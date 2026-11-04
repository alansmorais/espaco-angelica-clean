import test from 'node:test';
import assert from 'node:assert';
import { normalizeDateKey, areDatesEqual } from '../../src/services/notificationTemplates.ts';

test('normalizeDateKey converts ISO dates YYYY-MM-DD to MM-DD', () => {
  assert.strictEqual(normalizeDateKey('2026-11-13'), '11-13');
  assert.strictEqual(normalizeDateKey('2026-05-04'), '05-04');
  assert.strictEqual(normalizeDateKey('2026-1-2'), '01-02');
});

test('normalizeDateKey converts DD/MM/YYYY to MM-DD', () => {
  assert.strictEqual(normalizeDateKey('13/11/2026'), '11-13');
  assert.strictEqual(normalizeDateKey('04/05/2026'), '05-04');
});

test('normalizeDateKey converts Brazilian textual dates', () => {
  assert.strictEqual(normalizeDateKey('Quarta, 13 Nov'), '11-13');
  assert.strictEqual(normalizeDateKey('13 de Novembro'), '11-13');
  assert.strictEqual(normalizeDateKey('Sex, 24 Out'), '10-24');
});

test('areDatesEqual compares dates across formats correctly', () => {
  assert.strictEqual(areDatesEqual('2026-11-13', '13/11/2026'), true);
  assert.strictEqual(areDatesEqual('Quarta, 13 Nov', '2026-11-13'), true);
  assert.strictEqual(areDatesEqual('13 de Novembro', 'Quarta, 13 Nov'), true);
});

test('areDatesEqual avoids false positives between adjacent days', () => {
  assert.strictEqual(areDatesEqual('2026-11-13', '2026-11-14'), false);
  assert.strictEqual(areDatesEqual('Quarta, 13 Nov', 'Quinta, 14 Nov'), false);
});
