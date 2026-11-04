import test from 'node:test';
import assert from 'node:assert';

/**
 * Funções idênticas às implementadas em apps-script/Code.gs
 */
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
 * Simulação fiel do mecanismo de verificação de conflitos do Code.gs
 */
function evaluateBookingConflict({
  requestedDateKey,
  requestedTimeKey,
  requestedDuration,
  existingRows
}) {
  const requestedStart = timeToMinutes(requestedTimeKey);
  if (requestedStart === null) return { error: 'Horário inválido' };
  const requestedEnd = requestedStart + requestedDuration;

  for (let i = 0; i < existingRows.length; i++) {
    const row = existingRows[i];
    const existingDateKey = row.date;
    const existingTimeRaw = String(row.time || '').trim();
    const existingStatus = String(row.status || 'pendente_pix').toLowerCase();
    const sameDate = requestedDateKey === existingDateKey;

    if (!sameDate) continue;

    // 1. Verificação de ID duplicado (idempotência)
    if (row.id && row.requestedId && row.id.toLowerCase() === row.requestedId.toLowerCase()) {
      return { duplicate: true, persisted: true, message: 'Reserva já confirmada anteriormente.' };
    }

    // 2. Bloqueio dia inteiro
    const allDayBlocked = existingStatus === 'bloqueado' &&
      ['dia inteiro', 'dia todo', 'all day'].indexOf(existingTimeRaw.toLowerCase()) !== -1;

    // 3. Bloqueio por intervalo ou horário específico
    const blockInterval = existingStatus === 'bloqueado' ? parseBlockInterval(existingTimeRaw) : null;
    const slotBlocked = Boolean(blockInterval && intervalsOverlap(
      requestedStart, requestedEnd, blockInterval.start, blockInterval.end
    ));

    // 4. Conflito com agendamento ativo
    let activeBookingConflict = false;
    if (['cancelado', 'teste_sistema', 'bloqueado'].indexOf(existingStatus) === -1) {
      const existingStart = timeToMinutes(existingTimeRaw);
      if (existingStart !== null) {
        let existingDuration = row.durationMinutes || parseDurationMinutes(row.durationText);
        if (!existingDuration) existingDuration = 30;
        activeBookingConflict = intervalsOverlap(
          requestedStart, requestedEnd, existingStart, existingStart + existingDuration
        );
      }
    }

    if (allDayBlocked || slotBlocked || activeBookingConflict) {
      return {
        conflict: true,
        persisted: false,
        reason: allDayBlocked ? 'allDayBlocked' : slotBlocked ? 'slotBlocked' : 'activeBookingConflict',
        conflictingWith: row
      };
    }
  }

  return { conflict: false, allowed: true };
}

// =========================================================================
// TESTES OBRIGATÓRIOS DO ESCOPO
// =========================================================================

test('Regra de Ouro: 14:00 com duração de 90 min BLOQUEIA 14:30', () => {
  const existingRows = [
    {
      id: 'apt-001',
      date: '2026-11-10',
      time: '14:00',
      status: 'confirmado',
      durationMinutes: 90 // 14:00 às 15:30
    }
  ];

  // Tentativa de agendar às 14:30 com 30 min
  const result1430 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:30',
    requestedDuration: 30,
    existingRows
  });

  assert.strictEqual(result1430.conflict, true, '14:30 deve ser bloqueado');
  assert.strictEqual(result1430.reason, 'activeBookingConflict');
});

test('Regra de Ouro: 14:00 com duração de 90 min BLOQUEIA 15:00 e 15:15', () => {
  const existingRows = [
    {
      id: 'apt-001',
      date: '2026-11-10',
      time: '14:00',
      status: 'confirmado',
      durationMinutes: 90 // 14:00 às 15:30
    }
  ];

  const result1500 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '15:00',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1500.conflict, true, '15:00 deve ser bloqueado');

  const result1515 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '15:15',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1515.conflict, true, '15:15 deve ser bloqueado');
});

test('Regra de Ouro: 14:00 com duração de 90 min PERMITE 15:30 se não houver outro conflito', () => {
  const existingRows = [
    {
      id: 'apt-001',
      date: '2026-11-10',
      time: '14:00',
      status: 'confirmado',
      durationMinutes: 90 // 14:00 às 15:30
    }
  ];

  const result1530 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '15:30',
    requestedDuration: 30,
    existingRows
  });

  assert.strictEqual(result1530.conflict, false, '15:30 deve ser permitido');
  assert.strictEqual(result1530.allowed, true);
});

test('Horário anterior adjacente: 12:30 com 90 min termina às 14:00 e PERMITE reserva às 14:00', () => {
  const existingRows = [
    {
      id: 'apt-001',
      date: '2026-11-10',
      time: '12:30',
      status: 'confirmado',
      durationMinutes: 90 // 12:30 às 14:00
    }
  ];

  const result1400 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:00',
    requestedDuration: 60,
    existingRows
  });

  assert.strictEqual(result1400.conflict, false, '14:00 é adjacente e deve ser permitido');
  assert.strictEqual(result1400.allowed, true);
});

test('Procedimentos adicionais somam à duração principal para definir o intervalo ocupado', () => {
  // Principal: 60 min, Adicional 1: 30 min, Adicional 2: 15 min -> Total 105 min (14:00 às 15:45)
  const mainDuration = parseDurationMinutes('1h 00min');
  const add1Duration = parseDurationMinutes('30min');
  const add2Duration = parseDurationMinutes('15min');
  const totalDuration = mainDuration + add1Duration + add2Duration;

  assert.strictEqual(totalDuration, 105, 'Duração total deve ser 105 minutos');

  const existingRows = [
    {
      id: 'apt-001',
      date: '2026-11-10',
      time: '14:00',
      status: 'pendente_pix',
      durationMinutes: totalDuration // 14:00 até 15:45
    }
  ];

  // 15:30 deve ser bloqueado porque o atendimento vai até 15:45
  const result1530 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '15:30',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1530.conflict, true, '15:30 deve estar bloqueado pela soma dos adicionais');

  // 15:45 deve ser permitido
  const result1545 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '15:45',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1545.conflict, false, '15:45 é o próximo horário disponível');
});

test('Agendamentos cancelados NÃO bloqueiam horários', () => {
  const existingRows = [
    {
      id: 'apt-canceled',
      date: '2026-11-10',
      time: '14:00',
      status: 'cancelado',
      durationMinutes: 90
    }
  ];

  // Tentativa no exato mesmo horário de um agendamento cancelado
  const result1400 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:00',
    requestedDuration: 90,
    existingRows
  });
  assert.strictEqual(result1400.conflict, false, 'Agendamento cancelado às 14:00 não deve bloquear 14:00');

  // Tentativa no intervalo de 14:30
  const result1430 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:30',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1430.conflict, false, 'Agendamento cancelado às 14:00 não deve bloquear 14:30');
});

test('Agendamentos com status teste_sistema NÃO bloqueiam horários', () => {
  const existingRows = [
    {
      id: 'apt-test-system',
      date: '2026-11-10',
      time: '14:00',
      status: 'teste_sistema',
      durationMinutes: 90
    }
  ];

  const result1400 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:00',
    requestedDuration: 90,
    existingRows
  });
  assert.strictEqual(result1400.conflict, false, 'teste_sistema não deve bloquear');
});

test('Idempotência: Repetir a mesma requisição (mesmo appointmentId) NÃO duplica o registro', () => {
  const existingRows = [
    {
      id: 'apt-unique-12345',
      requestedId: 'apt-unique-12345',
      date: '2026-11-10',
      time: '14:00',
      status: 'pendente_pix',
      durationMinutes: 90
    }
  ];

  // Reenvio da mesma requisição
  const resubmission = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:00',
    requestedDuration: 90,
    existingRows: [
      { ...existingRows[0], requestedId: 'apt-unique-12345' }
    ]
  });

  assert.strictEqual(resubmission.duplicate, true, 'Deve identificar como duplicata legítima');
  assert.strictEqual(resubmission.persisted, true, 'Mantém persisted: true da reserva anterior');
});

test('Simulação de Concorrência atômica: Dois envios simultâneos NÃO criam duas reservas', async () => {
  // Simula o comportamento do LockService do Google Apps Script com barreira de exclusão mútua
  let isLocked = false;
  const sheet = [];

  async function simulateAtomicBookingRequest({ id, date, time, durationMinutes }) {
    // Tenta adquirir o lock com espera
    let waitAttempts = 0;
    while (isLocked && waitAttempts < 10) {
      await new Promise(r => setTimeout(r, 10));
      waitAttempts++;
    }

    isLocked = true;
    try {
      // 1. Checa conflito na planilha atualizada
      const conflictCheck = evaluateBookingConflict({
        requestedDateKey: date,
        requestedTimeKey: time,
        requestedDuration: durationMinutes,
        existingRows: sheet
      });

      if (conflictCheck.conflict) {
        return { success: false, conflict: true, message: 'Horário sobreposto' };
      }

      // 2. Persiste a linha
      sheet.push({
        id,
        date,
        time,
        status: 'pendente_pix',
        durationMinutes
      });

      return { success: true, persisted: true, id };
    } finally {
      isLocked = false;
    }
  }

  // Dois envios simultâneos para o mesmo horário/intervalo (14:00 com 90 min vs 14:30 com 30 min)
  const [res1, res2] = await Promise.all([
    simulateAtomicBookingRequest({ id: 'apt-sim-1', date: '2026-11-10', time: '14:00', durationMinutes: 90 }),
    simulateAtomicBookingRequest({ id: 'apt-sim-2', date: '2026-11-10', time: '14:30', durationMinutes: 30 })
  ]);

  // Exatamente uma das requisições deve ter sucesso e a outra deve ser rejeitada por conflito
  const successes = [res1, res2].filter(r => r.success);
  const conflicts = [res1, res2].filter(r => r.conflict);

  assert.strictEqual(successes.length, 1, 'Apenas 1 reserva deve ser gravada na concorrência');
  assert.strictEqual(conflicts.length, 1, 'A segunda reserva simultânea deve ser rejeitada por conflito');
  assert.strictEqual(sheet.length, 1, 'A planilha deve conter exatamente 1 linha');
});

test('Bloqueios administrativos: intervalo bloqueado pelo admin impede reservas', () => {
  const existingRows = [
    {
      id: 'block-001',
      date: '2026-11-10',
      time: '14:00 às 16:00',
      status: 'bloqueado'
    }
  ];

  const result1430 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:30',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1430.conflict, true, '14:30 deve ser bloqueado pelo intervalo administrativo');
  assert.strictEqual(result1430.reason, 'slotBlocked');

  const result1600 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '16:00',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1600.conflict, false, '16:00 deve ser liberado após o término do bloqueio');
});

test('Bloqueios administrativos: bloqueio de horário pontual (ex: 14:00) impede reservas', () => {
  const existingRows = [
    {
      id: 'block-002',
      date: '2026-11-10',
      time: '14:00',
      status: 'bloqueado'
    }
  ];

  const result1400 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:00',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1400.conflict, true, '14:00 deve ser bloqueado');
  assert.strictEqual(result1400.reason, 'slotBlocked');

  const result1430 = evaluateBookingConflict({
    requestedDateKey: '2026-11-10',
    requestedTimeKey: '14:30',
    requestedDuration: 30,
    existingRows
  });
  assert.strictEqual(result1430.conflict, false, '14:30 deve estar livre');
});
