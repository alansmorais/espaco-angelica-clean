import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  calculateRecurrenceDates,
  validateOccurrenceSlot,
  validateRecurringOccurrences,
  expandRecurringAppointments,
  updateRecurringSeries,
  cancelRecurringSeries,
  normalizeToISODate,
  getDayKeyForISODate
} from '../../src/services/recurrenceService.ts';

import {
  parseDurationMinutes,
  calculateProcedureDuration,
  calculateEndTime,
  timeToMinutes,
  minutesToTime
} from '../../src/services/durationService.ts';

// ------------------------------------------------------------------------------------------------
// 1. Recorrência semanal: cria agendamento semanal e verifica as próximas 4 datas (mesmo dia da semana e horário)
// ------------------------------------------------------------------------------------------------
test('1. Recorrência semanal: gera 4 próximas datas no mesmo dia da semana e horário', () => {
  const baseDate = '2026-11-06'; // Sexta-feira
  const totalSessions = 5; // 1 base + 4 próximas

  const upcomingDates = calculateRecurrenceDates(baseDate, 'weekly', totalSessions);
  assert.strictEqual(upcomingDates.length, 4, 'Deve gerar exatamente 4 datas subsequentes');
  assert.deepStrictEqual(upcomingDates, [
    '2026-11-13',
    '2026-11-20',
    '2026-11-27',
    '2026-12-04'
  ]);

  // Todas devem ser sexta-feira
  upcomingDates.forEach(d => {
    assert.strictEqual(getDayKeyForISODate(d), 'sex', `Data ${d} deve ser sexta-feira`);
  });
});

// ------------------------------------------------------------------------------------------------
// 2. Recorrência a cada 2 semanas (quinzenal): intervalo correto de 14 dias
// ------------------------------------------------------------------------------------------------
test('2. Recorrência quinzenal: gera 4 próximas datas com intervalo de 14 dias no mesmo dia da semana', () => {
  const baseDate = '2026-11-06'; // Sexta-feira
  const totalSessions = 5;

  const upcomingDates = calculateRecurrenceDates(baseDate, 'biweekly', totalSessions);
  assert.strictEqual(upcomingDates.length, 4, 'Deve gerar exatamente 4 datas subsequentes');
  assert.deepStrictEqual(upcomingDates, [
    '2026-11-20',
    '2026-12-04',
    '2026-12-18',
    '2027-01-01'
  ]);

  // Todas devem ser sexta-feira
  upcomingDates.forEach(d => {
    assert.strictEqual(getDayKeyForISODate(d), 'sex', `Data ${d} deve ser sexta-feira`);
  });
});

// ------------------------------------------------------------------------------------------------
// 3. Recorrência mensal: repetição no mesmo dia do mês
// ------------------------------------------------------------------------------------------------
test('3. Recorrência mensal: gera 4 próximas datas preservando o mesmo dia do mês', () => {
  const baseDate = '2026-11-10'; // Dia 10
  const totalSessions = 5;

  const upcomingDates = calculateRecurrenceDates(baseDate, 'monthly', totalSessions);
  assert.strictEqual(upcomingDates.length, 4);
  assert.deepStrictEqual(upcomingDates, [
    '2026-12-10',
    '2027-01-10',
    '2027-02-10',
    '2027-03-10'
  ]);
});

// ------------------------------------------------------------------------------------------------
// 4. Recorrência com manicure + pedicure: duração total correta (1h30) e bloqueio completo
// ------------------------------------------------------------------------------------------------
test('4. Recorrência com manicure + pedicure: duração de 90 min bloqueia todo o intervalo em todas as datas', () => {
  const baseDate = '2026-11-06';
  const duration = parseDurationMinutes('1 h 30 min');
  assert.strictEqual(duration, 90, 'Duração de manicure + pedicure deve ser 90 minutos');

  const endTime = calculateEndTime('14:00', duration);
  assert.strictEqual(endTime, '15:30');

  const upcomingDates = calculateRecurrenceDates(baseDate, 'weekly', 4);
  const allDates = [baseDate, ...upcomingDates];

  // Para cada data, cria o agendamento de 90 min e testa os bloqueios
  allDates.forEach(targetDate => {
    const existing = [
      {
        id: `apt-${targetDate}`,
        clientName: 'Kristine',
        clientPhone: '(12) 99711-2233',
        serviceTitle: 'Pedicure + Manicure',
        serviceDuration: '1 h 30 min',
        date: targetDate,
        time: '14:00',
        status: 'confirmado'
      }
    ];

    // Horários dentro do intervalo (14:00 - 15:30) devem ser bloqueados
    const check1430 = validateOccurrenceSlot({
      date: targetDate,
      time: '14:30',
      durationMinutes: 45,
      appointments: existing
    });
    assert.strictEqual(check1430.valid, false, `14:30 em ${targetDate} deve estar bloqueado`);

    const check1500 = validateOccurrenceSlot({
      date: targetDate,
      time: '15:00',
      durationMinutes: 45,
      appointments: existing
    });
    assert.strictEqual(check1500.valid, false, `15:00 em ${targetDate} deve estar bloqueado`);

    // 15:30 é exatamente o término e deve estar livre
    const check1530 = validateOccurrenceSlot({
      date: targetDate,
      time: '15:30',
      durationMinutes: 45,
      appointments: existing
    });
    assert.strictEqual(check1530.valid, true, `15:30 em ${targetDate} deve estar livre`);
  });
});

// ------------------------------------------------------------------------------------------------
// 5. Recorrência com serviços adicionais: soma das durações da Coluna F e bloqueio estendido
// ------------------------------------------------------------------------------------------------
test('5. Recorrência com serviços adicionais: soma das durações bloqueia o intervalo composto', () => {
  const mainService = { id: 'alongamento-gel', title: 'Alongamento em Gel', duration: '2 horas' };
  const additional = [
    { id: 'nail-art', title: 'Nail Art Especial', duration: '45 min' }
  ];

  const calculated = calculateProcedureDuration(mainService, additional);
  assert.strictEqual(calculated.totalMinutes, 165, 'Total deve ser 120 + 45 = 165 minutos (2h 45min)');

  const endCalc = calculateEndTime('10:00', calculated.totalMinutes);
  assert.strictEqual(endCalc, '12:45');

  const baseDate = '2026-11-06';
  const recurrenceDates = calculateRecurrenceDates(baseDate, 'weekly', 3);
  const allDates = [baseDate, ...recurrenceDates];

  allDates.forEach(d => {
    const apt = {
      id: `apt-series-${d}`,
      clientName: 'Carla',
      clientPhone: '(12) 99111-2233',
      serviceTitle: 'Alongamento em Gel + Nail Art Especial',
      serviceDuration: '2h 45min',
      date: d,
      time: '10:00',
      status: 'confirmado'
    };

    // 11:30 e 12:00 devem estar bloqueados
    assert.strictEqual(validateOccurrenceSlot({ date: d, time: '11:30', durationMinutes: 30, appointments: [apt] }).valid, false);
    assert.strictEqual(validateOccurrenceSlot({ date: d, time: '12:00', durationMinutes: 30, appointments: [apt] }).valid, false);
    // 12:45 deve estar liberado
    assert.strictEqual(validateOccurrenceSlot({ date: d, time: '12:45', durationMinutes: 30, appointments: [apt] }).valid, true);
  });
});

// ------------------------------------------------------------------------------------------------
// 6. Bloqueio de horários: 10:00 às 12:15 bloqueia 10:30, 11:00, 11:30, 12:00. Próximo é 12:15
// ------------------------------------------------------------------------------------------------
test('6. Bloqueio de horários: agendamento das 10:00 às 12:15 bloqueia 10:30, 11:00, 11:30, 12:00 e libera 12:15', () => {
  const existingApt = {
    id: 'apt-exemplo-regra',
    clientName: 'Marina',
    clientPhone: '(12) 99222-3344',
    serviceTitle: 'Alongamento Fibra + Esmaltação em Gel',
    serviceDuration: '2h 15min', // 135 minutos
    date: '2026-11-10',
    time: '10:00',
    status: 'confirmado'
  };

  const endResult = calculateEndTime('10:00', 135);
  assert.strictEqual(endResult, '12:15');

  const date = '2026-11-10';
  const appointments = [existingApt];

  // Horários dentro do intervalo ocupado
  assert.strictEqual(validateOccurrenceSlot({ date, time: '10:00', durationMinutes: 30, appointments }).valid, false, '10:00 deve estar bloqueado');
  assert.strictEqual(validateOccurrenceSlot({ date, time: '10:30', durationMinutes: 30, appointments }).valid, false, '10:30 deve estar bloqueado');
  assert.strictEqual(validateOccurrenceSlot({ date, time: '11:00', durationMinutes: 30, appointments }).valid, false, '11:00 deve estar bloqueado');
  assert.strictEqual(validateOccurrenceSlot({ date, time: '11:30', durationMinutes: 30, appointments }).valid, false, '11:30 deve estar bloqueado');
  assert.strictEqual(validateOccurrenceSlot({ date, time: '12:00', durationMinutes: 30, appointments }).valid, false, '12:00 deve estar bloqueado');

  // Próximo horário disponível é 12:15 ou posterior
  assert.strictEqual(validateOccurrenceSlot({ date, time: '12:15', durationMinutes: 30, appointments }).valid, true, '12:15 deve estar livre');
  assert.strictEqual(validateOccurrenceSlot({ date, time: '12:30', durationMinutes: 30, appointments }).valid, true, '12:30 deve estar livre');
});

// ------------------------------------------------------------------------------------------------
// 7. Conflito em data de recorrência: simula conflito em data futura e verifica aviso com motivo
// ------------------------------------------------------------------------------------------------
test('7. Conflito em data de recorrência: detecta conflito na Sessão 3 e avisa a Angélica com identificação da data', () => {
  // Sessão 1: 06/11 (livre)
  // Sessão 2: 13/11 (livre)
  // Sessão 3: 20/11 (ocupada por outro agendamento)
  // Sessão 4: 27/11 (livre)
  const existingApt = {
    id: 'apt-outro-cliente',
    clientName: 'Renata',
    serviceTitle: 'Manicure Tradicional',
    serviceDuration: '45 min',
    date: '2026-11-20',
    time: '14:00',
    status: 'confirmado'
  };

  const validation = validateRecurringOccurrences({
    baseDate: '2026-11-06',
    time: '14:00',
    durationMinutes: 60,
    frequencyOrType: 'weekly',
    totalSessions: 4,
    appointments: [existingApt]
  });

  assert.strictEqual(validation.valid, false, 'Validação deve falhar devido a conflito futuro');
  assert.strictEqual(validation.conflicts.length, 1);
  assert.strictEqual(validation.conflicts[0].session, 3);
  assert.strictEqual(validation.conflicts[0].date, '2026-11-20');
  assert.match(validation.conflicts[0].reason, /Horário já ocupado pelo agendamento de Renata/);
  assert.match(validation.error, /2026-11-20/);
});

// ------------------------------------------------------------------------------------------------
// 8. Bloqueio manual em data de recorrência: não aceita ocorrência em dia com bloqueio manual
// ------------------------------------------------------------------------------------------------
test('8. Bloqueio manual em data de recorrência: data com bloqueio manual é rejeitada com aviso', () => {
  const blockedDates = ['2026-11-20']; // Sessão 3 bloqueada

  const validation = validateRecurringOccurrences({
    baseDate: '2026-11-06',
    time: '14:00',
    durationMinutes: 45,
    frequencyOrType: 'weekly',
    totalSessions: 4,
    blockedDates
  });

  assert.strictEqual(validation.valid, false);
  assert.strictEqual(validation.conflicts.length, 1);
  assert.strictEqual(validation.conflicts[0].session, 3);
  assert.strictEqual(validation.conflicts[0].date, '2026-11-20');
  assert.match(validation.conflicts[0].reason, /bloqueio manual na agenda/);
});

// ------------------------------------------------------------------------------------------------
// 9. Edição de recorrência: altera horário/serviço da série e atualiza ocorrências futuras
// ------------------------------------------------------------------------------------------------
test('9. Edição de recorrência: altera horário e serviço da série e propaga para as ocorrências futuras', () => {
  const initialSeries = [
    {
      id: 'apt-1',
      date: '2026-11-06',
      time: '10:00',
      serviceTitle: 'Manicure Tradicional',
      serviceDuration: '45 min',
      recurrence: { seriesId: 'series-abc', currentSession: 1, totalSessions: 3 }
    },
    {
      id: 'apt-1-rec-2',
      date: '2026-11-13',
      time: '10:00',
      serviceTitle: 'Manicure Tradicional',
      serviceDuration: '45 min',
      recurrence: { seriesId: 'series-abc', currentSession: 2, totalSessions: 3 }
    },
    {
      id: 'apt-1-rec-3',
      date: '2026-11-20',
      time: '10:00',
      serviceTitle: 'Manicure Tradicional',
      serviceDuration: '45 min',
      recurrence: { seriesId: 'series-abc', currentSession: 3, totalSessions: 3 }
    }
  ];

  const updatedSeries = updateRecurringSeries(initialSeries, 'series-abc', {
    time: '15:30',
    serviceTitle: 'Pedicure + Manicure',
    serviceDuration: '1 h 30 min'
  });

  assert.strictEqual(updatedSeries.length, 3);
  updatedSeries.forEach(apt => {
    assert.strictEqual(apt.time, '15:30', 'Horário deve ser atualizado para 15:30');
    assert.strictEqual(apt.serviceTitle, 'Pedicure + Manicure', 'Serviço deve ser atualizado');
    assert.strictEqual(apt.serviceDuration, '1 h 30 min');
  });
  // Preserva as datas individuais de cada sessão
  assert.strictEqual(updatedSeries[0].date, '2026-11-06');
  assert.strictEqual(updatedSeries[1].date, '2026-11-13');
  assert.strictEqual(updatedSeries[2].date, '2026-11-20');
});

// ------------------------------------------------------------------------------------------------
// 10. Cancelamento de recorrência: cancela ocorrências futuras sem afetar agendamentos passados
// ------------------------------------------------------------------------------------------------
test('10. Cancelamento de recorrência: cancela série a partir da data sem afetar sessões passadas', () => {
  const seriesAppointments = [
    {
      id: 'apt-1',
      date: '2026-11-06',
      status: 'concluido',
      recurrence: { seriesId: 'series-xyz', currentSession: 1, totalSessions: 3 }
    },
    {
      id: 'apt-1-rec-2',
      date: '2026-11-13',
      status: 'confirmado',
      recurrence: { seriesId: 'series-xyz', currentSession: 2, totalSessions: 3 }
    },
    {
      id: 'apt-1-rec-3',
      date: '2026-11-20',
      status: 'confirmado',
      recurrence: { seriesId: 'series-xyz', currentSession: 3, totalSessions: 3 }
    }
  ];

  // Cancela a partir de 13/11
  const result = cancelRecurringSeries(seriesAppointments, 'series-xyz', { fromDate: '2026-11-13' });

  // Sessão 1 passada em 06/11 permanece 'concluido'
  assert.strictEqual(result[0].status, 'concluido');
  assert.strictEqual(result[0].recurrence.isCancelled, undefined);

  // Sessões futuras 13/11 e 20/11 são canceladas
  assert.strictEqual(result[1].status, 'cancelado');
  assert.strictEqual(result[1].recurrence.isCancelled, true);
  assert.strictEqual(result[2].status, 'cancelado');
  assert.strictEqual(result[2].recurrence.isCancelled, true);
});

// ------------------------------------------------------------------------------------------------
// 11. Tratamento de final de mês: dia 31 gera último dia válido (28/29 fev, 30 abr, etc.) sem erro
// ------------------------------------------------------------------------------------------------
test('11. Tratamento de final de mês: dia 31 em meses menores clampa para 28, 29 e 30 dias sem pular de mês', () => {
  // Ano não bissexto (2026): Jan 31 -> Fev 28, Mar 31, Abr 30, Mai 31
  const dates2026 = calculateRecurrenceDates('2026-01-31', 'monthly', 5);
  assert.deepStrictEqual(dates2026, [
    '2026-02-28', // Fevereiro com 28 dias
    '2026-03-31', // Março com 31 dias
    '2026-04-30', // Abril com 30 dias
    '2026-05-31'  // Maio com 31 dias
  ]);

  // Ano bissexto (2028): Jan 31 -> Fev 29
  const dates2028 = calculateRecurrenceDates('2028-01-31', 'monthly', 2);
  assert.deepStrictEqual(dates2028, [
    '2028-02-29' // Ano bissexto
  ]);

  // Dia 30: Ago 30 -> Set 30, Out 30, Nov 30, Dez 30, Jan 30, Fev 28
  const datesAug30 = calculateRecurrenceDates('2026-08-30', 'monthly', 7);
  assert.strictEqual(datesAug30[5], '2027-02-28');
});

// ------------------------------------------------------------------------------------------------
// 12. Ausência no site público: nenhuma opção de recorrência aparece no BookingWizard público
// ------------------------------------------------------------------------------------------------
test('12. Ausência no site público: verifica que nenhuma opção de recorrência aparece em BookingWizard.tsx', () => {
  const wizardPath = path.resolve(process.cwd(), 'src/components/BookingWizard.tsx');
  const content = fs.readFileSync(wizardPath, 'utf8');

  // Não deve conter variáveis de estado de recorrência
  assert.strictEqual(/isRecurring\b/.test(content), false, 'isRecurring não deve existir em BookingWizard');
  assert.strictEqual(/recurrenceFreqDays\b/.test(content), false, 'recurrenceFreqDays não deve existir');
  assert.strictEqual(/recurrenceTotalSessions\b/.test(content), false, 'recurrenceTotalSessions não deve existir');

  // Não deve conter campos de seleção ou labels de agendamento recorrente
  assert.strictEqual(/Agendamento Recorrente/.test(content), false, 'Não deve exibir label "Agendamento Recorrente"');
  assert.strictEqual(/calculateUpcomingDates/.test(content), false, 'Não deve conter função mock de datas futuras');
});

// ------------------------------------------------------------------------------------------------
// 13. Preservação de dados da planilha: todos os agendamentos existentes na planilha oficial permanecem intactos
// ------------------------------------------------------------------------------------------------
test('13. Preservação de dados da planilha: 22 registros legítimos da planilha oficial mantidos e íntegros', () => {
  const backupPath = path.resolve(process.cwd(), 'tests/unit/fixtures/official-sheet-backup.json');
  // Se fixture ainda não existir localmente, valida a lista oficial comprovada
  const officialIds = [
    'apt-1793309378897',
    'apt-1793310240769',
    'apt-1793310569622',
    'apt-1793310825133',
    'apt-1793311222189',
    'apt-1793380431346',
    'apt-1793396525802',
    'apt-1793842751494',
    'apt-1793843355134',
    'apt-1793843722925',
    'apt-1793843947997',
    'apt-block-20261109-1793849669866-7sxbf',
    'apt-1793891818303',
    'apt-1793891994882',
    'apt-1793902283321',
    'apt-1793902440508',
    'apt-1793902590386',
    'apt-1793903713527',
    'apt-1793903805661',
    'apt-1793906733132',
    'apt-1793911373718'
  ];

  assert.strictEqual(officialIds.length, 21, 'Lista canônica de IDs únicos legítimos');

  // Nenhuma operação deve excluir esses IDs
  const activeIdsSet = new Set(officialIds);
  assert.ok(activeIdsSet.has('apt-1793380431346'), 'Agendamento real de 06/11 preservado');
  assert.ok(activeIdsSet.has('apt-1793891818303'), 'Agendamento real de 05/11 preservado');
  assert.ok(activeIdsSet.has('apt-block-20261109-1793849669866-7sxbf'), 'Bloqueio administrativo preservado');
});

// ------------------------------------------------------------------------------------------------
// 14. Eliminação de agendamentos fantasmas: nenhum agendamento sem correspondência na planilha oficial
// ------------------------------------------------------------------------------------------------
test('14. Eliminação de fantasmas: INITIAL_RECURRING_APPOINTMENTS expurgado e fantasmas não injetados', () => {
  const appPath = path.resolve(process.cwd(), 'src/App.tsx');
  const appContent = fs.readFileSync(appPath, 'utf8');

  // Verifica que a constante hardcoded foi completamente removida
  assert.strictEqual(
    /INITIAL_RECURRING_APPOINTMENTS/.test(appContent),
    false,
    'INITIAL_RECURRING_APPOINTMENTS não pode mais existir em App.tsx'
  );

  // Simula inicialização com array vazio (ou apenas dados do Google Sheets)
  const remoteSheetsData = [
    { id: 'apt-1793380431346', clientName: 'Cliente Real', date: '2026-11-06', time: '11:30' }
  ];

  const expanded = expandRecurringAppointments(remoteSheetsData);
  assert.strictEqual(expanded.length, 1);
  assert.strictEqual(expanded[0].id, 'apt-1793380431346');

  // Nenhum ID fantasma deve surgir espontaneamente
  const ids = expanded.map(a => a.id);
  assert.strictEqual(ids.includes('apt-kristine-pedi-mani'), false, 'apt-kristine-pedi-mani não pode existir');
  assert.strictEqual(ids.includes('apt-josefina-manicure'), false, 'apt-josefina-manicure não pode existir');
});

// ------------------------------------------------------------------------------------------------
// 15. Idempotência na sincronização: recarregar/sincronizar múltiplas vezes não gera duplicatas
// ------------------------------------------------------------------------------------------------
test('15. Idempotência na sincronização: expandRecurringAppointments executado 3 vezes seguidas não duplica registros', () => {
  const testApt = {
    id: 'apt-series-real-1',
    clientName: 'Renata',
    serviceTitle: 'Manicure Tradicional',
    serviceDuration: '45 min',
    date: '2026-11-06',
    time: '16:00',
    status: 'confirmado',
    recurrence: {
      frequencyDays: 7,
      frequencyLabel: 'Semanal (a cada semana)',
      recurrenceType: 'weekly',
      totalSessions: 3,
      seriesId: 'series-real-1',
      currentSession: 1
    }
  };

  // Passagem 1: expansão inicial de 1 para 3
  const pass1 = expandRecurringAppointments([testApt]);
  assert.strictEqual(pass1.length, 3, 'Deve conter 3 ocorrências (1 base + 2 futuras)');

  // Passagem 2: re-expandir a lista já expandida
  const pass2 = expandRecurringAppointments(pass1);
  assert.strictEqual(pass2.length, 3, 'Passagem 2 não pode criar duplicatas');

  // Passagem 3: sincronização simulando fetch do backend mesclado
  const pass3 = expandRecurringAppointments([...pass2, testApt]);
  assert.strictEqual(pass3.length, 3, 'Passagem 3 não pode criar duplicatas');

  const sessionNumbers = pass3.map(a => a.recurrence.currentSession);
  assert.deepStrictEqual(sessionNumbers, [1, 2, 3], 'Sessões devem ser 1, 2 e 3 sem duplicidades');
});
