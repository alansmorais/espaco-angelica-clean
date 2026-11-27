import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const syncSourcePath = path.resolve(here, '../../apps-script/CalendarFirstDurationSync.gs');
const syncSource = readFileSync(syncSourcePath, 'utf8');

const DEFAULT_HEADERS = [
  'Timestamp', 'Cliente', 'Telefone', 'Email', 'Procedimento', 'Data', 'Horário',
  'Sinal', 'Status', 'ID', 'Notas', 'Local', 'Endereço', 'Adicionais', 'Pedido',
  'ID Serviço', 'Nascimento', 'Pagamento', 'Recorrência', 'Google Calendar Event ID',
  'Google Calendar Original Start'
];

function createSyncHarness({
  appointmentRows = [],
  profileRows = [],
  events = [],
  deletedById = {},
  writeEnabled = true
} = {}) {
  const headers = DEFAULT_HEADERS.slice();
  const grid = appointmentRows.length ? appointmentRows.map(r => {
    const copy = Array(21).fill('');
    for (let i = 0; i < r.length; i++) copy[i] = r[i];
    return copy;
  }) : [headers];

  const serviceRows = [
    ['ID', 'Título', 'Categoria', 'Preço', 'PreçoFmt', 'Duração'],
    ['manicure-tradicional', 'Manicure Tradicional (Mão)', 'tradicional', 45, 'R$ 45', '45'],
    ['pedicure-tradicional', 'Pedicure Tradicional (Pé)', 'tradicional', 45, 'R$ 45', '45'],
    ['manicure-pedicure-tradicional', 'Manicure e Pedicure Tradicional', 'tradicional', 90, 'R$ 90', '90'],
    ['manutencao-fibra-vidro', 'Manutenção de Crescimento', 'manutencao', 180, 'R$ 180', '160'],
    ['alongamento-fibra-slim', 'Alongamento em Fibra Slim', 'alongamento', 230, 'R$ 230', '180'],
    ['domicilio-pe-e-mao', 'Atendimento a Domicílio - Pé e Mão', 'domicilio', 130, 'R$ 130', '90']
  ];
  const depilRows = [
    ['ID', 'Título', 'Categoria', 'Preço', 'PreçoFmt', 'Duração'],
    ['depilacao-virilha-completa', 'Virilha Completa', 'depilacao', 70, 'R$ 70', '45min']
  ];

  function makeSheet(name, data) {
    return {
      getName: () => name,
      getLastRow: () => data.length,
      getLastColumn: () => (data[0] ? data[0].length : 0),
      getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
      getRange: (row, col, numRows = 1, numCols = 1) => ({
        getValues: () => {
          const out = [];
          for (let r = row - 1; r < row - 1 + numRows; r++) {
            const line = [];
            for (let c = col - 1; c < col - 1 + numCols; c++) {
              line.push(data[r] ? (data[r][c] ?? '') : '');
            }
            out.push(line);
          }
          return out;
        },
        getDisplayValues: () => {
          const out = [];
          for (let r = row - 1; r < row - 1 + numRows; r++) {
            const line = [];
            for (let c = col - 1; c < col - 1 + numCols; c++) {
              line.push(String(data[r] ? (data[r][c] ?? '') : ''));
            }
            out.push(line);
          }
          return out;
        },
        getDisplayValue: () => String((data[row - 1] && data[row - 1][col - 1]) || ''),
        getValue: () => (data[row - 1] ? data[row - 1][col - 1] : ''),
        setValue: (val) => {
          while (data.length < row) data.push(Array(21).fill(''));
          data[row - 1][col - 1] = val;
        },
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            const targetRow = row - 1 + r;
            while (data.length <= targetRow) data.push(Array(21).fill(''));
            for (let c = 0; c < vals[r].length; c++) {
              data[targetRow][col - 1 + c] = vals[r][c];
            }
          }
        }
      })
    };
  }

  const sheets = {
    Agendamentos: makeSheet('Agendamentos', grid),
    Servicos: makeSheet('Servicos', serviceRows),
    'Depilação': makeSheet('Depilação', depilRows),
    'Perfis de Clientes': makeSheet('Perfis de Clientes', [
      ['ID', 'Telefone Normalizado', 'Perfil JSON', 'Atualizado em'],
      ...profileRows
    ])
  };

  const patches = [];
  const propsStore = {
    SPREADSHEET_ID: 'sheet-test-id',
    GOOGLE_CALENDAR_ID: 'angelikm19@gmail.com',
    CALENDAR_FIRST_SYNC_ENABLED: writeEnabled ? 'true' : 'false'
  };

  const context = {
    TARGET_SPREADSHEET_ID: 'sheet-test-id',
    console: { log: () => {}, error: () => {}, warn: () => {} },
    Logger: { log: () => {} },
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    JSON,
    isFinite,
    isNaN,
    Utilities: {
      formatDate(value, _tz, pattern) {
        const local = new Date(new Date(value).getTime() - 3 * 60 * 60 * 1000);
        const iso = local.toISOString();
        if (pattern === 'yyyy-MM-dd') return iso.slice(0, 10);
        if (pattern === 'HH:mm') return iso.slice(11, 16);
        return iso;
      }
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} })
    },
    CacheService: {
      getScriptCache: () => ({ get: () => null, put: () => {} })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => propsStore[k] || '',
        setProperty: (k, v) => { propsStore[k] = String(v); }
      })
    },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name) => sheets[name] || null
      }),
      flush: () => {}
    },
    Calendar: {
      Events: {
        list: () => ({ items: events }),
        get: (_calId, evId) => {
          if (deletedById[evId] === '404') throw new Error('404 Not Found');
          if (deletedById[evId]) return { id: evId, status: 'cancelled' };
          const found = events.find(e => e.id === evId);
          if (!found) throw new Error('404 Not Found');
          return found;
        },
        patch: (body, _calId, evId) => {
          patches.push({ eventId: evId, body });
          return { id: evId, ...body };
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(syncSource, context, { filename: syncSourcePath });
  return { context, grid, patches, propsStore, headers };
}

test('Scenario 1: generic event "Agendamento de Unhas" without identifying metadata stays unclassified block, never guessed', () => {
  const { context, grid, patches } = createSyncHarness({
    events: [{
      id: 'evt-generic-empty',
      status: 'confirmed',
      summary: 'Agendamento de Unhas',
      description: '',
      start: { dateTime: '2027-02-10T14:00:00-03:00' },
      end: { dateTime: '2027-02-10T15:00:00-03:00' }
    }]
  });

  const res = context.syncCalendarBookingsAndDurations({ dryRun: false, startDate: '2027-02-01', endDate: '2027-02-28' });
  assert.equal(res.counts.rowsImported, 0);
  assert.equal(res.counts.blockedRowsImported, 1);
  assert.equal(grid.length, 2);
  assert.equal(grid[1][1], 'Agendamento de Unhas');
  assert.equal(grid[1][8], 'bloqueado');
  assert.equal(grid[1][10].includes('UNCLASSIFIED_CALENDAR_EVENT'), false, 'Notes must be human-readable, not raw error code');
  assert.equal(patches.length, 0);
});

test('Scenario 2 & 3: events with client/service in title OR description (including WhatsApp Booking notes & phone lookup) are accurately classified', () => {
  const { context, grid } = createSyncHarness({
    profileRows: [
      ['client-1', '21998027923', JSON.stringify({ name: 'Giulia Freitas', phone: '+55 21 99802-7923' }), ''],
      ['client-2', '11996065260', JSON.stringify({ name: 'Rafaela Ferrari', phone: '+55 11 99606-5260' }), '']
    ],
    events: [
      {
        id: 'evt-title-bruna',
        status: 'confirmed',
        summary: 'Bruna Maganhe - Pé e mão convencional',
        description: 'Customer name: Bruna Maganhe<br>Customer phone: +55 19 99947-3966<br>Booking notes:<br>Pé e mão convencional',
        start: { dateTime: '2027-02-10T09:40:00-03:00' },
        end: { dateTime: '2027-02-10T11:10:00-03:00' }
      },
      {
        id: 'evt-desc-giulia',
        status: 'confirmed',
        summary: 'Agendamento de Unhas',
        description: 'Business name: Lika Nails Designer\nCustomer phone: +55 21 99802-7923\n\nBooking notes:\nManutenção de Crescimento - Giulia Freitas - 10/02 14h',
        start: { dateTime: '2027-02-10T14:00:00-03:00' },
        end: { dateTime: '2027-02-10T16:40:00-03:00' }
      },
      {
        id: 'evt-desc-rafaela',
        status: 'confirmed',
        summary: 'Rafaela - depilação',
        description: 'Business name: Lika Nails Designer\nCustomer phone: +55 11 99606-5260\n\nBooking notes:\nRafaela Ferrari - Virilha Completa - 2027-02-10 18:30 BRT',
        start: { dateTime: '2027-02-10T18:30:00-03:00' },
        end: { dateTime: '2027-02-10T19:15:00-03:00' }
      },
      {
        id: 'evt-desc-priscila',
        status: 'confirmed',
        summary: 'Priscila Borges',
        description: 'Customer phone: +55 11 98010-7651\n\nBooking notes:\nAlongamento - Priscila Borges - Data preferida 11/02',
        start: { dateTime: '2027-02-11T14:30:00-03:00' },
        end: { dateTime: '2027-02-11T17:30:00-03:00' }
      }
    ]
  });

  const res = context.syncCalendarBookingsAndDurations({ dryRun: false, startDate: '2027-02-01', endDate: '2027-02-28' });
  assert.equal(res.counts.rowsImported, 4);
  assert.equal(res.counts.blockedRowsImported, 0);
  assert.equal(grid[1][1], 'Bruna Maganhe');
  assert.equal(grid[1][15], 'manicure-pedicure-tradicional');
  assert.equal(grid[2][1], 'Giulia Freitas');
  assert.equal(grid[2][15], 'manutencao-fibra-vidro');
  assert.equal(grid[3][1], 'Rafaela Ferrari');
  assert.equal(grid[3][15], 'depilacao-virilha-completa');
  assert.equal(grid[4][1], 'Priscila Borges');
  assert.equal(grid[4][15], 'alongamento-fibra-slim');
});

test('Scenario 4: previously unclassified block updated in Calendar promotes IN-PLACE without duplicates and propagates time changes', () => {
  const existingUnclassified = Array(21).fill('');
  existingUnclassified[1] = 'Agendamento de Unhas';
  existingUnclassified[4] = 'Bloqueio do Google Agenda';
  existingUnclassified[5] = '2027-02-12';
  existingUnclassified[6] = '14:00';
  existingUnclassified[8] = 'bloqueado';
  existingUnclassified[9] = 'apt-gcal-8718cb6f';
  existingUnclassified[10] = 'Importado do Google Calendar — UNCLASSIFIED_CALENDAR_EVENT:TITLE_MUST_CONTAIN_KNOWN_CLIENT_AND_APPROVED_SERVICE';
  existingUnclassified[19] = 'evt-promoted-1';

  const { context, grid, patches, headers } = createSyncHarness({
    appointmentRows: [DEFAULT_HEADERS, existingUnclassified],
    profileRows: [
      ['client-1', '21998027923', JSON.stringify({ name: 'Giulia Freitas', phone: '+55 21 99802-7923' }), '']
    ],
    events: [{
      id: 'evt-promoted-1',
      status: 'confirmed',
      summary: 'Giulia Freitas Manutenção de Crescimento',
      description: 'Customer phone: +55 21 99802-7923',
      start: { dateTime: '2027-02-12T14:30:00-03:00' },
      end: { dateTime: '2027-02-12T16:30:00-03:00' } // 120m -> should patch end to 17:10 (160m from Servicos!F)
    }]
  });

  const res = context.syncCalendarBookingsAndDurations({ dryRun: false, startDate: '2027-02-01', endDate: '2027-02-28' });
  assert.equal(grid.length, 2, 'Must update in-place without duplicating row');
  assert.equal(grid[1][1], 'Giulia Freitas');
  assert.equal(grid[1][4], 'Manutenção de Crescimento');
  assert.equal(grid[1][6], '14:30');
  assert.equal(grid[1][8], 'confirmado');
  assert.equal(grid[1][15], 'manutencao-fibra-vidro');
  assert.equal(patches.length, 1, 'Calendar end time patched strictly using official 160m duration');
  assert.equal(patches[0].body.end.dateTime, new Date('2027-02-12T17:10:00-03:00').toISOString());

  // Re-run must be 100% idempotent
  const rerun = context.syncCalendarBookingsAndDurations({ dryRun: true, startDate: '2027-02-01', endDate: '2027-02-28' });
  assert.equal(rerun.counts.rowsImported, 0);
  assert.equal(rerun.counts.blockedRowsImported, 0);
  assert.equal(rerun.counts.existingRowsUpdatedFromCalendar, 0);
});

test('Scenario 5: deleted Calendar events (tombstone or 404 on Events.get) cancel linked Sheet rows so no stale events remain', () => {
  const rowA = Array(21).fill('');
  rowA[1] = 'Agendamento de Unhas';
  rowA[4] = 'Bloqueio do Google Agenda';
  rowA[5] = '2027-02-15';
  rowA[6] = '10:00';
  rowA[8] = 'bloqueado';
  rowA[9] = 'apt-gcal-del-a';
  rowA[19] = 'evt-deleted-404';

  const { context, grid, headers } = createSyncHarness({
    appointmentRows: [DEFAULT_HEADERS, rowA],
    events: [],
    deletedById: { 'evt-deleted-404': '404' }
  });

  const res = context.syncCalendarBookingsAndDurations({ dryRun: false, startDate: '2027-02-01', endDate: '2027-02-28' });
  assert.equal(res.counts.cancelledRowsMarked, 1);
  assert.equal(grid[1][8], 'cancelado');
});

test('Scenario 6: recurring event with a changed occurrence updates ONLY that occurrence via instance ID + originalStartTime', () => {
  const occ1 = Array(21).fill('');
  occ1[1] = 'Kristine Sorensen';
  occ1[4] = 'Manicure e Pedicure Tradicional';
  occ1[5] = '2027-02-04';
  occ1[6] = '12:30';
  occ1[8] = 'confirmado';
  occ1[9] = 'apt-k-1';
  occ1[15] = 'manicure-pedicure-tradicional';
  occ1[19] = 'series-k_20270204T153000Z';
  occ1[20] = '2027-02-04T12:30:00-03:00';

  const occ2 = Array(21).fill('');
  occ2[1] = 'Kristine Sorensen';
  occ2[4] = 'Manicure e Pedicure Tradicional';
  occ2[5] = '2027-02-18';
  occ2[6] = '12:30';
  occ2[8] = 'confirmado';
  occ2[9] = 'apt-k-2';
  occ2[15] = 'manicure-pedicure-tradicional';
  occ2[19] = 'series-k_20270218T153000Z';
  occ2[20] = '2027-02-18T12:30:00-03:00';

  const { context, grid, headers } = createSyncHarness({
    appointmentRows: [DEFAULT_HEADERS, occ1, occ2],
    events: [
      {
        id: 'series-k_20270204T153000Z',
        recurringEventId: 'series-k',
        originalStartTime: { dateTime: '2027-02-04T12:30:00-03:00' },
        status: 'confirmed',
        summary: 'Kristine Sorensen pé e mão',
        start: { dateTime: '2027-02-04T12:30:00-03:00' },
        end: { dateTime: '2027-02-04T14:00:00-03:00' }
      },
      {
        id: 'series-k_20270218T153000Z',
        recurringEventId: 'series-k',
        originalStartTime: { dateTime: '2027-02-18T12:30:00-03:00' },
        status: 'confirmed',
        summary: 'Kristine Sorensen pé e mão',
        // Occurrence 2 rescheduled from 12:30 to 15:00 on 2027-02-19!
        start: { dateTime: '2027-02-19T15:00:00-03:00' },
        end: { dateTime: '2027-02-19T16:30:00-03:00' }
      }
    ]
  });

  const res = context.syncCalendarBookingsAndDurations({ dryRun: false, startDate: '2027-02-01', endDate: '2027-02-28' });
  assert.equal(grid.length, 3, 'No duplicate recurring rows');
  assert.equal(grid[1][5], '2027-02-04');
  assert.equal(grid[1][6], '12:30');
  assert.equal(grid[2][5], '2027-02-19');
  assert.equal(grid[2][6], '15:00');
  assert.equal(res.counts.existingRowsUpdatedFromCalendar, 1);
});

test('Scenario 7: personal events and all-day blocks stay protected as bloqueado', () => {
  const { context, grid } = createSyncHarness({
    events: [
      {
        id: 'evt-personal-1',
        status: 'confirmed',
        summary: 'Evento Claudinho 11h',
        description: '',
        start: { dateTime: '2027-02-20T10:00:00-03:00' },
        end: { dateTime: '2027-02-20T13:00:00-03:00' }
      },
      {
        id: 'evt-personal-2',
        status: 'confirmed',
        summary: 'Dentista eu e Maya',
        description: '',
        start: { dateTime: '2027-02-22T07:30:00-03:00' },
        end: { dateTime: '2027-02-22T09:00:00-03:00' }
      },
      {
        id: 'evt-folga',
        status: 'confirmed',
        summary: 'Folga',
        start: { date: '2027-02-21' },
        end: { date: '2027-02-22' }
      }
    ]
  });

  const res = context.syncCalendarBookingsAndDurations({ dryRun: false, startDate: '2027-02-01', endDate: '2027-02-28' });
  assert.equal(res.counts.rowsImported, 0);
  assert.equal(res.counts.blockedRowsImported, 3);
  assert.equal(grid[1][8], 'bloqueado');
  assert.equal(grid[2][8], 'bloqueado');
  assert.equal(grid[3][8], 'bloqueado');
  assert.equal(grid[3][6], 'Dia inteiro');
});

test('UI helper calendarBlockFormatting distinguishes all-day vs partial blocks and hides raw internal codes', async () => {
  const tsSource = readFileSync(path.resolve(here, '../../src/services/calendarBlockFormatting.ts'), 'utf8');
  assert.ok(tsSource.includes('isAllDayCalendarBlock'));
  assert.ok(tsSource.includes('UNCLASSIFIED_CALENDAR_EVENT'));
  assert.ok(tsSource.includes('Dia inteiro bloqueado'));
});
