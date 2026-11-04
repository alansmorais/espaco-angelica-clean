import test from 'node:test';
import assert from 'node:assert';
import {
  buildOfficialPreBookingWhatsAppMessage,
  buildOfficialWhatsAppUrl,
  formatBRL
} from '../../src/services/notificationTemplates.ts';

test('buildOfficialPreBookingWhatsAppMessage generates approved template with clean price', () => {
  const msg = buildOfficialPreBookingWhatsAppMessage({
    clientName: 'Maria Silva',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 160,00',
    date: '2026-11-20',
    time: '14:00',
    depositAmount: 64
  });

  assert.ok(msg.includes('Olá, Angelica! Sou Maria Silva'));
  assert.ok(msg.includes('Procedimento: Alongamento em Fibra Slim'));
  assert.ok(msg.includes('Data: 2026-11-20'));
  assert.ok(msg.includes('Horário: 14:00'));
  // Ensure no duplicate 'R$ R$' in price
  assert.ok(msg.includes('Valor: R$ 160,00'), 'Should contain Valor: R$ 160,00');
  assert.ok(!msg.includes('R$ R$'), 'Must not contain duplicated R$ R$');
  // Check Pix key
  assert.ok(msg.includes('(12) 97406-2241'));
  // Ensure real line breaks \n
  assert.ok(msg.split('\n').length >= 8, 'Must have multiple real line breaks');
});

test('buildOfficialWhatsAppUrl creates properly encoded wa.me URL', () => {
  const url = buildOfficialWhatsAppUrl({
    clientName: 'Maria Silva',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 160,00',
    date: '2026-11-20',
    time: '14:00',
    depositAmount: 64
  }, '(12) 97406-2241');

  assert.ok(url.startsWith('https://wa.me/5512974062241?text='));
  // Encoded line breaks in wa.me URL must be %0A
  assert.ok(url.includes('%0A'), 'URL should contain %0A for line breaks');
  assert.ok(!url.includes('%5Cn'), 'URL should not contain literal \\n encoded as %5Cn');
});

test('manual booking confirmation template uses real line breaks and interpolates fields', () => {
  const rawTemplate = [
    'Olá, {cliente}! 💕',
    '',
    'Seu agendamento está confirmado!',
    '',
    '📅 Data: {data}',
    '⏰ Horário: {horario}',
    '💅 Procedimento: {servico}',
    '',
    'Até breve! ✨',
    '',
    'Angélica do Carmo',
    'Felicidade é fazer as unhas. 💖'
  ].join('\n');

  // Verify real newlines
  assert.strictEqual(rawTemplate.includes('\\n'), false, 'Must not contain escaped \\n');
  assert.strictEqual(rawTemplate.split('\n').length, 12, 'Must have 12 lines');

  const filled = rawTemplate
    .replace(/{cliente}/g, 'Ana Santos')
    .replace(/{servico}/g, 'Blindagem em Gel')
    .replace(/{data}/g, '22/11/2026')
    .replace(/{horario}/g, '10:30');

  assert.ok(filled.includes('Olá, Ana Santos! 💕'));
  assert.ok(filled.includes('💅 Procedimento: Blindagem em Gel'));
  assert.ok(filled.includes('📅 Data: 22/11/2026'));
  assert.ok(filled.includes('⏰ Horário: 10:30'));
});
