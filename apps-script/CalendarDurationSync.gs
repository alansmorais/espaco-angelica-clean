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
var CDS_CALENDAR_TRIGGER_HANDLER = "syncCalendarChangesToSheet";
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
    calendarEvents.push({
      id: evId,
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
    configAudit: configAudit,
    summary: {
      1_totalFutureAppointments: futureAppointments.length,
      2_uniqueMatches: uniqueMatches.length,
      3_unmatchedCalendarEvents: unmatchedCalendarEvents.length,
      4_appointmentsWithoutEvent: appointmentsWithoutEvent.length,
      5_ambiguousMatches: ambiguousMatches.length,
      6_ignoredByExceptions: ignoredByExceptions.length,
      7_safeToUpdate: safeToUpdate.length,
      8_duplicateRiskRecords: duplicateRiskRecords.length,
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
 * 4. SENTIDO CALENDAR -> SHEETS:
 * Sincroniza alterações feitas diretamente no Google Calendar para a aba Agendamentos.
 * - Atualiza Coluna F (Data) e Coluna G (Horário inicial) com a verdade oficial do Calendar.
 * - Preserva cliente, pagamento, serviços e Coluna T.
 * - NUNCA altera Serviços!F por causa de edição individual de evento.
 * - Se um evento vinculado em Coluna T foi excluído/cancelado no Calendar, marca a linha como "cancelado"
 *   preservando a linha e o histórico (nunca apaga linha; não cancela exceções autorizadas).
 * - Detecta e cancela duplicidades inequívocas na planilha (Calendar prevalece; idempotente).
 */
function syncCalendarChangesToSheet(options) {
  options = options || {};
  var dryRun = options.dryRun === true || !_cdsIsWriteSyncEnabled_();

  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return { status: "error", errorCode: "LOCK_TIMEOUT" }; }

  try {
    var tz = _cdsTimezone_();
    var ss = _cdsOpenOfficialSpreadsheet_(dryRun);
    var agSheet = ss.getSheetByName("Agendamentos");
    if (!agSheet || agSheet.getLastRow() < 2) return { status: "success", dryRun: dryRun, updated: 0, cancelled: 0, duplicatesCancelled: 0, logs: [] };
    var calendar = _cdsGetCalendar_();

    var lastRow = agSheet.getLastRow();
    var lastCol = Math.max(agSheet.getLastColumn(), 20);
    var values = agSheet.getRange(1, 1, lastRow, lastCol).getValues();
    var display = agSheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    var nowMs = new Date().getTime();

    var seenEventOwnerRow = {}; // eventId -> first authoritative active row
    var updated = 0, cancelled = 0, duplicatesCancelled = 0, skipped = 0;
    var logs = [];

    if (!dryRun) _cdsMarkInternalSync_();

    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      var d = display[i];
      var rowNum = i + 1;

      var client = String(r[1] || "").trim();
      var procedure = String(r[4] || "").trim();
      var statusNorm = _cdsNormalize_(r[8]);
      var appointmentId = String(r[9] || "").trim();
      var colTEventId = String(r[19] || "").trim();

      if (!colTEventId) continue; // Somente registros inequivocamente vinculados em Coluna T

      var guard = _cdsClassifyGuard_(appointmentId, client, procedure, statusNorm);
      if (guard.skip && guard.reason !== "AUTHORIZED_DURATION_EXCEPTION") {
        skipped++;
        continue;
      }

      // 1. Duplicidade inequívoca na planilha (mais de uma linha ativa com o mesmo Event ID oficial)
      if (seenEventOwnerRow[colTEventId]) {
        if (guard.reason === "AUTHORIZED_DURATION_EXCEPTION") {
          skipped++;
          logs.push({ row: rowNum, appointmentId: appointmentId, status: "SKIPPED_EXCEPTION_NOT_CANCELLED", eventId: colTEventId });
          continue;
        }
        if (!dryRun) {
          agSheet.getRange(rowNum, 9).setValue("cancelado");
        }
        duplicatesCancelled++;
        logs.push({
          row: rowNum,
          appointmentId: appointmentId,
          status: dryRun ? "WOULD_CANCEL_DUPLICATE_IN_SHEET" : "CANCELLED_DUPLICATE_IN_SHEET",
          eventId: colTEventId,
          primaryRow: seenEventOwnerRow[colTEventId]
        });
        continue;
      }
      seenEventOwnerRow[colTEventId] = rowNum;

      var sheetDate = _cdsDateKey_(r[5], d[5]);
      var sheetTime = _cdsTimeKey_(r[6], d[6]);
      var ev = calendar.getEventById(colTEventId);

      // 2. Evento excluído/cancelado no Google Calendar -> refletir cancelamento na planilha preservando histórico
      if (!ev) {
        if (sheetDate && sheetTime) {
          var sheetStart = new Date(sheetDate + "T" + sheetTime + ":00" + CDS_TZ_OFFSET);
          if (!isNaN(sheetStart.getTime()) && sheetStart.getTime() <= nowMs) {
            skipped++;
            continue; // Não alterar passados
          }
        }
        if (guard.reason === "AUTHORIZED_DURATION_EXCEPTION") {
          skipped++;
          continue;
        }
        if (!dryRun) {
          agSheet.getRange(rowNum, 9).setValue("cancelado");
        }
        cancelled++;
        logs.push({
          row: rowNum,
          appointmentId: appointmentId,
          status: dryRun ? "WOULD_CANCEL_MISSING_IN_CALENDAR" : "CANCELLED_FROM_CALENDAR",
          eventId: colTEventId
        });
        continue;
      }

      if (ev.isAllDayEvent()) { skipped++; continue; }
      if (ev.getStartTime().getTime() <= nowMs) { skipped++; continue; } // Protege eventos passados

      // 3. Refletir data (Col F) e horário inicial (Col G) oficiais do Calendar na planilha (sem alterar Serviços!F!)
      var calDate = Utilities.formatDate(ev.getStartTime(), tz, "yyyy-MM-dd");
      var calTime = Utilities.formatDate(ev.getStartTime(), tz, "HH:mm");

      if (calDate === sheetDate && calTime === sheetTime) {
        logs.push({ row: rowNum, appointmentId: appointmentId, status: "UNCHANGED", eventId: colTEventId });
        continue;
      }

      if (!dryRun) {
        if (calDate !== sheetDate) agSheet.getRange(rowNum, 6).setValue(calDate);
        if (calTime !== sheetTime) agSheet.getRange(rowNum, 7).setValue(calTime);
      }
      updated++;
      logs.push({
        row: rowNum,
        appointmentId: appointmentId,
        status: dryRun ? "WOULD_UPDATE_SHEET_FROM_CALENDAR" : "UPDATED_SHEET_FROM_CALENDAR",
        eventId: colTEventId,
        before: { date: sheetDate, time: sheetTime },
        after: { date: calDate, time: calTime }
      });
    }

    if (!dryRun) SpreadsheetApp.flush();

    var summary = {
      status: "success",
      dryRun: dryRun,
      updated: updated,
      cancelled: cancelled,
      duplicatesCancelled: duplicatesCancelled,
      skipped: skipped,
      logs: logs
    };
    Logger.log(JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
  }
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

  var client = String(row[1] || "").trim();
  var procedure = String(row[4] || "").trim();
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

  var existingEvent = calendar.getEventById(colTEventId);
  if (!existingEvent) {
    return {
      status: "SKIPPED_EVENT_NOT_FOUND_IN_CALENDAR",
      rowIndex: rowIndex,
      appointmentId: appointmentId,
      eventId: colTEventId,
      message: "Evento não encontrado no Google Calendar (não recriado automaticamente)."
    };
  }
  if (existingEvent.isAllDayEvent()) {
    return { status: "SKIPPED_ALL_DAY_EVENT", rowIndex: rowIndex, appointmentId: appointmentId, eventId: colTEventId };
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

  // Preserva data e horário inicial oficiais do Calendar; atualiza SOMENTE o horário final
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
 * Instala os gatilhos bidirecionais SOMENTE quando o proprietário autorizar ativação final.
 * Verifica todos os gatilhos existentes antes para garantir zero duplicações.
 */
function installBidirectionalCalendarSyncTriggers() {
  var cfgAudit = auditCalendarDurationSyncConfig();
  if (!cfgAudit.configReady) {
    throw new Error("Instalação bloqueada: corrija os bloqueios de configuração antes: " + cfgAudit.blockers.join(" | "));
  }
  if (!_cdsIsWriteSyncEnabled_()) {
    throw new Error("Instalação bloqueada: defina CALENDAR_DURATION_SYNC_ENABLED='true' somente após aprovação final.");
  }

  var installed = [];
  var ss = _cdsOpenOfficialSpreadsheet_(false);

  if (!cfgAudit.triggers.hasEditTrigger) {
    ScriptApp.newTrigger(CDS_EDIT_TRIGGER_HANDLER).forSpreadsheet(ss).onEdit().create();
    installed.push(CDS_EDIT_TRIGGER_HANDLER);
  }
  if (!cfgAudit.triggers.hasCalendarTrigger) {
    var calId = String(PropertiesService.getScriptProperties().getProperty("GOOGLE_CALENDAR_ID") || "").trim();
    ScriptApp.newTrigger(CDS_CALENDAR_TRIGGER_HANDLER).forUserCalendar(calId).onEventUpdated().create();
    installed.push(CDS_CALENDAR_TRIGGER_HANDLER);
  }

  Logger.log("Gatilhos instalados: " + JSON.stringify(installed));
  return { status: "success", installed: installed };
}

function _cdsGetDurationException_(appointmentId) {
  if (appointmentId && Object.prototype.hasOwnProperty.call(CDS_AUTHORIZED_EXCEPTIONS.durationOverrideByAppointmentId, appointmentId)) {
    return CDS_AUTHORIZED_EXCEPTIONS.durationOverrideByAppointmentId[appointmentId];
  }
  return null;
}

function _cdsClassifyGuard_(appointmentId, client, procedure, statusNorm) {
  if (!client && !appointmentId && !procedure) return { skip: true, reason: "EMPTY_ROW" };
  if (statusNorm === "cancelado" || statusNorm === "cancelada" || statusNorm === "cancelled" || statusNorm === "excluido") {
    return { skip: true, reason: "SKIPPED_CANCELLED" };
  }
  if (statusNorm.indexOf("bloquei") >= 0 || statusNorm.indexOf("bloquead") >= 0 || statusNorm === "folga" || _cdsNormalize_(procedure).indexOf("bloquei") === 0) {
    return { skip: true, reason: "SKIPPED_SCHEDULE_BLOCK" };
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

function _cdsFindMatchingCalendarEvents_(apt, calendarEvents) {
  var matches = [];
  var clientNorm = _cdsNormalize_(apt.client);
  var procNorm = _cdsNormalize_(apt.procedure);
  var clientTokens = clientNorm.split(" ").filter(function(t) { return t.length >= 3; });
  var tag = apt.appointmentId ? CDS_APT_TAG_PREFIX + apt.appointmentId + "]" : "";

  if (apt.columnTEventId) {
    for (var i = 0; i < calendarEvents.length; i++) {
      if (calendarEvents[i].id === apt.columnTEventId) {
        matches.push({ event: calendarEvents[i], matchType: "COLUMN_T_EVENT_ID" });
      }
    }
    if (matches.length > 0) return matches;
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
