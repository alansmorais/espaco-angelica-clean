/**
 * Espaço Angélica — Sincronização Bidirecional Controlada (Google Calendar <-> Google Sheets)
 *
 * REGRA DEFINITIVA DE AUTORIDADE:
 * - Google Calendar é a FONTE OFICIAL dos agendamentos (data, horário inicial, horário final e existência).
 * - Google Sheets é o CATÁLOGO OFICIAL de serviços, a ÚNICA FONTE OFICIAL das durações em Serviços!F,
 *   a base de relacionamento e o registro dos Google Calendar Event IDs em Agendamentos!T.
 * - NUNCA permitir que datas/horários antigos da planilha sobrescrevam agendamentos oficiais do Calendar.
 * - NUNCA alterar Serviços!F em razão de edição individual de evento no Calendar.
 * - NUNCA apagar linhas da planilha: duplicidades inequívocas são marcadas como "cancelado" preservando histórico.
 * - Prevenção de ciclos infinitos via guarda de sincronização interna (CacheService + verificação no-op).
 *
 * Reutiliza funções/constantes oficiais de Code.gs sem duplicá-las:
 *   TARGET_SPREADSHEET_ID, OFFICIAL_TIME_ZONE, getSharedCalendar_(), getOfficialSheet(),
 *   getServicesSheets(), normalizeBookingDate(), normalizeBookingTime().
 */

var CDS_TZ_OFFSET = "-03:00";
var CDS_APT_TAG_PREFIX = "[ESPACO_ANGELICA_APT_ID:";
var CDS_EDIT_TRIGGER_HANDLER = "handleSpreadsheetEditForCalendarSync";
var CDS_CALENDAR_TRIGGER_HANDLER = "syncCalendarBookingsToSheet";
var CDS_LEGACY_CALENDAR_HANDLER = "syncCalendarChangesToSheet";
var CDS_LOOP_GUARD_KEY = "CDS_INTERNAL_SYNC_LOCK_TS";
var CDS_LOOP_GUARD_TTL_SEC = 15;

// Exceções oficiais autorizadas pelo administrador (alinhadas com CalendarSync.gs + decisões consolidadas).
var CDS_AUTHORIZED_EXCEPTIONS = {
  // Registros excluídos da sincronização (preservados na planilha)
  excludeAppointmentIds: [
    "apt-1794006950286-rec-4" // Linha 23: registro de teste (Alan TesteAdmin — EXCLUDE_FROM_SYNC)
  ],
  // Exceções oficiais de duração especial no Google Calendar (não reduzir automaticamente)
  durationOverrideByAppointmentId: {
    "apt-1793902283321": 150, // Linha 16 (23/12): atendimento especial 150 min (mãe e filha)
    "apt-1793902440508": 90   // Linha 17 (24/12): Calendar oficial 12:30, duração especial 90 min
  },
  // Registros pendentes de confirmação humana (não criar evento nem cancelar automaticamente)
  pendingReviewAppointmentIds: [
    "apt-1793903805661",      // Linha 20 (30/12): sem evento no Calendar — aguarda confirmação de validade
    "apt-1794603000976"       // Linha 24 (02/12): conflito com evento sobreposto — aguarda resolução
  ]
};

function _cdsTimezone_() {
  return (typeof OFFICIAL_TIME_ZONE !== "undefined" && OFFICIAL_TIME_ZONE)
    ? OFFICIAL_TIME_ZONE
    : "America/Sao_Paulo";
}

function _cdsIsWriteSyncEnabled_() {
  var flag = String(PropertiesService.getScriptProperties().getProperty("CALENDAR_DURATION_SYNC_ENABLED") || "").trim().toLowerCase();
  return flag === "true";
}

function _cdsMarkInternalSync_() {
  try {
    CacheService.getScriptCache().put(CDS_LOOP_GUARD_KEY, String(new Date().getTime()), CDS_LOOP_GUARD_TTL_SEC);
  } catch (e) {}
}

function _cdsIsInternalSyncActive_() {
  try {
    return !!CacheService.getScriptCache().get(CDS_LOOP_GUARD_KEY);
  } catch (e) {
    return false;
  }
}

function _cdsResolveSpreadsheetConfig_() {
  var props = PropertiesService.getScriptProperties();
  var propSpreadsheetId = String(props.getProperty("SPREADSHEET_ID") || "").trim();
  var codeTargetId = (typeof TARGET_SPREADSHEET_ID !== "undefined" && TARGET_SPREADSHEET_ID)
    ? String(TARGET_SPREADSHEET_ID).trim()
    : "";

  var status = "OK";
  var effectiveId = propSpreadsheetId || codeTargetId;
  var actionRequired = null;

  if (!propSpreadsheetId && codeTargetId) {
    status = "MISSING_SCRIPT_PROPERTY";
    actionRequired = "Configurar Script Property SPREADSHEET_ID = " + codeTargetId + " (mesmo valor de TARGET_SPREADSHEET_ID no Code.gs).";
  } else if (propSpreadsheetId && codeTargetId && propSpreadsheetId !== codeTargetId) {
    status = "MISMATCH_WITH_TARGET_SPREADSHEET_ID";
    actionRequired = "SPREADSHEET_ID nas Script Properties diverge de TARGET_SPREADSHEET_ID no Code.gs. Corrigir antes de ativar.";
  } else if (!effectiveId) {
    status = "MISSING_BOTH";
    actionRequired = "Configurar Script Property SPREADSHEET_ID com o ID oficial da planilha.";
  }

  return {
    status: status,
    hasScriptProperty: !!propSpreadsheetId,
    matchesCodeTarget: !!(propSpreadsheetId && codeTargetId && propSpreadsheetId === codeTargetId),
    effectiveId: effectiveId,
    actionRequired: actionRequired
  };
}

function _cdsOpenOfficialSpreadsheet_(allowFallbackToTarget) {
  var cfg = _cdsResolveSpreadsheetConfig_();
  if (cfg.status === "MISMATCH_WITH_TARGET_SPREADSHEET_ID") {
    throw new Error(cfg.actionRequired);
  }
  if (!cfg.hasScriptProperty && !allowFallbackToTarget) {
    throw new Error(cfg.actionRequired || "Script Property SPREADSHEET_ID não configurada.");
  }
  if (!cfg.effectiveId) throw new Error("ID da planilha oficial indisponível.");
  return SpreadsheetApp.openById(cfg.effectiveId);
}

function _cdsGetCalendar_() {
  if (typeof getSharedCalendar_ === "function") return getSharedCalendar_();
  var calId = String(PropertiesService.getScriptProperties().getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  if (!calId) throw new Error("Configure GOOGLE_CALENDAR_ID nas Propriedades do Script.");
  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) throw new Error("Google Calendar não encontrado ou sem acesso.");
  return cal;
}

/**
 * 1. CONCILIAÇÃO INICIAL CONTROLADA E AUTORIZADA (Linhas 16, 17 e 19).
 *
 * - Revalida cliente, data e horário de cada evento no Google Calendar ANTES de gravar.
 * - Preenche Agendamentos!T nas linhas 16, 17 e 19 sem criar nenhum evento no Calendar.
 * - Atualiza Agendamentos!G17 de 12:00 para 12:30 (horário oficial do Calendar) mantendo exceção de 90 min.
 * - Mantém exceção de 150 min na Linha 16 (não altera o evento no Calendar).
 * - NÃO toca nas linhas 20, 23, 24 nem em qualquer evento do Google Calendar.
 * - Idempotente: execuções repetidas não sobrescrevem nem duplicam nada.
 */
function applyAuthorizedColumnTReconciliation() {
  var tz = _cdsTimezone_();
  var ss = _cdsOpenOfficialSpreadsheet_(true);
  var agSheet = ss.getSheetByName("Agendamentos");
  if (!agSheet) throw new Error("Aba 'Agendamentos' não encontrada.");
  var calendar = _cdsGetCalendar_();

  var authorizedTargets = [
    {
      row: 16,
      appointmentId: "apt-1793902283321",
      expectedClientToken: "maria de jesus",
      expectedDate: "2026-12-23",
      expectedCalendarStartTime: "16:00",
      expectedCalendarDurationMin: 150,
      eventId: "6g07637k50lq60c35h36qt72uo@google.com",
      alignSheetTimeTo: null,
      exceptionNote: "Exceção de 150 min (mãe e filha) preservada; evento do Calendar não alterado."
    },
    {
      row: 17,
      appointmentId: "apt-1793902440508",
      expectedClientToken: "kristine sorensen",
      expectedDate: "2026-12-24",
      expectedCalendarStartTime: "12:30",
      expectedCalendarDurationMin: 90,
      eventId: "gmdts7nvfk56vl6v1iaa068leg@google.com",
      alignSheetTimeTo: "12:30",
      exceptionNote: "Calendar oficial 12:30 (90 min): planilha alinhada para 12:30 e exceção de 90 min preservada."
    },
    {
      row: 19,
      appointmentId: "apt-1793903713527",
      expectedClientToken: "josefina calderon",
      expectedDate: "2026-12-23",
      expectedCalendarStartTime: "15:00",
      expectedCalendarDurationMin: 60,
      eventId: "bj320net3mqnvtndi3q201qcis@google.com",
      alignSheetTimeTo: null,
      exceptionNote: "Correspondência exata de 60 min; apenas vínculo na Coluna T gravado."
    }
  ];

  var results = [];
  _cdsMarkInternalSync_();

  for (var i = 0; i < authorizedTargets.length; i++) {
    var target = authorizedTargets[i];
    var rowVals = agSheet.getRange(target.row, 1, 1, 20).getValues()[0];
    var rowDisp = agSheet.getRange(target.row, 1, 1, 20).getDisplayValues()[0];

    var sheetAptId = String(rowVals[9] || "").trim();
    var sheetClient = String(rowVals[1] || "").trim();
    var sheetDate = _cdsDateKey_(rowVals[5], rowDisp[5]);
    var sheetTime = _cdsTimeKey_(rowVals[6], rowDisp[6]);
    var existingColT = String(rowVals[19] || "").trim();

    // Validação estrita da linha na planilha antes de gravar
    if (sheetAptId !== target.appointmentId || _cdsNormalize_(sheetClient).indexOf(target.expectedClientToken) < 0 || sheetDate !== target.expectedDate) {
      results.push({
        row: target.row,
        status: "BLOCKED_SHEET_MISMATCH",
        expectedAppointmentId: target.appointmentId,
        actualAppointmentId: sheetAptId,
        actualClient: sheetClient,
        actualDate: sheetDate
      });
      continue;
    }

    // Revalidação estrita do evento no Google Calendar por cliente, data e horário
    var dayEvents = calendar.getEvents(
      new Date(target.expectedDate + "T00:00:00" + CDS_TZ_OFFSET),
      new Date(target.expectedDate + "T23:59:59" + CDS_TZ_OFFSET)
    );
    var matchedEvent = null;
    for (var eIdx = 0; eIdx < dayEvents.length; eIdx++) {
      var ev = dayEvents[eIdx];
      if (ev.getId() !== target.eventId) continue;
      var evStartTime = Utilities.formatDate(ev.getStartTime(), tz, "HH:mm");
      var evTitleNorm = _cdsNormalize_(ev.getTitle());
      var evDurMin = Math.round((ev.getEndTime().getTime() - ev.getStartTime().getTime()) / 60000);
      if (evStartTime === target.expectedCalendarStartTime && evTitleNorm.indexOf(target.expectedClientToken) >= 0) {
        matchedEvent = {
          id: ev.getId(),
          title: ev.getTitle(),
          start: Utilities.formatDate(ev.getStartTime(), tz, "yyyy-MM-dd'T'HH:mm:ss"),
          end: Utilities.formatDate(ev.getEndTime(), tz, "yyyy-MM-dd'T'HH:mm:ss"),
          durationMinutes: evDurMin
        };
        break;
      }
    }

    if (!matchedEvent) {
      results.push({
        row: target.row,
        appointmentId: target.appointmentId,
        status: "BLOCKED_CALENDAR_IDENTITY_NOT_CONFIRMED",
        expectedEventId: target.eventId,
        expectedDate: target.expectedDate,
        expectedTime: target.expectedCalendarStartTime
      });
      continue;
    }

    var actionsTaken = [];
    if (existingColT !== target.eventId) {
      agSheet.getRange(target.row, 20).setValue(target.eventId);
      actionsTaken.push("COLUMN_T_SET:" + target.eventId);
    } else {
      actionsTaken.push("COLUMN_T_ALREADY_SET");
    }

    if (target.alignSheetTimeTo && sheetTime !== target.alignSheetTimeTo) {
      agSheet.getRange(target.row, 7).setValue(target.alignSheetTimeTo);
      actionsTaken.push("COLUMN_G_TIME_ALIGNED:" + sheetTime + "->" + target.alignSheetTimeTo);
    } else if (target.alignSheetTimeTo) {
      actionsTaken.push("COLUMN_G_ALREADY_ALIGNED:" + target.alignSheetTimeTo);
    }

    results.push({
      row: target.row,
      appointmentId: target.appointmentId,
      client: sheetClient,
      status: "RECONCILED",
      verifiedCalendarEvent: matchedEvent,
      actionsTaken: actionsTaken,
      note: target.exceptionNote
    });
  }

  SpreadsheetApp.flush();

  var summary = {
    status: "success",
    calendarEventsCreated: 0,
    calendarEventsModified: 0,
    results: results,
    safety: "Nenhum evento do Google Calendar foi criado, alterado ou excluído. Linhas 20, 23 e 24 preservadas intactas."
  };
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * 2. AUDITORIA SOMENTE LEITURA DE CONFIGURAÇÃO E GATILHOS (zero segredos nos logs).
 */
function auditCalendarDurationSyncConfig() {
  var props = PropertiesService.getScriptProperties();
  var tzOfficial = _cdsTimezone_();
  var sheetCfg = _cdsResolveSpreadsheetConfig_();
  var calIdConfigured = !!String(props.getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  var executionAccount = "";
  try { executionAccount = String(Session.getEffectiveUser().getEmail() || ""); } catch (e) {}

  var spreadsheetCheck = {
    scriptPropertyConfigured: sheetCfg.hasScriptProperty,
    matchesTargetSpreadsheetId: sheetCfg.matchesCodeTarget,
    status: sheetCfg.status,
    spreadsheetName: null,
    spreadsheetTimeZone: null,
    timeZoneIsSaoPaulo: false,
    hasAgendamentosTab: false,
    hasServicosTab: false,
    columnTHeader: null,
    actionRequired: sheetCfg.actionRequired
  };

  if (sheetCfg.status !== "MISMATCH_WITH_TARGET_SPREADSHEET_ID" && sheetCfg.effectiveId) {
    try {
      var ss = SpreadsheetApp.openById(sheetCfg.effectiveId);
      spreadsheetCheck.spreadsheetName = ss.getName();
      spreadsheetCheck.spreadsheetTimeZone = ss.getSpreadsheetTimeZone();
      spreadsheetCheck.timeZoneIsSaoPaulo = spreadsheetCheck.spreadsheetTimeZone === "America/Sao_Paulo";
      var agSh = ss.getSheetByName("Agendamentos");
      spreadsheetCheck.hasAgendamentosTab = !!agSh;
      if (agSh && agSh.getLastColumn() >= 20) {
        spreadsheetCheck.columnTHeader = String(agSh.getRange(1, 20).getDisplayValue() || "").trim();
      }
      spreadsheetCheck.hasServicosTab = !!(ss.getSheetByName("Serviços") || ss.getSheetByName("Servicos"));
    } catch (ssErr) {
      spreadsheetCheck.error = String(ssErr && ssErr.message ? ssErr.message : ssErr);
    }
  }

  var calendarCheck = {
    scriptPropertyConfigured: calIdConfigured,
    accessible: false,
    calendarName: null,
    calendarTimeZone: null,
    timeZoneIsSaoPaulo: false,
    isOwnedByExecutionAccount: null,
    editPermissionNote: null,
    error: null
  };

  if (calIdConfigured) {
    try {
      var cal = _cdsGetCalendar_();
      calendarCheck.accessible = true;
      calendarCheck.calendarName = cal.getName();
      calendarCheck.calendarTimeZone = cal.getTimeZone();
      calendarCheck.timeZoneIsSaoPaulo = calendarCheck.calendarTimeZone === "America/Sao_Paulo";
      calendarCheck.isOwnedByExecutionAccount = cal.isOwnedByMe();
      calendarCheck.editPermissionNote = cal.isOwnedByMe()
        ? "Conta executora é proprietária do calendário (permissão de edição garantida)."
        : "Calendário compartilhado acessível via CalendarApp; confirmar permissão 'Fazer alterações em eventos' antes de ativar escrita.";
    } catch (calErr) {
      calendarCheck.error = String(calErr && calErr.message ? calErr.message : calErr);
    }
  } else {
    calendarCheck.error = "Script Property GOOGLE_CALENDAR_ID ausente.";
  }

  var existingTriggers = [];
  var hasEditTrigger = false;
  var hasCalendarTrigger = false;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var t = 0; t < triggers.length; t++) {
      var handler = triggers[t].getHandlerFunction();
      if (handler === CDS_EDIT_TRIGGER_HANDLER) hasEditTrigger = true;
      if (handler === CDS_CALENDAR_TRIGGER_HANDLER) hasCalendarTrigger = true;
      existingTriggers.push({
        handlerFunction: handler,
        eventType: String(triggers[t].getEventType()),
        triggerSource: String(triggers[t].getTriggerSource())
      });
    }
  } catch (trErr) {
    existingTriggers.push({ error: String(trErr && trErr.message ? trErr.message : trErr) });
  }

  var blockers = [];
  if (!spreadsheetCheck.scriptPropertyConfigured || !spreadsheetCheck.matchesTargetSpreadsheetId) {
    blockers.push(spreadsheetCheck.actionRequired || "Configurar SPREADSHEET_ID corretamente nas Script Properties.");
  }
  if (!calendarCheck.accessible) blockers.push(calendarCheck.error || "Configurar GOOGLE_CALENDAR_ID.");
  if (!spreadsheetCheck.timeZoneIsSaoPaulo) blockers.push("Fuso horário da planilha difere de America/Sao_Paulo.");
  if (calendarCheck.accessible && !calendarCheck.timeZoneIsSaoPaulo) blockers.push("Fuso horário do calendário difere de America/Sao_Paulo.");
  if (!spreadsheetCheck.hasAgendamentosTab || !spreadsheetCheck.hasServicosTab) blockers.push("Abas obrigatórias não encontradas.");

  var report = {
    status: "success",
    readOnly: true,
    officialTimeZone: tzOfficial,
    executionAccount: executionAccount,
    writeSyncEnabled: _cdsIsWriteSyncEnabled_(),
    spreadsheet: spreadsheetCheck,
    calendar: calendarCheck,
    triggers: {
      total: existingTriggers.length,
      hasEditTrigger: hasEditTrigger,
      hasCalendarTrigger: hasCalendarTrigger,
      items: existingTriggers
    },
    configReady: blockers.length === 0,
    blockers: blockers,
    safety: "Somente leitura. Nenhum segredo foi exposto, nenhuma propriedade foi alterada e nenhum gatilho foi instalado."
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * 3. DRY-RUN ATUALIZADO (100% SOMENTE LEITURA).
 * Reflete a regra definitiva de autoridade (Calendar = fonte oficial dos agendamentos;
 * Sheets = catálogo + durações em Serviços!F + Coluna T) e todas as exceções autorizadas.
 */
function runCalendarDurationSyncDryRun(options) {
  options = options || {};
  var configAudit = auditCalendarDurationSyncConfig();
  var tz = _cdsTimezone_();
  var today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var daysAhead = Number(options.daysAhead || 365);
  var endDateObj = new Date();
  endDateObj.setDate(endDateObj.getDate() + daysAhead);
  var endKey = Utilities.formatDate(endDateObj, tz, "yyyy-MM-dd");

  var ss = _cdsOpenOfficialSpreadsheet_(true);
  var agSheet = ss.getSheetByName("Agendamentos");
  if (!agSheet) throw new Error("Aba 'Agendamentos' não encontrada.");
  var calendar = _cdsGetCalendar_();
  var catalog = _cdsReadServicesCatalog_(ss);

  var lastRow = agSheet.getLastRow();
  var lastCol = Math.max(agSheet.getLastColumn(), 20);
  var values = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var display = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];

  var rawEvents = calendar.getEvents(
    new Date(today + "T00:00:00" + CDS_TZ_OFFSET),
    new Date(endKey + "T23:59:59" + CDS_TZ_OFFSET)
  );

  var ignoredByExceptions = [];
  var calendarEvents = [];

  for (var eIdx = 0; eIdx < rawEvents.length; eIdx++) {
    var ev = rawEvents[eIdx];
    var evId = ev.getId();
    var evTitle = String(ev.getTitle() || "");
    var evDesc = String(ev.getDescription() || "");
    var evStartIso = Utilities.formatDate(ev.getStartTime(), tz, "yyyy-MM-dd'T'HH:mm:ss");
    var evEndIso = Utilities.formatDate(ev.getEndTime(), tz, "yyyy-MM-dd'T'HH:mm:ss");

    if (ev.isAllDayEvent()) {
      ignoredByExceptions.push({ source: "CALENDAR", reason: "ALL_DAY_EVENT", eventId: evId, title: evTitle, start: evStartIso });
      continue;
    }
    var normEvTitle = _cdsNormalize_(evTitle);
    if (/\bteste?\b|\bintegracao\b|\bintegration\b|\be2e\b/i.test(normEvTitle)) {
      ignoredByExceptions.push({ source: "CALENDAR", reason: "TEST_EVENT", eventId: evId, title: evTitle, start: evStartIso });
      continue;
    }

    var evDurationMin = Math.round((ev.getEndTime().getTime() - ev.getStartTime().getTime()) / 60000);
    var isRecurring = false;
    try { isRecurring = !!ev.isRecurringEvent(); } catch (recErr) {}
    calendarEvents.push({
      id: evId,
      isRecurring: isRecurring,
      occurrenceKey: evId + "|" + evStartIso,
      title: evTitle,
      normalizedTitle: normEvTitle,
      description: evDesc,
      dateKey: evStartIso.substring(0, 10),
      timeKey: evStartIso.substring(11, 16),
      startIso: evStartIso,
      endIso: evEndIso,
      durationMinutes: evDurationMin,
      matchedRows: []
    });
  }

  var futureAppointments = [];
  var uniqueMatches = [];
  var appointmentsWithoutEvent = [];
  var ambiguousMatches = [];
  var safeToUpdate = [];
  var duplicateRiskRecords = [];
  var pendingHumanReview = [];
  var nowMs = new Date().getTime();

  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var d = display[i];
    var rowNum = i + 1;

    var client = String(r[1] || "").trim();
    var procedure = String(r[4] || "").trim();
    var statusRaw = String(r[8] || "").trim();
    var statusNorm = _cdsNormalize_(statusRaw);
    var appointmentId = String(r[9] || "").trim();
    var additionalIds = _cdsParseAdditionalIds_(r[13]);
    var serviceId = String(r[15] || "").trim();
    var colTEventId = String(r[19] || "").trim();

    if (!client && !appointmentId && !procedure) continue;

    var dateKey = _cdsDateKey_(r[5], d[5]);
    var timeKey = _cdsTimeKey_(r[6], d[6]);
    if (!dateKey || dateKey < today || dateKey > endKey) continue;
    if (timeKey) {
      var startCheck = new Date(dateKey + "T" + timeKey + ":00" + CDS_TZ_OFFSET);
      if (!isNaN(startCheck.getTime()) && startCheck.getTime() <= nowMs) continue;
    }

    // Classifica exceções de exclusão / cancelados / bloqueios
    var guard = _cdsClassifyGuard_(appointmentId, client, procedure, statusNorm);
    if (guard.skip && guard.reason !== "AUTHORIZED_DURATION_EXCEPTION" && guard.reason !== "PENDING_HUMAN_REVIEW") {
      ignoredByExceptions.push({
        source: "SHEET",
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        procedure: procedure,
        date: dateKey,
        time: timeKey,
        status: statusRaw,
        columnTEventId: colTEventId || null,
        reason: guard.reason
      });
      continue;
    }

    var durationRes = _cdsResolveServiceDuration_(catalog, serviceId, procedure, additionalIds);
    var authorizedOverrideMin = _cdsGetDurationException_(appointmentId);

    var aptRecord = {
      row: rowNum,
      appointmentId: appointmentId,
      client: client,
      procedure: procedure,
      serviceId: serviceId || null,
      additionalServiceIds: additionalIds,
      date: dateKey,
      time: timeKey,
      status: statusRaw,
      hasColumnTId: !!colTEventId,
      columnTEventId: colTEventId || null,
      catalogDurationMinutes: durationRes.ok ? durationRes.durationMinutes : null,
      authorizedDurationExceptionMin: authorizedOverrideMin,
      durationError: durationRes.ok ? null : durationRes.errorCode + ": " + durationRes.message
    };
    futureAppointments.push(aptRecord);

    if (guard.reason === "PENDING_HUMAN_REVIEW") {
      pendingHumanReview.push({
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        date: dateKey,
        time: timeKey,
        status: statusRaw,
        reason: "BLOQUEADO_INDIVIDUALMENTE_AGUARDANDO_CONFIRMACAO_HUMANA"
      });
      appointmentsWithoutEvent.push(aptRecord);
      continue;
    }

    var candidates = _cdsFindMatchingCalendarEvents_(aptRecord, calendarEvents);

    if (candidates.length === 1) {
      var matchedEv = candidates[0].event;
      matchedEv.matchedRows.push({ row: rowNum, appointmentId: appointmentId, hasColumnTId: !!colTEventId });
      var effectiveTargetDuration = authorizedOverrideMin !== null ? authorizedOverrideMin : (durationRes.ok ? durationRes.durationMinutes : null);
      var needsDurationUpdate = !!(effectiveTargetDuration !== null && matchedEv.durationMinutes !== effectiveTargetDuration && authorizedOverrideMin === null);
      var needsSheetTimeAlign = matchedEv.dateKey !== dateKey || matchedEv.timeKey !== timeKey;

      var matchEntry = {
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        procedure: procedure,
        sheetDate: dateKey,
        sheetTime: timeKey,
        hasColumnTId: !!colTEventId,
        columnTEventId: colTEventId || null,
        matchType: candidates[0].matchType,
        calendarEventId: matchedEv.id,
        isRecurringEvent: matchedEv.isRecurring,
        occurrenceKey: matchedEv.occurrenceKey,
        calendarTitle: matchedEv.title,
        calendarStart: matchedEv.startIso,
        calendarEnd: matchedEv.endIso,
        currentCalendarDurationMin: matchedEv.durationMinutes,
        catalogDurationMinutes: aptRecord.catalogDurationMinutes,
        authorizedDurationExceptionMin: authorizedOverrideMin,
        needsDurationUpdate: needsDurationUpdate,
        needsSheetTimeAlignFromCalendar: needsSheetTimeAlign
      };
      uniqueMatches.push(matchEntry);

      if (authorizedOverrideMin !== null) {
        ignoredByExceptions.push({
          source: "SHEET_LINKED_EXCEPTION",
          row: rowNum,
          appointmentId: appointmentId,
          client: client,
          columnTEventId: colTEventId || null,
          calendarDurationMin: matchedEv.durationMinutes,
          authorizedExceptionMin: authorizedOverrideMin,
          reason: "AUTHORIZED_DURATION_EXCEPTION_PRESERVED"
        });
      }

      if (!colTEventId) {
        duplicateRiskRecords.push({
          row: rowNum,
          appointmentId: appointmentId,
          client: client,
          date: dateKey,
          time: timeKey,
          existingCalendarEventId: matchedEv.id,
          riskReason: "Coluna T vazia para evento já existente no Calendar."
        });
      } else if (needsDurationUpdate && durationRes.ok) {
        safeToUpdate.push(matchEntry);
      }
    } else if (candidates.length > 1) {
      ambiguousMatches.push({
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        date: dateKey,
        time: timeKey,
        candidates: candidates.map(function(c) {
          return { matchType: c.matchType, eventId: c.event.id, title: c.event.title, start: c.event.startIso, end: c.event.endIso };
        })
      });
      duplicateRiskRecords.push({
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        riskReason: "Múltiplos candidatos no Calendar (" + candidates.length + ")."
      });
    } else {
      appointmentsWithoutEvent.push(aptRecord);
    }
  }

  // Detectar duplicidades na planilha (mais de 1 linha ativa apontando para o mesmo evento oficial do Calendar)
  var duplicateSheetRows = [];
  for (var ce = 0; ce < calendarEvents.length; ce++) {
    if (calendarEvents[ce].matchedRows.length > 1) {
      duplicateSheetRows.push({
        calendarEventId: calendarEvents[ce].id,
        calendarTitle: calendarEvents[ce].title,
        calendarStart: calendarEvents[ce].startIso,
        rows: calendarEvents[ce].matchedRows
      });
    }
  }

  var unmatchedCalendarEvents = calendarEvents
    .filter(function(ev) { return ev.matchedRows.length === 0; })
    .map(function(ev) {
      return { eventId: ev.id, title: ev.title, start: ev.startIso, end: ev.endIso, durationMinutes: ev.durationMinutes };
    });

  var activationBlockers = configAudit.blockers.slice();
  if (ambiguousMatches.length > 0) activationBlockers.push("Há " + ambiguousMatches.length + " correspondência(s) ambígua(s).");
  if (duplicateRiskRecords.length > 0) activationBlockers.push("Há " + duplicateRiskRecords.length + " registro(s) com risco de duplicação (Coluna T ausente).");
  if (duplicateSheetRows.length > 0) activationBlockers.push("Há " + duplicateSheetRows.length + " duplicidade(s) na planilha para o mesmo evento do Calendar.");

  var result = {
    status: "success",
    readOnly: true,
    dryRun: true,
    authorityRule: "GOOGLE_CALENDAR_OFFICIAL_APPOINTMENTS__SHEETS_OFFICIAL_SERVICES_AND_DURATIONS",
    timezone: tz,
    range: { start: today, end: endKey },
    configSummary: {
      configReady: configAudit.configReady,
      writeSyncEnabled: configAudit.writeSyncEnabled,
      triggersTotal: configAudit.triggers.total,
      calendarName: configAudit.calendar.calendarName,
      isOwnedByExecutionAccount: configAudit.calendar.isOwnedByExecutionAccount,
      blockers: configAudit.blockers
    },
    summary: {
      totalFutureAppointments: futureAppointments.length,
      uniqueMatches: uniqueMatches.length,
      unmatchedCalendarEvents: unmatchedCalendarEvents.length,
      appointmentsWithoutEvent: appointmentsWithoutEvent.length,
      ambiguousMatches: ambiguousMatches.length,
      ignoredByExceptions: ignoredByExceptions.length,
      safeToUpdate: safeToUpdate.length,
      duplicateRiskRecords: duplicateRiskRecords.length,
      duplicateSheetRowsDetected: duplicateSheetRows.length,
      pendingHumanReviewCount: pendingHumanReview.length,
      withColumnTId: futureAppointments.filter(function(a) { return a.hasColumnTId; }).length,
      withoutColumnTId: futureAppointments.filter(function(a) { return !a.hasColumnTId; }).length
    },
    uniqueMatches: uniqueMatches,
    appointmentsWithoutEvent: appointmentsWithoutEvent,
    ambiguousMatches: ambiguousMatches,
    duplicateSheetRows: duplicateSheetRows,
    ignoredByExceptions: ignoredByExceptions,
    pendingHumanReview: pendingHumanReview,
    safeToUpdate: safeToUpdate,
    duplicateRiskRecords: duplicateRiskRecords,
    readyForTriggerInstallation: activationBlockers.length === 0,
    activationBlockers: activationBlockers,
    safety: "DRY RUN SOMENTE LEITURA: nenhum evento ou célula alterado; nenhum gatilho instalado."
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * 4. OBJETIVO 1 — CALENDAR -> SHEETS: TODOS OS AGENDAMENTOS FUTUROS LEGÍTIMOS DE CLIENTES
 *
 * - Garante que cada agendamento futuro legítimo de cliente no Google Calendar esteja
 *   representado na aba Agendamentos (1 linha por agendamento / por ocorrência recorrente).
 * - Se a linha já existir (por Event ID + data em Col T, tag de ID ou match inequívoco):
 *   atualiza apenas Data (Col F), Horário inicial (Col G) e Event ID (Col T), preservando
 *   integralmente cliente, telefone, e-mail, pagamentos, serviços e histórico.
 * - Se não existir e for comprovadamente um agendamento legítimo de cliente: cria exatamente 1 linha
 *   com Event ID na Coluna T (determinístico e idempotente).
 * - NUNCA importa nem altera bloqueios, folgas, férias, feriados, eventos de dia inteiro,
 *   compromissos pessoais, eventos administrativos, reuniões, almoços ou eventos incertos.
 * - Eventos incertos/ambíguos permanecem inalterados e são reportados em needsAdminReview.
 * - NUNCA apaga linhas históricas nem sincroniza cancelamentos destrutivos.
 */
function previewCalendarBookingsImportDryRun(options) {
  options = options || {};
  options.dryRun = true;
  return syncCalendarBookingsToSheet(options);
}

function syncCalendarChangesToSheet(options) {
  return syncCalendarBookingsToSheet(options);
}

function syncCalendarBookingsToSheet(options) {
  options = options || {};
  var dryRun = options.dryRun === true || !_cdsIsWriteSyncEnabled_();

  // Prevenção de loop recursivo quando o próprio gatilho de duração acabou de ajustar um término
  if (!options.bypassLoopGuard && !dryRun && _cdsIsInternalSyncActive_()) {
    return { status: "ignored_loop_guard", dryRun: dryRun, imported: 0, updatedExisting: 0, skippedProtected: 0, needsAdminReview: [] };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { status: "error", errorCode: "LOCK_TIMEOUT" }; }

  try {
    var tz = _cdsTimezone_();
    var ss = _cdsOpenOfficialSpreadsheet_(dryRun);
    var agSheet = ss.getSheetByName("Agendamentos");
    if (!agSheet) throw new Error("Aba 'Agendamentos' não encontrada.");
    var calendar = _cdsGetCalendar_();
    var catalog = _cdsReadServicesCatalog_(ss);
    var knownClients = _cdsReadKnownClients_(ss, agSheet);

    var nowObj = new Date();
    var nowMs = nowObj.getTime();
    var startKey = options.startDate || Utilities.formatDate(nowObj, tz, "yyyy-MM-dd");
    var endObj = new Date(nowMs);
    endObj.setDate(endObj.getDate() + Number(options.daysAhead || 365));
    var endKey = options.endDate || Utilities.formatDate(endObj, tz, "yyyy-MM-dd");

    var lastRow = agSheet.getLastRow();
    var lastCol = Math.max(agSheet.getLastColumn(), 20);
    var values = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
    var display = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];

    // Índices das linhas existentes em Agendamentos para evitar duplicidade
    var byEventIdAndDate = {};
    var byEventId = {};
    var byAptId = {};
    var activeUnlinkedFutureRows = [];

    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      var d = display[i];
      var rowNum = i + 1;
      var client = String(r[1] || "").trim();
      var proc = String(r[4] || "").trim();
      var dateKey = _cdsDateKey_(r[5], d[5]);
      var timeKey = _cdsTimeKey_(r[6], d[6]);
      var statusNorm = _cdsNormalize_(r[8]);
      var aptId = String(r[9] || "").trim();
      var colT = String(r[19] || "").trim();

      if (!client && !aptId && !proc && !colT) continue;

      var rowMeta = {
        row: rowNum,
        client: client,
        clientNorm: _cdsNormalize_(client),
        procedure: proc,
        dateKey: dateKey,
        timeKey: timeKey,
        statusNorm: statusNorm,
        appointmentId: aptId,
        colT: colT
      };

      if (aptId) byAptId[aptId] = rowMeta;
      if (colT) {
        var keyED = colT + "|" + dateKey;
        byEventIdAndDate[keyED] = byEventIdAndDate[keyED] || [];
        byEventIdAndDate[keyED].push(rowMeta);
        byEventId[colT] = byEventId[colT] || [];
        byEventId[colT].push(rowMeta);
      } else if (dateKey && dateKey >= startKey && statusNorm !== "cancelado" && statusNorm !== "cancelada") {
        activeUnlinkedFutureRows.push(rowMeta);
      }
    }

    var rawEvents = calendar.getEvents(
      new Date(startKey + "T00:00:00" + CDS_TZ_OFFSET),
      new Date(endKey + "T23:59:59" + CDS_TZ_OFFSET)
    );

    var discoveredCustomerBookings = 0;
    var alreadyLinkedCount = 0;
    var updatedExistingCount = 0;
    var newlyImportedCount = 0;
    var protectedSkipped = [];
    var needsAdminReview = [];
    var importedItems = [];
    var updatedItems = [];
    var rowsToAppend = [];

    if (!dryRun) _cdsMarkInternalSync_();

    for (var eIdx = 0; eIdx < rawEvents.length; eIdx++) {
      var ev = rawEvents[eIdx];
      var evId = ev.getId();
      var evTitle = String(ev.getTitle() || "").trim();
      if (options.onlyTitleContaining && evTitle.indexOf(options.onlyTitleContaining) < 0) continue;
      var evDesc = String(ev.getDescription() || "");
      var evStart = ev.getStartTime();
      var evEnd = ev.getEndTime();
      var evDateKey = Utilities.formatDate(evStart, tz, "yyyy-MM-dd");
      var evTimeKey = Utilities.formatDate(evStart, tz, "HH:mm");
      var evStartIso = Utilities.formatDate(evStart, tz, "yyyy-MM-dd'T'HH:mm:ss");
      var evEndIso = Utilities.formatDate(evEnd, tz, "yyyy-MM-dd'T'HH:mm:ss");
      var isRecurring = false;
      try { isRecurring = !!ev.isRecurringEvent(); } catch (recErr) {}

      // Ignorar eventos passados (apenas agendamentos futuros)
      if (!ev.isAllDayEvent() && evStart.getTime() <= nowMs) continue;

      // 1. PROTEÇÃO ABSOLUTA — Bloqueios, folgas, férias, feriados, dia inteiro, pessoais, admin, reuniões, almoço
      var protCheck = _cdsClassifyProtectedCalendarEvent_(ev, options.allowTestPrefix || "");
      if (protCheck.protected) {
        protectedSkipped.push({
          eventId: evId,
          title: evTitle,
          start: evStartIso,
          allDay: ev.isAllDayEvent(),
          reason: protCheck.reason
        });
        continue;
      }

      // 2. BUSCAR CORRESPONDÊNCIA EM LINHAS EXISTENTES (evita duplicação; trata ocorrências recorrentes por Event ID + Data)
      var matchedRows = [];
      var matchMethod = null;
      var exactKey = evId + "|" + evDateKey;

      if (byEventIdAndDate[exactKey] && byEventIdAndDate[exactKey].length > 0) {
        matchedRows = byEventIdAndDate[exactKey];
        matchMethod = isRecurring ? "COLUMN_T_EVENT_ID_AND_DATE" : "COLUMN_T_EVENT_ID";
      } else if (!isRecurring && byEventId[evId] && byEventId[evId].length > 0) {
        matchedRows = byEventId[evId];
        matchMethod = "COLUMN_T_EVENT_ID_MOVED_DATE";
      } else {
        // Verifica tag [ESPACO_ANGELICA_APT_ID:...] na descrição
        var tagMatch = /\[ESPACO_ANGELICA_APT_ID:([^\]]+)\]/.exec(evDesc);
        if (tagMatch && byAptId[tagMatch[1]]) {
          var taggedRow = byAptId[tagMatch[1]];
          if (!isRecurring || taggedRow.dateKey === evDateKey) {
            matchedRows = [taggedRow];
            matchMethod = "DESCRIPTION_APT_TAG";
          }
        }
      }

      // Verifica linha sem Coluna T na mesma data + horário + sobreposição clara de nome de cliente
      if (matchedRows.length === 0) {
        var evTitleNorm = _cdsNormalize_(evTitle);
        var unlinkedCandidates = [];
        for (var u = 0; u < activeUnlinkedFutureRows.length; u++) {
          var uRow = activeUnlinkedFutureRows[u];
          if (uRow.dateKey !== evDateKey || uRow.timeKey !== evTimeKey) continue;
          if (CDS_AUTHORIZED_EXCEPTIONS.excludeAppointmentIds.indexOf(uRow.appointmentId) >= 0) continue;
          if (CDS_AUTHORIZED_EXCEPTIONS.pendingReviewAppointmentIds.indexOf(uRow.appointmentId) >= 0) continue;
          var uTokens = uRow.clientNorm.split(" ").filter(function(t) { return t.length >= 3; });
          var overlap = uTokens.filter(function(t) { return evTitleNorm.indexOf(t) >= 0; }).length;
          if (uTokens.length > 0 && overlap >= Math.min(2, uTokens.length)) {
            unlinkedCandidates.push(uRow);
          }
        }
        if (unlinkedCandidates.length === 1) {
          matchedRows = [unlinkedCandidates[0]];
          matchMethod = "UNLINKED_EXACT_DATE_TIME_CLIENT";
        } else if (unlinkedCandidates.length > 1) {
          needsAdminReview.push({
            eventId: evId,
            title: evTitle,
            start: evStartIso,
            end: evEndIso,
            isRecurring: isRecurring,
            reason: "AMBIGUOUS_MULTIPLE_SHEET_ROWS",
            candidateRows: unlinkedCandidates.map(function(c) { return c.row; })
          });
          continue;
        }
      }

      // 2B. SE JÁ EXISTE LINHA CORRESPONDENTE: atualizar somente Data (F), Horário (G) e Coluna T se necessário
      if (matchedRows.length === 1) {
        discoveredCustomerBookings++;
        alreadyLinkedCount++;
        var existingRow = matchedRows[0];

        // Protege exceções de exclusão ou revisão pendente
        if (CDS_AUTHORIZED_EXCEPTIONS.excludeAppointmentIds.indexOf(existingRow.appointmentId) >= 0 ||
            CDS_AUTHORIZED_EXCEPTIONS.pendingReviewAppointmentIds.indexOf(existingRow.appointmentId) >= 0) {
          continue;
        }

        var needsDateUpdate = existingRow.dateKey !== evDateKey;
        var needsTimeUpdate = existingRow.timeKey !== evTimeKey;
        var needsColTUpdate = existingRow.colT !== evId;

        if (needsDateUpdate || needsTimeUpdate || needsColTUpdate) {
          if (!dryRun) {
            if (needsDateUpdate) agSheet.getRange(existingRow.row, 6).setValue(evDateKey);
            if (needsTimeUpdate) agSheet.getRange(existingRow.row, 7).setValue(evTimeKey);
            if (needsColTUpdate) agSheet.getRange(existingRow.row, 20).setValue(evId);
          }
          existingRow.dateKey = evDateKey;
          existingRow.timeKey = evTimeKey;
          existingRow.colT = evId;
          updatedExistingCount++;
          updatedItems.push({
            row: existingRow.row,
            appointmentId: existingRow.appointmentId,
            eventId: evId,
            matchMethod: matchMethod,
            date: evDateKey,
            time: evTimeKey,
            updatedFields: [
              needsDateUpdate ? "F:date" : null,
              needsTimeUpdate ? "G:time" : null,
              needsColTUpdate ? "T:eventId" : null
            ].filter(Boolean)
          });
        }
        continue;
      }

      if (matchedRows.length > 1) {
        needsAdminReview.push({
          eventId: evId,
          title: evTitle,
          start: evStartIso,
          end: evEndIso,
          isRecurring: isRecurring,
          reason: "AMBIGUOUS_MULTIPLE_LINKED_ROWS",
          rows: matchedRows.map(function(m) { return m.row; })
        });
        continue;
      }

      // 3. EVENTO SEM LINHA CORRESPONDENTE: só importar se comprovadamente for agendamento legítimo de cliente!
      var classification = _cdsClassifyUnlinkedCustomerBooking_(evTitle, evDesc, catalog, knownClients, options.allowTestPrefix || "");
      if (!classification.isConfidentCustomerBooking) {
        needsAdminReview.push({
          eventId: evId,
          title: evTitle,
          start: evStartIso,
          end: evEndIso,
          isRecurring: isRecurring,
          reason: classification.reason
        });
        continue;
      }

      // Agendamento futuro legítimo de cliente confirmado -> preparar inserção idempotente de 1 única linha
      discoveredCustomerBookings++;
      newlyImportedCount++;
      var newAptId = "apt-gcal-" + _cdsShortHash_(evId + "|" + evDateKey);

      // Proteção final contra duplicação caso o mesmo deterministic ID já exista
      if (byAptId[newAptId]) {
        newlyImportedCount--;
        alreadyLinkedCount++;
        continue;
      }

      var newRowArr = new Array(lastCol);
      for (var c = 0; c < lastCol; c++) newRowArr[c] = "";
      newRowArr[0] = new Date();
      newRowArr[1] = classification.clientName;
      newRowArr[4] = classification.serviceTitle;
      newRowArr[5] = evDateKey;
      newRowArr[6] = evTimeKey;
      newRowArr[7] = "";
      newRowArr[8] = "confirmado";
      newRowArr[9] = newAptId;
      newRowArr[10] = "Importado do Google Calendar";
      if (classification.additionalServiceIds && classification.additionalServiceIds.length > 0) {
        newRowArr[13] = JSON.stringify(classification.additionalServiceIds);
      }
      newRowArr[15] = classification.serviceId || "";
      newRowArr[19] = evId;

      rowsToAppend.push(newRowArr);

      var newMeta = {
        row: lastRow + rowsToAppend.length,
        client: classification.clientName,
        clientNorm: _cdsNormalize_(classification.clientName),
        procedure: classification.serviceTitle,
        dateKey: evDateKey,
        timeKey: evTimeKey,
        statusNorm: "confirmado",
        appointmentId: newAptId,
        colT: evId
      };
      byAptId[newAptId] = newMeta;
      byEventIdAndDate[exactKey] = [newMeta];
      byEventId[evId] = byEventId[evId] || [];
      byEventId[evId].push(newMeta);

      importedItems.push({
        row: newMeta.row,
        appointmentId: newAptId,
        eventId: evId,
        isRecurring: isRecurring,
        client: classification.clientName,
        procedure: classification.serviceTitle,
        serviceId: classification.serviceId || null,
        date: evDateKey,
        time: evTimeKey,
        confidence: classification.confidence
      });
    }

    // Gravação em lote (rápida e atômica) somente quando dryRun === false
    if (!dryRun && rowsToAppend.length > 0) {
      agSheet.getRange(lastRow + 1, 1, rowsToAppend.length, lastCol).setValues(rowsToAppend);
      SpreadsheetApp.flush();
    } else if (!dryRun && updatedExistingCount > 0) {
      SpreadsheetApp.flush();
    }

    var patternMap = {};
    for (var im = 0; im < importedItems.length; im++) {
      var it = importedItems[im];
      var pKey = it.client + " | " + it.procedure + " | rec=" + (it.isRecurring ? "Y" : "N") + " | svcId=" + (it.serviceId || "-");
      patternMap[pKey] = (patternMap[pKey] || 0) + 1;
    }
    var uniqueImportedPatterns = Object.keys(patternMap).map(function(k) {
      return k + " (x" + patternMap[k] + ")";
    });

    var summary = {
      status: "success",
      dryRun: dryRun,
      range: { start: startKey, end: endKey },
      counts: {
        totalFutureEventsScanned: rawEvents.length,
        futureCustomerBookingsDiscovered: discoveredCustomerBookings,
        alreadyLinkedToSheets: alreadyLinkedCount,
        updatedExistingRows: updatedExistingCount,
        newlyImported: newlyImportedCount,
        skippedProtectedEvents: protectedSkipped.length,
        requiringAdminReview: needsAdminReview.length
      },
      updatedExisting: updatedItems,
      protectedEvents: protectedSkipped.map(function(p) { return p.start.slice(0, 10) + " | " + p.title + " | " + p.reason + (p.allDay ? " [ALL_DAY]" : ""); }),
      needsAdminReview: needsAdminReview,
      totalNeedsAdminReview: needsAdminReview.length,
      uniqueImportedPatterns: uniqueImportedPatterns,
      safety: dryRun
        ? "DRY RUN SOMENTE LEITURA: nenhuma linha criada ou alterada; nenhum evento do Calendar alterado."
        : "Sincronização Calendar -> Sheets concluída preservando dados existentes e ignorando todos os eventos protegidos/ambíguos."
    };
    Logger.log(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function _cdsClassifyProtectedCalendarEvent_(calendarEvent, allowTestPrefix) {
  if (calendarEvent.isAllDayEvent()) {
    return { protected: true, reason: "ALL_DAY_EVENT" };
  }
  var rawTitle = String(calendarEvent.getTitle() || "").trim();
  if (!rawTitle) {
    return { protected: true, reason: "EMPTY_TITLE" };
  }
  var normTitle = _cdsNormalize_(rawTitle);

  if (_cdsHasProtectedNonClientKeyword_(normTitle)) {
    return { protected: true, reason: "PROTECTED_NON_CLIENT_KEYWORD" };
  }

  var isAllowedTest = allowTestPrefix && rawTitle.indexOf(allowTestPrefix) >= 0;
  if (!isAllowedTest && /\bteste?\b|\bintegracao\b|\bintegration\b|\be2e\b/i.test(normTitle)) {
    return { protected: true, reason: "TEST_EVENT" };
  }

  return { protected: false };
}

function _cdsReadKnownClients_(ss, agSheet) {
  var names = {};
  function addName(val) {
    var norm = _cdsNormalize_(val);
    if (!norm || norm.length < 3) return;
    if (_cdsHasProtectedNonClientKeyword_(norm)) return;
    if (/\bteste?\b|\btesteadmin\b|\be2e\b/i.test(norm)) return;
    names[norm] = String(val).trim();
  }
  if (agSheet && agSheet.getLastRow() >= 2) {
    var agRows = agSheet.getRange(2, 1, agSheet.getLastRow() - 1, 10).getValues();
    for (var i = 0; i < agRows.length; i++) {
      var aptId = String(agRows[i][9] || "").trim();
      var statusNorm = _cdsNormalize_(agRows[i][8]);
      if (CDS_AUTHORIZED_EXCEPTIONS.excludeAppointmentIds.indexOf(aptId) >= 0) continue;
      if (statusNorm === "teste sistema" || statusNorm === "bloqueado") continue;
      addName(agRows[i][1]);
    }
  }
  var cliSheet = ss.getSheetByName("Clientes");
  if (cliSheet && cliSheet.getLastRow() >= 2) {
    var cliVals = cliSheet.getRange(2, 1, cliSheet.getLastRow() - 1, 3).getValues();
    for (var j = 0; j < cliVals.length; j++) {
      addName(cliVals[j][1] || cliVals[j][0]);
    }
  }
  return names;
}

function _cdsEscapeRegex_(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _cdsAccentInsensitivePattern_(str) {
  var base = String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  var escaped = _cdsEscapeRegex_(base).replace(/\s+/g, "\\s+");
  return escaped
    .replace(/a/gi, "[aáàâãä]")
    .replace(/e/gi, "[eéèêë]")
    .replace(/i/gi, "[iíìîï]")
    .replace(/o/gi, "[oóòôõö]")
    .replace(/u/gi, "[uúùûü]")
    .replace(/c/gi, "[cç]");
}

function _cdsIsGenericNonClientLabel_(clientNorm) {
  if (!clientNorm) return true;
  var genericLabels = [
    "agendamento", "agendamento de", "agendamento para", "agendamento de unhas",
    "atendimento", "atendimento de", "horario", "horario de", "reserva", "reserva de",
    "servico", "procedimento", "cliente", "unha", "unhas"
  ];
  return genericLabels.indexOf(clientNorm) >= 0;
}

function _cdsMatchCatalogAlias_(rawProcedureText, catalog) {
  var norm = _cdsNormalize_(rawProcedureText);
  if (!norm || !catalog || !catalog.byId) return null;

  // 1. Correspondência exata com título oficial na aba Serviços / Depilação
  if (catalog.byTitle && catalog.byTitle[norm] && catalog.byTitle[norm].length === 1) {
    return { mainService: catalog.byTitle[norm][0], additionalServiceIds: [], matchedBy: "EXACT_CATALOG_TITLE" };
  }

  function findById(id) {
    var list = catalog.byId[id];
    return (list && list.length === 1) ? list[0] : null;
  }

  // 2. Combos e sinônimos reais usados no Google Calendar do Espaço Angélica
  if (/\bmanutencao\b/.test(norm) && /\bpe\b/.test(norm)) {
    var mainM = findById("manutencao-fibra-vidro");
    var addP = findById("pedicure-tradicional");
    if (mainM && addP) {
      return { mainService: mainM, additionalServiceIds: [addP.id], matchedBy: "ALIAS_MANUTENCAO_E_PE" };
    }
  }
  if (/\b(pe e mao|mao e pe|manicure e pedicure|pedicure e manicure)\b/.test(norm)) {
    var pm = findById("manicure-pedicure-tradicional");
    if (pm) return { mainService: pm, additionalServiceIds: [], matchedBy: "ALIAS_PE_E_MAO" };
  }
  if (/\b(esmaltacao em gel|esmaltacao gel)\b/.test(norm)) {
    var eg = /\bpe\b/.test(norm) ? findById("serv-1793851523054") : findById("esmaltacao-gel-premium");
    if (eg) return { mainService: eg, additionalServiceIds: [], matchedBy: "ALIAS_ESMALTACAO_GEL" };
  }
  if (/\b(banho de gel|banho em gel)\b/.test(norm)) {
    var bg = findById("banho-em-gel");
    if (bg) return { mainService: bg, additionalServiceIds: [], matchedBy: "ALIAS_BANHO_GEL" };
  }
  if (/\b(alongamento|fibra de vidro|fibra slim|fibra)\b/.test(norm)) {
    var al = findById("alongamento-fibra-slim");
    if (al) return { mainService: al, additionalServiceIds: [], matchedBy: "ALIAS_ALONGAMENTO" };
  }
  if (/\b(manutencao decorada|manutencao de crescimento|manutencao)\b/.test(norm)) {
    var mn = findById("manutencao-fibra-vidro");
    if (mn) return { mainService: mn, additionalServiceIds: [], matchedBy: "ALIAS_MANUTENCAO" };
  }
  if (/\bblindagem\b/.test(norm)) {
    var bl = findById("blindagem-homens-incolor");
    if (bl) return { mainService: bl, additionalServiceIds: [], matchedBy: "ALIAS_BLINDAGEM" };
  }
  if (/\bspa dos pes\b/.test(norm)) {
    var sp = findById("spa-das-maos-ouro");
    if (sp) return { mainService: sp, additionalServiceIds: [], matchedBy: "ALIAS_SPA_PES" };
  }
  if (/\bplastica dos pes\b/.test(norm)) {
    var pl = findById("plastica-dos-pes");
    if (pl) return { mainService: pl, additionalServiceIds: [], matchedBy: "ALIAS_PLASTICA_PES" };
  }
  if (norm === "mao" || norm === "manicure" || norm === "manicure tradicional" || norm === "manicure mao") {
    var mc = findById("manicure-tradicional");
    if (mc) return { mainService: mc, additionalServiceIds: [], matchedBy: "ALIAS_MANICURE_MAO" };
  }
  if (norm === "pe" || norm === "pedicure" || norm === "pedicure tradicional" || norm === "pedicure pe") {
    var pd = findById("pedicure-tradicional");
    if (pd) return { mainService: pd, additionalServiceIds: [], matchedBy: "ALIAS_PEDICURE_PE" };
  }
  return null;
}

function _cdsClassifyUnlinkedCustomerBooking_(rawTitle, rawDesc, catalog, knownClients, allowTestPrefix) {
  var title = String(rawTitle || "").trim();
  var titleNorm = _cdsNormalize_(title);

  // 1. Verificar correspondência direta com título de serviço oficial do catálogo (Serviços / Depilação)
  var matchedService = null;
  var bestTitleLen = 0;
  var titleKeys = Object.keys(catalog.byTitle || {});
  for (var k = 0; k < titleKeys.length; k++) {
    var sKey = titleKeys[k];
    if (sKey.length >= 4 && titleNorm.indexOf(sKey) >= 0 && sKey.length > bestTitleLen) {
      var list = catalog.byTitle[sKey];
      if (list && list.length === 1) {
        matchedService = list[0];
        bestTitleLen = sKey.length;
      }
    }
  }

  // 2. Verificar palavras-chave claras de procedimentos do Espaço Angélica
  var procedureKeywords = [
    "pe e mao", "mao e pe", "manicure", "pedicure", "alongamento", "fibra de vidro",
    "fibra slim", "fibra", "esmaltacao em gel", "esmaltacao", "blindagem",
    "banho de gel", "manutencao decorada", "manutencao", "spa dos pes", "cutilagem",
    "depilacao", "sobrancelha", "buco", "axila", "virilha", "perna", "francesinha",
    "postica", "remocao", "unha", "unhas", "decorada", "gel", "mao", "pe"
  ];
  var matchedKeyword = null;
  for (var p = 0; p < procedureKeywords.length; p++) {
    var kw = procedureKeywords[p];
    var re = new RegExp("(^|\\s)" + kw + "(\\s|$)");
    if (re.test(titleNorm)) {
      matchedKeyword = kw;
      break;
    }
  }

  // 3. Verificar correspondência com cliente conhecida na base (Agendamentos / Clientes)
  var matchedKnownClient = null;
  var knownKeys = Object.keys(knownClients || {});
  var bestClientLen = 0;
  for (var c = 0; c < knownKeys.length; c++) {
    var cKey = knownKeys[c];
    if (cKey.length >= 4 && titleNorm.indexOf(cKey) >= 0 && cKey.length > bestClientLen) {
      matchedKnownClient = knownClients[cKey];
      bestClientLen = cKey.length;
    }
  }

  // Extrai nome da cliente e procedimento a partir do título
  var clientName = "";
  var serviceTitle = "";
  var sepMatch = /^(.+?)\s*[-–—:|]\s*(.+)$/.exec(title);
  if (sepMatch) {
    var leftPart = sepMatch[1].trim();
    var rightPart = sepMatch[2].trim();
    var leftNorm = _cdsNormalize_(leftPart);
    var rightNorm = _cdsNormalize_(rightPart);
    var leftIsService = !!(matchedService && leftNorm === matchedService.normalizedTitle) ||
      (matchedKeyword && new RegExp("(^|\\s)" + matchedKeyword + "(\\s|$)").test(leftNorm) &&
      !(matchedKeyword && new RegExp("(^|\\s)" + matchedKeyword + "(\\s|$)").test(rightNorm)));
    if (leftIsService) {
      serviceTitle = leftPart;
      clientName = rightPart;
    } else {
      clientName = leftPart;
      serviceTitle = rightPart;
    }
  } else if (matchedKnownClient) {
    clientName = matchedKnownClient;
    var clientRe = new RegExp(_cdsAccentInsensitivePattern_(matchedKnownClient), "i");
    var restAfterClient = title.replace(clientRe, "").replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, "").trim();
    serviceTitle = matchedService ? matchedService.title : (restAfterClient || matchedKeyword || "");
  } else if (matchedService || matchedKeyword) {
    var stripped = title;
    var extractedService = "";
    if (matchedService) {
      var svcRe = new RegExp(_cdsAccentInsensitivePattern_(matchedService.title), "i");
      stripped = stripped.replace(svcRe, "").trim();
      extractedService = matchedService.title;
    } else if (matchedKeyword) {
      var kwRe = new RegExp("(?:^|\\s)(" + _cdsAccentInsensitivePattern_(matchedKeyword) + "(?:\\s+.*)?)$", "i");
      var kwExec = kwRe.exec(title);
      if (kwExec) {
        extractedService = kwExec[1].trim();
        stripped = title.substring(0, kwExec.index).trim();
      }
    }
    stripped = stripped.replace(/[\s\-–—:|]+$/, "").trim();
    clientName = stripped;
    serviceTitle = extractedService || matchedKeyword;
  }

  var clientNorm = _cdsNormalize_(clientName);
  if (_cdsHasProtectedNonClientKeyword_(clientNorm)) {
    return {
      isConfidentCustomerBooking: false,
      reason: "PROTECTED_NON_CLIENT_SIGNAL"
    };
  }
  if (_cdsIsGenericNonClientLabel_(clientNorm)) {
    return {
      isConfidentCustomerBooking: false,
      reason: "UNCERTAIN_GENERIC_NON_CLIENT_LABEL"
    };
  }

  var aliasMatch = (!matchedService && serviceTitle) ? _cdsMatchCatalogAlias_(serviceTitle, catalog) : null;
  var resolvedService = matchedService || (aliasMatch ? aliasMatch.mainService : null);
  var resolvedAdditionalIds = aliasMatch ? aliasMatch.additionalServiceIds : [];

  var hasProcedureSignal = !!(resolvedService || matchedKeyword);
  var clientWords = clientNorm.split(" ").filter(function(w) { return w.length >= 3 && !/^\d+$/.test(w); });
  var hasClientSignal = !!(matchedKnownClient || clientWords.length >= 1);

  if (allowTestPrefix && title.indexOf(allowTestPrefix) >= 0 && hasProcedureSignal && hasClientSignal) {
    return {
      isConfidentCustomerBooking: true,
      confidence: "ISOLATED_TEST_MATCH",
      clientName: clientName,
      serviceTitle: resolvedService ? resolvedService.title : (serviceTitle || title),
      serviceId: resolvedService ? resolvedService.id : "",
      additionalServiceIds: resolvedAdditionalIds
    };
  }

  if (hasProcedureSignal && hasClientSignal) {
    return {
      isConfidentCustomerBooking: true,
      confidence: resolvedService ? "CATALOG_SERVICE_AND_CLIENT" : (matchedKnownClient ? "KNOWN_CLIENT_AND_PROCEDURE" : "PROCEDURE_KEYWORD_AND_CLIENT"),
      clientName: clientName,
      serviceTitle: resolvedService ? resolvedService.title : (serviceTitle || matchedKeyword),
      serviceId: resolvedService ? resolvedService.id : "",
      additionalServiceIds: resolvedAdditionalIds
    };
  }

  return {
    isConfidentCustomerBooking: false,
    reason: !hasProcedureSignal ? "UNCERTAIN_NO_SERVICE_SIGNAL" : "UNCERTAIN_NO_CLIENT_NAME"
  };
}

function _cdsShortHash_(input) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(input || ""));
  var hex = "";
  for (var i = 0; i < 8; i++) {
    var b = digest[i];
    if (b < 0) b += 256;
    hex += ("0" + b.toString(16)).slice(-2);
  }
  return hex;
}

/**
 * 5. SENTIDO SHEETS (Serviços!F) -> CALENDAR:
 * Gatilho instalável onEdit (NÃO instalar automaticamente nesta execução).
 * - Quando Serviços!F mudar: encontra agendamentos futuros vinculados via Coluna T,
 *   preserva data e horário inicial oficiais do Calendar e atualiza SOMENTE o horário final.
 * - Preserva todas as exceções autorizadas (ex.: Linha 16 = 150 min, Linha 17 = 90 min).
 * - Nunca cria evento substituto/duplicado.
 * - Ignora edições internas feitas por Calendar -> Sheets (prevenção de loop infinito).
 */
function handleSpreadsheetEditForCalendarSync(e) {
  if (!e || !e.range) return { status: "ignored", reason: "NO_EVENT_RANGE" };
  if (!_cdsIsWriteSyncEnabled_()) return { status: "skipped_disabled", reason: "CALENDAR_DURATION_SYNC_ENABLED !== true" };
  if (_cdsIsInternalSyncActive_()) return { status: "ignored_loop_guard", reason: "INTERNAL_SYNC_IN_PROGRESS" };

  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = _cdsNormalize_(sheet.getName());
  var startRow = range.getRow();
  var endRow = range.getLastRow();
  var startCol = range.getColumn();
  var endCol = range.getLastColumn();
  if (endRow < 2) return { status: "ignored", reason: "HEADER_ONLY" };

  // Somente mudanças em Serviços!F (ou Depilação!F) propagam duração para o Calendar
  if (sheetName !== "servicos" && sheetName !== "depilacao") {
    return { status: "ignored", reason: "CALENDAR_IS_AUTHORITATIVE_FOR_APPOINTMENTS" };
  }
  if (startCol > 6 || endCol < 6) {
    return { status: "ignored", reason: "NON_DURATION_COLUMN" };
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return { status: "error", errorCode: "LOCK_TIMEOUT" }; }

  try {
    var ss = _cdsOpenOfficialSpreadsheet_(false);
    var calendar = _cdsGetCalendar_();
    var summaries = [];
    for (var r = Math.max(2, startRow); r <= endRow; r++) {
      var rowVals = sheet.getRange(r, 1, 1, 8).getValues()[0];
      summaries.push(_cdsPropagateServiceDurationToCalendar_(ss, calendar, {
        rowIndex: r,
        id: String(rowVals[0] || "").trim(),
        title: String(rowVals[1] || "").trim(),
        normalizedTitle: _cdsNormalize_(rowVals[1]),
        rawDuration: rowVals[5],
        durationMinutes: _cdsParseDurationMinutes_(rowVals[5])
      }));
    }
    Logger.log(JSON.stringify({ action: "ON_SERVICES_F_EDIT", summaries: summaries }));
    return { status: "success", summaries: summaries };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hook chamado pelo Code.gs após saveService concluir com sucesso no painel administrativo.
 */
function syncFutureAppointmentsForServiceDurationChange(serviceId, serviceTitle, options) {
  options = options || {};
  if (!_cdsIsWriteSyncEnabled_() || options.dryRun === true) {
    return {
      status: "skipped_dry_run_mode",
      executed: false,
      serviceId: serviceId || null,
      serviceTitle: serviceTitle || null,
      message: "Sincronização em modo de proteção (CALENDAR_DURATION_SYNC_ENABLED !== 'true'). Nenhum evento alterado."
    };
  }

  var ss = _cdsOpenOfficialSpreadsheet_(false);
  var calendar = _cdsGetCalendar_();
  var catalog = _cdsReadServicesCatalog_(ss);
  var target = null;

  if (serviceId && catalog.byId[String(serviceId).trim()] && catalog.byId[String(serviceId).trim()].length === 1) {
    target = catalog.byId[String(serviceId).trim()][0];
  } else if (serviceTitle && catalog.byTitle[_cdsNormalize_(serviceTitle)] && catalog.byTitle[_cdsNormalize_(serviceTitle)].length === 1) {
    target = catalog.byTitle[_cdsNormalize_(serviceTitle)][0];
  }

  if (!target) {
    var msg = "Serviço não encontrado na aba Serviços (ID=" + serviceId + ", Título=" + serviceTitle + ").";
    Logger.log("ERROR: " + msg);
    return { status: "error", errorCode: "SERVICE_NOT_FOUND", message: msg };
  }

  return _cdsPropagateServiceDurationToCalendar_(ss, calendar, target);
}

/**
 * Hook chamado pelo Code.gs após updateAppointment no painel administrativo.
 * Respeita a regra definitiva: se o procedimento mudar, atualiza SOMENTE o horário final do evento
 * existente em Coluna T preservando data e horário inicial oficiais do Calendar (nunca cria duplicata).
 */
function syncAppointmentRowAfterPanelUpdate_(rowIndex) {
  if (!_cdsIsWriteSyncEnabled_()) {
    return { status: "skipped_dry_run_mode", executed: false, rowIndex: rowIndex };
  }
  var ss = _cdsOpenOfficialSpreadsheet_(false);
  var calendar = _cdsGetCalendar_();
  return _cdsUpdateExistingEventDurationOnly_(ss, calendar, rowIndex);
}

function _cdsPropagateServiceDurationToCalendar_(ss, calendar, targetService) {
  if (!targetService || targetService.durationMinutes === null) {
    var errMsg = "Duração inválida em Serviços!F para " + (targetService ? targetService.title : "desconhecido") + ". Nenhum evento alterado.";
    Logger.log("ERROR: " + errMsg);
    return { ok: false, errorCode: "INVALID_DURATION", updated: 0, errors: 1, message: errMsg };
  }

  var agSheet = ss.getSheetByName("Agendamentos");
  if (!agSheet || agSheet.getLastRow() < 2) return { ok: true, updated: 0, unchanged: 0, skipped: 0, errors: 0, logs: [] };

  var rows = agSheet.getDataRange().getValues();
  var logs = [];
  var updated = 0, unchanged = 0, skipped = 0, errors = 0;

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var rowServiceId = String(r[15] || "").trim();
    var rowProc = _cdsNormalize_(r[4]);
    var addIds = _cdsParseAdditionalIds_(r[13]);

    var matches =
      (targetService.id && rowServiceId === targetService.id && (!rowProc || rowProc === targetService.normalizedTitle)) ||
      (targetService.normalizedTitle && rowProc === targetService.normalizedTitle) ||
      (targetService.id && addIds.indexOf(targetService.id) >= 0);

    if (!matches) continue;

    var res = _cdsUpdateExistingEventDurationOnly_(ss, calendar, i + 1);
    logs.push(res);

    if (res.status === "UPDATED") updated++;
    else if (res.status === "UNCHANGED") unchanged++;
    else if (res.status === "ERROR") errors++;
    else skipped++;
  }

  var summary = { ok: errors === 0, service: targetService.title, durationMinutes: targetService.durationMinutes, updated: updated, unchanged: unchanged, skipped: skipped, errors: errors, logs: logs };
  Logger.log(JSON.stringify(summary));
  return summary;
}

/**
 * Atualiza SOMENTE o horário final de um evento existente localizado pelo ID em Agendamentos!T,
 * preservando a data e o horário inicial oficiais do Google Calendar e todas as exceções autorizadas.
 * Nunca cria novo evento para substituir um evento existente.
 */
function _cdsUpdateExistingEventDurationOnly_(ss, calendar, rowIndex) {
  var agSheet = ss.getSheetByName("Agendamentos");
  if (!agSheet || rowIndex < 2 || rowIndex > agSheet.getLastRow()) {
    return { status: "ERROR", errorCode: "ROW_NOT_FOUND", rowIndex: rowIndex };
  }

  var lastCol = Math.max(agSheet.getLastColumn(), 20);
  var row = agSheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var display = agSheet.getRange(rowIndex, 1, 1, lastCol).getDisplayValues()[0];

  var client = String(row[1] || "").trim();
  var procedure = String(row[4] || "").trim();
  var sheetDate = _cdsDateKey_(row[5], display[5]);
  var sheetTime = _cdsTimeKey_(row[6], display[6]);
  var statusNorm = _cdsNormalize_(row[8]);
  var appointmentId = String(row[9] || "").trim();
  var additionalIds = _cdsParseAdditionalIds_(row[13]);
  var serviceId = String(row[15] || "").trim();
  var colTEventId = String(row[19] || "").trim();

  var guard = _cdsClassifyGuard_(appointmentId, client, procedure, statusNorm);
  if (guard.skip) {
    return { status: guard.reason, rowIndex: rowIndex, appointmentId: appointmentId, eventId: colTEventId || null };
  }

  if (!colTEventId) {
    return {
      status: "SKIPPED_NO_COLUMN_T_ID",
      rowIndex: rowIndex,
      appointmentId: appointmentId,
      message: "Coluna T vazia: nenhum evento criado automaticamente para evitar duplicação."
    };
  }

  // Resolve ocorrência exata por Event ID + Data (fundamental para séries recorrentes no CalendarApp)
  var resolved = _cdsResolveEventOccurrence_(calendar, colTEventId, sheetDate, sheetTime, _cdsTimezone_());
  if (resolved.status === "AMBIGUOUS") {
    return {
      status: "ERROR",
      errorCode: "AMBIGUOUS_RECURRING_OCCURRENCE",
      rowIndex: rowIndex,
      appointmentId: appointmentId,
      eventId: colTEventId,
      date: sheetDate,
      message: "Mais de uma ocorrência encontrada para o mesmo Event ID e data; evento não alterado."
    };
  }
  var existingEvent = resolved.event;
  if (!existingEvent) {
    return {
      status: "SKIPPED_EVENT_NOT_FOUND_IN_CALENDAR",
      rowIndex: rowIndex,
      appointmentId: appointmentId,
      eventId: colTEventId,
      date: sheetDate,
      message: "Evento/ocorrência não encontrada no Google Calendar para a data informada (não recriado automaticamente)."
    };
  }
  if (existingEvent.isAllDayEvent()) {
    return { status: "SKIPPED_ALL_DAY_EVENT", rowIndex: rowIndex, appointmentId: appointmentId, eventId: colTEventId };
  }

  // Proteção absoluta: não tocar em bloqueios, folgas, férias, indisponibilidades, eventos pessoais/administrativos
  // nem em qualquer evento que não seja comprovadamente o agendamento da cliente vinculada.
  var clientEventCheck = _cdsVerifyConfirmedClientAppointmentEvent_(existingEvent, appointmentId, client);
  if (!clientEventCheck.confirmed) {
    return {
      status: clientEventCheck.reason,
      rowIndex: rowIndex,
      appointmentId: appointmentId,
      eventId: colTEventId,
      message: clientEventCheck.message
    };
  }

  // Protege eventos passados com base no horário oficial do Calendar
  var officialStart = existingEvent.getStartTime();
  if (officialStart.getTime() <= new Date().getTime()) {
    return { status: "SKIPPED_PAST", rowIndex: rowIndex, appointmentId: appointmentId, eventId: colTEventId };
  }

  var catalog = _cdsReadServicesCatalog_(ss);
  var lookup = _cdsResolveServiceDuration_(catalog, serviceId, procedure, additionalIds);
  if (!lookup.ok) {
    Logger.log("ERROR row " + rowIndex + ": " + lookup.message);
    return { status: "ERROR", errorCode: lookup.errorCode, rowIndex: rowIndex, appointmentId: appointmentId, eventId: colTEventId, message: lookup.message };
  }

  // Preserva integralmente data, horário inicial, título, descrição e demais dados; atualiza SOMENTE o horário final
  var targetEnd = new Date(officialStart.getTime() + lookup.durationMinutes * 60000);
  if (existingEvent.getEndTime().getTime() === targetEnd.getTime()) {
    return { status: "UNCHANGED", rowIndex: rowIndex, appointmentId: appointmentId, eventId: colTEventId, durationMinutes: lookup.durationMinutes };
  }

  _cdsMarkInternalSync_();
  existingEvent.setTime(officialStart, targetEnd);
  return {
    status: "UPDATED",
    rowIndex: rowIndex,
    appointmentId: appointmentId,
    eventId: colTEventId,
    durationMinutes: lookup.durationMinutes
  };
}

/**
 * Garante que EXATAMENTE os dois gatilhos autorizados estejam instalados (sem duplicidades):
 *  1) handleSpreadsheetEditForCalendarSync (From spreadsheet - On edit) -> Fluxo 2 (Duração -> Calendar)
 *  2) syncCalendarBookingsToSheet (Calendar - Changed) -> Fluxo 1 (Agendamentos legítimos Calendar -> Sheets)
 * Remove gatilhos legados (syncCalendarChangesToSheet) ou duplicados.
 */
function ensureFinalDualFlowTriggers() {
  var cfgAudit = auditCalendarDurationSyncConfig();
  if (!cfgAudit.configReady) {
    throw new Error("Configuração pendente: " + cfgAudit.blockers.join(" | "));
  }
  if (!_cdsIsWriteSyncEnabled_()) {
    throw new Error("Habilite CALENDAR_DURATION_SYNC_ENABLED='true' antes de instalar os gatilhos.");
  }

  var triggers = ScriptApp.getProjectTriggers();
  var editTriggerCount = 0;
  var calTriggerCount = 0;
  var removed = [];

  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === CDS_LEGACY_CALENDAR_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed.push(fn + " (legacy)");
    } else if (fn === CDS_EDIT_TRIGGER_HANDLER) {
      editTriggerCount++;
      if (editTriggerCount > 1) {
        ScriptApp.deleteTrigger(triggers[i]);
        removed.push(fn + " (duplicate)");
      }
    } else if (fn === CDS_CALENDAR_TRIGGER_HANDLER) {
      calTriggerCount++;
      if (calTriggerCount > 1) {
        ScriptApp.deleteTrigger(triggers[i]);
        removed.push(fn + " (duplicate)");
      }
    }
  }

  var installed = [];
  if (editTriggerCount === 0) {
    var ss = _cdsOpenOfficialSpreadsheet_(false);
    ScriptApp.newTrigger(CDS_EDIT_TRIGGER_HANDLER).forSpreadsheet(ss).onEdit().create();
    installed.push(CDS_EDIT_TRIGGER_HANDLER);
  }
  if (calTriggerCount === 0) {
    var cal = _cdsGetCalendar_();
    var calEmail = cal.getId();
    ScriptApp.newTrigger(CDS_CALENDAR_TRIGGER_HANDLER).forUserCalendar(calEmail).onEventUpdated().create();
    installed.push(CDS_CALENDAR_TRIGGER_HANDLER);
  }

  var finalTriggers = ScriptApp.getProjectTriggers().map(function(tr) {
    return {
      handlerFunction: tr.getHandlerFunction(),
      eventType: String(tr.getEventType()),
      triggerSource: String(tr.getTriggerSource())
    };
  });

  var result = {
    status: "success",
    installed: installed,
    removed: removed,
    totalActiveTriggers: finalTriggers.length,
    triggers: finalTriggers
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function installBidirectionalCalendarSyncTriggers() {
  return ensureFinalDualFlowTriggers();
}

function _cdsGetDurationException_(appointmentId) {
  if (appointmentId && Object.prototype.hasOwnProperty.call(CDS_AUTHORIZED_EXCEPTIONS.durationOverrideByAppointmentId, appointmentId)) {
    return CDS_AUTHORIZED_EXCEPTIONS.durationOverrideByAppointmentId[appointmentId];
  }
  return null;
}

function _cdsHasProtectedNonClientKeyword_(normalizedText) {
  if (!normalizedText) return false;
  var protectedTerms = [
    // Bloqueios e indisponibilidades
    "bloqueio", "bloqueado", "bloqueada", "agenda bloqueada", "horario bloqueado",
    "indisponivel", "indisponibilidade", "nao atender", "fechado", "fechada",
    // Folgas, férias e recessos
    "folga", "ferias", "recesso", "day off", "off",
    // Feriados
    "feriado", "holiday", "natal", "ano novo", "reveillon", "carnaval", "pascoa",
    "sexta feira santa", "tiradentes", "dia do trabalho", "corpus christi",
    "independencia", "nossa senhora aparecida", "finados", "proclamacao da republica",
    "consciencia negra",
    // Eventos pessoais e compromissos particulares
    "pessoal", "compromisso pessoal", "particular", "aniversario", "medico", "medica",
    "dentista", "consulta", "exame", "terapia", "academia", "pilates", "igreja",
    "culto", "viagem", "voo", "banco", "cartorio", "escola", "familia",
    // Administrativos, reuniões, pausas, almoço e manutenção predial/equipamento
    "administrativo", "administrativa", "reuniao", "meeting", "almoco", "lanche",
    "pausa", "intervalo", "treinamento", "curso", "contabilidade", "contador",
    "fornecedor", "faxina", "limpeza", "ar condicionado", "equipamento", "internet",
    "eletricista", "encanador", "manutencao predial", "manutencao do", "manutencao da",
    "conserto", "reparo", "entrega", "compra", "pagamento", "boleto", "imposto"
  ];
  for (var i = 0; i < protectedTerms.length; i++) {
    var re = new RegExp("(^|\\s)" + protectedTerms[i] + "(\\s|$)");
    if (re.test(normalizedText)) {
      return true;
    }
  }
  return false;
}

function _cdsVerifyConfirmedClientAppointmentEvent_(calendarEvent, appointmentId, clientName) {
  if (!calendarEvent) {
    return { confirmed: false, reason: "SKIPPED_EVENT_NOT_FOUND_IN_CALENDAR", message: "Evento não encontrado." };
  }
  if (calendarEvent.isAllDayEvent()) {
    return { confirmed: false, reason: "SKIPPED_ALL_DAY_EVENT", message: "Evento de dia inteiro protegido." };
  }

  var evTitleNorm = _cdsNormalize_(calendarEvent.getTitle());
  if (_cdsHasProtectedNonClientKeyword_(evTitleNorm)) {
    return {
      confirmed: false,
      reason: "SKIPPED_PROTECTED_NON_CLIENT_EVENT",
      message: "Evento protegido (bloqueio/folga/férias/indisponibilidade/pessoal/administrativo) — não alterado."
    };
  }

  var evDesc = String(calendarEvent.getDescription() || "");
  if (appointmentId && evDesc.indexOf(CDS_APT_TAG_PREFIX + appointmentId + "]") >= 0) {
    return { confirmed: true, matchedBy: "APPOINTMENT_ID_TAG" };
  }

  var clientNorm = _cdsNormalize_(clientName);
  if (!clientNorm) {
    return {
      confirmed: false,
      reason: "SKIPPED_NOT_CONFIRMED_CLIENT_APPOINTMENT",
      message: "Linha sem nome de cliente para confirmar identidade do evento."
    };
  }
  var tokens = clientNorm.split(" ").filter(function(t) { return t.length >= 3; });
  var matchedTokens = tokens.filter(function(tok) { return evTitleNorm.indexOf(tok) >= 0; }).length;
  if (tokens.length > 0 && matchedTokens >= 1) {
    return { confirmed: true, matchedBy: "CLIENT_NAME_TOKEN" };
  }

  return {
    confirmed: false,
    reason: "SKIPPED_NOT_CONFIRMED_CLIENT_APPOINTMENT",
    message: "Título do evento no Calendar não confirma vínculo inequívoco com a cliente — evento protegido."
  };
}

function _cdsClassifyGuard_(appointmentId, client, procedure, statusNorm) {
  if (!client && !appointmentId && !procedure) return { skip: true, reason: "EMPTY_ROW" };
  if (statusNorm === "cancelado" || statusNorm === "cancelada" || statusNorm === "cancelled" || statusNorm === "excluido") {
    return { skip: true, reason: "SKIPPED_CANCELLED" };
  }
  var procNorm = _cdsNormalize_(procedure);
  var clientNorm = _cdsNormalize_(client);
  if (_cdsHasProtectedNonClientKeyword_(statusNorm) ||
      _cdsHasProtectedNonClientKeyword_(procNorm) ||
      _cdsHasProtectedNonClientKeyword_(clientNorm)) {
    return { skip: true, reason: "SKIPPED_PROTECTED_NON_CLIENT_ROW" };
  }
  if (CDS_AUTHORIZED_EXCEPTIONS.excludeAppointmentIds.indexOf(appointmentId) >= 0 || statusNorm === "teste sistema" || appointmentId.indexOf("test-") === 0) {
    return { skip: true, reason: "SKIPPED_AUTHORIZED_EXCLUSION" };
  }
  if (CDS_AUTHORIZED_EXCEPTIONS.pendingReviewAppointmentIds.indexOf(appointmentId) >= 0) {
    return { skip: true, reason: "PENDING_HUMAN_REVIEW" };
  }
  if (_cdsGetDurationException_(appointmentId) !== null) {
    return { skip: true, reason: "AUTHORIZED_DURATION_EXCEPTION" };
  }
  return { skip: false };
}

/**
 * Resolve uma ocorrência exata no CalendarApp sem presumir que eventId seja único
 * entre ocorrências de uma série recorrente.
 * - Comportamento real do CalendarApp: todas as ocorrências de uma série recorrente
 *   compartilham o mesmo event.getId(); calendar.getEventById(id) retorna a série/primeira
 *   instância, enquanto calendar.getEvents(dayStart, dayEnd) retorna a ocorrência exata daquele dia
 *   e permite atualizar apenas aquela ocorrência via setTime() sem alterar as demais.
 */
function _cdsResolveEventOccurrence_(calendar, eventId, dateKey, timeKey, tz) {
  if (!eventId) return { status: "NOT_FOUND", event: null, isRecurring: false };
  var timeZone = tz || _cdsTimezone_();

  // 1. Busca pela combinação exata Event ID + Data da ocorrência (seguro para séries recorrentes)
  if (dateKey) {
    var dayEvents = calendar.getEvents(
      new Date(dateKey + "T00:00:00" + CDS_TZ_OFFSET),
      new Date(dateKey + "T23:59:59" + CDS_TZ_OFFSET)
    );
    var sameDayMatches = [];
    for (var i = 0; i < dayEvents.length; i++) {
      if (dayEvents[i].getId() === eventId) {
        sameDayMatches.push(dayEvents[i]);
      }
    }
    if (sameDayMatches.length === 1) {
      var isRec = false;
      try { isRec = !!sameDayMatches[0].isRecurringEvent(); } catch (e) {}
      return { status: "FOUND_BY_ID_AND_DATE", event: sameDayMatches[0], isRecurring: isRec };
    }
    if (sameDayMatches.length > 1) {
      if (timeKey) {
        var exactTimeMatches = sameDayMatches.filter(function(ev) {
          return Utilities.formatDate(ev.getStartTime(), timeZone, "HH:mm") === timeKey;
        });
        if (exactTimeMatches.length === 1) {
          var isRecT = false;
          try { isRecT = !!exactTimeMatches[0].isRecurringEvent(); } catch (e) {}
          return { status: "FOUND_BY_ID_DATE_AND_TIME", event: exactTimeMatches[0], isRecurring: isRecT };
        }
      }
      return { status: "AMBIGUOUS", event: null, isRecurring: true };
    }
  }

  // 2. Fallback seguro apenas para eventos NÃO recorrentes (ex.: evento único remarcado manualmente para outro dia)
  var byId = calendar.getEventById(eventId);
  if (byId) {
    var byIdRecurring = false;
    try { byIdRecurring = !!byId.isRecurringEvent(); } catch (e) {}
    if (!byIdRecurring) {
      return { status: "FOUND_NON_RECURRING_BY_ID", event: byId, isRecurring: false };
    }
    // É série recorrente, mas NÃO existe ocorrência na data informada: nunca confundir com outra data (ex.: 10/12 ou 07/01)!
    return { status: "RECURRING_OCCURRENCE_NOT_ON_DATE", event: null, isRecurring: true };
  }

  return { status: "NOT_FOUND", event: null, isRecurring: false };
}

function _cdsFindMatchingCalendarEvents_(apt, calendarEvents) {
  var matches = [];
  var clientNorm = _cdsNormalize_(apt.client);
  var procNorm = _cdsNormalize_(apt.procedure);
  var clientTokens = clientNorm.split(" ").filter(function(t) { return t.length >= 3; });
  var tag = apt.appointmentId ? CDS_APT_TAG_PREFIX + apt.appointmentId + "]" : "";

  if (apt.columnTEventId) {
    var sameIdEvents = [];
    for (var i = 0; i < calendarEvents.length; i++) {
      if (calendarEvents[i].id === apt.columnTEventId) {
        sameIdEvents.push(calendarEvents[i]);
      }
    }
    if (sameIdEvents.length > 0) {
      var anyRecurring = sameIdEvents.length > 1 || sameIdEvents.some(function(ev) { return !!ev.isRecurring; });
      if (!anyRecurring) {
        // Evento único (não recorrente): ID na Coluna T identifica exclusivamente o evento (mesmo se remarcado de data)
        return [{ event: sameIdEvents[0], matchType: "COLUMN_T_EVENT_ID" }];
      }
      // Série recorrente: identificar obrigatoriamente pela combinação Event ID + Data exata da ocorrência!
      var sameDate = sameIdEvents.filter(function(ev) { return ev.dateKey === apt.date; });
      if (sameDate.length === 1) {
        return [{ event: sameDate[0], matchType: "COLUMN_T_EVENT_ID_AND_DATE" }];
      }
      if (sameDate.length > 1) {
        var exactTime = sameDate.filter(function(ev) { return ev.timeKey === apt.time; });
        if (exactTime.length === 1) {
          return [{ event: exactTime[0], matchType: "COLUMN_T_EVENT_ID_DATE_AND_TIME" }];
        }
        return sameDate.map(function(ev) { return { event: ev, matchType: "COLUMN_T_RECURRING_AMBIGUOUS_SAME_DAY" }; });
      }
      // Nenhuma ocorrência desta série recorrente na data apt.date: nunca confundir com 10/12, 07/01 ou outras datas!
      return [];
    }
  }
  if (tag) {
    for (var j = 0; j < calendarEvents.length; j++) {
      if (calendarEvents[j].description.indexOf(tag) >= 0) {
        matches.push({ event: calendarEvents[j], matchType: "DESCRIPTION_APT_TAG" });
      }
    }
    if (matches.length > 0) return matches;
  }
  for (var k = 0; k < calendarEvents.length; k++) {
    var ev = calendarEvents[k];
    if (ev.dateKey !== apt.date) continue;
    var exactStart = ev.timeKey === apt.time;
    var overlap = clientTokens.filter(function(tok) { return ev.normalizedTitle.indexOf(tok) >= 0; }).length;
    var clientMatches = clientTokens.length > 0 && overlap >= Math.min(2, clientTokens.length);
    var procMatches = procNorm.length >= 5 && ev.normalizedTitle.indexOf(procNorm) >= 0;
    if (exactStart && (clientMatches || procMatches)) {
      matches.push({ event: ev, matchType: "EXACT_DATE_TIME_AND_TEXT" });
    } else if (!exactStart && clientMatches) {
      matches.push({ event: ev, matchType: "SAME_DAY_CLIENT_TIME_DIFFERS" });
    }
  }
  return matches;
}

function _cdsReadServicesCatalog_(ss) {
  var byId = {}, byTitle = {};
  var sheets = (typeof getServicesSheets === "function") ? getServicesSheets() : [];
  if (!sheets.length) {
    ["Serviços", "Servicos", "Depilação", "Depilacao"].forEach(function(tabName) {
      var sh = ss.getSheetByName(tabName);
      if (sh) sheets.push(sh);
    });
  }
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s];
    if (!sh || sh.getLastRow() < 2) continue;
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var id = String(values[i][0] || "").trim();
      var title = String(values[i][1] || "").trim();
      if (!id && !title) continue;
      var entry = {
        rowIndex: i + 1,
        sheetName: sh.getName(),
        id: id,
        title: title,
        normalizedTitle: _cdsNormalize_(title),
        rawDuration: values[i][5],
        durationMinutes: _cdsParseDurationMinutes_(values[i][5])
      };
      if (id) { byId[id] = byId[id] || []; byId[id].push(entry); }
      if (entry.normalizedTitle) { byTitle[entry.normalizedTitle] = byTitle[entry.normalizedTitle] || []; byTitle[entry.normalizedTitle].push(entry); }
    }
  }
  return { byId: byId, byTitle: byTitle };
}

function _cdsResolveServiceDuration_(catalog, serviceId, procedureTitle, additionalIds) {
  var normTitle = _cdsNormalize_(procedureTitle);
  var matched = null;
  var resolvedBy = null;

  if (serviceId) {
    var idList = catalog.byId[serviceId] || [];
    if (idList.length > 1) return { ok: false, errorCode: "AMBIGUOUS_SERVICE_MATCH", message: "ID duplicado em Serviços: " + serviceId };
    if (idList.length === 1) {
      if (normTitle && idList[0].normalizedTitle && idList[0].normalizedTitle !== normTitle) {
        var tList = catalog.byTitle[normTitle] || [];
        if (tList.length === 1) { matched = tList[0]; resolvedBy = "TITLE_OVERRIDE_AFTER_PROCEDURE_EDIT"; }
        else if (tList.length > 1) return { ok: false, errorCode: "AMBIGUOUS_SERVICE_MATCH", message: "Título ambíguo em Serviços: " + procedureTitle };
        else return { ok: false, errorCode: "SERVICE_NOT_FOUND", message: "Procedimento não encontrado em Serviços: " + procedureTitle };
      } else {
        matched = idList[0]; resolvedBy = "ID";
      }
    }
  }
  if (!matched && normTitle) {
    var titleList = catalog.byTitle[normTitle] || [];
    if (titleList.length > 1) return { ok: false, errorCode: "AMBIGUOUS_SERVICE_MATCH", message: "Título ambíguo em Serviços: " + procedureTitle };
    if (titleList.length === 1) { matched = titleList[0]; resolvedBy = "TITLE"; }
  }

  if (!matched) return { ok: false, errorCode: "SERVICE_NOT_FOUND", message: "Serviço não encontrado na aba Serviços." };
  if (matched.durationMinutes === null) return { ok: false, errorCode: "INVALID_DURATION", message: "Duração inválida em Serviços!F para " + matched.title };

  var total = matched.durationMinutes;
  for (var a = 0; a < additionalIds.length; a++) {
    var aList = catalog.byId[additionalIds[a]] || [];
    if (aList.length !== 1 || aList[0].durationMinutes === null) {
      return { ok: false, errorCode: "INVALID_DURATION", message: "Serviço adicional ausente ou sem duração válida em Serviços!F: " + additionalIds[a] };
    }
    total += aList[0].durationMinutes;
  }
  return { ok: true, service: matched, durationMinutes: total, resolvedBy: resolvedBy };
}

function _cdsParseDurationMinutes_(value) {
  if (value === null || value === undefined || value instanceof Date) return null;
  if (typeof value === "number") return (isFinite(value) && value > 0 && value <= 1440 && Math.floor(value) === value) ? value : null;
  var raw = String(value).trim();
  if (!raw || raw.indexOf("/") >= 0 || raw.indexOf("-") >= 0 || raw.indexOf(":") >= 0) return null;
  var m = /^(?:(\d+)\s*(?:h(?:oras?)?)(?:\s*(?:e\s*)?(?:(\d{1,2})\s*(?:min(?:utos?)?|m)?)?)?|(\d+)\s*(?:min(?:utos?)?|m)?)$/i.exec(raw.toLowerCase());
  if (!m) return null;
  var total = 0;
  if (m[1] !== undefined) {
    total += Number(m[1]) * 60;
    if (m[2] !== undefined) {
      if (Number(m[2]) >= 60) return null;
      total += Number(m[2]);
    }
  } else if (m[3] !== undefined) {
    total += Number(m[3]);
  }
  return (isFinite(total) && total > 0 && total <= 1440) ? total : null;
}

function _cdsNormalize_(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function _cdsDateKey_(raw, displayed) {
  if (typeof normalizeBookingDate === "function") {
    var normalized = normalizeBookingDate(raw);
    if (normalized) return normalized;
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) return Utilities.formatDate(raw, _cdsTimezone_(), "yyyy-MM-dd");
  var s = String(displayed || raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? br[3] + "-" + br[2] + "-" + br[1] : "";
}

function _cdsTimeKey_(raw, displayed) {
  if (typeof normalizeBookingTime === "function") {
    var normalized = normalizeBookingTime(raw);
    if (normalized) return normalized;
  }
  if (raw instanceof Date && !isNaN(raw.getTime())) return Utilities.formatDate(raw, _cdsTimezone_(), "HH:mm");
  var s = String(displayed || raw || "").trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? ("0" + m[1]).slice(-2) + ":" + m[2] : "";
}

function _cdsParseAdditionalIds_(raw) {
  try {
    var parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (e) {
    return [];
  }
}

/**
 * TESTE ISOLADO COMPLETO DOS 2 FLUXOS FINAIS (10/10 CENÁRIOS OBRIGATÓRIOS, AUTO-LIMPANTE).
 * Executa exclusivamente na janela futura isolada 2027-07-01..2027-07-22, sem tocar em nenhum
 * agendamento real (Linhas 1..24 permanecem 100% intocadas) e limpa 100% dos registros no finally.
 *
 * Cenários validados:
 *  1) Agendamento legítimo futuro criado diretamente no Calendar é inserido em Agendamentos.
 *  2) Agendamento já existente em Sheets é vinculado sem duplicar linha.
 *  3) Google Calendar Event ID correto é gravado na Coluna T.
 *  4) Segunda execução de syncCalendarBookingsToSheet não gera duplicidades.
 *  5) Alterar duração em Serviços!F (45 -> 60 -> 90 min) atualiza SOMENTE o horário final no Calendar.
 *  6) Horário de início, data, título e descrição no Calendar permanecem intactos.
 *  7) Série recorrente tratada individualmente por Event ID + Data (sem alterar ocorrência vizinha).
 *  8) Bloqueios, folgas, férias, feriados, dia inteiro, reuniões, almoço, pessoais e evento incerto permanecem intocados e não são importados.
 *  9) Dados existentes de cliente, pagamento, observações e linhas reais (16, 17, 19, 20, 23, 24) permanecem intactos.
 * 10) Idempotência total nas execuções repetidas de ambos os fluxos (zero duplicatas de linhas ou eventos).
 */
function runFinalDualFlowIsolatedTest() {
  if (!_cdsIsWriteSyncEnabled_()) {
    throw new Error("Habilite CALENDAR_DURATION_SYNC_ENABLED='true' antes de executar o teste isolado.");
  }
  var tz = _cdsTimezone_();
  var ss = _cdsOpenOfficialSpreadsheet_(false);
  var calendar = _cdsGetCalendar_();
  var agSheet = ss.getSheetByName("Agendamentos");
  var servSheet = ss.getSheetByName("Serviços") || ss.getSheetByName("Servicos");
  if (!agSheet || !servSheet) throw new Error("Abas Agendamentos/Serviços não encontradas.");

  var stamp = String(new Date().getTime());
  var allowPrefix = "ISOL" + stamp.slice(-6);
  var testServiceId = "sync-final-svc-" + stamp;
  var testServiceTitle = "Manicure Isolada " + allowPrefix;
  var existingAptId = "apt-final-existing-" + stamp;
  var recAptId = "apt-final-rec-" + stamp;

  var initialAgLastRow = agSheet.getLastRow();
  var initialServLastRow = servSheet.getLastRow();

  var watchedRows = [16, 17, 19, 20, 23, 24];
  var beforeSnapshot = {};
  for (var w = 0; w < watchedRows.length; w++) {
    var wr = watchedRows[w];
    if (wr <= initialAgLastRow) {
      beforeSnapshot[wr] = agSheet.getRange(wr, 1, 1, 20).getDisplayValues()[0].join("|");
    }
  }

  var createdEvents = [];
  var createdRecSeries = null;

  try {
    // 1. Inserir serviço isolado temporário em Serviços!F = "45 min" (inativo)
    var servLastCol = Math.max(servSheet.getLastColumn(), 8);
    var servRowData = new Array(servLastCol);
    for (var sc = 0; sc < servLastCol; sc++) servRowData[sc] = "";
    servRowData[0] = testServiceId;
    servRowData[1] = testServiceTitle;
    servRowData[2] = "manicure";
    servRowData[3] = 55;
    servRowData[4] = "R$ 55,00";
    servRowData[5] = "45 min";
    servRowData[7] = "Servico temporario isolado";
    if (servLastCol >= 12) servRowData[11] = false;
    var tempServRow = initialServLastRow + 1;
    servSheet.getRange(tempServRow, 1, 1, servLastCol).setValues([servRowData]);

    // 2. Criar eventos isolados na janela 2027-07-01..2027-07-22
    // 2a) Agendamento legítimo criado DIRETAMENTE no Calendar (sem linha na planilha)
    var directTitle = "Marina " + allowPrefix + " - " + testServiceTitle;
    var evDirect = calendar.createEvent(
      directTitle,
      new Date("2027-07-01T09:00:00" + CDS_TZ_OFFSET),
      new Date("2027-07-01T09:45:00" + CDS_TZ_OFFSET),
      { description: "Agendado direto no Calendar" }
    );
    createdEvents.push(evDirect);
    var directEventId = evDirect.getId();

    // 2b) Agendamento já existente na planilha (com dados de cliente/pagamento/observações preserváveis e Col T vazia inicialmente)
    var existingTitle = "Carla " + allowPrefix + " - " + testServiceTitle;
    var existingDesc = "Descricao original preservada\n" + CDS_APT_TAG_PREFIX + existingAptId + "]";
    var evExisting = calendar.createEvent(
      existingTitle,
      new Date("2027-07-02T10:00:00" + CDS_TZ_OFFSET),
      new Date("2027-07-02T10:45:00" + CDS_TZ_OFFSET),
      { description: existingDesc }
    );
    createdEvents.push(evExisting);
    var existingEventId = evExisting.getId();

    // 2c) Série recorrente semanal x2 (08/07 e 15/07 08:00-08:45)
    var recTitle = "Bianca " + allowPrefix + " - Manicure";
    createdRecSeries = calendar.createEventSeries(
      recTitle,
      new Date("2027-07-08T08:00:00" + CDS_TZ_OFFSET),
      new Date("2027-07-08T08:45:00" + CDS_TZ_OFFSET),
      CalendarApp.newRecurrence().addWeeklyRule().times(2)
    );
    var day08Events = calendar.getEvents(
      new Date("2027-07-08T00:00:00" + CDS_TZ_OFFSET),
      new Date("2027-07-08T23:59:59" + CDS_TZ_OFFSET)
    );
    var recEventId = "";
    for (var ri = 0; ri < day08Events.length; ri++) {
      if (day08Events[ri].getTitle() === recTitle) { recEventId = day08Events[ri].getId(); break; }
    }
    if (!recEventId) throw new Error("Falha ao localizar ocorrência 2027-07-08 da série recorrente isolada.");

    // 2d) Eventos PROTEGIDOS + evento incerto/ambíguo (NUNCA importar nem modificar)
    var evBlock = calendar.createEvent("Bloqueio Agenda " + allowPrefix, new Date("2027-07-03T09:00:00" + CDS_TZ_OFFSET), new Date("2027-07-03T10:00:00" + CDS_TZ_OFFSET));
    var evFolga = calendar.createEvent("Folga " + allowPrefix, new Date("2027-07-03T11:00:00" + CDS_TZ_OFFSET), new Date("2027-07-03T12:00:00" + CDS_TZ_OFFSET));
    var evFerias = calendar.createAllDayEvent("Férias " + allowPrefix, new Date("2027-07-04T00:00:00" + CDS_TZ_OFFSET));
    var evHoliday = calendar.createAllDayEvent("Feriado Nacional " + allowPrefix, new Date("2027-07-05T00:00:00" + CDS_TZ_OFFSET));
    var evMeeting = calendar.createEvent("Reunião Administrativa " + allowPrefix, new Date("2027-07-06T14:00:00" + CDS_TZ_OFFSET), new Date("2027-07-06T15:00:00" + CDS_TZ_OFFSET));
    var evLunch = calendar.createEvent("Almoço " + allowPrefix, new Date("2027-07-06T12:00:00" + CDS_TZ_OFFSET), new Date("2027-07-06T13:00:00" + CDS_TZ_OFFSET));
    var evPersonal = calendar.createEvent("Compromisso Pessoal " + allowPrefix, new Date("2027-07-06T16:00:00" + CDS_TZ_OFFSET), new Date("2027-07-06T17:00:00" + CDS_TZ_OFFSET));
    var evUncertain = calendar.createEvent("Recado avulso " + allowPrefix, new Date("2027-07-07T15:00:00" + CDS_TZ_OFFSET), new Date("2027-07-07T16:00:00" + CDS_TZ_OFFSET));
    createdEvents.push(evBlock, evFolga, evFerias, evHoliday, evMeeting, evLunch, evPersonal, evUncertain);

    // 3. Inserir 2 linhas pré-existentes na planilha:
    //    - Carla (sem Coluna T inicialmente, com telefone/email/sinal/observações para validar preservação!)
    //    - Bianca ocorrência 08/07 (vinculada ao testServiceId para validar atualização recorrente individual!)
    var agLastCol = Math.max(agSheet.getLastColumn(), 20);
    function buildAgRow(opts) {
      var arr = new Array(agLastCol);
      for (var k = 0; k < agLastCol; k++) arr[k] = "";
      arr[0] = new Date();
      arr[1] = opts.client;
      arr[2] = opts.phone || "";
      arr[3] = opts.email || "";
      arr[4] = opts.procedure;
      arr[5] = opts.date;
      arr[6] = opts.time;
      arr[7] = opts.payment !== undefined ? opts.payment : "";
      arr[8] = "confirmado";
      arr[9] = opts.aptId;
      arr[10] = opts.notes || "";
      arr[15] = opts.serviceId || "";
      arr[19] = opts.colT || "";
      return arr;
    }

    var rowExistingIdx = initialAgLastRow + 1;
    agSheet.getRange(rowExistingIdx, 1, 1, agLastCol).setValues([buildAgRow({
      client: "Carla " + allowPrefix,
      phone: "11999990000",
      email: "carla.isolada@example.com",
      procedure: testServiceTitle,
      date: "2027-07-02",
      time: "10:00",
      payment: "R$ 120,00",
      aptId: existingAptId,
      notes: "Cliente VIP historico preservado",
      serviceId: testServiceId,
      colT: ""
    })]);

    var rowRec08Idx = initialAgLastRow + 2;
    agSheet.getRange(rowRec08Idx, 1, 1, agLastCol).setValues([buildAgRow({
      client: "Bianca " + allowPrefix,
      procedure: testServiceTitle,
      date: "2027-07-08",
      time: "08:00",
      payment: "",
      aptId: recAptId,
      notes: "Ocorrencia 08/07 vinculada ao servico de teste",
      serviceId: testServiceId,
      colT: recEventId
    })]);
    SpreadsheetApp.flush();

    var rowsBeforeCalSync = agSheet.getLastRow(); // initialAgLastRow + 2

    // === FLUXO 1 (1ª execução): Calendar -> Sheets na janela isolada 2027-07-01..2027-07-22 ===
    var calSync1 = syncCalendarBookingsToSheet({
      dryRun: false,
      bypassLoopGuard: true,
      startDate: "2027-07-01",
      endDate: "2027-07-22",
      allowTestPrefix: allowPrefix,
      onlyTitleContaining: allowPrefix
    });

    var rowsAfterCalSync1 = agSheet.getLastRow();
    // Esperado: +2 novas linhas (Marina 01/07 + Bianca ocorrência 15/07); Carla 02/07 vinculada sem duplicar (Col T preenchida); Bianca 08/07 já vinculada.
    var importedRaw = rowsAfterCalSync1 > initialAgLastRow
      ? agSheet.getRange(initialAgLastRow + 1, 1, rowsAfterCalSync1 - initialAgLastRow, 20).getValues()
      : [];
    var importedDisp = rowsAfterCalSync1 > initialAgLastRow
      ? agSheet.getRange(initialAgLastRow + 1, 1, rowsAfterCalSync1 - initialAgLastRow, 20).getDisplayValues()
      : [];
    var importedBlock = [];
    for (var ib = 0; ib < importedRaw.length; ib++) {
      importedBlock.push({
        dateKey: _cdsDateKey_(importedRaw[ib][5], importedDisp[ib][5]),
        timeKey: _cdsTimeKey_(importedRaw[ib][6], importedDisp[ib][6]),
        colT: String(importedRaw[ib][19] || "").trim()
      });
    }

    var marinaRows = importedBlock.filter(function(r) { return r.colT === directEventId; });
    var carlaRows = importedBlock.filter(function(r) { return r.colT === existingEventId; });
    var bianca08Rows = importedBlock.filter(function(r) { return r.colT === recEventId && r.dateKey === "2027-07-08"; });
    var bianca15Rows = importedBlock.filter(function(r) { return r.colT === recEventId && r.dateKey === "2027-07-15"; });

    var protectedIds = [evBlock.getId(), evFolga.getId(), evFerias.getId(), evHoliday.getId(), evMeeting.getId(), evLunch.getId(), evPersonal.getId(), evUncertain.getId()];
    var anyProtectedImported = importedBlock.some(function(r) { return protectedIds.indexOf(r.colT) >= 0; });
    var uncertainReported = calSync1.needsAdminReview.some(function(item) { return item.eventId === evUncertain.getId(); });

    // === FLUXO 1 (2ª execução — Idempotência / 0 duplicatas) ===
    var calSync2 = syncCalendarBookingsToSheet({
      dryRun: false,
      bypassLoopGuard: true,
      startDate: "2027-07-01",
      endDate: "2027-07-22",
      allowTestPrefix: allowPrefix,
      onlyTitleContaining: allowPrefix
    });
    var rowsAfterCalSync2 = agSheet.getLastRow();

    // Verifica preservação integral dos dados existentes de Carla (telefone, email, pagamento, observações)
    var carlaAfterVals = agSheet.getRange(rowExistingIdx, 1, 1, 20).getDisplayValues()[0];
    var carlaDataPreserved =
      carlaAfterVals[1] === "Carla " + allowPrefix &&
      String(carlaAfterVals[2]).replace(/\D/g, "") === "11999990000" &&
      carlaAfterVals[3] === "carla.isolada@example.com" &&
      String(carlaAfterVals[7]).indexOf("120") >= 0 &&
      carlaAfterVals[10] === "Cliente VIP historico preservado" &&
      String(carlaAfterVals[19]).trim() === existingEventId;

    // === FLUXO 2 (Serviços!F -> Calendar end time ONLY): 45 min -> 60 min -> 90 min ===
    servSheet.getRange(tempServRow, 6).setValue("60 min");
    SpreadsheetApp.flush();
    var durRun60 = syncFutureAppointmentsForServiceDurationChange(testServiceId, testServiceTitle, { source: "final_test_60" });

    var evExisting60 = calendar.getEventById(existingEventId);
    var evDirect60 = calendar.getEventById(directEventId);
    var ex60Start = Utilities.formatDate(evExisting60.getStartTime(), tz, "HH:mm");
    var ex60End = Utilities.formatDate(evExisting60.getEndTime(), tz, "HH:mm");
    var dir60Start = Utilities.formatDate(evDirect60.getStartTime(), tz, "HH:mm");
    var dir60End = Utilities.formatDate(evDirect60.getEndTime(), tz, "HH:mm");

    servSheet.getRange(tempServRow, 6).setValue("90 min");
    SpreadsheetApp.flush();
    var durRun90 = syncFutureAppointmentsForServiceDurationChange(testServiceId, testServiceTitle, { source: "final_test_90" });

    var evExisting90 = calendar.getEventById(existingEventId);
    var ex90Date = Utilities.formatDate(evExisting90.getStartTime(), tz, "yyyy-MM-dd");
    var ex90Start = Utilities.formatDate(evExisting90.getStartTime(), tz, "HH:mm");
    var ex90End = Utilities.formatDate(evExisting90.getEndTime(), tz, "HH:mm");
    var ex90Title = evExisting90.getTitle();
    var ex90Desc = evExisting90.getDescription();

    // Verifica série recorrente: 08/07 (vinculada a testServiceId) atualizada para 90 min (08:00-09:30);
    // vizinha 15/07 (importada com procedimento "Manicure", não testServiceId) permanece INTACTA em 08:00-08:45!
    var recOcc08 = _cdsResolveEventOccurrence_(calendar, recEventId, "2027-07-08", "08:00", tz).event;
    var recOcc15 = _cdsResolveEventOccurrence_(calendar, recEventId, "2027-07-15", "08:00", tz).event;
    var rec08Span = Utilities.formatDate(recOcc08.getStartTime(), tz, "HH:mm") + "-" + Utilities.formatDate(recOcc08.getEndTime(), tz, "HH:mm");
    var rec15Span = Utilities.formatDate(recOcc15.getStartTime(), tz, "HH:mm") + "-" + Utilities.formatDate(recOcc15.getEndTime(), tz, "HH:mm");

    // 2ª execução de duração com 90 min -> Idempotência (0 updates, 0 duplicatas)
    var durRun90Repeat = syncFutureAppointmentsForServiceDurationChange(testServiceId, testServiceTitle, { source: "final_test_idem" });
    var day02EventCount = calendar.getEvents(
      new Date("2027-07-02T00:00:00" + CDS_TZ_OFFSET),
      new Date("2027-07-02T23:59:59" + CDS_TZ_OFFSET)
    ).filter(function(e) { return e.getTitle() === existingTitle; }).length;

    // Verifica integridade dos eventos protegidos no Calendar
    var protectedCalIntact =
      Utilities.formatDate(calendar.getEventById(evBlock.getId()).getStartTime(), tz, "HH:mm") === "09:00" &&
      Utilities.formatDate(calendar.getEventById(evBlock.getId()).getEndTime(), tz, "HH:mm") === "10:00" &&
      Utilities.formatDate(calendar.getEventById(evFolga.getId()).getEndTime(), tz, "HH:mm") === "12:00" &&
      calendar.getEventById(evFerias.getId()).isAllDayEvent() === true &&
      calendar.getEventById(evHoliday.getId()).isAllDayEvent() === true &&
      Utilities.formatDate(calendar.getEventById(evMeeting.getId()).getEndTime(), tz, "HH:mm") === "15:00" &&
      Utilities.formatDate(calendar.getEventById(evLunch.getId()).getEndTime(), tz, "HH:mm") === "13:00" &&
      Utilities.formatDate(calendar.getEventById(evPersonal.getId()).getEndTime(), tz, "HH:mm") === "17:00" &&
      Utilities.formatDate(calendar.getEventById(evUncertain.getId()).getEndTime(), tz, "HH:mm") === "16:00";

    // Verifica integridade das linhas reais 16, 17, 19, 20, 23, 24
    var realRowsIntact = true;
    var realRowDiffs = [];
    for (var c = 0; c < watchedRows.length; c++) {
      var cr = watchedRows[c];
      if (cr <= initialAgLastRow) {
        if (agSheet.getRange(cr, 1, 1, 20).getDisplayValues()[0].join("|") !== beforeSnapshot[cr]) {
          realRowsIntact = false;
          realRowDiffs.push(cr);
        }
      }
    }

    var report = {
      status: "success",
      checks: {
        test1_directCalendarBookingInserted: marinaRows.length === 1 && marinaRows[0].dateKey === "2027-07-01" && marinaRows[0].timeKey === "09:00",
        test2_existingSheetBookingMatchedNotDuplicated: carlaRows.length === 1 && rowsAfterCalSync1 === rowsBeforeCalSync + 2,
        test3_correctEventIdStoredInColumnT: marinaRows.length === 1 && marinaRows[0].colT === directEventId && String(carlaAfterVals[19]).trim() === existingEventId && bianca08Rows.length === 1 && bianca15Rows.length === 1,
        test4_secondSyncZeroDuplicates: calSync2.counts.newlyImported === 0 && calSync2.counts.updatedExistingRows === 0 && rowsAfterCalSync2 === rowsAfterCalSync1,
        test5_durationChangeUpdatesEndTimeOnly: ex60End === "11:00" && dir60End === "10:00" && ex90End === "11:30",
        test6_calendarStartTimePreserved: ex90Date === "2027-07-02" && ex60Start === "10:00" && ex90Start === "10:00" && dir60Start === "09:00" && ex90Title === existingTitle && ex90Desc === existingDesc,
        test7_recurringHandledIndividuallyNeighborUntouched: bianca08Rows.length === 1 && bianca15Rows.length === 1 && rec08Span === "08:00-09:30" && rec15Span === "08:00-08:45",
        test8_protectedAndUncertainNotImportedOrModified: !anyProtectedImported && protectedCalIntact && calSync1.counts.skippedProtectedEvents >= 7 && uncertainReported,
        test9_existingCustomerPaymentHistoryAndRealRowsPreserved: carlaDataPreserved && realRowsIntact,
        test10_fullIdempotencyBothFlows: calSync2.counts.newlyImported === 0 && durRun90Repeat.updated === 0 && durRun90Repeat.unchanged === 3 && day02EventCount === 1
      },
      details: {
        calSync1Counts: calSync1.counts,
        calSync2Counts: calSync2.counts,
        existingAfter60: ex60Start + "-" + ex60End,
        existingAfter90: ex90Start + "-" + ex90End,
        directImportedAfter60: dir60Start + "-" + dir60End,
        recurring08After90: rec08Span,
        recurring15NeighborIntact: rec15Span,
        durRun60: { updated: durRun60.updated, unchanged: durRun60.unchanged, errors: durRun60.errors },
        durRun90: { updated: durRun90.updated, unchanged: durRun90.unchanged, errors: durRun90.errors },
        durRun90Repeat: { updated: durRun90Repeat.updated, unchanged: durRun90Repeat.unchanged, errors: durRun90Repeat.errors },
        day02EventCount: day02EventCount,
        realRowDiffs: realRowDiffs
      },
      allPassed: false,
      cleanupCompleted: false
    };
    report.allPassed = Object.keys(report.checks).every(function(k) { return report.checks[k] === true; });

    // Limpeza completa de 100% dos eventos e linhas temporárias
    for (var ce = 0; ce < createdEvents.length; ce++) {
      try { createdEvents[ce].deleteEvent(); } catch (e) {}
    }
    createdEvents = [];
    if (createdRecSeries) { try { createdRecSeries.deleteEventSeries(); createdRecSeries = null; } catch (e) {} }

    var curAgLast = agSheet.getLastRow();
    if (curAgLast > initialAgLastRow) {
      agSheet.deleteRows(initialAgLastRow + 1, curAgLast - initialAgLastRow);
    }
    var curServLast = servSheet.getLastRow();
    if (curServLast > initialServLastRow) {
      servSheet.deleteRows(initialServLastRow + 1, curServLast - initialServLastRow);
    }
    SpreadsheetApp.flush();
    report.cleanupCompleted = (agSheet.getLastRow() === initialAgLastRow && servSheet.getLastRow() === initialServLastRow);

    Logger.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    for (var fce = 0; fce < createdEvents.length; fce++) {
      try { createdEvents[fce].deleteEvent(); } catch (e) {}
    }
    if (createdRecSeries) { try { createdRecSeries.deleteEventSeries(); } catch (e) {} }
    try {
      var remAg = agSheet.getLastRow();
      if (remAg > initialAgLastRow) agSheet.deleteRows(initialAgLastRow + 1, remAg - initialAgLastRow);
    } catch (e) {}
    try {
      var remServ = servSheet.getLastRow();
      if (remServ > initialServLastRow) servSheet.deleteRows(initialServLastRow + 1, remServ - initialServLastRow);
    } catch (e) {}
    try { SpreadsheetApp.flush(); } catch (e) {}
  }
}

/**
 * DIAGNÓSTICO 100% SOMENTE LEITURA:
 * Compara lado a lado Painel (Code.gs getServiceDurationMinutes) x Sheets (Serviços!F) x Google Calendar
 * para hoje e todos os agendamentos futuros vinculados.
 */
function diagnosePanelSheetsCalendarAlignment() {
  var tz = _cdsTimezone_();
  var nowObj = new Date();
  var todayKey = Utilities.formatDate(nowObj, tz, "yyyy-MM-dd");
  var ss = _cdsOpenOfficialSpreadsheet_(true);
  var agSheet = ss.getSheetByName("Agendamentos");
  var calendar = _cdsGetCalendar_();
  var catalog = _cdsReadServicesCatalog_(ss);

  var todayCalEvents = calendar.getEvents(
    new Date(todayKey + "T00:00:00" + CDS_TZ_OFFSET),
    new Date(todayKey + "T23:59:59" + CDS_TZ_OFFSET)
  ).map(function(ev) {
    var durMin = Math.round((ev.getEndTime().getTime() - ev.getStartTime().getTime()) / 60000);
    return {
      eventId: ev.getId(),
      title: ev.getTitle(),
      start: Utilities.formatDate(ev.getStartTime(), tz, "HH:mm"),
      end: Utilities.formatDate(ev.getEndTime(), tz, "HH:mm"),
      calendarDurationMin: durMin,
      allDay: ev.isAllDayEvent(),
      recurring: (function() { try { return !!ev.isRecurringEvent(); } catch (e) { return false; } })()
    };
  });

  var endObj = new Date(nowObj.getTime());
  endObj.setDate(endObj.getDate() + 365);
  var endKey = Utilities.formatDate(endObj, tz, "yyyy-MM-dd");
  var allFutureCal = calendar.getEvents(
    new Date(todayKey + "T00:00:00" + CDS_TZ_OFFSET),
    new Date(endKey + "T23:59:59" + CDS_TZ_OFFSET)
  );
  var calDurByIdAndDate = {};
  for (var ce = 0; ce < allFutureCal.length; ce++) {
    var cev = allFutureCal[ce];
    var cDate = Utilities.formatDate(cev.getStartTime(), tz, "yyyy-MM-dd");
    var cDur = Math.round((cev.getEndTime().getTime() - cev.getStartTime().getTime()) / 60000);
    calDurByIdAndDate[cev.getId() + "|" + cDate] = {
      title: cev.getTitle(),
      start: Utilities.formatDate(cev.getStartTime(), tz, "HH:mm"),
      end: Utilities.formatDate(cev.getEndTime(), tz, "HH:mm"),
      durMin: cDur
    };
  }

  var lastRow = agSheet.getLastRow();
  var lastCol = Math.max(agSheet.getLastColumn(), 20);
  var vals = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var disp = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];

  var todaySheetRows = [];
  var patternCounts = {};
  var unmatchedRows = [];

  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    var d = disp[i];
    var rowNum = i + 1;
    var client = String(r[1] || "").trim();
    var proc = String(r[4] || "").trim();
    var dateKey = _cdsDateKey_(r[5], d[5]);
    var timeKey = _cdsTimeKey_(r[6], d[6]);
    var statusNorm = _cdsNormalize_(r[8]);
    var aptId = String(r[9] || "").trim();
    var svcId = String(r[15] || "").trim();
    var addIds = _cdsParseAdditionalIds_(r[13]);
    var colT = String(r[19] || "").trim();

    if (!dateKey || dateKey < todayKey) continue;
    if (statusNorm === "cancelado" || statusNorm === "cancelada" || statusNorm === "bloqueado") continue;

    var codeGsDur = (typeof getServiceDurationMinutes === "function")
      ? getServiceDurationMinutes(svcId, proc)
      : null;
    var lookupDirect = _cdsResolveServiceDuration_(catalog, svcId, proc, addIds);
    var alias = (!lookupDirect.ok) ? _cdsMatchCatalogAlias_(proc, catalog) : null;
    var aliasDur = null;
    if (alias) {
      var aliasLookup = _cdsResolveServiceDuration_(catalog, alias.mainService.id, alias.mainService.title, alias.additionalServiceIds);
      if (aliasLookup.ok) aliasDur = aliasLookup.durationMinutes;
    }

    var calInfo = colT ? (calDurByIdAndDate[colT + "|" + dateKey] || null) : null;
    var targetDur = lookupDirect.ok ? lookupDirect.durationMinutes : aliasDur;
    var targetSvcId = lookupDirect.ok ? lookupDirect.service.id : (alias ? alias.mainService.id : "");

    if (dateKey === todayKey) {
      todaySheetRows.push({
        row: rowNum,
        aptId: aptId,
        client: client,
        procedureColE: proc,
        serviceIdColP: svcId || "(vazio)",
        timeColG: timeKey,
        colT: colT,
        codeGsDurMin: codeGsDur,
        officialTargetSvcId: targetSvcId || "(sem match)",
        officialTargetDurMin: targetDur,
        calendarActual: calInfo
      });
    }

    var pKey = "E='" + proc + "' | P='" + (svcId || "") + "' -> target=" + (targetSvcId || "NONE") + "(" + (targetDur || "?") + "m) | cal=" + (calInfo ? calInfo.durMin + "m" : "none");
    patternCounts[pKey] = (patternCounts[pKey] || 0) + 1;

    if (!targetSvcId && unmatchedRows.length < 15) {
      unmatchedRows.push({ row: rowNum, date: dateKey, time: timeKey, client: client, proc: proc, calTitle: calInfo ? calInfo.title : "", calDurMin: calInfo ? calInfo.durMin : null });
    }
  }

  var report = {
    status: "success",
    readOnly: true,
    today: todayKey,
    todayCalendarEvents: todayCalEvents,
    todaySheetRows: todaySheetRows,
    futurePatterns: Object.keys(patternCounts).map(function(k) { return k + " (x" + patternCounts[k] + ")"; }),
    unmatchedRows: unmatchedRows
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Prévia completa em DRY-RUN (100% somente leitura) que registra em blocos sem truncamento
 * todas as linhas elegíveis (163+) com Coluna T, data, início, fim atual e fim esperado.
 */
function exportProposedAlignmentListDryRun() {
  return reconcileServiceLinksAndAlignCalendar({
    dryRun: true,
    alignCalendar: true,
    authorizedCancelRow191: true,
    logFullListChunked: true
  });
}

/**
 * Wrapper autorizado pelo administrador para execução direta no editor do Apps Script:
 * - Altera SOMENTE Agendamentos!I191 para "cancelado" após revalidar ID apt-gcal-66dd8c3ccf9bed60 e ausência no Calendar (não apaga a linha).
 * - Vincula Coluna P (ID Serviço Principal), Coluna E (título oficial) e Coluna N (adicionais) em todas as
 *   linhas apt-gcal-* futuras com alias inequívoco no catálogo Serviços/Depilação (incl. Josefina e Kristine "Mão" -> manicure-tradicional 45 min).
 * - Alinha SOMENTE o horário final (setTime) dos eventos futuros confirmados no Google Calendar conforme Serviços!F,
 *   preservando integralmente início, data, título, descrição, Coluna T, exceções autorizadas (Linhas 16=150m e 17=90m),
 *   Linhas 20/24, Linha 23, eventos passados e todos os eventos protegidos.
 */
function runAuthorizedServiceLinkAndCalendarAlignment() {
  return reconcileServiceLinksAndAlignCalendar({
    dryRun: false,
    alignCalendar: true,
    authorizedCancelRow191: true,
    logFullListChunked: true
  });
}

function reconcileServiceLinksAndAlignCalendar(options) {
  options = options || {};
  var dryRun = options.dryRun !== false;
  var alignCalendar = options.alignCalendar === true;
  var authorizedCancelRow191 = options.authorizedCancelRow191 === true;
  var logFullListChunked = options.logFullListChunked === true;

  var tz = _cdsTimezone_();
  var nowObj = new Date();
  var nowMs = nowObj.getTime();
  var todayKey = Utilities.formatDate(nowObj, tz, "yyyy-MM-dd");
  var endObj = new Date(nowMs);
  endObj.setDate(endObj.getDate() + 365);
  var endKey = Utilities.formatDate(endObj, tz, "yyyy-MM-dd");

  var ss = _cdsOpenOfficialSpreadsheet_(dryRun);
  var agSheet = ss.getSheetByName("Agendamentos");
  var calendar = _cdsGetCalendar_();
  var catalog = _cdsReadServicesCatalog_(ss);

  // Pré-indexa ocorrências futuras do Calendar por EventID|Data (evita chamadas redundantes por linha)
  var allFutureEvents = calendar.getEvents(
    new Date(todayKey + "T00:00:00" + CDS_TZ_OFFSET),
    new Date(endKey + "T23:59:59" + CDS_TZ_OFFSET)
  );
  var eventsByIdAndDate = {};
  for (var ce = 0; ce < allFutureEvents.length; ce++) {
    var cev = allFutureEvents[ce];
    var cDate = Utilities.formatDate(cev.getStartTime(), tz, "yyyy-MM-dd");
    var cKey = cev.getId() + "|" + cDate;
    eventsByIdAndDate[cKey] = eventsByIdAndDate[cKey] || [];
    eventsByIdAndDate[cKey].push(cev);
  }

  var lastRow = agSheet.getLastRow();
  var lastCol = Math.max(agSheet.getLastColumn(), 20);
  var vals = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var disp = lastRow > 0 ? agSheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];

  var colEOut = [];
  var colNOut = [];
  var colPOut = [];
  for (var initIdx = 1; initIdx < vals.length; initIdx++) {
    colEOut.push([vals[initIdx][4]]);
    colNOut.push([vals[initIdx][13]]);
    colPOut.push([vals[initIdx][15]]);
  }

  var row191Status = "NOT_MODIFIED";
  var linkedRowsUpdated = 0;
  var calendarEventsUpdated = 0;
  var calendarEventsUnchanged = 0;
  var skippedPastOrInProgress = 0;
  var skippedExceptionsOrProtected = 0;
  var fullChangeLines = [];

  if (!dryRun) _cdsMarkInternalSync_();

  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    var d = disp[i];
    var outIdx = i - 1;
    var rowNum = i + 1;
    var client = String(r[1] || "").trim();
    var proc = String(r[4] || "").trim();
    var dateKey = _cdsDateKey_(r[5], d[5]);
    var timeKey = _cdsTimeKey_(r[6], d[6]);
    var statusNorm = _cdsNormalize_(r[8]);
    var aptId = String(r[9] || "").trim();
    var addIds = _cdsParseAdditionalIds_(r[13]);
    var svcId = String(r[15] || "").trim();
    var colT = String(r[19] || "").trim();

    // 0. Autorização estrita exclusiva para Linha 191 (apt-gcal-66dd8c3ccf9bed60, órfã comprovada)
    if (authorizedCancelRow191 &&
        rowNum === 191 &&
        aptId === "apt-gcal-66dd8c3ccf9bed60" &&
        _cdsIsGenericNonClientLabel_(_cdsNormalize_(client)) &&
        (!colT || !eventsByIdAndDate[colT + "|" + dateKey])) {
      if (statusNorm === "cancelado") {
        row191Status = "ALREADY_CANCELLED";
      } else {
        if (!dryRun) {
          agSheet.getRange(191, 9).setValue("cancelado");
        }
        row191Status = dryRun ? "WOULD_CANCEL_I191" : "CANCELLED_I191";
      }
      continue;
    }

    if (!dateKey || dateKey < todayKey) continue;

    var guard = _cdsClassifyGuard_(aptId, client, proc, statusNorm);
    if (guard.skip) { skippedExceptionsOrProtected++; continue; }

    var resolvedSvcId = svcId;
    var resolvedProc = proc;
    var resolvedAddIds = addIds;
    var rowLinked = false;

    // 1. Vincular Col P / Col E / Col N em linhas apt-gcal-* sem serviceId (nunca sobrescreve ID válido existente)
    if (!svcId && aptId.indexOf("apt-gcal-") === 0) {
      var alias = _cdsMatchCatalogAlias_(proc, catalog);
      if (alias) {
        resolvedSvcId = alias.mainService.id;
        resolvedProc = alias.mainService.title;
        resolvedAddIds = alias.additionalServiceIds || [];
        colEOut[outIdx] = [resolvedProc];
        colPOut[outIdx] = [resolvedSvcId];
        if (resolvedAddIds.length > 0) {
          colNOut[outIdx] = [JSON.stringify(resolvedAddIds)];
        }
        linkedRowsUpdated++;
        rowLinked = true;
      }
    }

    // 2. Alinhar SOMENTE o término no Calendar conforme Serviços!F (por Coluna T + data exata da ocorrência)
    var calAction = "NONE";
    var startStr = timeKey;
    var oldEndStr = "-";
    var newEndStr = "-";
    var targetDurMin = null;

    if (alignCalendar && colT && resolvedSvcId) {
      var lookup = _cdsResolveServiceDuration_(catalog, resolvedSvcId, resolvedProc, resolvedAddIds);
      if (lookup.ok) {
        targetDurMin = lookup.durationMinutes;
        var occList = eventsByIdAndDate[colT + "|" + dateKey] || [];
        var ev = null;
        if (occList.length === 1) {
          ev = occList[0];
        } else if (occList.length > 1 && timeKey) {
          var exactTime = occList.filter(function(cand) {
            return Utilities.formatDate(cand.getStartTime(), tz, "HH:mm") === timeKey;
          });
          if (exactTime.length === 1) ev = exactTime[0];
        }
        if (ev) {
          var clientCheck = _cdsVerifyConfirmedClientAppointmentEvent_(ev, aptId, client);
          if (!clientCheck.confirmed) {
            skippedExceptionsOrProtected++;
            calAction = "PROTECTED_SKIPPED";
          } else {
            var officialStart = ev.getStartTime();
            startStr = Utilities.formatDate(officialStart, tz, "HH:mm");
            oldEndStr = Utilities.formatDate(ev.getEndTime(), tz, "HH:mm");
            if (officialStart.getTime() <= nowMs) {
              skippedPastOrInProgress++;
              calAction = "PAST_SKIPPED";
            } else {
              var targetEnd = new Date(officialStart.getTime() + lookup.durationMinutes * 60000);
              newEndStr = Utilities.formatDate(targetEnd, tz, "HH:mm");
              if (ev.getEndTime().getTime() === targetEnd.getTime()) {
                calendarEventsUnchanged++;
                calAction = "CAL_UNCHANGED";
              } else {
                if (!dryRun) {
                  _cdsMarkInternalSync_();
                  ev.setTime(officialStart, targetEnd);
                }
                calendarEventsUpdated++;
                calAction = dryRun ? "CAL_WOULD_UPDATE" : "CAL_UPDATED";
              }
            }
          }
        }
      }
    }

    if (rowLinked || calAction === "CAL_UPDATED" || calAction === "CAL_WOULD_UPDATE") {
      fullChangeLines.push(
        "R" + rowNum + "|" + dateKey + " " + startStr + "|" + client + "|" +
        resolvedSvcId + "(" + (targetDurMin || "?") + "m)|" +
        oldEndStr + "->" + newEndStr + "|" + calAction + "|" + colT
      );
    }
  }

  // Gravação em lote na planilha (Colunas E, N, P — preservando todas as demais colunas e Coluna T)
  if (!dryRun && colEOut.length > 0 && linkedRowsUpdated > 0) {
    _cdsMarkInternalSync_();
    agSheet.getRange(2, 5, colEOut.length, 1).setValues(colEOut);
    agSheet.getRange(2, 14, colNOut.length, 1).setValues(colNOut);
    agSheet.getRange(2, 16, colPOut.length, 1).setValues(colPOut);
    SpreadsheetApp.flush();
  } else if (!dryRun && row191Status === "CANCELLED_I191") {
    SpreadsheetApp.flush();
  }

  if (logFullListChunked && fullChangeLines.length > 0) {
    var chunkSize = 35;
    for (var ch = 0; ch < fullChangeLines.length; ch += chunkSize) {
      var partNum = Math.floor(ch / chunkSize) + 1;
      var totalParts = Math.ceil(fullChangeLines.length / chunkSize);
      Logger.log(
        "ALIGNMENT_LIST_PART " + partNum + "/" + totalParts + " (" +
        (ch + 1) + ".." + Math.min(ch + chunkSize, fullChangeLines.length) + " of " + fullChangeLines.length + "):\n" +
        fullChangeLines.slice(ch, ch + chunkSize).join("\n")
      );
    }
  }

  var result = {
    status: "success",
    dryRun: dryRun,
    alignCalendar: alignCalendar,
    row191Status: row191Status,
    linkedRowsUpdated: linkedRowsUpdated,
    calendarEventsUpdated: calendarEventsUpdated,
    calendarEventsUnchanged: calendarEventsUnchanged,
    skippedPastOrInProgress: skippedPastOrInProgress,
    skippedExceptionsOrProtected: skippedExceptionsOrProtected,
    totalListedChanges: fullChangeLines.length
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
