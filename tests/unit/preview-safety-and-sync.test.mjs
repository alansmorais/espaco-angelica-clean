import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateDeposit40, calculateRemainingBalance } from '../../src/services/notificationTemplates.ts';

const ROOT = process.cwd();
const readRepoFile = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

test('Authorized admin preview enables authenticated booking and admin operations', () => {
  const svcCode = readRepoFile('src/services/emailNotificationService.ts');
  const appCode = readRepoFile('src/App.tsx');

  assert.match(
    svcCode,
    /export\s+const\s+READ_ONLY_PREVIEW(?:\s*:\s*boolean)?\s*=\s*false\s*;/,
    'emailNotificationService.ts must export READ_ONLY_PREVIEW = false for the authorized admin branch'
  );
  assert.match(
    appCode,
    /import\s*\{[\s\S]*\bREAD_ONLY_PREVIEW\b[\s\S]*\}\s*from\s*['"]\.\/services\/emailNotificationService['"]/,
    'App.tsx must import READ_ONLY_PREVIEW from emailNotificationService.ts'
  );
  assert.match(appCode, /!READ_ONLY_PREVIEW\s*&&\s*bookingModalOpen/, 'Live booking wizard must be enabled when preview protection is false');
});

test('All remote write and admin functions retain the centralized READ_ONLY_PREVIEW safety switch', () => {
  const svcCode = readRepoFile('src/services/emailNotificationService.ts');
  const guardedFunctions = [
    'sendWebhookNotification',
    'testNotificationWebhook',
    'triggerNewPreBookingEmailNotification',
    'createAdminSession',
    'revokeAdminSession',
    'fetchRemoteAppointmentsDetailed',
    'deleteRemoteAppointment',
    'submitBlockSchedule',
    'updateRemoteAppointment',
    'callScheduleAction',
    'lookupPublicClientByPhone',
    'saveRemoteService',
    'deleteRemoteService',
    'listDrivePhotos',
    'uploadServicePhoto'
  ];

  for (const fnName of guardedFunctions) {
    const startIdx = svcCode.indexOf(`function ${fnName}`);
    assert.ok(startIdx >= 0, `Expected function ${fnName} in emailNotificationService.ts`);
    const bodyPreview = svcCode.slice(startIdx, startIdx + 450);
    assert.match(
      bodyPreview,
      /if\s*\(\s*READ_ONLY_PREVIEW\b/,
      `${fnName} must check READ_ONLY_PREVIEW before making any network request`
    );
  }
});

test('App.tsx handlers retain the safety switch and live BookingWizard is enabled', () => {
  const appCode = readRepoFile('src/App.tsx');
  const handlers = [
    'handleAdminLogin',
    'handleUpdateBlacklist',
    'handleUpdateStudioAddress',
    'handleUpdatePaymentConfig',
    'handleUpdateWhatsappConfig',
    'persistWeeklySchedule',
    'handleUpdateService',
    'handleAddService',
    'handleDeleteService',
    'handleBookingConfirmed',
    'handleUpdateAppointment',
    'handleDeleteAppointment',
    'handleDeleteClient',
    'handleUpdateClient',
    'handleOverviewAppointmentSave',
    'handleOverviewAppointmentDelete',
    'handleManualBookingSave',
    'handleNewClientSave',
    'handleBlockConfirm',
    'handleExtraEncaixeConfirm'
  ];

  for (const handler of handlers) {
    const startIdx = appCode.indexOf(`const ${handler}`);
    assert.ok(startIdx >= 0, `Expected handler ${handler} in App.tsx`);
    const bodyPreview = appCode.slice(startIdx, startIdx + 400);
    assert.match(
      bodyPreview,
      /if\s*\(\s*READ_ONLY_PREVIEW\b/,
      `App.tsx handler ${handler} must guard with READ_ONLY_PREVIEW`
    );
  }

  assert.match(
    appCode,
    /!READ_ONLY_PREVIEW\s*&&\s*bookingModalOpen[\s\S]*?<BookingWizard/,
    'BookingWizard must be available when READ_ONLY_PREVIEW is false'
  );
  assert.match(
    appCode,
    /bookingModalOpen\s*&&\s*READ_ONLY_PREVIEW/,
    'Read-only fallback remains available if the safety switch is re-enabled'
  );
});

test('Public catalog uses real fetchRemoteServices without static mock fallback', () => {
  const svcCode = readRepoFile('src/services/emailNotificationService.ts');
  const appCode = readRepoFile('src/App.tsx');
  const catalogCode = readRepoFile('src/components/ServiceCatalog.tsx');

  assert.match(svcCode, /postAppsScriptAction\(endpoint,\s*'getServices'\)/);
  assert.match(svcCode, /function\s+getReadOnlyPublicCatalogEndpoint\s*\(/);
  assert.match(appCode, /const\s+remoteServices\s*=\s*await\s+fetchRemoteServices\(\)/);
  assert.doesNotMatch(appCode, /INITIAL_SERVICES|MOCK_SERVICES/, 'App.tsx must not fall back to mock services');
  assert.match(catalogCode, /id="catalogo-vitrine"/);
  assert.match(catalogCode, /Vitrine de Procedimentos/);
});

test('AboutModal first-visit intro modal opens, closes, and wires Agendar CTA to bookingModalOpen', () => {
  const aboutCode = readRepoFile('src/components/Modals/AboutModal.tsx');
  const appCode = readRepoFile('src/App.tsx');

  assert.match(aboutCode, /espaco_angelica_intro_seen/);
  assert.match(aboutCode, /setShowIntro\(true\)/);
  assert.match(aboutCode, /aria-label="Fechar apresentação"/);
  assert.match(aboutCode, /Agendar horário/);
  assert.match(
    appCode,
    /<AboutModal[\s\S]*?onBookNow=\{\(\)\s*=>\s*\{\s*setBookingModalOpen\(true\);\s*\}\}/,
    'AboutModal onBookNow CTA must open the booking modal cleanly'
  );
});

test('Google Calendar synchronization files and core rules remain preserved in apps-script/', () => {
  const calSync = readRepoFile('apps-script/CalendarSync.gs');
  const durSync = readRepoFile('apps-script/CalendarDurationSync.gs');
  const codeGs = readRepoFile('apps-script/Code.gs');

  assert.ok(calSync.length > 5000, 'apps-script/CalendarSync.gs must be preserved');
  assert.ok(durSync.length > 20000, 'apps-script/CalendarDurationSync.gs must be preserved');

  // Verify Code.gs hooks remain intact
  assert.match(codeGs, /syncFutureAppointmentsForServiceDurationChange/);
  assert.match(codeGs, /syncAppointmentRowAfterPanelUpdate_/);

  // Verify CalendarDurationSync.gs core rules: duration from Serviços/Depilação, end-time-only setTime,
  // recurring occurrence resolution by ID+date, protected non-client events, Column T ID preservation
  assert.match(durSync, /_cdsResolveEventOccurrence_/);
  assert.match(durSync, /_cdsUpdateExistingEventDurationOnly_/);
  assert.match(durSync, /officialStart\.getTime\(\)\s*\+\s*lookup\.durationMinutes\s*\*\s*60000/);
  assert.match(durSync, /isAllDayEvent/);
  assert.match(durSync, /bloqueio/i);
  assert.match(durSync, /folga/i);
  assert.match(durSync, /SKIPPED_PAST/);
  assert.match(durSync, /Serviços|Servicos/);
  assert.match(durSync, /Depilação|Depilacao/);
  assert.match(durSync, /COLUMN_T_EVENT_ID/);
});

test('Same-day booking slots that have already started are unavailable in Sao Paulo time', () => {
  const bookingCode = readRepoFile('src/components/BookingWizard.tsx');
  assert.ok(bookingCode.includes("timeZone: 'America/Sao_Paulo'"));
  assert.ok(bookingCode.includes('const isPastTimeSlot = (slotTime: string, dateKey: string = selectedDate): boolean =>'));
  assert.ok(bookingCode.includes('return start === null || start <= getStudioNowMinutes()'));
  assert.ok(bookingCode.includes('if (isPastTimeSlot(slotTime, dateKey)) return true'));
  assert.ok(bookingCode.includes("isPastTimeSlot(slot.time) ? 'Encerrado'"));
});

test('BookingWizard offers only compatible Nail Art and francesinha add-ons in the final summary', () => {
  const bookingCode = readRepoFile('src/components/BookingWizard.tsx');
  assert.match(bookingCode, /primarySupportsNailAddons/);
  assert.match(bookingCode, /category\.includes\('nailart'\)\s*\|\|\s*\/nail\\s\*art\|francesinha\//);
  assert.match(bookingCode, /\+ Adicionar serviço/);
  assert.match(bookingCode, /eligibleAdditionalServices\.length > 0 && <button[\s\S]*?setShowAdditionalServices\(true\)/);
  assert.match(bookingCode, /Adicione Nail Art ou francesinha ao procedimento/);
});

test('BookingWizard additional services modal opens on any step (3, 4, 5) and supports Confirmar seleção vs Recolher', () => {
  const bookingCode = readRepoFile('src/components/BookingWizard.tsx');

  // Regression guard: modal portal must NOT be gated by bookingStep === 3
  assert.doesNotMatch(
    bookingCode,
    /showAdditionalServices\s*&&\s*bookingStep\s*===\s*3/,
    'Additional services modal must open on Steps 3, 4, and 5 (never gated on bookingStep === 3)'
  );
  assert.match(
    bookingCode,
    /\{showAdditionalServices\s*&&\s*createPortal\(/,
    'Additional services modal portal must render whenever showAdditionalServices is true'
  );

  // Draft vs confirmed state separation
  assert.match(bookingCode, /const\s*\[draftAdditionalServiceIds,\s*setDraftAdditionalServiceIds\]/);
  assert.match(bookingCode, /const\s+openAdditionalServicesSelector\s*=\s*\(\)\s*=>/);
  assert.match(bookingCode, /const\s+confirmAdditionalServicesSelection\s*=\s*\(\)\s*=>/);
  assert.match(bookingCode, /const\s+collapseAdditionalServicesSelector\s*=\s*\(\)\s*=>/);
  assert.match(bookingCode, /const\s+removeConfirmedAdditionalService\s*=\s*\(serviceId:\s*string\)\s*=>/);

  // Explicit Confirmar seleção, Recolher, and Remover controls in the UI
  assert.match(bookingCode, /onClick=\{collapseAdditionalServicesSelector\}[\s\S]*?>Recolher<\/button>/);
  assert.match(bookingCode, /onClick=\{confirmAdditionalServicesSelection\}[\s\S]*?>Confirmar seleção<\/button>/);
  assert.match(bookingCode, /onClick=\{\(\)\s*=>\s*removeConfirmedAdditionalService\(service\.id\)\}[\s\S]*?>Remover<\/button>/);
});

test('BookingWizard supports Reversa 3D quantity (1..10), incompatible add-on pruning, and accurate 40% deposit pricing', () => {
  const bookingCode = readRepoFile('src/components/BookingWizard.tsx');

  assert.match(bookingCode, /const\s*\[reversa3dQuantity,\s*setReversa3dQuantity\]/);
  assert.match(bookingCode, /const\s*\[draftReversa3dQuantity,\s*setDraftReversa3dQuantity\]/);
  assert.match(bookingCode, /const\s+isReversa3DAddon\s*=/);
  assert.match(bookingCode, /const\s+primarySupportsReversa3D\s*=/);
  assert.match(bookingCode, /Quantidade de Reversa 3D/);
  assert.match(bookingCode, /const\s+getAddonQuantity\s*=\s*\(service:\s*Service\):\s*number\s*=>/);
  assert.match(bookingCode, /const\s+getAddonTotalPrice\s*=\s*\(service:\s*Service\):\s*number\s*=>\s*service\.price\s*\*\s*getAddonQuantity\(service\)/);
  assert.match(bookingCode, /const\s+servicePrice\s*=\s*selectedService\.price\s*\+\s*additionalServices\.reduce\(\(sum,\s*service\)\s*=>\s*sum\s*\+\s*getAddonTotalPrice\(service\),\s*0\)/);
  assert.match(bookingCode, /const\s+standardDeposit\s*=\s*calculateDeposit40\(servicePrice,\s*paymentConfig\.depositAmount\)/);

  // Verify incompatible add-on pruning effect when selectedService changes
  assert.match(
    bookingCode,
    /useEffect\(\(\)\s*=>\s*\{[\s\S]*?eligibleAdditionalServices\.map\(service => service\.id\)[\s\S]*?setAdditionalServiceIds[\s\S]*?setDraftAdditionalServiceIds[\s\S]*?if\s*\(!primarySupportsReversa3D\)[\s\S]*?\},\s*\[selectedService\.id,\s*primarySupportsReversa3D,\s*services\.length\]\)/
  );

  // Runtime pricing and 40% deposit checks with official catalog prices and Reversa 3D quantities
  const alongamentoPrice = 160;
  const nailArtPrice = 35;
  const reversa3dUnitPrice = 25;

  const totalWithNailArt = alongamentoPrice + nailArtPrice;
  assert.strictEqual(totalWithNailArt, 195);
  assert.strictEqual(calculateDeposit40(totalWithNailArt, 40), 78);
  assert.strictEqual(calculateRemainingBalance(totalWithNailArt, 78), 117);

  const totalWithReversaQty3 = alongamentoPrice + reversa3dUnitPrice * 3;
  assert.strictEqual(totalWithReversaQty3, 235);
  assert.strictEqual(calculateDeposit40(totalWithReversaQty3, 40), 94);
  assert.strictEqual(calculateRemainingBalance(totalWithReversaQty3, 94), 141);

  const totalWithNailArtAndReversaQty2 = alongamentoPrice + nailArtPrice + reversa3dUnitPrice * 2;
  assert.strictEqual(totalWithNailArtAndReversaQty2, 245);
  assert.strictEqual(calculateDeposit40(totalWithNailArtAndReversaQty2, 40), 98);
  assert.strictEqual(calculateRemainingBalance(totalWithNailArtAndReversaQty2, 98), 147);

  // Removing add-ons restores base procedure price and 40% deposit
  assert.strictEqual(calculateDeposit40(alongamentoPrice, 40), 64);
  assert.strictEqual(calculateRemainingBalance(alongamentoPrice, 64), 96);
});
