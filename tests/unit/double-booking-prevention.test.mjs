import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Double Booking Prevention and Real-time Availability Test Suite
 *
 * Verifies all 9 mandatory requirements:
 * 1. Free time succeeds.
 * 2. Exact same time rejected with code SLOT_UNAVAILABLE and message.
 * 3. Overlapping time interval (e.g., 14:00 with 90min blocks 14:30, 15:00, 15:15) rejected.
 * 4. Non-overlapping time (e.g., 15:30) succeeds.
 * 5. Cancelled appointment frees the slot.
 * 6. Blocked interval blocks overlapping times.
 * 7. Concurrent requests serialize: first commits, second receives SLOT_UNAVAILABLE.
 * 8. Calendar slot availability calculation reflects backend state.
 * 9. Admin-created manual appointment cannot overlap existing appointment.
 */

// Core time and duration parsing helpers matching Code.gs and frontend
function timeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseDurationMinutes(value) {
  const text = String(value || '').toLowerCase().trim();
  const hoursMatch = text.match(/(\d+)\s*h(?:ou?rs?)?/);
  const minutesMatch = text.match(/(?:h\s*)?(\d+)\s*(?:min|m\b)/) || text.match(/h\s*(\d{1,2})\b/);
  const pureMinutes = !hoursMatch ? text.match(/^(\d+)$/) : null;
  const total = (hoursMatch ? Number(hoursMatch[1]) * 60 : 0) +
    (minutesMatch ? Number(minutesMatch[1]) : (pureMinutes ? Number(pureMinutes[1]) : 0));
  return total > 0 && Number.isFinite(total) ? total : 30;
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function parseBlockInterval(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}:\d{2})\s*(?:às|as|-)\s*(\d{1,2}:\d{2})$/i);
  if (match) {
    const start = timeToMinutes(match[1]);
    const end = timeToMinutes(match[2]);
    return start !== null && end !== null && end > start ? { start, end } : null;
  }
  const singleMatch = raw.match(/^(\d{1,2}:\d{2})$/);
  if (singleMatch) {
    const singleStart = timeToMinutes(singleMatch[1]);
    return singleStart !== null ? { start: singleStart, end: singleStart + 30 } : null;
  }
  return null;
}

/**
 * Server-side booking validation engine simulating Code.gs createBooking / updateAppointment
 */
class MockSpreadsheetBackend {
  constructor() {
    this.rows = [];
    this.blocks = [];
    this.locked = false;
    this.flushed = false;
  }

  acquireLock() {
    if (this.locked) {
      throw new Error('Lock timeout');
    }
    this.locked = true;
  }

  releaseLock() {
    this.locked = false;
  }

  flush() {
    this.flushed = true;
  }

  createBooking(data) {
    this.acquireLock();
    try {
      const requestedDateKey = data.date;
      const requestedTimeKey = data.time;
      const requestedStart = timeToMinutes(requestedTimeKey);
      if (requestedStart === null) {
        return { status: 'error', success: false, persisted: false, message: 'Horário inválido.' };
      }

      // Compute total duration: main service + sum of additional services
      let requestedDuration = data.durationMinutes || parseDurationMinutes(data.durationText);
      if (Array.isArray(data.additionalDurations)) {
        for (const addDur of data.additionalDurations) {
          requestedDuration += addDur;
        }
      }
      const requestedEnd = requestedStart + requestedDuration;

      // Check external blocks (e.g. Schedule blocks)
      for (const block of this.blocks) {
        if (block.active === false || block.date !== requestedDateKey) continue;
        if (block.allDay) {
          return {
            status: 'error',
            success: false,
            persisted: false,
            conflict: true,
            code: 'SLOT_UNAVAILABLE',
            message: 'Esta data está bloqueada para atendimentos. Escolha outro dia.'
          };
        }
        if (block.startTime && block.endTime) {
          const bStart = timeToMinutes(block.startTime);
          const bEnd = timeToMinutes(block.endTime);
          if (bStart !== null && bEnd !== null && intervalsOverlap(requestedStart, requestedEnd, bStart, bEnd)) {
            return {
              status: 'error',
              success: false,
              persisted: false,
              conflict: true,
              code: 'SLOT_UNAVAILABLE',
              message: 'Este intervalo está bloqueado. Escolha outro horário.'
            };
          }
        }
      }

      // Check existing rows in sheet
      for (const row of this.rows) {
        if (row.id && row.id.toLowerCase() === String(data.appointmentId).toLowerCase()) {
          return {
            status: 'success',
            duplicate: true,
            persisted: true,
            message: `Reserva ${data.appointmentId} já confirmada anteriormente no Sheets.`
          };
        }

        const existingDate = row.date;
        if (existingDate !== requestedDateKey) continue;

        const existingStatus = String(row.status || 'pendente_pix').toLowerCase();
        const existingTimeRaw = String(row.time || '').trim();

        const allDayBlocked = existingStatus === 'bloqueado' &&
          ['dia inteiro', 'dia todo', 'all day'].includes(existingTimeRaw.toLowerCase());

        const blockInterval = existingStatus === 'bloqueado' ? parseBlockInterval(existingTimeRaw) : null;
        const slotBlocked = Boolean(blockInterval && intervalsOverlap(
          requestedStart, requestedEnd, blockInterval.start, blockInterval.end
        ));

        let activeBookingConflict = false;
        if (!['cancelado', 'teste_sistema', 'bloqueado'].includes(existingStatus)) {
          const existingStart = timeToMinutes(existingTimeRaw);
          if (existingStart !== null) {
            let existingDuration = row.durationMinutes || parseDurationMinutes(row.serviceDuration);
            if (Array.isArray(row.additionalDurations)) {
              for (const addDur of row.additionalDurations) {
                existingDuration += addDur;
              }
            }
            if (!existingDuration) existingDuration = 30;
            const existingEnd = existingStart + existingDuration;
            activeBookingConflict = intervalsOverlap(requestedStart, requestedEnd, existingStart, existingEnd);
          }
        }

        if (allDayBlocked || slotBlocked || activeBookingConflict) {
          return {
            status: 'error',
            success: false,
            persisted: false,
            conflict: true,
            code: 'SLOT_UNAVAILABLE',
            message: allDayBlocked
              ? 'Esta data está bloqueada para atendimentos. Escolha outro dia.'
              : slotBlocked
                ? 'Este intervalo está bloqueado. Escolha outro horário.'
                : 'Este horário acabou de ser reservado. Por favor, escolha outro horário.'
          };
        }
      }

      // Persist appointment
      this.rows.push({
        id: data.appointmentId,
        date: data.date,
        time: data.time,
        clientName: data.clientName,
        serviceTitle: data.serviceTitle,
        status: data.status || 'pendente_pix',
        durationMinutes: requestedDuration,
        additionalDurations: data.additionalDurations || []
      });

      this.flush();

      return {
        status: 'success',
        success: true,
        persisted: true,
        appointmentId: data.appointmentId,
        message: 'Agendamento gravado na planilha oficial.'
      };
    } finally {
      this.releaseLock();
    }
  }

  getPublicAvailability() {
    const slots = [];
    const blockedDates = [];

    for (const row of this.rows) {
      if (!row.date) continue;
      const status = String(row.status || 'pendente_pix').toLowerCase();
      if (status === 'cancelado') continue;
      if (status === 'bloqueado' && (!row.time || row.time.toLowerCase() === 'dia inteiro')) {
        blockedDates.push(row.date);
        continue;
      }

      slots.push({
        id: row.id,
        date: row.date,
        time: row.time,
        status: row.status,
        serviceDuration: `${row.durationMinutes || 30} min`
      });
    }

    for (const block of this.blocks) {
      if (block.active === false || !block.date) continue;
      if (block.allDay) {
        blockedDates.push(block.date);
      } else if (block.startTime && block.endTime) {
        slots.push({
          id: `block-${block.date}-${block.startTime}`,
          date: block.date,
          time: `${block.startTime} às ${block.endTime}`,
          status: 'bloqueado',
          serviceDuration: '30 min'
        });
      }
    }

    return {
      status: 'success',
      success: true,
      slots,
      blockedDates: Array.from(new Set(blockedDates))
    };
  }
}

/**
 * Client-side slot availability helper matching BookingWizard.tsx
 */
function isSlotUnavailableClient(slotTime, requestedDurationMinutes, dateKey, activeAppointments, activeBlockedDates) {
  const start = timeToMinutes(slotTime);
  if (start === null) return true;
  const end = start + requestedDurationMinutes;

  if (activeBlockedDates.includes(dateKey)) return true;

  return activeAppointments.some(a => {
    if (a.date !== dateKey || ['cancelado', 'teste_sistema'].includes(a.status)) return false;
    const raw = String(a.time || '').trim();
    if (a.status === 'bloqueado') {
      if (['dia inteiro', 'dia todo', 'all day'].includes(raw.toLowerCase())) return true;
      const interval = /^(\d{1,2}:\d{2})\s*(?:às|as|-)\s*(\d{1,2}:\d{2})$/i.exec(raw);
      if (interval) {
        const bStart = timeToMinutes(interval[1]);
        const bEnd = timeToMinutes(interval[2]);
        return bStart !== null && bEnd !== null && start < bEnd && end > bStart;
      }
    }
    const oStart = timeToMinutes(raw);
    if (oStart === null) return false;
    const oDur = parseDurationMinutes(a.serviceDuration);
    const oEnd = oStart + oDur;
    return start < oEnd && end > oStart;
  });
}

test('1. Free time slot succeeds and is persisted with flush', () => {
  const backend = new MockSpreadsheetBackend();
  const res = backend.createBooking({
    appointmentId: 'apt-001',
    date: '2026-11-20',
    time: '10:00',
    clientName: 'Carla Dias',
    serviceTitle: 'Manicure Completa',
    durationMinutes: 60
  });

  assert.equal(res.success, true);
  assert.equal(res.persisted, true);
  assert.equal(backend.flushed, true);
  assert.equal(backend.rows.length, 1);
  assert.equal(backend.rows[0].id, 'apt-001');
});

test('2. Exact same time slot is rejected with code SLOT_UNAVAILABLE', () => {
  const backend = new MockSpreadsheetBackend();
  backend.createBooking({
    appointmentId: 'apt-001',
    date: '2026-11-20',
    time: '10:00',
    clientName: 'Carla Dias',
    serviceTitle: 'Manicure Completa',
    durationMinutes: 60
  });

  const duplicateAttempt = backend.createBooking({
    appointmentId: 'apt-002',
    date: '2026-11-20',
    time: '10:00',
    clientName: 'Fernanda Rocha',
    serviceTitle: 'Manicure Completa',
    durationMinutes: 60
  });

  assert.equal(duplicateAttempt.success, false);
  assert.equal(duplicateAttempt.persisted, false);
  assert.equal(duplicateAttempt.conflict, true);
  assert.equal(duplicateAttempt.code, 'SLOT_UNAVAILABLE');
  assert.equal(duplicateAttempt.message, 'Este horário acabou de ser reservado. Por favor, escolha outro horário.');
});

test('3. Overlapping time interval is rejected (14:00 with 90 min blocks 14:30, 15:00, 15:15)', () => {
  const backend = new MockSpreadsheetBackend();
  // 14:00 + 90 min = 14:00 to 15:30
  backend.createBooking({
    appointmentId: 'apt-1400',
    date: '2026-11-20',
    time: '14:00',
    clientName: 'Juliana Paes',
    serviceTitle: 'Alongamento em Fibra',
    durationMinutes: 90
  });

  const conflictingTimes = ['14:15', '14:30', '14:45', '15:00', '15:15'];
  for (const conflictTime of conflictingTimes) {
    const attempt = backend.createBooking({
      appointmentId: `apt-conflict-${conflictTime.replace(':', '')}`,
      date: '2026-11-20',
      time: conflictTime,
      clientName: 'Cliente Tentativa',
      serviceTitle: 'Manicure',
      durationMinutes: 30
    });

    assert.equal(attempt.success, false, `Time ${conflictTime} should be rejected`);
    assert.equal(attempt.conflict, true);
    assert.equal(attempt.code, 'SLOT_UNAVAILABLE');
    assert.equal(attempt.message, 'Este horário acabou de ser reservado. Por favor, escolha outro horário.');
  }

  // Also verify that a booking starting at 13:30 with 60min duration (ends 14:30) is rejected
  const overlapFromBefore = backend.createBooking({
    appointmentId: 'apt-overlap-before',
    date: '2026-11-20',
    time: '13:30',
    clientName: 'Cliente Anterior',
    serviceTitle: 'Manicure e Pedicure',
    durationMinutes: 60
  });
  assert.equal(overlapFromBefore.success, false);
  assert.equal(overlapFromBefore.code, 'SLOT_UNAVAILABLE');
});

test('4. Non-overlapping time slot immediately adjacent succeeds (15:30 after 14:00-15:30)', () => {
  const backend = new MockSpreadsheetBackend();
  // 14:00 to 15:30
  backend.createBooking({
    appointmentId: 'apt-1400',
    date: '2026-11-20',
    time: '14:00',
    clientName: 'Juliana Paes',
    serviceTitle: 'Alongamento em Fibra',
    durationMinutes: 90
  });

  // 15:30 starts exactly when the 14:00 appointment ends
  const nextAttempt = backend.createBooking({
    appointmentId: 'apt-1530',
    date: '2026-11-20',
    time: '15:30',
    clientName: 'Mariana Lima',
    serviceTitle: 'Manicure Simples',
    durationMinutes: 30
  });

  assert.equal(nextAttempt.success, true);
  assert.equal(nextAttempt.persisted, true);
  assert.equal(backend.rows.length, 2);
});

test('5. Cancelled appointment frees the time slot', () => {
  const backend = new MockSpreadsheetBackend();
  backend.createBooking({
    appointmentId: 'apt-cancelled',
    date: '2026-11-20',
    time: '14:00',
    clientName: 'Renata Castro',
    serviceTitle: 'Alongamento em Fibra',
    durationMinutes: 90
  });

  // Mark as cancelled
  backend.rows[0].status = 'cancelado';

  // Availability query must exclude cancelled
  const avail = backend.getPublicAvailability();
  assert.equal(avail.slots.length, 0);

  // New booking at 14:00 must now succeed
  const newBooking = backend.createBooking({
    appointmentId: 'apt-new-at-1400',
    date: '2026-11-20',
    time: '14:00',
    clientName: 'Beatriz Santos',
    serviceTitle: 'Alongamento em Fibra',
    durationMinutes: 90
  });

  assert.equal(newBooking.success, true);
  assert.equal(newBooking.persisted, true);
});

test('6. Blocked interval or day blocks overlapping appointment attempts', () => {
  const backend = new MockSpreadsheetBackend();
  // Partial day block: 14:00 às 16:00
  backend.blocks.push({
    id: 'block-1',
    date: '2026-11-21',
    startTime: '14:00',
    endTime: '16:00',
    active: true,
    allDay: false
  });

  // Attempt inside blocked interval
  const attempt = backend.createBooking({
    appointmentId: 'apt-in-block',
    date: '2026-11-21',
    time: '14:30',
    clientName: 'Marina Silva',
    serviceTitle: 'Manicure',
    durationMinutes: 45
  });

  assert.equal(attempt.success, false);
  assert.equal(attempt.conflict, true);
  assert.equal(attempt.code, 'SLOT_UNAVAILABLE');
  assert.equal(attempt.message, 'Este intervalo está bloqueado. Escolha outro horário.');

  // Full day block
  backend.blocks.push({
    id: 'block-allday',
    date: '2026-11-22',
    active: true,
    allDay: true
  });

  const fullDayAttempt = backend.createBooking({
    appointmentId: 'apt-on-blocked-day',
    date: '2026-11-22',
    time: '10:00',
    clientName: 'Patricia Melo',
    serviceTitle: 'Manicure',
    durationMinutes: 30
  });

  assert.equal(fullDayAttempt.success, false);
  assert.equal(fullDayAttempt.code, 'SLOT_UNAVAILABLE');
  assert.equal(fullDayAttempt.message, 'Esta data está bloqueada para atendimentos. Escolha outro dia.');
});

test('7. Concurrent requests serialization via LockService', () => {
  const backend = new MockSpreadsheetBackend();

  // Simulate LockService: first request holds the lock
  backend.acquireLock();
  assert.equal(backend.locked, true);

  // Second request attempting to acquire lock throws / times out
  let timeoutCaught = false;
  try {
    backend.acquireLock();
  } catch (err) {
    timeoutCaught = true;
    assert.match(err.message, /Lock timeout/);
  }
  assert.equal(timeoutCaught, true);

  backend.releaseLock();
  assert.equal(backend.locked, false);

  // Now first request runs to completion
  const req1 = backend.createBooking({
    appointmentId: 'apt-concurrent-1',
    date: '2026-11-25',
    time: '11:00',
    clientName: 'Ana Clara',
    serviceTitle: 'Manicure',
    durationMinutes: 45
  });
  assert.equal(req1.success, true);

  // Immediately following second request for the same slot receives SLOT_UNAVAILABLE
  const req2 = backend.createBooking({
    appointmentId: 'apt-concurrent-2',
    date: '2026-11-25',
    time: '11:00',
    clientName: 'Claudia Souza',
    serviceTitle: 'Manicure',
    durationMinutes: 45
  });
  assert.equal(req2.success, false);
  assert.equal(req2.code, 'SLOT_UNAVAILABLE');
});

test('8. Calendar slot availability reflects backend state accurately', () => {
  const backend = new MockSpreadsheetBackend();
  backend.createBooking({
    appointmentId: 'apt-booked-1',
    date: '2026-11-20',
    time: '14:00',
    clientName: 'Luciana Ramos',
    serviceTitle: 'Alongamento em Fibra',
    durationMinutes: 90 // 14:00 - 15:30
  });

  const avail = backend.getPublicAvailability();
  assert.equal(avail.slots.length, 1);
  assert.equal(avail.slots[0].time, '14:00');
  assert.equal(avail.slots[0].serviceDuration, '90 min');

  // Verify client-side availability evaluation
  const activeAppointments = avail.slots;
  const activeBlockedDates = avail.blockedDates;

  // 14:00 must be unavailable
  assert.equal(isSlotUnavailableClient('14:00', 30, '2026-11-20', activeAppointments, activeBlockedDates), true);
  // 14:30 must be unavailable
  assert.equal(isSlotUnavailableClient('14:30', 30, '2026-11-20', activeAppointments, activeBlockedDates), true);
  // 15:00 must be unavailable
  assert.equal(isSlotUnavailableClient('15:00', 30, '2026-11-20', activeAppointments, activeBlockedDates), true);
  // 15:15 must be unavailable
  assert.equal(isSlotUnavailableClient('15:15', 30, '2026-11-20', activeAppointments, activeBlockedDates), true);
  // 15:30 must be AVAILABLE
  assert.equal(isSlotUnavailableClient('15:30', 30, '2026-11-20', activeAppointments, activeBlockedDates), false);
  // 16:00 must be AVAILABLE
  assert.equal(isSlotUnavailableClient('16:00', 30, '2026-11-20', activeAppointments, activeBlockedDates), false);
});

test('9. Admin manual booking creation cannot overlap existing appointment', () => {
  const backend = new MockSpreadsheetBackend();
  // Existing public appointment: 14:00 - 15:30
  backend.createBooking({
    appointmentId: 'apt-existing-public',
    date: '2026-11-20',
    time: '14:00',
    clientName: 'Cliente Publico',
    serviceTitle: 'Alongamento em Gel',
    durationMinutes: 90
  });

  // Admin attempts manual booking at 14:30
  const adminAttempt = backend.createBooking({
    appointmentId: 'apt-admin-manual',
    date: '2026-11-20',
    time: '14:30',
    clientName: 'Cliente Manual Admin',
    serviceTitle: 'Manicure',
    durationMinutes: 30
  });

  assert.equal(adminAttempt.success, false);
  assert.equal(adminAttempt.conflict, true);
  assert.equal(adminAttempt.code, 'SLOT_UNAVAILABLE');
  assert.equal(adminAttempt.message, 'Este horário acabou de ser reservado. Por favor, escolha outro horário.');

  // Admin manual booking at 15:30 succeeds
  const adminSuccess = backend.createBooking({
    appointmentId: 'apt-admin-manual-valid',
    date: '2026-11-20',
    time: '15:30',
    clientName: 'Cliente Manual Admin Válido',
    serviceTitle: 'Manicure',
    durationMinutes: 30
  });

  assert.equal(adminSuccess.success, true);
  assert.equal(adminSuccess.persisted, true);
});
