import test from 'node:test';
import assert from 'node:assert';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbysNBMLthA_GvAZJR1irBGcS-3Lspbfz0NIsvz0P2ax6jzE4M01RwVJ0za6zFsq8bGojw/exec';

async function callPublicEndpoint(action, extra = {}) {
  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...extra })
  });
  assert.ok(response.ok, `HTTP ${response.status} from Google Apps Script for action ${action}`);
  return await response.json();
}

test('Google Apps Script live read: getServices returns official catalogue', async () => {
  const data = await callPublicEndpoint('getServices');
  assert.strictEqual(data.status, 'success', 'getServices must return status success');
  assert.ok(Array.isArray(data.services), 'services must be an array');
  assert.ok(data.services.length >= 30, `Expected at least 30 services, received ${data.services.length}`);

  const sample = data.services[0];
  assert.ok(sample.id, 'service has id');
  assert.ok(sample.title, 'service has title');
  assert.ok(typeof sample.price === 'number', 'service price is number');
  assert.ok(sample.priceFormatted, 'service has formatted price');
});

test('Google Apps Script live read: getPublicStudioAddress returns official studio address', async () => {
  const data = await callPublicEndpoint('getPublicStudioAddress');
  assert.strictEqual(data.status, 'success');
  assert.ok(data.address, 'address object exists');
  assert.ok(
    data.address.fullAddress.includes('Pontal da Cruz') &&
    data.address.fullAddress.includes('São Sebastião'),
    'fullAddress must contain Pontal da Cruz and São Sebastião'
  );
});

test('Google Apps Script live read: getPublicPaymentConfig returns official Pix settings', async () => {
  const data = await callPublicEndpoint('getPublicPaymentConfig');
  assert.strictEqual(data.status, 'success');
  assert.ok(data.paymentConfig, 'paymentConfig object exists');
  assert.strictEqual(data.paymentConfig.pixKey, '12974062241', 'Pix key must match official phone');
  assert.strictEqual(data.paymentConfig.pixBeneficiary, 'Angelica do Carmo', 'Beneficiary must match Angelica do Carmo');
  assert.strictEqual(data.paymentConfig.depositAmount, 40, 'Deposit must be 40%');
});

test('Google Apps Script live read: getPublicAvailability returns slot structure without writes', async () => {
  const data = await callPublicEndpoint('getPublicAvailability');
  assert.strictEqual(data.status, 'success');
  assert.ok(Array.isArray(data.slots), 'slots is an array');
  assert.ok(Array.isArray(data.blockedDates), 'blockedDates is an array');
});
