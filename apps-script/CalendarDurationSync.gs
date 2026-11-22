/**
 * Espaço Angélica — Sincronização Controlada de Duração (Google Sheets -> Google Calendar)
 *
 * Módulo integrado ao projeto oficial (apps-script/), preservando Code.gs e CalendarSync.gs.
 * Reutiliza funções/constantes oficiais já existentes em Code.gs:
 *   - TARGET_SPREADSHEET_ID
 *   - OFFICIAL_TIME_ZONE ("America/Sao_Paulo")
 *   - getSharedCalendar_()
 *   - getOfficialSheet()
 *   - getServicesSheets()
 *   - normalizeBookingDate() / normalizeBookingTime()
 *
 * Contrato oficial de colunas (1-based):
 * - Aba "Serviços" (e "Depilação"):
 *     Coluna A (1): ID
 *     Coluna B (2): Título
 *     Coluna F (6): Duração (ÚNICA fonte oficial da duração!)
 * - Aba "Agendamentos":
 *     Coluna B (2): Cliente
 *     Coluna E (5): Procedimento
 *     Coluna F (6): Data Agendada (NUNCA usar como duração!)
 *     Coluna G (7): Horário Agendado (horário inicial)
 *     Coluna I (9): Status
 *     Coluna J (10): ID Agendamento
 *     Coluna N (14): IDs Serviços Adicionais (JSON opcional)
 *     Coluna P (16): ID Serviço Principal
 *     Coluna T (20): Google Calendar Event ID
 *
 * TRAVA DE ATIVAÇÃO SEGURA:
 * - Por padrão (CALENDAR_DURATION_SYNC_ENABLED !== "true"), nenhuma escrita no Calendar
 *   ou na Coluna T é executada.
 * - Execute primeiro:
 *     1) auditCalendarDurationSyncConfig()
 *     2) runCalendarDurationSyncDryRun()
 *   Somente após confirmar configuração, ausência de ambiguidades e conciliação de IDs,
 *   habilite CALENDAR_DURATION_SYNC_ENABLED="true" e execute installCalendarDurationSyncTrigger().
 */

var CDS_TZ_OFFSET = "-03:00";
var CDS_APT_TAG_PREFIX = "[ESPACO_ANGELICA_APT_ID:";
var CDS_TRIGGER_HANDLER = "handleSpreadsheetEditForCalendarSync";

// Exceções já autorizadas no sistema (alinhadas com apps-script/CalendarSync.gs).
var CDS_AUTHORIZED_EXCEPTIONS = {
  excludeAppointmentIds: [
    "apt-1794006950286-rec-4" // Registro de teste excluído da sincronização (EXCLUDE_FROM_SYNC)
  ],
  durationOverrideByAppointmentId: {
    "apt-1793902440508": 90   // Exceção autorizada pelo administrador (KEEP_CALENDAR_AND_ALIGN_SHEET)
  },
  allowPendingPixIds: [
    "apt-1794603000976"       // Exceção autorizada pelo administrador (CREATE_CALENDAR_EVENT_PENDING_PIX)
  ]
};

/**
 * Resolve o fuso horário oficial reutilizando OFFICIAL_TIME_ZONE do Code.gs.
 */
function _cdsTimezone_() {
  return (typeof OFFICIAL_TIME_ZONE !== "undefined" && OFFICIAL_TIME_ZONE)
    ? OFFICIAL_TIME_ZONE
    : "America/Sao_Paulo";
}

/**
 * Verifica se a trava de ativação em produção está explicitamente ligada.
 */
function _cdsIsWriteSyncEnabled_() {
  var flag = String(PropertiesService.getScriptProperties().getProperty("CALENDAR_DURATION_SYNC_ENABLED") || "").trim().toLowerCase();
  return flag === "true";
}

/**
 * Resolve e valida o ID da planilha sem nunca alterar Script Properties automaticamente.
 * Reutiliza TARGET_SPREADSHEET_ID do Code.gs como referência oficial.
 */
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

/**
 * Abre a planilha oficial com bloqueio de segurança caso SPREADSHEET_ID divirja de TARGET_SPREADSHEET_ID.
 */
function _cdsOpenOfficialSpreadsheet_(allowReadOnlyFallback) {
  var cfg = _cdsResolveSpreadsheetConfig_();
  if (cfg.status === "MISMATCH_WITH_TARGET_SPREADSHEET_ID") {
    throw new Error(cfg.actionRequired);
  }
  if (!cfg.hasScriptProperty && !allowReadOnlyFallback) {
    throw new Error(cfg.actionRequired || "Script Property SPREADSHEET_ID não configurada.");
  }
  if (!cfg.effectiveId) {
    throw new Error("ID da planilha oficial não disponível.");
  }
  return SpreadsheetApp.openById(cfg.effectiveId);
}

/**
 * Abre o calendário compartilhado reutilizando getSharedCalendar_() do Code.gs.
 */
function _cdsGetCalendar_() {
  if (typeof getSharedCalendar_ === "function") {
    return getSharedCalendar_();
  }
  var calId = String(PropertiesService.getScriptProperties().getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  if (!calId) throw new Error("Configure GOOGLE_CALENDAR_ID nas Propriedades do Script.");
  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) throw new Error("Google Calendar não encontrado ou sem acesso.");
  return cal;
}

/**
 * AUDITORIA SOMENTE LEITURA DE CONFIGURAÇÃO E GATILHOS.
 * Não altera propriedades, não instala gatilhos, não grava na planilha,
 * não modifica eventos e NÃO imprime tokens, senhas ou segredos.
 */
function auditCalendarDurationSyncConfig() {
  var props = PropertiesService.getScriptProperties();
  var tzOfficial = _cdsTimezone_();
  var sheetCfg = _cdsResolveSpreadsheetConfig_();
  var calIdConfigured = !!String(props.getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  var executionAccount = "";
  try {
    executionAccount = String(Session.getEffectiveUser().getEmail() || "");
  } catch (e) {}

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
  var hasDurationSyncTrigger = false;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var t = 0; t < triggers.length; t++) {
      var handler = triggers[t].getHandlerFunction();
      if (handler === CDS_TRIGGER_HANDLER) hasDurationSyncTrigger = true;
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
  if (!calendarCheck.accessible) {
    blockers.push(calendarCheck.error || "Configurar GOOGLE_CALENDAR_ID e confirmar acesso da conta executora.");
  }
  if (!spreadsheetCheck.timeZoneIsSaoPaulo) {
    blockers.push("Fuso horário da planilha (" + spreadsheetCheck.spreadsheetTimeZone + ") difere de America/Sao_Paulo.");
  }
  if (calendarCheck.accessible && !calendarCheck.timeZoneIsSaoPaulo) {
    blockers.push("Fuso horário do calendário (" + calendarCheck.calendarTimeZone + ") difere de America/Sao_Paulo.");
  }
  if (!spreadsheetCheck.hasAgendamentosTab || !spreadsheetCheck.hasServicosTab) {
    blockers.push("Abas obrigatórias 'Agendamentos' e/ou 'Serviços' não encontradas.");
  }

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
      hasDurationSyncTrigger: hasDurationSyncTrigger,
      items: existingTriggers
    },
    configReady: blockers.length === 0,
    blockers: blockers,
    safety: "Somente leitura. Nenhum segredo foi exibido, nenhuma propriedade foi alterada e nenhum gatilho foi instalado."
  };

  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * AUDITORIA DE CONCILIAÇÃO — DRY RUN OBRIGATÓRIO (100% SOMENTE LEITURA).
 *
 * NÃO cria, atualiza, exclui ou move eventos no Google Calendar.
 * NÃO preenche a Coluna T nem altera qualquer célula da planilha.
 *
 * Produz os 8 grupos exigidos antes de qualquer ativação:
 *   1. Total de agendamentos futuros
 *   2. Correspondências únicas
 *   3. Eventos sem correspondência
 *   4. Agendamentos sem evento
 *   5. Correspondências ambíguas
 *   6. Registros ignorados por exceções
 *   7. Registros que poderiam ser atualizados com segurança
 *   8. Registros que poderiam gerar duplicações
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
      ignoredByExceptions.push({
        source: "CALENDAR",
        reason: "ALL_DAY_EVENT",
        eventId: evId,
        title: evTitle,
        start: evStartIso
      });
      continue;
    }

    var normEvTitle = _cdsNormalize_(evTitle);
    if (/\bteste?\b|\bintegracao\b|\bintegration\b|\be2e\b/i.test(normEvTitle)) {
      ignoredByExceptions.push({
        source: "CALENDAR",
        reason: "TEST_EVENT",
        eventId: evId,
        title: evTitle,
        start: evStartIso
      });
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

    // Coluna F de Agendamentos é DATA (nunca duração)
    var dateKey = _cdsDateKey_(r[5], d[5]);
    var timeKey = _cdsTimeKey_(r[6], d[6]);
    if (!dateKey || dateKey < today || dateKey > endKey) continue;

    // Ignorar passados dentro do próprio dia de hoje
    if (timeKey) {
      var startCheck = new Date(dateKey + "T" + timeKey + ":00" + CDS_TZ_OFFSET);
      if (!isNaN(startCheck.getTime()) && startCheck.getTime() <= nowMs) continue;
    }

    // Classificar exceções/cancelados/bloqueios/testes
    var guard = _cdsClassifyGuard_(appointmentId, client, procedure, statusNorm);
    if (guard.skip) {
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

    // Resolver duração oficial exclusivamente a partir de Serviços!F
    var durationRes = _cdsResolveServiceDuration_(catalog, serviceId, procedure, additionalIds);
    var expectedEndTime = null;
    if (durationRes.ok && timeKey) {
      var startObj = new Date(dateKey + "T" + timeKey + ":00" + CDS_TZ_OFFSET);
      var endObj = new Date(startObj.getTime() + durationRes.durationMinutes * 60000);
      expectedEndTime = Utilities.formatDate(endObj, tz, "HH:mm");
    }

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
      officialDurationMinutes: durationRes.ok ? durationRes.durationMinutes : null,
      expectedEndTime: expectedEndTime,
      durationError: durationRes.ok ? null : durationRes.errorCode + ": " + durationRes.message
    };
    futureAppointments.push(aptRecord);

    // Buscar eventos candidatos no calendário (ID na Col T, tag na descrição, ou data+horário+cliente/procedimento)
    var candidates = _cdsFindMatchingCalendarEvents_(aptRecord, calendarEvents);

    if (candidates.length === 1) {
      var matchedEv = candidates[0].event;
      matchedEv.matchedRows.push(rowNum);
      var needsDurationUpdate = !!(durationRes.ok && matchedEv.durationMinutes !== durationRes.durationMinutes);
      var exactStartMatch = matchedEv.dateKey === dateKey && matchedEv.timeKey === timeKey;

      var matchEntry = {
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        procedure: procedure,
        date: dateKey,
        time: timeKey,
        hasColumnTId: !!colTEventId,
        columnTEventId: colTEventId || null,
        matchType: candidates[0].matchType,
        calendarEventId: matchedEv.id,
        calendarTitle: matchedEv.title,
        calendarStart: matchedEv.startIso,
        calendarEnd: matchedEv.endIso,
        currentCalendarDurationMin: matchedEv.durationMinutes,
        officialDurationMinutes: durationRes.ok ? durationRes.durationMinutes : null,
        expectedEndTime: expectedEndTime,
        exactStartMatch: exactStartMatch,
        needsDurationUpdate: needsDurationUpdate,
        durationError: aptRecord.durationError
      };
      uniqueMatches.push(matchEntry);

      if (!colTEventId) {
        duplicateRiskRecords.push({
          row: rowNum,
          appointmentId: appointmentId,
          client: client,
          date: dateKey,
          time: timeKey,
          existingCalendarEventId: matchedEv.id,
          riskReason: "Agendamento já possui evento no Calendar, mas Coluna T está vazia. Preencher/conciliar Coluna T antes de habilitar criação automática para evitar duplicação."
        });
      }

      if (needsDurationUpdate && durationRes.ok && exactStartMatch && !!colTEventId) {
        safeToUpdate.push(matchEntry);
      } else if (needsDurationUpdate && durationRes.ok && exactStartMatch && !colTEventId) {
        matchEntry.pendingActionBeforeUpdate = "Conciliar e preencher Google Calendar Event ID na Coluna T antes da atualização.";
      }
    } else if (candidates.length > 1) {
      ambiguousMatches.push({
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        procedure: procedure,
        date: dateKey,
        time: timeKey,
        hasColumnTId: !!colTEventId,
        reason: "MULTIPLOS_EVENTOS_CANDIDATOS_NO_CALENDAR",
        candidates: candidates.map(function(c) {
          return {
            matchType: c.matchType,
            eventId: c.event.id,
            title: c.event.title,
            start: c.event.startIso,
            end: c.event.endIso,
            durationMinutes: c.event.durationMinutes
          };
        })
      });
      duplicateRiskRecords.push({
        row: rowNum,
        appointmentId: appointmentId,
        client: client,
        date: dateKey,
        time: timeKey,
        riskReason: "Correspondência ambígua (" + candidates.length + " eventos candidatos no Calendar). Decisão humana obrigatória."
      });
    } else {
      appointmentsWithoutEvent.push(aptRecord);
    }
  }

  // Verificar também se um mesmo evento do Calendar casou com mais de 1 linha da planilha (ambiguidade reversa)
  for (var ce = 0; ce < calendarEvents.length; ce++) {
    if (calendarEvents[ce].matchedRows.length > 1) {
      ambiguousMatches.push({
        reason: "EVENTO_CALENDAR_VINCULADO_A_MULTIPLAS_LINHAS",
        calendarEventId: calendarEvents[ce].id,
        calendarTitle: calendarEvents[ce].title,
        calendarStart: calendarEvents[ce].startIso,
        sheetRows: calendarEvents[ce].matchedRows
      });
    }
  }

  var unmatchedCalendarEvents = calendarEvents
    .filter(function(ev) { return ev.matchedRows.length === 0; })
    .map(function(ev) {
      return {
        eventId: ev.id,
        title: ev.title,
        start: ev.startIso,
        end: ev.endIso,
        durationMinutes: ev.durationMinutes
      };
    });

  var activationBlockers = configAudit.blockers.slice();
  if (ambiguousMatches.length > 0) {
    activationBlockers.push("Existem " + ambiguousMatches.length + " correspondência(s) ambígua(s) aguardando decisão humana.");
  }
  if (duplicateRiskRecords.length > 0) {
    activationBlockers.push("Existem " + duplicateRiskRecords.length + " registro(s) com risco de duplicação (Coluna T vazia ou ambiguidade).");
  }
  var invalidDurationCount = futureAppointments.filter(function(a) { return !!a.durationError; }).length;
  if (invalidDurationCount > 0) {
    activationBlockers.push("Existem " + invalidDurationCount + " agendamento(s) futuro(s) com serviço não encontrado ou duração inválida em Serviços!F.");
  }

  var result = {
    status: "success",
    readOnly: true,
    dryRun: true,
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
      withColumnTId: futureAppointments.filter(function(a) { return a.hasColumnTId; }).length,
      withoutColumnTId: futureAppointments.filter(function(a) { return !a.hasColumnTId; }).length
    },
    uniqueMatches: uniqueMatches,
    unmatchedCalendarEvents: unmatchedCalendarEvents,
    appointmentsWithoutEvent: appointmentsWithoutEvent,
    ambiguousMatches: ambiguousMatches,
    ignoredByExceptions: ignoredByExceptions,
    safeToUpdate: safeToUpdate,
    duplicateRiskRecords: duplicateRiskRecords,
    readyForTriggerInstallation: activationBlockers.length === 0,
    activationBlockers: activationBlockers,
    safety: "DRY RUN SOMENTE LEITURA: nenhum evento foi criado, atualizado, movido ou excluído; Coluna T não foi preenchida; gatilho não foi instalado."
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Instala o gatilho instalável onEdit (NÃO executar antes de aprovação final após dry-run).
 * Evita duplicação verificando todos os gatilhos existentes antes de criar.
 */
function installCalendarDurationSyncTrigger() {
  var cfgAudit = auditCalendarDurationSyncConfig();
  if (!cfgAudit.configReady) {
    throw new Error("Instalação bloqueada: corrija os bloqueios de configuração antes: " + cfgAudit.blockers.join(" | "));
  }
  if (!_cdsIsWriteSyncEnabled_()) {
    throw new Error("Instalação bloqueada: habilite Script Property CALENDAR_DURATION_SYNC_ENABLED='true' somente após aprovar o dry-run.");
  }
  if (cfgAudit.triggers.hasDurationSyncTrigger) {
    Logger.log("Gatilho " + CDS_TRIGGER_HANDLER + " já existe. Nenhuma duplicação criada.");
    return { status: "already_installed", handler: CDS_TRIGGER_HANDLER };
  }
  var ss = _cdsOpenOfficialSpreadsheet_(false);
  ScriptApp.newTrigger(CDS_TRIGGER_HANDLER)
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  Logger.log("Gatilho instalável " + CDS_TRIGGER_HANDLER + " criado com sucesso.");
  return { status: "installed", handler: CDS_TRIGGER_HANDLER };
}

/**
 * Gatilho instalável onEdit para alterações diretas em Serviços!F ou Agendamentos!E,F,G,N,P.
 * Usa LockService para evitar execuções simultâneas/duplicadas.
 */
function handleSpreadsheetEditForCalendarSync(e) {
  if (!e || !e.range) return { status: "ignored", reason: "NO_EVENT_RANGE" };
  if (!_cdsIsWriteSyncEnabled_()) {
    return { status: "skipped_disabled", reason: "CALENDAR_DURATION_SYNC_ENABLED !== true" };
  }

  var range = e.range;
  var sheet = range.getSheet();
  var sheetName = _cdsNormalize_(sheet.getName());
  var startRow = range.getRow();
  var endRow = range.getLastRow();
  var startCol = range.getColumn();
  var endCol = range.getLastColumn();
  if (endRow < 2) return { status: "ignored", reason: "HEADER_ONLY" };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (lockErr) {
    Logger.log("ERROR: Lock timeout em handleSpreadsheetEditForCalendarSync.");
    return { status: "error", errorCode: "LOCK_TIMEOUT" };
  }

  try {
    var ss = _cdsOpenOfficialSpreadsheet_(false);
    var calendar = _cdsGetCalendar_();

    // 1. Edição em Serviços!F (ou Depilação!F) — Coluna 6
    if (sheetName === "servicos" || sheetName === "depilacao") {
      if (startCol > 6 || endCol < 6) return { status: "ignored", reason: "NON_DURATION_COLUMN" };
      var summaries = [];
      for (var r = Math.max(2, startRow); r <= endRow; r++) {
        var rowVals = sheet.getRange(r, 1, 1, 8).getValues()[0];
        summaries.push(_cdsPropagateServiceDuration_(ss, calendar, {
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
    }

    // 2. Edição em Agendamentos!E(5), F(6), G(7), N(14), P(16)
    if (sheetName === "agendamentos") {
      var watched = [5, 6, 7, 14, 16];
      var intersects = false;
      for (var w = 0; w < watched.length; w++) {
        if (watched[w] >= startCol && watched[w] <= endCol) { intersects = true; break; }
      }
      if (!intersects) return { status: "ignored", reason: "NON_SYNC_COLUMN" };

      var results = [];
      for (var ar = Math.max(2, startRow); ar <= endRow; ar++) {
        results.push(_cdsSyncSingleAppointmentRow_(ss, calendar, ar, {
          requireFuture: true,
          preserveStartOnUpdate: false
        }));
      }
      Logger.log(JSON.stringify({ action: "ON_AGENDAMENTOS_EDIT", results: results }));
      return { status: "success", results: results };
    }

    return { status: "ignored", reason: "OTHER_SHEET" };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hook chamado pelo Code.gs após saveService concluir com sucesso no painel administrativo.
 * Enquanto CALENDAR_DURATION_SYNC_ENABLED !== "true", retorna apenas status dry-run sem alterar eventos.
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
    var msg = "Serviço não localizado na aba Serviços (ID=" + serviceId + ", Título=" + serviceTitle + ").";
    Logger.log("ERROR: " + msg);
    return { status: "error", errorCode: "SERVICE_NOT_FOUND", message: msg };
  }

  return _cdsPropagateServiceDuration_(ss, calendar, target);
}

/**
 * Hook chamado pelo Code.gs após updateAppointment concluir com sucesso no painel administrativo.
 * Enquanto CALENDAR_DURATION_SYNC_ENABLED !== "true", não altera eventos.
 */
function syncAppointmentRowAfterPanelUpdate_(rowIndex) {
  if (!_cdsIsWriteSyncEnabled_()) {
    return {
      status: "skipped_dry_run_mode",
      executed: false,
      rowIndex: rowIndex,
      message: "Sincronização em modo de proteção (CALENDAR_DURATION_SYNC_ENABLED !== 'true'). Nenhum evento alterado."
    };
  }
  var ss = _cdsOpenOfficialSpreadsheet_(false);
  var calendar = _cdsGetCalendar_();
  return _cdsSyncSingleAppointmentRow_(ss, calendar, rowIndex, {
    requireFuture: true,
    preserveStartOnUpdate: false
  });
}

function _cdsPropagateServiceDuration_(ss, calendar, targetService) {
  if (!targetService || targetService.durationMinutes === null) {
    var errMsg = "Duração inválida em Serviços!F (serviço: " + (targetService ? targetService.title : "desconhecido") + "). Nenhum evento alterado.";
    Logger.log("ERROR: " + errMsg);
    return { ok: false, errorCode: "INVALID_DURATION", updated: 0, errors: 1, message: errMsg };
  }

  var agSheet = ss.getSheetByName("Agendamentos");
  if (!agSheet || agSheet.getLastRow() < 2) {
    return { ok: true, updated: 0, unchanged: 0, skipped: 0, errors: 0, logs: [] };
  }

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

    var res = _cdsSyncSingleAppointmentRow_(ss, calendar, i + 1, {
      requireFuture: true,
      preserveStartOnUpdate: true
    });
    logs.push(res);

    if (res.status === "UPDATED" || res.status === "CREATED") updated++;
    else if (res.status === "UNCHANGED") unchanged++;
    else if (res.status === "ERROR") errors++;
    else skipped++;
  }

  var summary = {
    ok: errors === 0,
    service: targetService.title,
    durationMinutes: targetService.durationMinutes,
    updated: updated,
    unchanged: unchanged,
    skipped: skipped,
    errors: errors,
    logs: logs
  };
  Logger.log(JSON.stringify(summary));
  return summary;
}

function _cdsSyncSingleAppointmentRow_(ss, calendar, rowIndex, options) {
  options = options || {};
  var agSheet = ss.getSheetByName("Agendamentos");
  if (!agSheet || rowIndex < 2 || rowIndex > agSheet.getLastRow()) {
    return { status: "ERROR", errorCode: "ROW_NOT_FOUND", rowIndex: rowIndex };
  }

  var lastCol = Math.max(agSheet.getLastColumn(), 20);
  var row = agSheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var display = agSheet.getRange(rowIndex, 1, 1, lastCol).getDisplayValues()[0];

  var client = String(row[1] || "").trim();
  var procedure = String(row[4] || "").trim();
  var statusNorm = _cdsNormalize_(row[8]);
  var appointmentId = String(row[9] || "").trim();
  var additionalIds = _cdsParseAdditionalIds_(row[13]);
  var serviceId = String(row[15] || "").trim();
  var storedEventId = String(row[19] || "").trim();

  var guard = _cdsClassifyGuard_(appointmentId, client, procedure, statusNorm);
  if (guard.skip) {
    return { status: guard.reason, rowIndex: rowIndex, appointmentId: appointmentId };
  }

  // Agendamentos!F = Data, Agendamentos!G = Horário inicial (NUNCA duração)
  var dateKey = _cdsDateKey_(row[5], display[5]);
  var timeKey = _cdsTimeKey_(row[6], display[6]);
  if (!dateKey || !timeKey) {
    return { status: "ERROR", errorCode: "INVALID_DATE_OR_TIME", rowIndex: rowIndex, appointmentId: appointmentId };
  }

  var startDate = new Date(dateKey + "T" + timeKey + ":00" + CDS_TZ_OFFSET);
  if (options.requireFuture && startDate.getTime() <= new Date().getTime()) {
    return { status: "SKIPPED_PAST", rowIndex: rowIndex, appointmentId: appointmentId };
  }

  // Duração lida fresca exclusivamente de Serviços!F
  var catalog = _cdsReadServicesCatalog_(ss);
  var lookup = _cdsResolveServiceDuration_(catalog, serviceId, procedure, additionalIds);
  if (!lookup.ok) {
    Logger.log("ERROR row " + rowIndex + ": " + lookup.message);
    return { status: "ERROR", errorCode: lookup.errorCode, rowIndex: rowIndex, appointmentId: appointmentId, message: lookup.message };
  }

  var endDate = new Date(startDate.getTime() + lookup.durationMinutes * 60000);
  var title = client ? client + " — " + lookup.service.title : lookup.service.title;
  var existingEvent = storedEventId ? calendar.getEventById(storedEventId) : null;

  if (!existingEvent && appointmentId) {
    var dayEvents = calendar.getEvents(
      new Date(dateKey + "T00:00:00" + CDS_TZ_OFFSET),
      new Date(dateKey + "T23:59:59" + CDS_TZ_OFFSET)
    );
    var tag = CDS_APT_TAG_PREFIX + appointmentId + "]";
    for (var eIdx = 0; eIdx < dayEvents.length; eIdx++) {
      if (String(dayEvents[eIdx].getDescription() || "").indexOf(tag) >= 0) {
        existingEvent = dayEvents[eIdx];
        break;
      }
    }
  }

  if (existingEvent) {
    if (existingEvent.isAllDayEvent()) {
      return { status: "SKIPPED_ALL_DAY_EVENT", rowIndex: rowIndex, appointmentId: appointmentId, eventId: existingEvent.getId() };
    }
    var targetStart = options.preserveStartOnUpdate ? existingEvent.getStartTime() : startDate;
    var targetEnd = new Date(targetStart.getTime() + lookup.durationMinutes * 60000);

    if (!storedEventId) agSheet.getRange(rowIndex, 20).setValue(existingEvent.getId());
    if (lookup.resolvedBy === "TITLE_OVERRIDE_AFTER_PROCEDURE_EDIT" && lookup.service.id) {
      agSheet.getRange(rowIndex, 16).setValue(lookup.service.id);
    }

    if (existingEvent.getStartTime().getTime() === targetStart.getTime() &&
        existingEvent.getEndTime().getTime() === targetEnd.getTime() &&
        existingEvent.getTitle() === title) {
      return { status: "UNCHANGED", rowIndex: rowIndex, appointmentId: appointmentId, eventId: existingEvent.getId() };
    }

    existingEvent.setTime(targetStart, targetEnd);
    if (existingEvent.getTitle() !== title) existingEvent.setTitle(title);
    return {
      status: "UPDATED",
      rowIndex: rowIndex,
      appointmentId: appointmentId,
      eventId: existingEvent.getId(),
      durationMinutes: lookup.durationMinutes
    };
  }

  var desc = "Procedimento: " + lookup.service.title + (appointmentId ? "\n" + CDS_APT_TAG_PREFIX + appointmentId + "]" : "");
  var created = calendar.createEvent(title, startDate, endDate, { description: desc });
  agSheet.getRange(rowIndex, 20).setValue(created.getId());
  return {
    status: "CREATED",
    rowIndex: rowIndex,
    appointmentId: appointmentId,
    eventId: created.getId(),
    durationMinutes: lookup.durationMinutes
  };
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
  if (appointmentId && Object.prototype.hasOwnProperty.call(CDS_AUTHORIZED_EXCEPTIONS.durationOverrideByAppointmentId, appointmentId)) {
    return { skip: true, reason: "SKIPPED_AUTHORIZED_DURATION_EXCEPTION" };
  }
  return { skip: false };
}

function _cdsFindMatchingCalendarEvents_(apt, calendarEvents) {
  var matches = [];
  var clientNorm = _cdsNormalize_(apt.client);
  var procNorm = _cdsNormalize_(apt.procedure);
  var clientTokens = clientNorm.split(" ").filter(function(t) { return t.length >= 3; });
  var tag = apt.appointmentId ? CDS_APT_TAG_PREFIX + apt.appointmentId + "]" : "";

  // 1. Match direto pelo Google Calendar Event ID salvo em Agendamentos!T
  if (apt.columnTEventId) {
    for (var i = 0; i < calendarEvents.length; i++) {
      if (calendarEvents[i].id === apt.columnTEventId) {
        matches.push({ event: calendarEvents[i], matchType: "COLUMN_T_EVENT_ID" });
      }
    }
    if (matches.length > 0) return matches;
  }

  // 2. Match direto pela tag de idempotência [ESPACO_ANGELICA_APT_ID:...]
  if (tag) {
    for (var j = 0; j < calendarEvents.length; j++) {
      if (calendarEvents[j].description.indexOf(tag) >= 0) {
        matches.push({ event: calendarEvents[j], matchType: "DESCRIPTION_APT_TAG" });
      }
    }
    if (matches.length > 0) return matches;
  }

  // 3. Match conservador por Data + Horário inicial + sinal de Cliente ou Procedimento
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
      if (id) {
        byId[id] = byId[id] || [];
        byId[id].push(entry);
      }
      if (entry.normalizedTitle) {
        byTitle[entry.normalizedTitle] = byTitle[entry.normalizedTitle] || [];
        byTitle[entry.normalizedTitle].push(entry);
      }
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
