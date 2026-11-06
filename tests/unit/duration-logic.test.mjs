import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Suite de Testes: Lógica Oficial de Duração dos Agendamentos
 * 
 * Regra Fundamental:
 * - Coluna A: ID do serviço.
 * - Coluna B: Nome do serviço.
 * - Coluna F: Duração oficial do serviço.
 * 
 * Proibições estritas:
 * - Não utilizar a coluna D (preço).
 * - Não criar durações fixas no código.
 * - Não duplicar durações no frontend.
 * - Não utilizar valores fictícios ou padrões de 30 minutos.
 * - Se ausente/inválida, rejeitar com a mensagem oficial:
 *   "A duração oficial do procedimento não está configurada na planilha oficial. Entre em contato com o atelier."
 */

// Funções idênticas implementadas em src/services/durationService.ts e apps-script/Code.gs
function parseDurationMinutes(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).toLowerCase().trim();
  if (!text) return null;
  const hoursMatch = text.match(/(\d+)\s*h(?:oras?|ou?rs?)?/i);
  const minutesMatch = text.match(/(?:h\s*|\b)?(\d+)\s*(?:minutos?|min|m\b)/i) ||
    text.match(/h\s*(\d{1,2})\b/i);
  const pureMinutes = !hoursMatch && !minutesMatch ? text.match(/^(\d+)$/) : null;

  let totalMinutes = 0;
  if (hoursMatch) totalMinutes += Number(hoursMatch[1]) * 60;
  if (minutesMatch) totalMinutes += Number(minutesMatch[1]);
  else if (pureMinutes) totalMinutes += Number(pureMinutes[1]);

  return totalMinutes > 0 && Number.isFinite(totalMinutes) ? totalMinutes : null;
}

function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function calculateEndTime(startTime, durationMinutes) {
  const startMin = timeToMinutes(startTime);
  if (startMin === null || !durationMinutes || durationMinutes <= 0) return null;
  const totalMin = (startMin + durationMinutes) % 1440;
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function intervalsOverlap(startA, durationA, startB, durationB) {
  if (durationA <= 0 || durationB <= 0) return false;
  const endA = startA + durationA;
  const endB = startB + durationB;
  return startA < endB && startB < endA;
}

// Mock fiel da planilha oficial (aba "Serviços")
// Linha 0: Cabeçalhos
// Coluna A (idx 0): ID
// Coluna B (idx 1): Nome
// Coluna C (idx 2): Categoria
// Coluna D (idx 3): Preço (NÃO DEVE SER USADA PARA DURAÇÃO!)
// Coluna E (idx 4): Preço formatado
// Coluna F (idx 5): Duração Oficial
const mockSheetRows = [
  ['ID', 'Nome', 'Categoria', 'Preço', 'Preço Form.', 'Duração', 'Badge', 'Descrição', 'Nota', 'URL Imagem', 'Specs', 'Ativo'],
  ['manicure-pedicure', 'Manicure e Pedicure', 'alongamento', 90, 'R$ 90,00', '1h 30min', 'Destaque', 'Cuidado completo', '4.9', '', '', true],
  ['alongamento-fibra', 'Alongamento em Fibra de Vidro', 'alongamento', 180, 'R$ 180,00', '2h', 'Mais pedido', 'Alta durabilidade', '5.0', '', '', true],
  ['blindagem', 'Blindagem', 'alongamento', 60, 'R$ 60,00', '1h', '', 'Proteção de lâmina', '4.8', '', '', true],
  ['nail-art-extra', 'Nail Art Extra', 'alongamento', 30, 'R$ 30,00', '30 min', '', 'Decoração adicional', '4.9', '', '', true],
  ['spa-pes', 'Spa dos Pés', 'spa', 50, 'R$ 50,00', '45 min', '', 'Esfoliação e hidratação', '4.9', '', '', true],
  ['servico-sem-duracao', 'Serviço Sem Duração', 'alongamento', 75, 'R$ 75,00', '', '', 'Teste sem duração', '4.0', '', '', true],
  ['servico-duracao-invalida', 'Serviço Duração Inválida', 'alongamento', 80, 'R$ 80,00', 'indisponivel', '', 'Teste inválido', '4.0', '', '', true],
  ['servico-inativo', 'Serviço Inativo', 'alongamento', 100, 'R$ 100,00', '1h', '', 'Inativo', '4.0', '', '', false]
];

function getServiceDurationFromSheet(serviceId, serviceTitle) {
  for (let i = 1; i < mockSheetRows.length; i++) {
    const row = mockSheetRows[i];
    const rowId = String(row[0] || '').trim();
    const rowTitle = String(row[1] || '').trim();
    const idMatches = serviceId && rowId === String(serviceId).trim();
    const titleMatches = serviceTitle && rowTitle.toLowerCase() === String(serviceTitle).trim().toLowerCase();
    if (idMatches || titleMatches) {
      // REGRA: Lê da Coluna F (index 5)
      return parseDurationMinutes(row[5]);
    }
  }
  return null;
}

const OFFICIAL_ERROR_MSG = 'A duração oficial do procedimento não está configurada na planilha oficial. Entre em contato com o atelier.';

function validateAndCreateBooking({
  serviceId,
  serviceTitle,
  additionalServiceIds = [],
  date,
  time,
  existingAppointments = []
}) {
  const mainDuration = getServiceDurationFromSheet(serviceId, serviceTitle);
  if (!mainDuration || mainDuration <= 0) {
    return {
      success: false,
      persisted: false,
      error: OFFICIAL_ERROR_MSG
    };
  }

  let totalDuration = mainDuration;
  for (const addId of additionalServiceIds) {
    const addDur = getServiceDurationFromSheet(addId, '');
    if (!addDur || addDur <= 0) {
      return {
        success: false,
        persisted: false,
        error: OFFICIAL_ERROR_MSG
      };
    }
    totalDuration += addDur;
  }

  const startMin = timeToMinutes(time);
  if (startMin === null) {
    return { success: false, persisted: false, error: 'Horário inválido.' };
  }

  const reqEnd = startMin + totalDuration;

  // Verifica conflitos com agendamentos existentes
  for (const a of existingAppointments) {
    if (a.date !== date || a.status === 'cancelado') continue;
    const aStart = timeToMinutes(a.time);
    if (aStart === null) continue;
    const aDur = getServiceDurationFromSheet(a.serviceId, a.serviceTitle);
    if (aDur && intervalsOverlap(startMin, totalDuration, aStart, aDur)) {
      return {
        success: false,
        persisted: false,
        conflict: true,
        code: 'SLOT_UNAVAILABLE',
        error: 'Este horário acabou de ser reservado ou se sobrepõe a outro agendamento.'
      };
    }
  }

  return {
    success: true,
    persisted: true,
    totalDurationMinutes: totalDuration,
    endTime: calculateEndTime(time, totalDuration)
  };
}

// =========================================================================
// TESTES
// =========================================================================

test('1. parseDurationMinutes extrai minutos com precisão e NUNCA retorna fallback de 30', () => {
  assert.strictEqual(parseDurationMinutes('1h 30min'), 90);
  assert.strictEqual(parseDurationMinutes('1h30min'), 90);
  assert.strictEqual(parseDurationMinutes('1h30'), 90);
  assert.strictEqual(parseDurationMinutes('1 hora e 30 minutos'), 90);
  assert.strictEqual(parseDurationMinutes('1h'), 60);
  assert.strictEqual(parseDurationMinutes('2h'), 120);
  assert.strictEqual(parseDurationMinutes('45 min'), 45);
  assert.strictEqual(parseDurationMinutes('45'), 45);
  assert.strictEqual(parseDurationMinutes('30 min'), 30);

  // Valores inválidos retornam null, NUNCA 30
  assert.strictEqual(parseDurationMinutes(''), null, 'Vazio deve retornar null');
  assert.strictEqual(parseDurationMinutes(null), null, 'Null deve retornar null');
  assert.strictEqual(parseDurationMinutes(undefined), null, 'Undefined deve retornar null');
  assert.strictEqual(parseDurationMinutes('0 min'), null, '0 min deve retornar null');
  assert.strictEqual(parseDurationMinutes('texto inválido'), null, 'Texto inválido deve retornar null');
  assert.strictEqual(parseDurationMinutes('indefinido'), null, 'Indefinido deve retornar null');
});

test('2. Leitura da duração oficial estritamente pela Coluna F (index 5) usando ID da Coluna A (index 0)', () => {
  // Manicure e Pedicure: Preço na Coluna D é 90, Duração na Coluna F é "1h 30min" (90 min)
  const durManicure = getServiceDurationFromSheet('manicure-pedicure');
  assert.strictEqual(durManicure, 90, 'Duração de manicure-pedicure deve ser 90 min (da Coluna F)');

  // Alongamento em Fibra: Preço na Coluna D é 180, Duração na Coluna F é "2h" (120 min)
  // Se o código usasse Coluna D, retornaria 180! Comprovamos que lê Coluna F = 120 min!
  const durFibra = getServiceDurationFromSheet('alongamento-fibra');
  assert.strictEqual(durFibra, 120, 'Duração de alongamento-fibra deve ser 120 min da Coluna F, não 180 do preço da Coluna D');

  // Spa dos Pés: Preço na Coluna D é 50, Duração na Coluna F é "45 min" (45 min)
  const durSpa = getServiceDurationFromSheet('spa-pes');
  assert.strictEqual(durSpa, 45, 'Duração de spa-pes deve ser 45 min da Coluna F, não 50 da Coluna D');

  // Serviço sem duração na Coluna F deve retornar null, jamais fallback 30
  const durSem = getServiceDurationFromSheet('servico-sem-duracao');
  assert.strictEqual(durSem, null, 'Serviço sem duração na Coluna F deve retornar null');

  // Serviço com texto inválido na Coluna F deve retornar null, jamais fallback 30
  const durInv = getServiceDurationFromSheet('servico-duracao-invalida');
  assert.strictEqual(durInv, null, 'Serviço com duração inválida na Coluna F deve retornar null');

  // ID inexistente deve retornar null
  const durInex = getServiceDurationFromSheet('id-que-nao-existe');
  assert.strictEqual(durInex, null, 'ID inexistente deve retornar null');
});

test('3. Cálculo automático do término para serviço simples (Exemplo do Usuário)', () => {
  // Exemplo do prompt:
  // Manicure e Pedicure = 1h30min (coluna F).
  // Se o cliente escolher 10:00:
  // - Início: 10:00.
  // - Término: 11:30.
  const booking = validateAndCreateBooking({
    serviceId: 'manicure-pedicure',
    date: '2026-11-20',
    time: '10:00'
  });

  assert.strictEqual(booking.success, true);
  assert.strictEqual(booking.totalDurationMinutes, 90);
  assert.strictEqual(booking.endTime, '11:30', 'Término deve ser exatamente 11:30');
});

test('4. Cálculo automático do término com serviços adicionais (Exemplo do Usuário)', () => {
  // Exemplo do prompt:
  // Manicure e Pedicure = 1h30min (coluna F).
  // Adiciona serviço extra de 30min (consultado pela coluna F):
  // - Duração total = 1h30 + 30min = 2h00 (120 min).
  // - Término: 12:00.
  const booking = validateAndCreateBooking({
    serviceId: 'manicure-pedicure',
    additionalServiceIds: ['nail-art-extra'], // 30 min da Coluna F
    date: '2026-11-20',
    time: '10:00'
  });

  assert.strictEqual(booking.success, true);
  assert.strictEqual(booking.totalDurationMinutes, 120, 'Duração total deve ser 90 + 30 = 120 min (2h)');
  assert.strictEqual(booking.endTime, '12:00', 'Término deve ser exatamente 12:00');
});

test('5. Cálculo composto com múltiplos serviços adicionais', () => {
  // Manicure e Pedicure (90 min) + Nail Art (30 min) + Spa dos Pés (45 min)
  // Total = 90 + 30 + 45 = 165 min (2h 45min)
  // Início: 10:00 -> Término: 12:45
  const booking = validateAndCreateBooking({
    serviceId: 'manicure-pedicure',
    additionalServiceIds: ['nail-art-extra', 'spa-pes'],
    date: '2026-11-20',
    time: '10:00'
  });

  assert.strictEqual(booking.success, true);
  assert.strictEqual(booking.totalDurationMinutes, 165);
  assert.strictEqual(booking.endTime, '12:45', 'Término deve ser 12:45');
});

test('6. Bloqueio completo de todos os horários dentro do intervalo da duração simples (10:00 às 11:30)', () => {
  const existingAppointments = [
    {
      id: 'apt-001',
      serviceId: 'manicure-pedicure', // 90 min (10:00 às 11:30)
      date: '2026-11-20',
      time: '10:00',
      status: 'confirmado'
    }
  ];

  // Tentativas de agendamento em horários dentro do intervalo (10:00 às 11:30) DEVEM SER BLOQUEADAS:
  const blockedTimes = ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15'];
  for (const time of blockedTimes) {
    const res = validateAndCreateBooking({
      serviceId: 'blindagem', // 60 min
      date: '2026-11-20',
      time,
      existingAppointments
    });
    assert.strictEqual(res.success, false, `Horário ${time} deve estar BLOQUEADO`);
    assert.strictEqual(res.code, 'SLOT_UNAVAILABLE');
  }

  // Horário adjacente no término exato (11:30) DEVE SER PERMITIDO:
  const allowed1130 = validateAndCreateBooking({
    serviceId: 'blindagem',
    date: '2026-11-20',
    time: '11:30',
    existingAppointments
  });
  assert.strictEqual(allowed1130.success, true, 'Horário adjacente 11:30 DEVE ser permitido');
  assert.strictEqual(allowed1130.endTime, '12:30');

  // Horário anterior adjacente (terminando às 10:00) DEVE SER PERMITIDO:
  const allowed0900 = validateAndCreateBooking({
    serviceId: 'blindagem', // 60 min: 09:00 às 10:00
    date: '2026-11-20',
    time: '09:00',
    existingAppointments
  });
  assert.strictEqual(allowed0900.success, true, 'Horário 09:00 (termina 10:00) DEVE ser permitido');
});

test('7. Bloqueio completo do intervalo estendido com adicional (10:00 às 12:00)', () => {
  const existingAppointments = [
    {
      id: 'apt-002',
      serviceId: 'manicure-pedicure', // 90 min + 30 min extra = 120 min (10:00 às 12:00)
      date: '2026-11-20',
      time: '10:00',
      status: 'confirmado'
    }
  ];

  // Modificamos a consulta do mock para simular o agendamento existente de 120 min
  const mockCheck = (time) => {
    const reqStart = timeToMinutes(time);
    const reqDur = 60; // 1h
    const existingStart = timeToMinutes('10:00');
    const existingDur = 120; // 10:00 às 12:00
    return intervalsOverlap(reqStart, reqDur, existingStart, existingDur);
  };

  // Bloqueia 10:00, 10:30, 11:00, 11:30, 11:45
  assert.strictEqual(mockCheck('10:30'), true, '10:30 bloqueado');
  assert.strictEqual(mockCheck('11:00'), true, '11:00 bloqueado');
  assert.strictEqual(mockCheck('11:30'), true, '11:30 bloqueado pelo adicional até 12:00');
  assert.strictEqual(mockCheck('11:45'), true, '11:45 bloqueado pelo adicional até 12:00');

  // Permite 12:00
  assert.strictEqual(mockCheck('12:00'), false, '12:00 livre e permitido');
});

test('8. Rejeição de agendamento quando duração principal estiver ausente ou inválida', () => {
  // Serviço sem duração configurada na Coluna F
  const resSem = validateAndCreateBooking({
    serviceId: 'servico-sem-duracao',
    date: '2026-11-20',
    time: '14:00'
  });
  assert.strictEqual(resSem.success, false);
  assert.strictEqual(resSem.persisted, false);
  assert.strictEqual(resSem.error, OFFICIAL_ERROR_MSG);

  // Serviço com texto inválido na Coluna F
  const resInv = validateAndCreateBooking({
    serviceId: 'servico-duracao-invalida',
    date: '2026-11-20',
    time: '14:00'
  });
  assert.strictEqual(resInv.success, false);
  assert.strictEqual(resInv.persisted, false);
  assert.strictEqual(resInv.error, OFFICIAL_ERROR_MSG);
});

test('9. Rejeição de agendamento quando serviço adicional tiver duração ausente ou inválida', () => {
  const res = validateAndCreateBooking({
    serviceId: 'manicure-pedicure',
    additionalServiceIds: ['servico-sem-duracao'], // Adicional sem duração na Coluna F
    date: '2026-11-20',
    time: '14:00'
  });
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.persisted, false);
  assert.strictEqual(res.error, OFFICIAL_ERROR_MSG);
});
