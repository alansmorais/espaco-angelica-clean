import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../../apps-script/CalendarFirstDurationSync.gs');
const source = readFileSync(sourcePath, 'utf8');

const context = {
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  RegExp,
  JSON,
  isFinite,
  Utilities: {
    formatDate(value, _timezone, pattern) {
      const local = new Date(new Date(value).getTime() - 3 * 60 * 60 * 1000);
      const iso = local.toISOString();
      if (pattern === 'yyyy-MM-dd') return iso.slice(0, 10);
      if (pattern === 'HH:mm') return iso.slice(11, 16);
      return iso;
    }
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => '' })
  }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: sourcePath });

const mainService = {
  id: 'manicure-tradicional',
  title: 'Manicure Tradicional',
  normalizedTitle: 'manicure tradicional',
  durationMinutes: 45,
  sheetName: 'Serviços',
  row: 2
};
const addService = {
  id: 'pedicure-tradicional',
  title: 'Pedicure Tradicional',
  normalizedTitle: 'pedicure tradicional',
  durationMinutes: 50,
  sheetName: 'Serviços',
  row: 3
};
const catalog = {
  byId: {
    'manicure-tradicional': [mainService],
    'pedicure-tradicional': [addService]
  },
  byTitle: {
    'manicure tradicional': [mainService],
    'pedicure tradicional': [addService]
  }
};

function apiEvent({
  id = 'event-1',
  summary = 'Maria Silva - Manicure Tradicional',
  start = '2027-01-12T10:00:00-03:00',
  end = '2027-01-12T10:45:00-03:00',
  recurringEventId,
  originalStartTime,
  allDay = false,
  status = 'confirmed',
  description = '',
  eventType = 'default'
} = {}) {
  return {
    id,
    summary,
    description,
    status,
    eventType,
    start: allDay ? { date: '2027-01-12' } : { dateTime: start },
    end: allDay ? { date: '2027-01-13' } : { dateTime: end },
    recurringEventId,
    originalStartTime
  };
}

test('duration parser accepts minutes and hour/minute forms', () => {
  for (const [input, expected] of [
    [45, 45],
    ['45', 45],
    ['45 min', 45],
    ['1h', 60],
    ['1h30', 90],
    ['1h 30min', 90],
    ['2 horas', 120]
  ]) {
    assert.equal(context.cfsParseDurationMinutes_(input), expected, String(input));
  }
});

test('duration parser rejects missing, negative, ambiguous and out-of-range values', () => {
  for (const input of [null, '', 'indefinido', 0, -30, '1:30', '30-45', '1/2h', 1441, '2h 75min']) {
    assert.equal(context.cfsParseDurationMinutes_(input), null, String(input));
  }
});

test('main service plus every add-on is summed from unique official catalogue IDs', () => {
  const result = context.cfsResolveServiceDuration_(
    catalog,
    'manicure-tradicional',
    'Manicure Tradicional',
    ['pedicure-tradicional']
  );
  assert.equal(result.ok, true);
  assert.equal(result.durationMinutes, 95);
  assert.equal(result.additionalServices.length, 1);
});

test('unknown add-ons and title/ID mismatches fail closed', () => {
  const unknownAddon = context.cfsResolveServiceDuration_(
    catalog, 'manicure-tradicional', 'Manicure Tradicional', ['unknown-addon']
  );
  assert.equal(unknownAddon.ok, false);
  assert.equal(unknownAddon.errorCode, 'INVALID_ADDITIONAL_DURATION');

  const mismatch = context.cfsResolveServiceDuration_(
    catalog, 'manicure-tradicional', 'Pedicure Tradicional', []
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.errorCode, 'MAIN_SERVICE_TITLE_MISMATCH');
});

test('Calendar title import requires exact catalogue service segments and a client name', () => {
  const parsed = context.cfsMatchTitleToCatalog_(
    'Maria Silva - Manicure Tradicional + Pedicure Tradicional',
    catalog
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.clientName, 'Maria Silva');
  assert.equal(parsed.service.id, 'manicure-tradicional');
  assert.deepEqual(Array.from(parsed.additionalServices, s => s.id), ['pedicure-tradicional']);

  const uncertain = context.cfsMatchTitleToCatalog_('Maria Silva - procedimento especial', catalog);
  assert.equal(uncertain.ok, false);
});

test('all-day, personal/vacation, and non-standard event types are protected', () => {
  assert.equal(
    context.cfsProtectedReason_(apiEvent({ allDay: true })),
    'ALL_DAY_OR_MISSING_START'
  );
  assert.equal(
    context.cfsProtectedReason_(apiEvent({ summary: 'Férias da Angélica' })),
    'PROTECTED_OR_TEST_EVENT'
  );
  assert.equal(
    context.cfsProtectedReason_(apiEvent({ summary: 'Bloqueio - almoço' })),
    'PROTECTED_OR_TEST_EVENT'
  );
  assert.equal(
    context.cfsProtectedReason_(apiEvent({ eventType: 'outOfOffice' })),
    'NON_STANDARD_EVENT_TYPE'
  );
  assert.equal(context.cfsProtectedReason_(apiEvent()), '');
});

test('recurring instances are matched by unique instance ID and immutable originalStartTime', () => {
  const original = '2027-01-12T10:00:00-03:00';
  const priorOccurrence = {
    row: 8,
    client: 'Maria Silva',
    dateKey: '2027-01-05',
    timeKey: '10:00',
    eventId: 'series-master',
    originalStartKey: '2027-01-05T10:00:00-03:00',
    appointmentId: 'apt-gcal-prior',
    status: 'confirmado'
  };
  const event = apiEvent({
    id: 'instance-12',
    recurringEventId: 'series-master',
    originalStartTime: { dateTime: original }
  });

  const nextOccurrence = context.cfsFindRowForEvent_(event, '2027-01-12', '10:00', [priorOccurrence]);
  assert.equal(nextOccurrence.row, null);
  assert.equal(nextOccurrence.method, 'NEW_RECURRING_INSTANCE');

  const sameOccurrenceRow = {
    ...priorOccurrence,
    row: 9,
    dateKey: '2027-01-12',
    timeKey: '10:00',
    eventId: 'series-master',
    originalStartKey: ''
  };
  const migrated = context.cfsFindRowForEvent_(event, '2027-01-12', '10:00', [priorOccurrence, sameOccurrenceRow]);
  assert.equal(migrated.row.row, 9);
  assert.equal(migrated.method, 'LEGACY_SERIES_ID_AND_ORIGINAL_START');

  const alreadyMigrated = {
    ...sameOccurrenceRow,
    eventId: 'instance-12',
    originalStartKey: original
  };
  const direct = context.cfsFindRowForEvent_(event, '2027-01-12', '10:00', [alreadyMigrated]);
  assert.equal(direct.row.row, 9);
  assert.equal(direct.method, 'INSTANCE_EVENT_ID_AND_ORIGINAL_START');
});


test('a unique same-day client row is matched when Calendar changed the start time before linking', () => {
  const row = {
    row: 12,
    client: 'Maria Silva',
    dateKey: '2027-01-12',
    timeKey: '10:00',
    eventId: '',
    appointmentId: 'apt-existing',
    status: 'confirmado'
  };
  const event = apiEvent({ start: '2027-01-12T11:00:00-03:00' });
  const match = context.cfsFindRowForEvent_(event, '2027-01-12', '11:00', [row]);
  assert.equal(match.row.row, 12);
  assert.equal(match.method, 'UNIQUE_DATE_AND_CLIENT_START_TIME_CHANGED');
});

test('an appointment ID tag links a moved Calendar event without fuzzy matching', () => {
  const row = {
    row: 13,
    client: 'Maria Silva',
    dateKey: '2027-01-05',
    timeKey: '10:00',
    eventId: '',
    appointmentId: 'apt-tagged',
    status: 'confirmado'
  };
  const event = apiEvent({
    start: '2027-01-12T11:00:00-03:00',
    description: '[ESPACO_ANGELICA_APT_ID:apt-tagged]'
  });
  const match = context.cfsFindRowForEvent_(event, '2027-01-12', '11:00', [row]);
  assert.equal(match.row.row, 13);
  assert.equal(match.method, 'DESCRIPTION_APPOINTMENT_ID_TAG');
});

test('cancelled, protected, and human-review sheet rows are not synchronized', () => {
  assert.equal(context.cfsRowGuard_({ status: 'cancelado', appointmentId: 'apt-1' }), 'CANCELLED_ROW');
  assert.equal(context.cfsRowGuard_({ status: 'confirmado', appointmentId: 'apt-1793903805661' }), 'PENDING_HUMAN_REVIEW');
  assert.equal(context.cfsRowGuard_({ status: 'confirmado', appointmentId: 'apt-1794006950286-rec-4' }), 'EXCLUDED_APPOINTMENT');
});

test('a cancelled Calendar instance matches by unique instance ID', () => {
  const row = { row: 7, eventId: 'cancelled-instance', originalStartKey: '2027-01-12T10:00:00-03:00' };
  const cancelled = apiEvent({
    id: 'cancelled-instance',
    status: 'cancelled',
    recurringEventId: 'series-master',
    originalStartTime: { dateTime: '2027-01-12T10:00:00-03:00' }
  });
  assert.equal(context.cfsFindRowForCancelledEvent_(cancelled, [row]), row);
});

test('deterministic appointment ID is stable per event ID and original occurrence time', () => {
  const a = context.cfsDeterministicAppointmentId_('instance-12', '2027-01-12T10:00:00-03:00');
  const b = context.cfsDeterministicAppointmentId_('instance-12', '2027-01-12T10:00:00-03:00');
  const c = context.cfsDeterministicAppointmentId_('instance-19', '2027-01-19T10:00:00-03:00');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('a duration extension that overlaps another Calendar event is blocked', () => {
  const event = apiEvent({ id: 'target' });
  const other = apiEvent({
    id: 'blocked',
    summary: 'Bloqueio pessoal',
    start: '2027-01-12T11:00:00-03:00',
    end: '2027-01-12T12:00:00-03:00'
  });
  const proposedEnd = new Date('2027-01-12T11:30:00-03:00');
  assert.equal(context.cfsHasConflict_(event, proposedEnd, [event, other]).conflict, true);

  const noConflictEnd = new Date('2027-01-12T10:40:00-03:00');
  assert.equal(context.cfsHasConflict_(event, noConflictEnd, [event, other]).conflict, false);
});

test('write mode stays disabled unless the explicit Script Property is true', () => {
  assert.equal(context.cfsGetWriteEnabled_(), false);
  context.PropertiesService.getScriptProperties = () => ({ getProperty: name => name === 'CALENDAR_FIRST_SYNC_ENABLED' ? 'true' : '' });
  assert.equal(context.cfsGetWriteEnabled_(), true);
});

test('sync source requires Advanced Calendar API and never creates/deletes/relabels Calendar events', () => {
  assert.match(source, /Calendar\.Events\.list/);
  assert.match(source, /Calendar\.Events\.patch/);
  assert.doesNotMatch(source, /Calendar\.Events\.(?:insert|delete|move)\s*\(/);
  assert.doesNotMatch(source, /\.setTitle\s*\(/);
  assert.doesNotMatch(source, /\.setDescription\s*\(/);
  assert.match(source, /Agendamentos!U/);
});


function makeFakeSheet(initialRows, columnCount = 21) {
  const rows = initialRows.map(row => {
    const values = Array(columnCount).fill('');
    for (let i = 0; i < Math.min(row.length, columnCount); i++) values[i] = row[i] ?? '';
    return values;
  });
  function ensureRow(rowNumber) {
    while (rows.length < rowNumber) rows.push(Array(columnCount).fill(''));
  }
  return {
    _rows: rows,
    getLastRow() { return rows.length; },
    getLastColumn() { return columnCount; },
    getDataRange() { return this.getRange(1, 1, Math.max(1, rows.length), columnCount); },
    getRange(row, column, numRows = 1, numColumns = 1) {
      return {
        getValues() {
          const result = [];
          for (let r = 0; r < numRows; r++) {
            const line = [];
            for (let c = 0; c < numColumns; c++) {
              line.push(rows[row - 1 + r]?.[column - 1 + c] ?? '');
            }
            result.push(line);
          }
          return result;
        },
        getDisplayValues() {
          return this.getValues().map(line => line.map(value => value instanceof Date ? value.toISOString() : String(value ?? '')));
        },
        getValue() { return this.getValues()[0][0]; },
        getDisplayValue() { return this.getDisplayValues()[0][0]; },
        setValue(value) {
          ensureRow(row);
          rows[row - 1][column - 1] = value;
        },
        setValues(values) {
          for (let r = 0; r < values.length; r++) {
            ensureRow(row + r);
            for (let c = 0; c < values[r].length; c++) {
              rows[row - 1 + r][column - 1 + c] = values[r][c];
            }
          }
        }
      };
    }
  };
}

function makeCalendarSyncFixture({ appointmentRows, events, writeEnabled = false, beforePatch } = {}) {
  const headers = Array(21).fill('');
  headers[1] = 'Cliente';
  headers[4] = 'Procedimento';
  headers[5] = 'Data';
  headers[6] = 'Horário';
  headers[8] = 'Status';
  headers[9] = 'ID Agendamento';
  headers[13] = 'IDs Serviços Adicionais';
  headers[15] = 'ID Serviço Principal';
  headers[19] = 'Google Calendar Event ID';
  headers[20] = 'Google Calendar Original Start';
  const appointments = makeFakeSheet(appointmentRows || [headers]);
  const services = makeFakeSheet([
    ['ID', 'Nome', 'Categoria', 'Preço', 'Preço formatado', 'Duração'],
    ['manicure-tradicional', 'Manicure Tradicional', 'Unhas', 100, 'R$ 100,00', 45],
    ['pedicure-tradicional', 'Pedicure Tradicional', 'Unhas', 80, 'R$ 80,00', 50]
  ]);
  const spreadsheet = {
    getSheetByName(name) {
      if (name === 'Agendamentos') return appointments;
      if (name === 'Serviços') return services;
      return null;
    }
  };
  const cache = new Map();
  const patches = [];
  const listCalls = [];
  context.TARGET_SPREADSHEET_ID = 'fixture-spreadsheet';
  context.PropertiesService = {
    getScriptProperties: () => ({
      getProperty(name) {
        if (name === 'SPREADSHEET_ID') return 'fixture-spreadsheet';
        if (name === 'GOOGLE_CALENDAR_ID') return 'fixture-calendar';
        if (name === 'CALENDAR_FIRST_SYNC_ENABLED') return writeEnabled ? 'true' : '';
        return '';
      }
    })
  };
  context.SpreadsheetApp = { openById: () => spreadsheet, flush() {} };
  context.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  context.CacheService = {
    getScriptCache: () => ({
      get: key => cache.get(key),
      put: (key, value) => cache.set(key, value)
    })
  };
  context.Logger = { log() {} };
  context.Calendar = {
    Events: {
      list(_calendarId, params) {
        listCalls.push(params);
        return { items: events || [] };
      },
      patch(body, calendarId, eventId) {
        if (beforePatch) beforePatch({ body, calendarId, eventId, appointments });
        patches.push({ body, calendarId, eventId });
        return {};
      }
    }
  };
  return { appointments, services, patches, listCalls, spreadsheet, headers };
}

test('dry-run imports and calculates an appointment without writing Sheets or Calendar', () => {
  const event = apiEvent({
    id: 'new-calendar-event',
    summary: 'Maria Silva - Manicure Tradicional + Pedicure Tradicional'
  });
  const fixture = makeCalendarSyncFixture({ events: [event], writeEnabled: false });
  const result = context.syncCalendarBookingsAndDurations({
    dryRun: true,
    startDate: '2027-01-12',
    endDate: '2027-01-13'
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.counts.rowsImported, 1);
  assert.equal(result.durationResults[0].status, 'WOULD_UPDATE_END_ONLY');
  assert.equal(result.durationResults[0].durationMinutes, 95);
  assert.equal(fixture.appointments.getLastRow(), 1);
  assert.equal(fixture.patches.length, 0);
  assert.equal(fixture.listCalls[0].singleEvents, true);
  assert.equal(fixture.listCalls[0].showDeleted, true);
});

test('write mode persists the Sheet event link before patching only Calendar end', () => {
  const event = apiEvent({
    id: 'linked-calendar-event',
    summary: 'Maria Silva - Manicure Tradicional + Pedicure Tradicional'
  });
  const row = Array(21).fill('');
  row[1] = 'Maria Silva';
  row[4] = 'Manicure Tradicional';
  row[5] = '2027-01-12';
  row[6] = '10:00';
  row[8] = 'confirmado';
  row[9] = 'apt-existing';
  row[13] = JSON.stringify(['pedicure-tradicional']);
  row[15] = 'manicure-tradicional';
  const headerFixture = makeCalendarSyncFixture({});
  const fixture = makeCalendarSyncFixture({
    appointmentRows: [headerFixture.headers, row],
    events: [event],
    writeEnabled: true,
    beforePatch({ body, calendarId, eventId, appointments }) {
      assert.equal(appointments.getRange(2, 20).getValue(), eventId);
      assert.deepEqual(Object.keys(body), ['end']);
      assert.equal(calendarId, 'fixture-calendar');
    }
  });
  const result = context.syncCalendarBookingsAndDurations({
    dryRun: false,
    startDate: '2027-01-12',
    endDate: '2027-01-13'
  });
  assert.equal(result.dryRun, false);
  assert.equal(result.durationResults[0].status, 'UPDATED_END_ONLY');
  assert.equal(result.durationResults[0].durationMinutes, 95);
  assert.equal(fixture.appointments.getRange(2, 20).getValue(), 'linked-calendar-event');
  assert.equal(fixture.patches.length, 1);
  assert.equal(fixture.patches[0].body.end.timeZone, 'America/Sao_Paulo');
  assert.equal(fixture.patches[0].eventId, 'linked-calendar-event');
});

test('write mode imports a recurring instance with individual ID and original start key', () => {
  const originalStart = '2027-01-12T10:00:00-03:00';
  const event = apiEvent({
    id: 'recurring-instance-12',
    recurringEventId: 'recurring-series',
    originalStartTime: { dateTime: originalStart },
    summary: 'Maria Silva - Manicure Tradicional + Pedicure Tradicional'
  });
  const fixture = makeCalendarSyncFixture({
    events: [event],
    writeEnabled: true,
    beforePatch({ eventId, appointments }) {
      assert.equal(appointments.getRange(2, 20).getValue(), eventId);
      assert.equal(appointments.getRange(2, 21).getValue(), originalStart);
    }
  });
  const result = context.syncCalendarBookingsAndDurations({
    dryRun: false,
    startDate: '2027-01-12',
    endDate: '2027-01-13'
  });
  assert.equal(result.counts.rowsImported, 1);
  assert.equal(fixture.appointments.getRange(2, 20).getValue(), 'recurring-instance-12');
  assert.equal(fixture.appointments.getRange(2, 21).getValue(), originalStart);
  assert.equal(fixture.patches.length, 1);
});

test('a cancelled Calendar appointment marks its matched Sheet row cancelled without recreating anything', () => {
  const headerFixture = makeCalendarSyncFixture({});
  const row = Array(21).fill('');
  row[1] = 'Maria Silva';
  row[4] = 'Manicure Tradicional';
  row[5] = '2027-01-12';
  row[6] = '10:00';
  row[8] = 'confirmado';
  row[9] = 'apt-existing';
  row[15] = 'manicure-tradicional';
  row[19] = 'cancelled-calendar-event';
  const cancelled = { id: 'cancelled-calendar-event', status: 'cancelled' };
  const fixture = makeCalendarSyncFixture({
    appointmentRows: [headerFixture.headers, row],
    events: [cancelled],
    writeEnabled: true
  });
  const result = context.syncCalendarBookingsAndDurations({
    dryRun: false,
    startDate: '2027-01-12',
    endDate: '2027-01-13'
  });
  assert.equal(result.counts.cancelledRowsMarked, 1);
  assert.equal(fixture.appointments.getRange(2, 9).getValue(), 'cancelado');
  assert.equal(fixture.appointments.getLastRow(), 2);
  assert.equal(fixture.patches.length, 0);
});
