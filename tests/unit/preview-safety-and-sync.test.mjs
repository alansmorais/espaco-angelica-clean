import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
