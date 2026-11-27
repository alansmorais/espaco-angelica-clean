import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const codeGsPath = path.resolve(here, '../../apps-script/Code.gs');
const codeGsSource = readFileSync(codeGsPath, 'utf8');

function createCodeGsContext({
  calendarItems = [],
  calendarShouldThrow = false,
  useAdvancedCalendarApi = true,
  appointmentRows = [],
  serviceRows = [],
  scheduleBlocks = [],
  weeklySchedule = null
} = {}) {
  const sheetsByName = {
    Agendamentos: {
      getName: () => 'Agendamentos',
      getDataRange: () => ({ getValues: () => appointmentRows })
    },
    'Serviços': {
      getName: () => 'Serviços',
      getDataRange: () => ({ getValues: () => serviceRows })
    },
    'Bloqueios e Disponibilidade': {
      getName: () => 'Bloqueios e Disponibilidade',
      getDataRange: () => ({
        getValues: () => [
          ['Tipo', 'ID', 'Dados JSON', 'Atualizado em'],
          ...(weeklySchedule ? [['WEEKLY_SCHEDULE', 'default', JSON.stringify(weeklySchedule), '']] : []),
          ...scheduleBlocks.map(b => ['BLOCK', b.id, JSON.stringify(b), ''])
        ]
      })
    }
  };

  let servicesReadCount = 0;
  sheetsByName['Serviços'].getDataRange = () => {
    servicesReadCount++;
    return { getValues: () => serviceRows };
  };

  const context = {
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    JSON,
    Set,
    isFinite,
    isNaN,
    Session: {
      getScriptTimeZone: () => 'America/Sao_Paulo'
    },
    Utilities: {
      getUuid: () => 'mock-uuid-1234',
      formatDate(value, _tz, pattern) {
        const local = new Date(new Date(value).getTime() - 3 * 60 * 60 * 1000);
        const iso = local.toISOString();
        if (pattern === 'yyyy-MM-dd') return iso.slice(0, 10);
        if (pattern === 'HH:mm') return iso.slice(11, 16);
        return iso;
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'GOOGLE_CALENDAR_ID' ? 'angelikm19@gmail.com' : '')
      })
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name) => sheetsByName[name] || null
      })
    },
    CalendarApp: {
      getCalendarById: () => {
        if (calendarShouldThrow) throw new Error('CalendarApp read error');
        return {
          getEvents: () => calendarItems.map(item => ({
            getId: () => item.id,
            getStartTime: () => new Date(item.start.dateTime || `${item.start.date}T00:00:00-03:00`),
            getEndTime: () => new Date(item.end.dateTime || `${item.end.date}T00:00:00-03:00`),
            isAllDayEvent: () => Boolean(item.start && item.start.date)
          }))
        };
      }
    }
  };

  if (useAdvancedCalendarApi) {
    context.Calendar = {
      Events: {
        list: (_calId, _params) => {
          if (calendarShouldThrow) throw new Error('Calendar API v3 unavailable');
          return { items: calendarItems };
        }
      }
    };
  }

  vm.createContext(context);
  vm.runInContext(codeGsSource, context, { filename: codeGsPath });
  return { context, getServicesReadCount: () => servicesReadCount };
}

test('getCalendarBusySlotsForPublic_ blocks timed, all-day and multi-day events without exposing private titles', () => {
  const tomorrow = new Date(Date.now() + 2 * 86400000);
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getUTCDate()).padStart(2, '0');
  const dateKey = `${y}-${m}-${d}`;
  const next = new Date(tomorrow.getTime() + 86400000);
  const nextKey = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const afterNext = new Date(tomorrow.getTime() + 2 * 86400000);
  const afterNextKey = `${afterNext.getUTCFullYear()}-${String(afterNext.getUTCMonth() + 1).padStart(2, '0')}-${String(afterNext.getUTCDate()).padStart(2, '0')}`;

  const { context } = createCodeGsContext({
    calendarItems: [
      {
        id: 'timed-1',
        status: 'confirmed',
        summary: 'Segredo Cliente Privada',
        start: { dateTime: `${dateKey}T10:00:00-03:00` },
        end: { dateTime: `${dateKey}T11:30:00-03:00` }
      },
      {
        id: 'allday-1',
        status: 'confirmed',
        summary: 'Consulta Médica Pessoal',
        start: { date: nextKey },
        end: { date: afterNextKey }
      },
      {
        id: 'cancelled-1',
        status: 'cancelled',
        summary: 'Cancelado',
        start: { dateTime: `${dateKey}T14:00:00-03:00` },
        end: { dateTime: `${dateKey}T15:00:00-03:00` }
      }
    ]
  });

  const busy = context.getCalendarBusySlotsForPublic_();
  assert.equal(busy.slots.length, 1);
  assert.equal(busy.slots[0].date, dateKey);
  assert.equal(busy.slots[0].time, '10:00 às 11:30');
  assert.equal(busy.slots[0].status, 'bloqueado');
  assert.deepEqual(Array.from(busy.blockedDates), [nextKey]);

  const serialized = JSON.stringify(busy);
  assert.equal(serialized.includes('Segredo Cliente Privada'), false);
  assert.equal(serialized.includes('Consulta Médica Pessoal'), false);
});

test('validateAgainstGoogleCalendar rejects overlapping timed events, all-day blocks, and fails closed on API error', () => {
  const { context } = createCodeGsContext({
    calendarItems: [
      {
        id: 'evt-timed',
        status: 'confirmed',
        start: { dateTime: '2027-03-10T14:00:00-03:00' },
        end: { dateTime: '2027-03-10T15:30:00-03:00' }
      }
    ]
  });

  const overlap = context.validateAgainstGoogleCalendar('2027-03-10', '14:30', 60);
  assert.equal(overlap.allowed, false);

  const adjacentBefore = context.validateAgainstGoogleCalendar('2027-03-10', '13:00', 60);
  assert.equal(adjacentBefore.allowed, true);

  const adjacentAfter = context.validateAgainstGoogleCalendar('2027-03-10', '15:30', 45);
  assert.equal(adjacentAfter.allowed, true);

  const { context: allDayCtx } = createCodeGsContext({
    calendarItems: [
      {
        id: 'evt-allday',
        status: 'confirmed',
        start: { date: '2027-03-15' },
        end: { date: '2027-03-16' }
      }
    ]
  });
  const blockedDay = allDayCtx.validateAgainstGoogleCalendar('2027-03-15', '10:00', 45);
  assert.equal(blockedDay.allowed, false);

  const { context: errorCtx } = createCodeGsContext({ calendarShouldThrow: true });
  const failClosed = errorCtx.validateAgainstGoogleCalendar('2027-03-20', '10:00', 45);
  assert.equal(failClosed.allowed, false);
});

test('getPublicAvailabilityData reads service catalogue once per call, sums add-on durations, skips duplicate gcal blocks and fails closed', () => {
  const serviceRows = [
    ['ID', 'Titulo', 'Categoria', 'Preco', 'PrecoFmt', 'Duracao'],
    ['manicure-tradicional', 'Manicure Tradicional', 'manicure', 45, 'R$ 45', '45 min'],
    ['pedicure-tradicional', 'Pedicure Tradicional', 'pedicure', 50, 'R$ 50', '50 min']
  ];
  const makeRow = (id, date, time, status, svcId, addIds, gcalId = '') => {
    const row = Array(21).fill('');
    row[1] = 'Cliente Teste';
    row[4] = 'Manicure Tradicional';
    row[5] = date;
    row[6] = time;
    row[8] = status;
    row[9] = id;
    row[13] = addIds ? JSON.stringify(addIds) : '';
    row[15] = svcId;
    row[19] = gcalId;
    return row;
  };

  const appointmentRows = [
    Array(21).fill('Header'),
    makeRow('apt-1', '2027-04-10', '10:00', 'confirmado', 'manicure-tradicional', ['pedicure-tradicional']),
    makeRow('apt-2', '2027-04-11', '11:00', 'confirmado', 'manicure-tradicional', []),
    makeRow('apt-gcal-block', '2027-04-12', '09:00', 'bloqueado', '', [], 'gcal-block-event-id')
  ];

  const { context, getServicesReadCount } = createCodeGsContext({
    appointmentRows,
    serviceRows,
    calendarItems: []
  });

  const avail = context.getPublicAvailabilityData();
  assert.equal(avail.status, 'success');
  assert.equal(getServicesReadCount(), 1, 'Service catalog must be read only once per availability request');
  assert.equal(avail.slots.length, 2, 'Calendar-imported blocked row with Column T ID is deduplicated in favor of Calendar feed');
  assert.equal(avail.slots[0].serviceDuration, '95 min');
  assert.equal(avail.slots[1].serviceDuration, '45 min');
  assert.equal(JSON.stringify(avail).includes('null min'), false);

  const { context: errCtx } = createCodeGsContext({
    appointmentRows,
    serviceRows,
    calendarShouldThrow: true
  });
  const failed = errCtx.getPublicAvailabilityData();
  assert.equal(failed.status, 'error');
  assert.equal(failed.success, false);
});

test('Code.gs keeps auditCalendarFirstSync and runCalendarFirstSyncDryRun strictly behind admin auth', () => {
  const publicMatch = codeGsSource.match(/var\s+isPublicBooking\s*=[^;]+;/);
  assert.ok(publicMatch, 'isPublicBooking declaration must exist');
  assert.equal(publicMatch[0].includes('auditCalendarFirstSync'), false);
  assert.equal(publicMatch[0].includes('runCalendarFirstSyncDryRun'), false);
});
