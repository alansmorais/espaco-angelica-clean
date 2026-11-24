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
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => '' })
  }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: sourcePath });

const catalog = {
  byId: {
    'manicure-tradicional': [{
      id: 'manicure-tradicional',
      title: 'Manicure Tradicional',
      normalizedTitle: 'manicure tradicional',
      durationMinutes: 45,
      sheetName: 'Serviços',
      row: 2
    }],
    'pedicure-tradicional': [{
      id: 'pedicure-tradicional',
      title: 'Pedicure Tradicional',
      normalizedTitle: 'pedicure tradicional',
      durationMinutes: 50,
      sheetName: 'Serviços',
      row: 3
    }]
  },
  byTitle: {
    'manicure tradicional': [{
      id: 'manicure-tradicional',
      title: 'Manicure Tradicional',
      normalizedTitle: 'manicure tradicional',
      durationMinutes: 45,
      sheetName: 'Serviços',
      row: 2
    }],
    'pedicure tradicional': [{
      id: 'pedicure-tradicional',
      title: 'Pedicure Tradicional',
      normalizedTitle: 'pedicure tradicional',
      durationMinutes: 50,
      sheetName: 'Serviços',
      row: 3
    }]
  }
};

function mockEvent({ id = 'event-1', title = 'Maria Silva - Manicure Tradicional', start, end, recurring = false, allDay = false, description = '' } = {}) {
  return {
    getId: () => id,
    getTitle: () => title,
    getDescription: () => description,
    getStartTime: () => new Date(start || '2027-01-12T10:00:00-03:00'),
    getEndTime: () => new Date(end || '2027-01-12T10:45:00-03:00'),
    isRecurringEvent: () => recurring,
    isAllDayEvent: () => allDay
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

test('main service plus all add-ons are summed from the unique official catalogue IDs', () => {
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

test('calendar title import requires exact catalogue service segments and a client name', () => {
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

test('all-day, personal/vacation and test events are protected', () => {
  assert.equal(
    context.cfsProtectedReason_(mockEvent({ allDay: true })),
    'ALL_DAY_EVENT'
  );
  assert.equal(
    context.cfsProtectedReason_(mockEvent({ title: 'Férias da Angélica' })),
    'PROTECTED_OR_TEST_EVENT'
  );
  assert.equal(
    context.cfsProtectedReason_(mockEvent({ title: 'Bloqueio - almoço' })),
    'PROTECTED_OR_TEST_EVENT'
  );
  assert.equal(context.cfsProtectedReason_(mockEvent()), '');
});

test('recurring occurrence identity is Event ID plus actual occurrence date', () => {
  const priorOccurrence = {
    row: 8,
    client: 'Maria Silva',
    dateKey: '2027-01-05',
    timeKey: '10:00',
    eventId: 'recurring-series',
    appointmentId: 'apt-gcal-prior',
    status: 'confirmado'
  };
  const event = mockEvent({ id: 'recurring-series', recurring: true });
  const match = context.cfsFindRowForEvent_(event, '2027-01-12', '10:00', [priorOccurrence]);
  assert.equal(match.row, null);
  assert.equal(match.method, 'NEW_RECURRING_OCCURRENCE');

  const sameOccurrence = context.cfsFindRowForEvent_(
    event,
    '2027-01-12',
    '10:00',
    [priorOccurrence, { ...priorOccurrence, row: 9, dateKey: '2027-01-12' }]
  );
  assert.equal(sameOccurrence.row.row, 9);
  assert.equal(sameOccurrence.method, 'EVENT_ID_AND_OCCURRENCE_DATE');
});

test('cancelled, protected and manual-review sheet rows are not synchronized', () => {
  assert.equal(context.cfsRowGuard_({ status: 'cancelado', appointmentId: 'apt-1' }), 'CANCELLED_ROW');
  assert.equal(context.cfsRowGuard_({ status: 'confirmado', appointmentId: 'apt-1793903805661' }), 'PENDING_HUMAN_REVIEW');
  assert.equal(context.cfsRowGuard_({ status: 'confirmado', appointmentId: 'apt-1794006950286-rec-4' }), 'EXCLUDED_APPOINTMENT');
});

test('deterministic appointment ID is stable per event ID and occurrence date', () => {
  const a = context.cfsDeterministicAppointmentId_('recurring-series', '2027-01-12');
  const b = context.cfsDeterministicAppointmentId_('recurring-series', '2027-01-12');
  const c = context.cfsDeterministicAppointmentId_('recurring-series', '2027-01-19');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('a duration extension that overlaps another Calendar event is blocked', () => {
  const event = mockEvent({ id: 'target', start: '2027-01-12T10:00:00-03:00', end: '2027-01-12T10:45:00-03:00' });
  const other = mockEvent({ id: 'blocked', title: 'Bloqueio pessoal', start: '2027-01-12T11:00:00-03:00', end: '2027-01-12T12:00:00-03:00' });
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

test('sync source contains no Calendar event creation/deletion or title/description mutation', () => {
  assert.doesNotMatch(source, /\.createEvent\s*\(/);
  assert.doesNotMatch(source, /\.deleteEvent\s*\(/);
  assert.doesNotMatch(source, /\.setTitle\s*\(/);
  assert.doesNotMatch(source, /\.setDescription\s*\(/);
  assert.match(source, /event\.setTime\(eventStart,\s*targetEnd\)/);
});
