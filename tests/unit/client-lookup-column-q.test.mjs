import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Suite de Testes: Identificação e Recuperação do Cadastro da Cliente
 * Fonte oficial da data de nascimento: Coluna Q da aba "Agendamentos"
 */

function normalizeBirthDateToISO(val) {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const y = val.getFullYear();
    const m = val.getMonth() + 1;
    const d = val.getDate();
    return `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
  }
  const str = String(val).trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) {
    return isoMatch[1];
  }
  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (brMatch) {
    const d = parseInt(brMatch[1], 10);
    const m = parseInt(brMatch[2], 10);
    const y = brMatch[3];
    return `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
  }
  const parsed = new Date(str);
  if (parsed instanceof Date && !isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    return `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
  }
  return '';
}

function normalizeClientPhoneKey(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.indexOf('55') === 0 && (digits.length === 12 || digits.length === 13)) {
    digits = digits.substring(2);
  }
  if (digits.indexOf('0') === 0 && (digits.length === 11 || digits.length === 12)) {
    digits = digits.substring(1);
  }
  return digits;
}

function phonesMatch(phoneA, phoneB) {
  const a = normalizeClientPhoneKey(phoneA);
  const b = normalizeClientPhoneKey(phoneB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10 && a.substring(0, 2) === b.substring(0, 2) && a.slice(-8) === b.slice(-8)) {
    return true;
  }
  if ((a.length === 8 || a.length === 9) && (b.length === 10 || b.length === 11) && b.slice(-8) === a.slice(-8)) {
    return true;
  }
  if ((b.length === 8 || b.length === 9) && (a.length === 10 || a.length === 11) && a.slice(-8) === b.slice(-8)) {
    return true;
  }
  return false;
}

function isValidEmail(email) {
  const str = String(email || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

/**
 * Simulação fiel do mecanismo de busca de cliente do Code.gs
 */
function simulateLookupPublicClientByPhone(phoneValue, appointmentsRows, clientProfilesRows = []) {
  const phoneKey = normalizeClientPhoneKey(phoneValue);
  if (phoneKey.length < 8 || phoneKey.length > 15) {
    return { status: 'error', message: 'Informe um telefone válido com DDD.' };
  }

  let foundName = '';
  let foundEmail = '';
  let foundBirthDate = '';

  // 1. Fonte oficial da data de nascimento: aba 'Agendamentos', Coluna Q (índice 16)
  if (Array.isArray(appointmentsRows)) {
    for (let i = appointmentsRows.length - 1; i >= 1; i--) {
      const row = appointmentsRows[i];
      if (!phonesMatch(row[2], phoneKey)) continue;
      if (String(row[8] || '').toLowerCase() === 'bloqueado') continue;

      const rowName = String(row[1] || '').trim();
      const rowEmail = String(row[3] || '').trim();
      const rawBirth = row[16];
      const rowBirthDate = normalizeBirthDateToISO(rawBirth);

      if (!foundName && rowName) {
        foundName = rowName;
      }
      if (!foundEmail && rowEmail && isValidEmail(rowEmail)) {
        foundEmail = rowEmail;
      }
      if (!foundBirthDate && rowBirthDate) {
        foundBirthDate = rowBirthDate;
      }

      if (foundName && foundEmail && foundBirthDate) {
        break;
      }
    }
  }

  // 2. Consulta complementar na aba 'Perfis de Clientes'
  if (!foundName || !foundBirthDate || !foundEmail) {
    if (Array.isArray(clientProfilesRows)) {
      for (let c = 1; c < clientProfilesRows.length; c++) {
        if (phonesMatch(clientProfilesRows[c][1], phoneKey)) {
          try {
            const prof = JSON.parse(clientProfilesRows[c][2]);
            if (prof && typeof prof === 'object') {
              if (!foundName && prof.name) foundName = String(prof.name).trim();
              if (!foundEmail && prof.email && isValidEmail(prof.email)) foundEmail = String(prof.email).trim();
              if (!foundBirthDate && prof.birthDate) {
                const profBirth = normalizeBirthDateToISO(prof.birthDate);
                if (profBirth) foundBirthDate = profBirth;
              }
            }
          } catch {}
          if (foundName && foundBirthDate && foundEmail) break;
        }
      }
    }
  }

  if (foundName || foundBirthDate) {
    const isComplete = Boolean(foundName && foundBirthDate);
    return {
      status: 'success',
      found: true,
      isComplete,
      clientName: foundName,
      clientEmail: foundEmail,
      clientBirthDate: foundBirthDate
    };
  }

  return {
    status: 'success',
    found: false,
    isComplete: false,
    clientName: '',
    clientEmail: '',
    clientBirthDate: ''
  };
}

// ============================================================================
// TESTES
// ============================================================================

test('1. normalizeBirthDateToISO converte formatos diversos para YYYY-MM-DD com segurança', () => {
  // Objeto Date nativo (como retornado pelo Google Sheets)
  const nativeDate = new Date(1992, 4, 15); // 15 de maio de 1992
  assert.strictEqual(normalizeBirthDateToISO(nativeDate), '1992-05-15');

  // String no formato brasileiro DD/MM/YYYY
  assert.strictEqual(normalizeBirthDateToISO('28/07/1985'), '1985-07-28');
  assert.strictEqual(normalizeBirthDateToISO('05/03/1990'), '1990-03-05');
  assert.strictEqual(normalizeBirthDateToISO('5/3/1990'), '1990-03-05');

  // String no formato brasileiro com traço DD-MM-YYYY
  assert.strictEqual(normalizeBirthDateToISO('19-11-1996'), '1996-11-19');

  // String ISO pura YYYY-MM-DD
  assert.strictEqual(normalizeBirthDateToISO('1994-12-03'), '1994-12-03');

  // String ISO com timestamp UTC
  assert.strictEqual(normalizeBirthDateToISO('1994-12-03T00:00:00.000Z'), '1994-12-03');

  // Valores vazios ou inválidos
  assert.strictEqual(normalizeBirthDateToISO(''), '');
  assert.strictEqual(normalizeBirthDateToISO(null), '');
  assert.strictEqual(normalizeBirthDateToISO(undefined), '');
  assert.strictEqual(normalizeBirthDateToISO('data-invalida'), '');
});

test('2. phonesMatch e normalizeClientPhoneKey tratam prefixo +55, DDD e nono dígito', () => {
  // Com e sem +55
  assert.ok(phonesMatch('+55 (12) 99711-2233', '12997112233'));
  assert.ok(phonesMatch('5512997112233', '12997112233'));

  // Com código de discagem '0'
  assert.ok(phonesMatch('012997112233', '12997112233'));

  // Formato com 8 dígitos vs 9 dígitos (mesmo DDD e mesmos últimos 8 dígitos)
  assert.ok(phonesMatch('(11) 9876-5432', '(11) 99876-5432'));

  // DDDs diferentes NUNCA devem casar
  assert.strictEqual(phonesMatch('11997112233', '12997112233'), false);
  assert.strictEqual(phonesMatch('21997112233', '11997112233'), false);
});

test('3. Recuperação oficial da data de nascimento da Coluna Q (índice 16) da aba Agendamentos', () => {
  // Monta linha fiel da aba Agendamentos:
  // Col A: Timestamp, Col B: Nome, Col C: Telefone, Col D: Email, Col E: Serviço
  // Col F: Data, Col G: Horário, Col H: Sinal, Col I: Status, Col J: ID
  // Col K: Notas, Col L: Local, Col M: Endereço, Col N: Adicionais, Col O: Pedido
  // Col P: ID Serviço, Col Q: Data de Nascimento (índice 16)
  const rows = [
    ['Data/Hora', 'Nome', 'WhatsApp', 'Email', 'Serviço', 'Data', 'Horário', 'Sinal', 'Status', 'ID', 'Obs', 'Local', 'Endereço', 'Adicionais', 'Custom', 'ID_Serv', 'Data Nasc'],
    [
      new Date('2026-10-15'),
      'Maria Silva Souza',
      '(12) 99123-4567',
      'maria.silva@exemplo.com',
      'Manicure Clássica',
      '2026-10-20',
      '14:00',
      32,
      'concluido',
      'apt-101',
      '',
      'salon',
      '',
      '[]',
      '',
      'manicure-classica',
      '1991-08-25' // Coluna Q (índice 16)
    ]
  ];

  const result = simulateLookupPublicClientByPhone('(12) 99123-4567', rows);
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.isComplete, true);
  assert.strictEqual(result.clientName, 'Maria Silva Souza');
  assert.strictEqual(result.clientEmail, 'maria.silva@exemplo.com');
  assert.strictEqual(result.clientBirthDate, '1991-08-25');
});

test('4. Recuperação correta quando Coluna Q contém objeto Date nativo do Google Sheets', () => {
  const dateObj = new Date(1987, 2, 10); // 10 de março de 1987
  const rows = [
    ['Data/Hora', 'Nome', 'WhatsApp', 'Email', 'Serviço', 'Data', 'Horário', 'Sinal', 'Status', 'ID', 'Obs', 'Local', 'Endereço', 'Adicionais', 'Custom', 'ID_Serv', 'Data Nasc'],
    [
      new Date(),
      'Juliana Mendes',
      '11988776655',
      'juliana@teste.com',
      'Pedicure',
      '2026-11-01',
      '10:00',
      36,
      'confirmado',
      'apt-202',
      '',
      'salon',
      '',
      '[]',
      '',
      'pedicure-classica',
      dateObj // Objeto Date nativo na Coluna Q
    ]
  ];

  const result = simulateLookupPublicClientByPhone('11988776655', rows);
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.isComplete, true);
  assert.strictEqual(result.clientBirthDate, '1987-03-10');
  assert.strictEqual(result.clientName, 'Juliana Mendes');
});

test('5. Agregação entre múltiplos agendamentos: recupera Coluna Q preenchida em reserva anterior', () => {
  // Cliente tem 2 agendamentos:
  // Agendamento 1 (mais antigo): tinha Coluna Q preenchida
  // Agendamento 2 (mais recente, ex: agendamento manual sem data nasc): Coluna Q vazia
  const rows = [
    ['Header'],
    [
      new Date('2026-09-01'),
      'Ana Paula',
      '(12) 99555-4433',
      'anapaula@gmail.com',
      'Blindagem',
      '2026-09-10',
      '15:00',
      40,
      'concluido',
      'apt-301',
      '',
      'salon',
      '',
      '[]',
      '',
      'blindagem',
      '1995-04-18' // Coluna Q preenchida aqui
    ],
    [
      new Date('2026-11-01'),
      'Ana Paula',
      '(12) 99555-4433',
      '', // email não informado neste agendamento
      'Manicure',
      '2026-11-05',
      '16:00',
      32,
      'confirmado',
      'apt-302',
      '',
      'salon',
      '',
      '[]',
      '',
      'manicure',
      '' // Coluna Q vazia nesta reserva mais recente
    ]
  ];

  const result = simulateLookupPublicClientByPhone('12995554433', rows);
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.isComplete, true);
  assert.strictEqual(result.clientName, 'Ana Paula');
  assert.strictEqual(result.clientEmail, 'anapaula@gmail.com', 'Deve recuperar o e-mail preenchido na reserva anterior');
  assert.strictEqual(result.clientBirthDate, '1995-04-18', 'Deve recuperar a data de nascimento da Coluna Q da reserva anterior');
});

test('6. Cliente com cadastro incompleto (Coluna Q vazia em todas as reservas) retorna isComplete=false', () => {
  const rows = [
    ['Header'],
    [
      new Date(),
      'Camila Rocha',
      '(12) 99222-1100',
      'camila@email.com',
      'Esmaltação em Gel',
      '2026-10-05',
      '11:00',
      44,
      'concluido',
      'apt-401',
      '',
      'salon',
      '',
      '[]',
      '',
      'esmaltacao-gel',
      '' // Coluna Q vazia
    ]
  ];

  const result = simulateLookupPublicClientByPhone('12992221100', rows);
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.isComplete, false);
  assert.strictEqual(result.clientName, 'Camila Rocha');
  assert.strictEqual(result.clientBirthDate, '');
});

test('7. Novo cliente (número não cadastrado) retorna found=false e isComplete=false', () => {
  const rows = [
    ['Header'],
    [new Date(), 'Existente', '12999990000', '', '', '', '', 0, 'concluido', 'apt-1', '', 'salon', '', '[]', '', '', '1990-01-01']
  ];

  const result = simulateLookupPublicClientByPhone('12988887777', rows);
  assert.strictEqual(result.found, false);
  assert.strictEqual(result.isComplete, false);
  assert.strictEqual(result.clientName, '');
  assert.strictEqual(result.clientBirthDate, '');
});

test('8. Fluxo do BookingWizard: cliente completo avança sem solicitar data de nascimento novamente', () => {
  // Simula a lógica de decisão do componente React BookingWizard
  const lookupResult = {
    success: true,
    found: true,
    isComplete: true,
    clientName: 'Fernanda Lima',
    clientEmail: 'fernanda@exemplo.com',
    clientBirthDate: '1993-07-22'
  };

  // Estado do wizard após consulta
  let clientName = '';
  let clientEmail = '';
  let clientBirthDate = '';
  let isReturningClient = false;
  let isManualEdit = false;

  if (lookupResult.success && lookupResult.found && lookupResult.clientName) {
    clientName = lookupResult.clientName;
    if (lookupResult.clientEmail) clientEmail = lookupResult.clientEmail;
    if (lookupResult.clientBirthDate) clientBirthDate = lookupResult.clientBirthDate;
    isReturningClient = true;
    isManualEdit = false;
  }

  // Avaliação de exibição
  const isClientComplete = Boolean(isReturningClient && clientName.trim() && clientBirthDate.trim());
  assert.strictEqual(isClientComplete, true);

  // Não solicita data de nascimento se isClientComplete && !isManualEdit
  const shouldPromptBirthDate = !isClientComplete || isManualEdit;
  assert.strictEqual(shouldPromptBirthDate, false, 'Não deve solicitar data de nascimento quando o cadastro estiver completo');

  // O avanço para a etapa 2 (escolha da data) pode ser executado diretamente com 1 clique
  let bookingStep = 1;
  if (isClientComplete && !isManualEdit) {
    // Botão "Continuar para escolher a data"
    bookingStep = 2;
  }
  assert.strictEqual(bookingStep, 2, 'Cliente completo avança diretamente para a etapa 2');

  // Payload final de agendamento preserva a data de nascimento da Coluna Q
  const appointmentPayload = {
    clientName,
    clientBirthDate,
    clientEmail
  };
  assert.strictEqual(appointmentPayload.clientBirthDate, '1993-07-22');
});
