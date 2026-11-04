import test from 'node:test';
import assert from 'node:assert';

// Simulated catalogue matching the official Google Sheets catalogue
const mockServices = [
  { id: 'alongamento-fibra-slim', title: 'Alongamento em Fibra Slim', price: 160, priceFormatted: 'R$ 160,00', duration: '3h 00min' },
  { id: 'esmaltacao-gel', title: 'Esmaltação em Gel', price: 80, priceFormatted: 'R$ 80,00', duration: '1h 00min' },
  { id: 'blindagem-gel', title: 'Blindagem em Gel', price: 110, priceFormatted: 'R$ 110,00', duration: '1h 30min' },
  { id: 'manicure-tradicional', title: 'Manicure Tradicional', price: 50, priceFormatted: 'R$ 50,00', duration: '45min' },
  { id: 'buco', title: 'Buço', price: 25, priceFormatted: 'R$ 25,00', duration: '15min' }
];

// Helper mirroring the exact update logic in EditAppointmentModal
function resolveUpdatedAppointment(appointment, userSelection, services) {
  const { selectedServiceId, customTitle, additionalServiceIds = [] } = userSelection;

  const matchedService = (selectedServiceId !== '__custom__' ? services.find(s => s.id === selectedServiceId) : undefined) ||
    services.find(s => s.title.trim().toLowerCase() === (customTitle || '').trim().toLowerCase());

  const chosenTitle = matchedService ? matchedService.title : (customTitle || '').trim();
  const additionalServices = services.filter(service => additionalServiceIds.includes(service.id) && service.id !== matchedService?.id);
  const combinedPrice = matchedService ? matchedService.price + additionalServices.reduce((sum, service) => sum + service.price, 0) : undefined;

  const fullTitle = [chosenTitle, ...additionalServices.map(service => service.title)].filter(Boolean).join(' + ');

  return {
    ...appointment,
    serviceTitle: fullTitle,
    serviceId: matchedService ? matchedService.id : (selectedServiceId !== '__custom__' ? selectedServiceId : undefined),
    ...(matchedService && {
      servicePrice: combinedPrice === undefined ? matchedService.priceFormatted : `R$ ${combinedPrice.toFixed(2).replace('.', ',')}`
    })
  };
}

test('editing an appointment updates service to new procedure and does not revert to old serviceId', () => {
  const originalAppointment = {
    id: 'apt-101',
    clientName: 'Carla Dias',
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 160,00',
    date: '2026-11-20',
    time: '14:00'
  };

  // User changes procedure to 'Esmaltação em Gel'
  const updated = resolveUpdatedAppointment(originalAppointment, {
    selectedServiceId: 'esmaltacao-gel',
    customTitle: 'Esmaltação em Gel'
  }, mockServices);

  assert.strictEqual(updated.serviceId, 'esmaltacao-gel', 'serviceId must be updated to new selection');
  assert.strictEqual(updated.serviceTitle, 'Esmaltação em Gel', 'serviceTitle must match newly selected procedure');
  assert.strictEqual(updated.servicePrice, 'R$ 80,00', 'servicePrice must update to new procedure price');
  assert.notStrictEqual(updated.serviceId, originalAppointment.serviceId, 'Must not keep old serviceId');
});

test('stale serviceId does not overwrite custom procedure title', () => {
  const originalWithStaleId = {
    id: 'apt-102',
    clientName: 'Juliana Paes',
    serviceId: 'manicure-tradicional', // Old stale ID
    serviceTitle: 'Manicure Tradicional'
  };

  // User enters custom procedure
  const updated = resolveUpdatedAppointment(originalWithStaleId, {
    selectedServiceId: '__custom__',
    customTitle: 'Remoção Especial + Tratamento'
  }, mockServices);

  assert.strictEqual(updated.serviceTitle, 'Remoção Especial + Tratamento', 'Custom procedure title must be preserved');
  assert.notStrictEqual(updated.serviceTitle, 'Manicure Tradicional', 'Must NOT revert to procedure corresponding to old serviceId');
});

test('editing with additional services calculates combined price and title accurately', () => {
  const original = {
    id: 'apt-103',
    clientName: 'Patricia Abravanel',
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim'
  };

  // User selects Blindagem (110) + Buço (25)
  const updated = resolveUpdatedAppointment(original, {
    selectedServiceId: 'blindagem-gel',
    customTitle: 'Blindagem em Gel',
    additionalServiceIds: ['buco']
  }, mockServices);

  assert.strictEqual(updated.serviceId, 'blindagem-gel');
  assert.strictEqual(updated.serviceTitle, 'Blindagem em Gel + Buço');
  assert.strictEqual(updated.servicePrice, 'R$ 135,00');
});
