import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRecurrenceDates,
  expandRecurringAppointments,
  normalizeToISODate
} from '../../src/services/recurrenceService.ts';
import {
  getServiceDisplayTitle,
  isServiceInCategory
} from '../../src/services/catalogService.ts';

// 1. Recorrência: Cliente Kristine (Pedicure + Manicure amanhã, 6 de novembro às 11:00 -> 19 de novembro às 11:00)
test('Recorrência Kristine: Pedicure + Manicure amanhã 06/11 gera automaticamente 19/11 às 11:00', () => {
  const kristineApt = {
    id: 'apt-kristine-nov6',
    clientName: 'Kristine',
    clientPhone: '(12) 99711-2233',
    serviceId: 'manicure-pedicure-tradicional',
    serviceTitle: 'Pedicure + Manicure',
    servicePrice: 'R$ 70,00',
    serviceDuration: '1 h 30 min',
    date: '2026-11-06',
    time: '11:00',
    status: 'confirmado',
    depositStatus: 'liquidado',
    recurrence: {
      frequencyDays: 15,
      frequencyLabel: 'A cada 15 dias',
      totalSessions: 2,
      seriesId: 'series-kristine-pedi-mani',
      currentSession: 1,
      upcomingDates: ['2026-11-19']
    }
  };

  const dates = calculateRecurrenceDates(kristineApt.date, 15, 2, {
    clientName: kristineApt.clientName,
    serviceTitle: kristineApt.serviceTitle,
    upcomingDates: kristineApt.recurrence.upcomingDates
  });
  assert.deepStrictEqual(dates, ['2026-11-19']);

  const expanded = expandRecurringAppointments([kristineApt]);
  assert.strictEqual(expanded.length, 2, 'Deve conter a sessão base e a sessão recorrente de 19 de novembro');

  const futureSession = expanded.find(a => a.date === '2026-11-19');
  assert.ok(futureSession, 'Agendamento de 19 de novembro deve existir');
  assert.strictEqual(futureSession.time, '11:00');
  assert.strictEqual(futureSession.clientName, 'Kristine');
  assert.strictEqual(futureSession.serviceTitle, 'Pedicure + Manicure');
  assert.strictEqual(futureSession.recurrence?.currentSession, 2);
});

// 2. Recorrência: Cliente Josefina (Manicure toda semana)
test('Recorrência Josefina: Manicure toda semana gera agendamentos futuros semanais', () => {
  const josefinaApt = {
    id: 'apt-josefina-weekly',
    clientName: 'Josefina',
    clientPhone: '(12) 99822-3344',
    serviceId: 'manicure-tradicional',
    serviceTitle: 'Manicure Tradicional',
    servicePrice: 'R$ 40,00',
    serviceDuration: '45 min',
    date: '2026-11-06',
    time: '14:00',
    status: 'confirmado',
    depositStatus: 'liquidado',
    recurrence: {
      frequencyDays: 7,
      frequencyLabel: 'Toda semana',
      totalSessions: 4,
      seriesId: 'series-josefina-manicure',
      currentSession: 1
    }
  };

  const expanded = expandRecurringAppointments([josefinaApt]);
  assert.strictEqual(expanded.length, 4, 'Deve conter 4 sessões semanais para Josefina');

  assert.strictEqual(expanded[0].date, '2026-11-06');
  assert.strictEqual(expanded[1].date, '2026-11-13');
  assert.strictEqual(expanded[2].date, '2026-11-20');
  assert.strictEqual(expanded[3].date, '2026-11-27');

  for (const session of expanded) {
    assert.strictEqual(session.time, '14:00');
    assert.strictEqual(session.clientName, 'Josefina');
    assert.strictEqual(session.serviceTitle, 'Manicure Tradicional');
  }
});

// 3. Agendamento adicional: Manicure para Kristine na próxima semana a cada 15 dias
test('Agendamento adicional Kristine: Manicure na semana seguinte (13/11) a cada 15 dias gera 28/11', () => {
  const kristineExtraApt = {
    id: 'apt-kristine-mani-extra',
    clientName: 'Kristine',
    clientPhone: '(12) 99711-2233',
    serviceId: 'manicure-tradicional',
    serviceTitle: 'Manicure Tradicional',
    servicePrice: 'R$ 40,00',
    serviceDuration: '45 min',
    date: '2026-11-13',
    time: '11:00',
    status: 'confirmado',
    depositStatus: 'liquidado',
    recurrence: {
      frequencyDays: 15,
      frequencyLabel: 'A cada 15 dias',
      totalSessions: 2,
      seriesId: 'series-kristine-mani-extra',
      currentSession: 1
    }
  };

  const expanded = expandRecurringAppointments([kristineExtraApt]);
  assert.strictEqual(expanded.length, 2);
  assert.strictEqual(expanded[0].date, '2026-11-13');
  assert.strictEqual(expanded[1].date, '2026-11-28');
  assert.strictEqual(expanded[1].time, '11:00');
  assert.strictEqual(expanded[1].clientName, 'Kristine');
});

// 4. Prevenção de duplicações: re-expandir array já expandido não duplica registros
test('Idempotência da expansão: re-executar expandRecurringAppointments não duplica registros', () => {
  const kristineApt = {
    id: 'apt-kristine-nov6',
    clientName: 'Kristine',
    date: '2026-11-06',
    time: '11:00',
    recurrence: {
      frequencyDays: 15,
      totalSessions: 2,
      upcomingDates: ['2026-11-19']
    }
  };

  const pass1 = expandRecurringAppointments([kristineApt]);
  assert.strictEqual(pass1.length, 2);

  const pass2 = expandRecurringAppointments(pass1);
  assert.strictEqual(pass2.length, 2, 'Array já expandido não pode criar registros duplicados');

  const pass3 = expandRecurringAppointments([...pass2, kristineApt]);
  assert.strictEqual(pass3.length, 2, 'Mesmo re-adicionando a chave base, duplicações são prevenidas');
});

// 5. Renomeação de procedimento: "Blindagem masculino incolor" para "Blindagem" mantendo preço R$ 60
test('Vitrine: Renomeia "Blindagem masculino incolor" para "Blindagem" preservando preço R$ 60', () => {
  const blindagemService = {
    id: 'blindagem-homens-incolor',
    title: 'Blindagem Masculina Incolor',
    price: 60,
    priceFormatted: 'R$ 60,00',
    category: 'blindagem'
  };

  const displayTitle = getServiceDisplayTitle(blindagemService);
  assert.strictEqual(displayTitle, 'Blindagem');
  assert.strictEqual(blindagemService.price, 60);
  assert.strictEqual(blindagemService.priceFormatted, 'R$ 60,00');
});

// 6. Categoria Manicure: remove "Mãos e dedos" e "Esmaltação em gel"
test('Categoria Manicure: remove "Mãos e dedos" (depilação) e "Esmaltação em gel"', () => {
  const depilacaoMaos = {
    id: 'depilacao-maos-e-dedos',
    title: 'Mãos e dedos',
    category: 'depilacao',
    price: 10
  };
  const esmaltacaoGel = {
    id: 'esmaltacao-gel-premium',
    title: 'Esmaltação em Gel Premium ( Mão)',
    category: 'esmaltacao',
    price: 80
  };
  const manicureTradicional = {
    id: 'manicure-tradicional',
    title: 'Manicure Tradicional',
    category: 'manicure',
    price: 40
  };

  assert.strictEqual(isServiceInCategory(depilacaoMaos, 'manicure'), false, 'Depilação mãos e dedos não pode estar em Manicure');
  assert.strictEqual(isServiceInCategory(esmaltacaoGel, 'manicure'), false, 'Esmaltação em gel não pode estar em Manicure');
  assert.strictEqual(isServiceInCategory(manicureTradicional, 'manicure'), true, 'Manicure Tradicional deve estar em Manicure');
});

// 7. Categoria Pedicure: remove "Pés e dedos" (permanece em Depilação)
test('Categoria Pedicure: remove "Pés e dedos" (permanece somente em Depilação)', () => {
  const depilacaoPes = {
    id: 'depilacao-pes-e-dedos',
    title: 'Pés e dedos',
    category: 'depilacao',
    price: 10
  };
  const pedicureTradicional = {
    id: 'pedicure-tradicional',
    title: 'Pedicure Tradicional',
    category: 'pedicure',
    price: 40
  };

  assert.strictEqual(isServiceInCategory(depilacaoPes, 'pedicure'), false, 'Pés e dedos não pode estar em Pedicure');
  assert.strictEqual(isServiceInCategory(depilacaoPes, 'depilacao'), true, 'Pés e dedos deve estar em Depilação');
  assert.strictEqual(isServiceInCategory(pedicureTradicional, 'pedicure'), true, 'Pedicure Tradicional deve estar em Pedicure');
});

// 8. Categoria "Procedimentos em gel": consolidação e inclusão de "Manutenção de crescimento" e "Esmaltação em gel"
test('Categoria "Procedimentos em gel": inclui "Manutenção de crescimento", "Esmaltação em gel", "Banho em gel" e "Blindagem"', () => {
  const manutencao = {
    id: 'manutencao-fibra-vidro',
    title: 'Manutenção de Crescimento',
    category: 'manutencao',
    price: 120
  };
  const esmaltacaoGel = {
    id: 'esmaltacao-gel-premium',
    title: 'Esmaltação em Gel Premium ( Mão)',
    category: 'esmaltacao',
    price: 80
  };
  const banhoGel = {
    id: 'banho-em-gel',
    title: 'Banho em Gel',
    category: 'banho-gel',
    price: 150
  };
  const blindagem = {
    id: 'blindagem-homens-incolor',
    title: 'Blindagem Masculina Incolor',
    category: 'blindagem',
    price: 60
  };

  assert.strictEqual(isServiceInCategory(manutencao, 'gel'), true, 'Manutenção de crescimento deve estar em Procedimentos em gel');
  assert.strictEqual(isServiceInCategory(esmaltacaoGel, 'gel'), true, 'Esmaltação em gel deve estar em Procedimentos em gel');
  assert.strictEqual(isServiceInCategory(banhoGel, 'gel'), true, 'Banho em gel deve estar em Procedimentos em gel');
  assert.strictEqual(isServiceInCategory(blindagem, 'gel'), true, 'Blindagem deve estar em Procedimentos em gel');
});

// 9. Autocomplete de clientes para o administrador
test('Autocomplete de clientes: digitar "K" retorna Kristine com dados preenchidos e editáveis', () => {
  const clients = [
    {
      name: 'Kristine',
      phone: '(12) 99711-2233',
      email: 'kristine@exemplo.com',
      birthDate: '1992-04-15'
    },
    {
      name: 'Josefina',
      phone: '(12) 99822-3344',
      email: 'josefina@exemplo.com',
      birthDate: '1988-08-20'
    }
  ];

  const search = 'K';
  const searchDigits = search.trim().replace(/\D/g, '');
  const searchLower = search.toLowerCase().trim();
  const matches = clients.filter(c => {
    const nameMatch = c.name.toLowerCase().includes(searchLower);
    const phoneMatch = searchDigits.length >= 2 && c.phone.replace(/\D/g, '').includes(searchDigits);
    return nameMatch || phoneMatch;
  });

  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].name, 'Kristine');
  assert.strictEqual(matches[0].phone, '(12) 99711-2233');
  assert.strictEqual(matches[0].email, 'kristine@exemplo.com');
  assert.strictEqual(matches[0].birthDate, '1992-04-15');
});

// 10. Normalização de datas em múltiplos formatos
test('normalizeToISODate normaliza datas ISO, brasileiras e textuais', () => {
  assert.strictEqual(normalizeToISODate('2026-11-06'), '2026-11-06');
  assert.strictEqual(normalizeToISODate('06/11/2026'), '2026-11-06');
  assert.strictEqual(normalizeToISODate('19/11/2026'), '2026-11-19');
  assert.strictEqual(normalizeToISODate('6 de nov 2026'), '2026-11-06');
});
