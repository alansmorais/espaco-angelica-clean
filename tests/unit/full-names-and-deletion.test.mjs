import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeClients,
  mergeAndExpandAppointments,
  resolveClientFullName,
  normalizeClientPhoneKey,
} from '../../src/services/clientReconciliationService.ts';
import { cancelRecurringSeries } from '../../src/services/recurrenceService.ts';

/**
 * Suite de Testes: Nomes Completos e Eliminação de Registros Duplicados / Botão de Exclusão
 * REGRAS DO PROJETO ESPAÇO ANGÉLICA DO CARMO:
 * 1. Manter Kristine Sorensen e seus agendamentos legítimos
 * 2. Manter Josefina Calderón e seus agendamentos legítimos
 * 3. Remover registros fantasmas ou duplicados chamados apenas Kristine ou Josefina (sem sobrenome)
 * 4. Não apagar os registros completos da planilha
 * 5. Não excluir clientes ou agendamentos apenas pela diferença no nome
 * 6. Comparar telefone, ID, data, horário e procedimento para identificar origem correta
 * 7. Sincronização do painel apresenta nomes completos sem duplicações
 * 8. Funcionamento correto do botão de exclusão
 */

test('1. resolveClientFullName normaliza primeiros nomes para nomes completos oficiais', () => {
  assert.strictEqual(resolveClientFullName('Kristine'), 'Kristine Sorensen');
  assert.strictEqual(resolveClientFullName('kristine'), 'Kristine Sorensen');
  assert.strictEqual(resolveClientFullName('Josefina'), 'Josefina Calderón');
  assert.strictEqual(resolveClientFullName('josefina'), 'Josefina Calderón');
  assert.strictEqual(resolveClientFullName('Kristine Sorensen'), 'Kristine Sorensen');
  assert.strictEqual(resolveClientFullName('Josefina Calderón'), 'Josefina Calderón');
  assert.strictEqual(resolveClientFullName('Carla Mendes'), 'Carla Mendes');
});

test('2. mergeClients deduplica clientes e elimina entradas incompletas sem sobrenome', () => {
  const remoteClients = [
    {
      id: 'client-kristine-sorensen',
      name: 'Kristine Sorensen',
      initials: 'KS',
      phone: '(12) 99711-2233',
      email: 'kristine.sorensen@exemplo.com',
      birthDate: '1992-04-15',
      tier: 'VIP Club',
      status: 'vip'
    },
    {
      id: 'client-josefina-calderon',
      name: 'Josefina Calderón',
      initials: 'JC',
      phone: '(12) 99822-3344',
      email: 'josefina.calderon@exemplo.com',
      birthDate: '1988-08-20',
      tier: 'Frequente',
      status: 'frequente'
    }
  ];

  // Fallback antigo com apenas o primeiro nome
  const fallbackWithSingleNames = [
    {
      id: 'mock-kristine',
      name: 'Kristine',
      initials: 'K',
      phone: '(12) 99711-2233',
      email: 'kristine@exemplo.com',
      birthDate: '1992-04-15'
    },
    {
      id: 'mock-josefina',
      name: 'Josefina',
      initials: 'J',
      phone: '(12) 99822-3344',
      email: 'josefina@exemplo.com',
      birthDate: '1988-08-20'
    }
  ];

  const merged = mergeClients(remoteClients, fallbackWithSingleNames);

  // Deve haver exatamente 2 clientes
  assert.strictEqual(merged.length, 2, 'Deve conter apenas os 2 clientes completos');

  const kristine = merged.find(c => c.name.toLowerCase().includes('kristine'));
  assert.ok(kristine, 'Kristine Sorensen deve existir');
  assert.strictEqual(kristine.name, 'Kristine Sorensen', 'Nome deve ser Kristine Sorensen');
  assert.strictEqual(kristine.initials, 'KS');

  const josefina = merged.find(c => c.name.toLowerCase().includes('josefina'));
  assert.ok(josefina, 'Josefina Calderón deve existir');
  assert.strictEqual(josefina.name, 'Josefina Calderón', 'Nome deve ser Josefina Calderón');
  assert.strictEqual(josefina.initials, 'JC');

  // Não deve existir nenhum registro chamado apenas 'Kristine' ou 'Josefina'
  const singleKristine = merged.filter(c => c.name === 'Kristine');
  assert.strictEqual(singleKristine.length, 0, 'Não deve haver cliente com apenas Kristine');

  const singleJosefina = merged.filter(c => c.name === 'Josefina');
  assert.strictEqual(singleJosefina.length, 0, 'Não deve haver cliente com apenas Josefina');
});

test('3. mergeClients com cadastro incompleto vindo da planilha oficial promove para nome completo', () => {
  const remoteWithShortName = [
    {
      id: 'client-12997112233',
      name: 'Kristine',
      phone: '12997112233',
      email: '',
      birthDate: '1992-04-15'
    }
  ];

  const merged = mergeClients(remoteWithShortName);
  assert.strictEqual(merged.length, 2); // Kristine Sorensen + Josefina Calderón (do default)
  const k = merged.find(c => c.name.includes('Kristine'));
  assert.strictEqual(k.name, 'Kristine Sorensen');
});

test('4. mergeAndExpandAppointments unifica agendamentos com nome incompleto e nome completo', () => {
  const remoteAppointments = [
    {
      id: 'apt-1',
      clientName: 'Kristine', // registro com nome incompleto
      clientPhone: '(12) 99711-2233',
      serviceTitle: 'Pedicure + Manicure',
      serviceDuration: '1 h 30 min',
      date: '2026-11-06',
      time: '11:00',
      status: 'confirmado'
    },
    {
      id: 'apt-1', // mesmo ID com nome completo da planilha
      clientName: 'Kristine Sorensen',
      clientPhone: '(12) 99711-2233',
      serviceTitle: 'Pedicure + Manicure',
      serviceDuration: '1 h 30 min',
      date: '2026-11-06',
      time: '11:00',
      status: 'confirmado'
    },
    {
      id: 'apt-2',
      clientName: 'Josefina Calderón',
      clientPhone: '(12) 99822-3344',
      serviceTitle: 'Manicure Tradicional',
      serviceDuration: '45 min',
      date: '2026-11-06',
      time: '14:00',
      status: 'confirmado'
    }
  ];

  const result = mergeAndExpandAppointments(remoteAppointments);

  // Deve haver 2 agendamentos
  assert.strictEqual(result.length, 2);

  const kApt = result.find(a => a.id === 'apt-1');
  assert.strictEqual(kApt.clientName, 'Kristine Sorensen');
  assert.strictEqual(kApt.clientInitials, 'KS');

  const jApt = result.find(a => a.id === 'apt-2');
  assert.strictEqual(jApt.clientName, 'Josefina Calderón');
  assert.strictEqual(jApt.clientInitials, 'JC');

  // Nenhum deve ser chamado apenas 'Kristine' ou 'Josefina'
  assert.strictEqual(result.filter(a => a.clientName === 'Kristine').length, 0);
  assert.strictEqual(result.filter(a => a.clientName === 'Josefina').length, 0);
});

test('5. Deduplicação por telefone, data, horário e procedimento preserva registro oficial', () => {
  const duplicates = [
    {
      id: 'apt-phantom-kristine',
      clientName: 'Kristine',
      clientPhone: '(12) 99711-2233',
      serviceTitle: 'Pedicure + Manicure',
      serviceDuration: '90 min',
      date: '2026-11-06',
      time: '11:00',
      status: 'confirmado'
    },
    {
      id: 'apt-1793380431346', // ID oficial legítimo da planilha
      clientName: 'Kristine Sorensen',
      clientPhone: '(12) 99711-2233',
      serviceTitle: 'Pedicure + Manicure',
      serviceDuration: '90 min',
      date: '2026-11-06',
      time: '11:00',
      status: 'confirmado'
    }
  ];

  const unified = mergeAndExpandAppointments(duplicates);
  assert.strictEqual(unified.length, 1, 'Deve unificar agendamentos duplicados');
  assert.strictEqual(unified[0].id, 'apt-1793380431346', 'Preserva o ID legítimo da planilha');
  assert.strictEqual(unified[0].clientName, 'Kristine Sorensen', 'Preserva o nome completo');
});

test('6. Botão de exclusão: cancela ocorrência de série recorrente sem re-expansão fantasma', () => {
  const seriesAppointments = [
    {
      id: 'apt-base',
      clientName: 'Kristine Sorensen',
      date: '2026-11-06',
      time: '11:00',
      status: 'confirmado',
      recurrence: {
        seriesId: 'series-kristine-1',
        totalSessions: 3,
        currentSession: 1
      }
    },
    {
      id: 'apt-base-rec-2',
      clientName: 'Kristine Sorensen',
      date: '2026-11-19',
      time: '11:00',
      status: 'confirmado',
      recurrence: {
        seriesId: 'series-kristine-1',
        totalSessions: 3,
        currentSession: 2
      }
    },
    {
      id: 'apt-base-rec-3',
      clientName: 'Kristine Sorensen',
      date: '2026-12-04',
      time: '11:00',
      status: 'confirmado',
      recurrence: {
        seriesId: 'series-kristine-1',
        totalSessions: 3,
        currentSession: 3
      }
    }
  ];

  // Exclui/cancela a ocorrência 2 (19/11)
  const remaining = seriesAppointments.filter(a => a.id !== 'apt-base-rec-2');
  const cancelled = cancelRecurringSeries(remaining, 'series-kristine-1', { fromDate: '2026-11-19' });

  // A sessão 1 base permanece intacta
  assert.strictEqual(cancelled[0].id, 'apt-base');
  assert.strictEqual(cancelled[0].status, 'confirmado');

  // A sessão cancelada não é recriada como confirmada
  const reExpanded = mergeAndExpandAppointments(cancelled);
  const nov19 = reExpanded.find(a => a.date === '2026-11-19');
  assert.strictEqual(nov19, undefined, 'A sessão de 19/11 foi excluída e não deve reaparecer');
});

test('7. Autocomplete de clientes: busca por "K" ou "J" retorna nomes completos Kristine Sorensen e Josefina Calderón', () => {
  const clients = mergeClients([]);
  assert.strictEqual(clients.length, 2);

  // Busca 'K'
  const matchesK = clients.filter(c => c.name.toLowerCase().includes('k'));
  assert.strictEqual(matchesK.length, 1);
  assert.strictEqual(matchesK[0].name, 'Kristine Sorensen');

  // Busca 'J'
  const matchesJ = clients.filter(c => c.name.toLowerCase().includes('j'));
  assert.strictEqual(matchesJ.length, 1);
  assert.strictEqual(matchesJ[0].name, 'Josefina Calderón');

  // Nenhuma sugestão deve ser apenas 'Kristine' ou 'Josefina'
  assert.strictEqual(matchesK[0].name === 'Kristine', false);
  assert.strictEqual(matchesJ[0].name === 'Josefina', false);
});
