import test from 'node:test';
import assert from 'node:assert';
import {
  calculateDeposit40,
  calculateFullPrepayment,
  calculateRemainingBalance,
  formatBRL
} from '../../src/services/notificationTemplates.ts';

test('calculateDeposit40 calculates exact 40% deposit for services', () => {
  assert.strictEqual(calculateDeposit40(160), 64);
  assert.strictEqual(calculateDeposit40(110), 44);
  assert.strictEqual(calculateDeposit40(80), 32);
  assert.strictEqual(calculateDeposit40(50), 20);
});

test('calculateFullPrepayment returns full 100% price', () => {
  assert.strictEqual(calculateFullPrepayment(160), 160);
  assert.strictEqual(calculateFullPrepayment(110), 110);
});

test('calculateRemainingBalance calculates remaining 60% balance after deposit', () => {
  assert.strictEqual(calculateRemainingBalance(160, 64), 96);
  assert.strictEqual(calculateRemainingBalance(110, 44), 66);
  assert.strictEqual(calculateRemainingBalance(80, 80), 0);
});

test('formatBRL formats currency in Brazilian format', () => {
  assert.strictEqual(formatBRL(160), '160,00');
  assert.strictEqual(formatBRL(44.5), '44,50');
  assert.strictEqual(formatBRL(0), '0,00');
});
