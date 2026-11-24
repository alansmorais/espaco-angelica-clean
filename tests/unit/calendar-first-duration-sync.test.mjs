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
