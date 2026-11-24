/**
 * Espaço Angélica — Calendar-first sync (safe, opt-in).
 *
 * SOURCE OF TRUTH:
 * - Google Calendar: appointment existence, date and start time.
 * - Google Sheets: service catalogue and durations (column F).
 * - Agendamentos: link record; column T stores the Calendar event ID.
 *
 * The synchronizer imports Calendar appointments into Sheets, then calculates the
 * expected end from the main service + every additional service and updates ONLY
 * the existing Calendar event end. It never creates/deletes/moves Calendar events.
 *
 * Required Script Properties:
 *   SPREADSHEET_ID                 exact TARGET_SPREADSHEET_ID from Code.gs
 *   GOOGLE_CALENDAR_ID             shared studio calendar ID
 *   CALENDAR_FIRST_SYNC_ENABLED    "true" only after explicit production approval
 *
 * No trigger is installed automatically. All write entry points fail closed.
 */

var CFS_TIME_ZONE = "America/Sao_Paulo";
var CFS_EVENT_ID_COLUMN = 20;
var CFS_EVENT_ID_HEADER = "Google Calendar Event ID";
var CFS_LOOP_GUARD_KEY = "CFS_INTERNAL_SYNC_LOCK";
var CFS_LOOP_GUARD_SECONDS = 20;
var CFS_APPOINTMENT_TAG_PREFIX = "[ESPACO_ANGELICA_APT_ID:";
var CFS_DURATION_EXCEPTION_IDS = {
  "apt-1793902283321": true, // Validated special 150-minute appointment.
  "apt-1793902440508": true  // Validated special 90-minute appointment.
};
var CFS_REVIEW_APPOINTMENT_IDS = {
  "apt-1793903805661": true,
  "apt-1794603000976": true
};
var CFS_EXCLUDED_APPOINTMENT_IDS = {
  "apt-1794006950286-rec-4": true // Test appointment; never synchronize.
};

function cfsNormalize_(value) {
  return String(value === null || value === undefined ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cfsParseDurationMinutes_(value) {
  if (value === null || value === undefined || value instanceof Date) return null;
  if (typeof value === "number") {
    return isFinite(value) && value > 0 && value <= 1440 && Math.floor(value) === value ? value : null;
  }
  var raw = String(value).trim().toLowerCase();
  if (!raw || /[\/\-:]/.test(raw)) return null;

  var match = /^(?:(\d+)\s*h(?:oras?)?(?:\s*(?:(\d{1,2})\s*(?:min(?:utos?)?|m)?)?)?|(\d+)\s*(?:min(?:utos?)?|m))$/.exec(raw);
  var total = 0;
  if (match) {
    if (match[1] !== undefined) {
      total = Number(match[1]) * 60;
      if (match[2] !== undefined) {
        if (Number(match[2]) >= 60) return null;
        total += Number(match[2]);
      }
    } else {
      total = Number(match[3]);
    }
  } else if (/^\d+$/.test(raw)) {
    total = Number(raw);
  } else {
    return null;
  }
  return isFinite(total) && total > 0 && total <= 1440 ? total : null;
}

function cfsParseAdditionalIds_(value) {
  if (Array.isArray(value)) return value.map(function(v) { return String(v || "").trim(); }).filter(Boolean);
  var raw = String(value || "").trim();
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(function(v) { return String(v || "").trim(); }).filter(Boolean);
  } catch (e) {}
  return null; // Malformed data must not silently drop add-ons.
}

function cfsReadCatalog_(spreadsheet) {
  var names = ["Serviços", "Servicos", "Depilação", "Depilacao"];
  var byId = {};
  var byTitle = {};
  var tabsRead = [];

  names.forEach(function(name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    tabsRead.push(name);
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var id = String(values[i][0] || "").trim();
      var title = String(values[i][1] || "").trim();
      if (!id && !title) continue;
      var item = {
        id: id,
        title: title,
        normalizedTitle: cfsNormalize_(title),
        durationMinutes: cfsParseDurationMinutes_(values[i][5]),
        rawDuration: values[i][5],
        sheetName: name,
        row: i + 1
      };
      if (id) {
        byId[id] = byId[id] || [];
        byId[id].push(item);
      }
      if (item.normalizedTitle) {
        byTitle[item.normalizedTitle] = byTitle[item.normalizedTitle] || [];
        byTitle[item.normalizedTitle].push(item);
      }
    }
  });
  return { byId: byId, byTitle: byTitle, tabsRead: tabsRead };
}

function cfsResolveServiceDuration_(catalog, mainServiceId, mainServiceTitle, additionalIds) {
  var addIds = additionalIds === null ? null : (additionalIds || []);
  if (addIds === null) {
    return { ok: false, errorCode: "INVALID_ADDITIONAL_SERVICE_LIST", message: "Lista de serviços adicionais inválida." };
  }

  var main = null;
  var id = String(mainServiceId || "").trim();
  var titleNorm = cfsNormalize_(mainServiceTitle);

  if (id) {
    var idMatches = catalog.byId[id] || [];
    if (idMatches.length !== 1) {
      return { ok: false, errorCode: idMatches.length ? "AMBIGUOUS_MAIN_SERVICE" : "MAIN_SERVICE_NOT_FOUND", message: "ID do serviço principal ausente ou duplicado no catálogo: " + id };
    }
    main = idMatches[0];
    if (titleNorm && main.normalizedTitle !== titleNorm) {
      return { ok: false, errorCode: "MAIN_SERVICE_TITLE_MISMATCH", message: "O ID e o título do serviço principal não correspondem ao catálogo." };
    }
  } else if (titleNorm) {
    var titleMatches = catalog.byTitle[titleNorm] || [];
    if (titleMatches.length !== 1) {
      return { ok: false, errorCode: titleMatches.length ? "AMBIGUOUS_MAIN_SERVICE" : "MAIN_SERVICE_NOT_FOUND", message: "Título do serviço principal ausente ou duplicado no catálogo." };
    }
    main = titleMatches[0];
  } else {
    return { ok: false, errorCode: "MAIN_SERVICE_MISSING", message: "Serviço principal não identificado." };
  }

  if (main.durationMinutes === null) {
    return { ok: false, errorCode: "INVALID_MAIN_DURATION", message: "Duração inválida em " + main.sheetName + "!F" + main.row + "." };
  }

  var total = main.durationMinutes;
  var resolvedAdditional = [];
  for (var a = 0; a < addIds.length; a++) {
    var addId = String(addIds[a] || "").trim();
    var addMatches = catalog.byId[addId] || [];
    if (!addId || addMatches.length !== 1 || addMatches[0].durationMinutes === null) {
      return { ok: false, errorCode: "INVALID_ADDITIONAL_DURATION", message: "Serviço adicional ausente, duplicado ou sem duração válida: " + addId };
    }
    total += addMatches[0].durationMinutes;
    resolvedAdditional.push(addMatches[0]);
  }

  if (total <= 0 || total > 1440) {
    return { ok: false, errorCode: "TOTAL_DURATION_OUT_OF_RANGE", message: "Duração total fora do intervalo permitido." };
  }
  return { ok: true, service: main, additionalServices: resolvedAdditional, durationMinutes: total };
}

function cfsDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CFS_TIME_ZONE, "yyyy-MM-dd");
  }
  var raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  var br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (br) return br[3] + "-" + ("0" + br[2]).slice(-2) + "-" + ("0" + br[1]).slice(-2);
  return "";
}

function cfsTimeKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CFS_TIME_ZONE, "HH:mm");
  }
  var raw = String(value || "").trim();
  var match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) return "";
  var hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return ("0" + hours).slice(-2) + ":" + ("0" + minutes).slice(-2);
}

function cfsIsRecurring_(event) {
  try { return !!event.isRecurringEvent(); } catch (e) { return false; }
}

function cfsEventIdEqual_(left, right) {
  var a = String(left || "").trim();
  var b = String(right || "").trim();
  if (a === b) return true;
  return a.replace(/@google\.com$/i, "") === b.replace(/@google\.com$/i, "");
}

function cfsProtectedReason_(event) {
  if (event.isAllDayEvent()) return "ALL_DAY_EVENT";
  var title = cfsNormalize_(event.getTitle());
  if (!title) return "EMPTY_TITLE";
  if (/\b(bloqueio|bloqueado|bloqueada|folga|ferias|feriado|almoco|reuniao|pessoal|administrativo|indisponivel|indisponibilidade|compromisso|teste|integracao|integration|e2e)\b/.test(title)) {
    return "PROTECTED_OR_TEST_EVENT";
  }
  return "";
}

function cfsMatchTitleToCatalog_(title, catalog) {
  var rawParts = String(title || "").split(/\s*[-–—:|]\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
  var serviceParts = [];
  var clientParts = [];

  for (var p = 0; p < rawParts.length; p++) {
    var subParts = rawParts[p].split(/\s*(?:\+|&)\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
    var allServices = subParts.length > 0;
    var localMatches = [];
    for (var s = 0; s < subParts.length; s++) {
      var key = cfsNormalize_(subParts[s]);
      var list = catalog.byTitle[key] || [];
      if (list.length !== 1) {
        allServices = false;
        break;
      }
      localMatches.push(list[0]);
    }
    if (allServices && localMatches.length) {
      localMatches.forEach(function(item) { serviceParts.push(item); });
    } else {
      clientParts.push(rawParts[p]);
    }
  }

  if (!serviceParts.length || !clientParts.length) {
    return { ok: false, reason: "TITLE_MUST_CONTAIN_CLIENT_AND_EXACT_CATALOG_SERVICE" };
  }
  var uniqueServices = [];
  var seenIds = {};
  for (var i = 0; i < serviceParts.length; i++) {
    var service = serviceParts[i];
    if (!service.id || seenIds[service.id]) continue;
    seenIds[service.id] = true;
    uniqueServices.push(service);
  }
  if (!uniqueServices.length) return { ok: false, reason: "SERVICE_ID_MISSING_OR_DUPLICATE" };

  var clientName = clientParts.join(" - ").trim();
  var clientNorm = cfsNormalize_(clientName);
  if (clientNorm.length < 3 || /\b(bloqueio|bloqueado|folga|ferias|feriado|almoco|reuniao|teste|administrativo)\b/.test(clientNorm)) {
    return { ok: false, reason: "CLIENT_NAME_NOT_CONFIRMED" };
  }
  return {
    ok: true,
    clientName: clientName,
    service: uniqueServices[0],
    additionalServices: uniqueServices.slice(1)
  };
}

function cfsDeterministicAppointmentId_(eventId, dateKey) {
  var source = String(eventId || "") + "|" + String(dateKey || "");
  var hash = 2166136261;
  for (var i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "apt-gcal-" + (hash >>> 0).toString(16).padStart(8, "0");
}

function cfsReadRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), CFS_EVENT_ID_COLUMN);
  var values = lastRow ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var display = lastRow ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i], d = display[i];
    rows.push({
      row: i + 1,
      values: r,
      client: String(r[1] || "").trim(),
      procedure: String(r[4] || "").trim(),
      dateKey: cfsDateKey_(r[5] || d[5]),
      timeKey: cfsTimeKey_(r[6] || d[6]),
      status: cfsNormalize_(r[8]),
      appointmentId: String(r[9] || "").trim(),
      additionalIds: cfsParseAdditionalIds_(r[13]),
      serviceId: String(r[15] || "").trim(),
      eventId: String(r[19] || "").trim()
    });
  }
  return { rows: rows, lastRow: lastRow, lastCol: lastCol };
}

function cfsRowGuard_(row) {
  if (!row) return "ROW_NOT_FOUND";
  if (row.status === "cancelado" || row.status === "cancelada" || row.status === "cancelled" || row.status === "excluido") return "CANCELLED_ROW";
  if (row.status === "bloqueado" || row.status === "teste sistema") return "PROTECTED_ROW";
  if (CFS_EXCLUDED_APPOINTMENT_IDS[row.appointmentId]) return "EXCLUDED_APPOINTMENT";
  if (CFS_REVIEW_APPOINTMENT_IDS[row.appointmentId]) return "PENDING_HUMAN_REVIEW";
  return "";
}

function cfsEventIdentityConfirmed_(event, row) {
  var description = String(event.getDescription() || "");
  if (row.appointmentId && description.indexOf(CFS_APPOINTMENT_TAG_PREFIX + row.appointmentId + "]") >= 0) return true;
  var title = cfsNormalize_(event.getTitle());
  var client = cfsNormalize_(row.client);
  if (!client) return false;
  if (title.indexOf(client) >= 0) return true;
  var tokens = client.split(" ").filter(function(token) { return token.length >= 3; });
  if (tokens.length >= 2) {
    var matched = tokens.filter(function(token) { return title.indexOf(token) >= 0; }).length;
    return matched >= 2;
  }
  return tokens.length === 1 && tokens[0].length >= 5 && title.indexOf(tokens[0]) >= 0;
}

function cfsFindRowForEvent_(event, eventDate, eventTime, rows) {
  var id = String(event.getId() || "");
  var recurring = cfsIsRecurring_(event);
  var byId = rows.filter(function(row) { return row.eventId && cfsEventIdEqual_(row.eventId, id); });
  var sameDate = byId.filter(function(row) { return row.dateKey === eventDate; });

  if (sameDate.length === 1) return { row: sameDate[0], method: "EVENT_ID_AND_OCCURRENCE_DATE" };
  if (sameDate.length > 1) return { error: "DUPLICATE_EVENT_ID_AND_DATE_ROWS" };

  if (recurring && byId.length) {
    var tagRows = rows.filter(function(row) {
      return row.appointmentId && String(event.getDescription() || "").indexOf(CFS_APPOINTMENT_TAG_PREFIX + row.appointmentId + "]") >= 0;
    });
    if (tagRows.length === 1) return { row: tagRows[0], method: "RECURRING_OCCURRENCE_APPOINTMENT_TAG" };
    return { error: "RECURRING_OCCURRENCE_DATE_MISMATCH_REVIEW" };
  }

  if (!recurring && byId.length === 1) return { row: byId[0], method: "UNIQUE_NON_RECURRING_EVENT_ID" };
  if (!recurring && byId.length > 1) return { error: "DUPLICATE_NON_RECURRING_EVENT_ID_ROWS" };

  var titleNorm = cfsNormalize_(event.getTitle());
  var candidates = rows.filter(function(row) {
    if (row.eventId || row.dateKey !== eventDate || row.timeKey !== eventTime) return false;
    if (cfsRowGuard_(row)) return false;
    var client = cfsNormalize_(row.client);
    if (!client) return false;
    if (titleNorm.indexOf(client) >= 0) return true;
    var tokens = client.split(" ").filter(function(token) { return token.length >= 3; });
    if (tokens.length >= 2) return tokens.filter(function(token) { return titleNorm.indexOf(token) >= 0; }).length >= 2;
    return tokens.length === 1 && tokens[0].length >= 5 && titleNorm.indexOf(tokens[0]) >= 0;
  });
  if (candidates.length === 1) return { row: candidates[0], method: "UNIQUE_DATE_TIME_AND_CLIENT" };
  if (candidates.length > 1) return { error: "AMBIGUOUS_DATE_TIME_AND_CLIENT_MATCH" };

  var newId = cfsDeterministicAppointmentId_(id, eventDate);
  var byDeterministicId = rows.filter(function(row) { return row.appointmentId === newId; });
  if (byDeterministicId.length === 1) return { row: byDeterministicId[0], method: "DETERMINISTIC_APPOINTMENT_ID" };
  if (byDeterministicId.length > 1) return { error: "DUPLICATE_DETERMINISTIC_APPOINTMENT_ID" };

  return { row: null, method: "NEW_CALENDAR_EVENT" };
}

function cfsHasConflict_(event, targetEnd, allEvents) {
  var startMs = event.getStartTime().getTime();
  var endMs = targetEnd.getTime();
  var eventId = String(event.getId() || "");
  for (var i = 0; i < allEvents.length; i++) {
    var other = allEvents[i];
    if (other === event) continue;
    var otherStart = other.getStartTime().getTime();
    var otherEnd = other.getEndTime().getTime();
    if (cfsEventIdEqual_(other.getId(), eventId) && otherStart === startMs) continue;
    if (otherStart < endMs && otherEnd > startMs) {
      return { conflict: true, eventId: other.getId(), title: other.getTitle(), start: other.getStartTime(), end: other.getEndTime() };
    }
  }
  return { conflict: false };
}

function cfsGetWriteEnabled_() {
  return String(PropertiesService.getScriptProperties().getProperty("CALENDAR_FIRST_SYNC_ENABLED") || "").trim().toLowerCase() === "true";
}

function cfsOpenContext_() {
  var props = PropertiesService.getScriptProperties();
  var configuredId = String(props.getProperty("SPREADSHEET_ID") || "").trim();
  var targetId = typeof TARGET_SPREADSHEET_ID !== "undefined" ? String(TARGET_SPREADSHEET_ID || "").trim() : "";
  if (!configuredId || !targetId || configuredId !== targetId) {
    throw new Error("SPREADSHEET_ID ausente ou diferente de TARGET_SPREADSHEET_ID. Sincronização bloqueada.");
  }
  var calendarId = String(props.getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID ausente nas Script Properties.");
  var spreadsheet = SpreadsheetApp.openById(configuredId);
  var appointmentsSheet = spreadsheet.getSheetByName("Agendamentos");
  if (!appointmentsSheet) throw new Error("Aba Agendamentos não encontrada.");
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) throw new Error("Calendário não encontrado ou sem acesso.");
  var catalog = cfsReadCatalog_(spreadsheet);
  if (!catalog.tabsRead.length) throw new Error("Nenhuma aba oficial de serviços foi encontrada.");
  return { spreadsheet: spreadsheet, appointmentsSheet: appointmentsSheet, calendar: calendar, catalog: catalog, calendarId: calendarId };
}

function auditCalendarFirstSyncConfig() {
  var props = PropertiesService.getScriptProperties();
  var report = {
    readOnly: true,
    writeEnabled: cfsGetWriteEnabled_(),
    timeZone: CFS_TIME_ZONE,
    spreadsheetPropertyConfigured: !!String(props.getProperty("SPREADSHEET_ID") || "").trim(),
    calendarPropertyConfigured: !!String(props.getProperty("GOOGLE_CALENDAR_ID") || "").trim(),
    spreadsheetMatchesCodeTarget: false,
    spreadsheetAccessible: false,
    appointmentsTabFound: false,
    eventIdHeader: "",
    serviceTabs: [],
    calendarAccessible: false,
    calendarName: "",
    blockers: []
  };
  var configuredId = String(props.getProperty("SPREADSHEET_ID") || "").trim();
  var targetId = typeof TARGET_SPREADSHEET_ID !== "undefined" ? String(TARGET_SPREADSHEET_ID || "").trim() : "";
  report.spreadsheetMatchesCodeTarget = !!configuredId && !!targetId && configuredId === targetId;
  if (!report.spreadsheetPropertyConfigured) report.blockers.push("SPREADSHEET_ID não configurada.");
  else if (!report.spreadsheetMatchesCodeTarget) report.blockers.push("SPREADSHEET_ID não corresponde a TARGET_SPREADSHEET_ID.");

  if (report.spreadsheetMatchesCodeTarget) {
    try {
      var ss = SpreadsheetApp.openById(configuredId);
      report.spreadsheetAccessible = true;
      var ag = ss.getSheetByName("Agendamentos");
      report.appointmentsTabFound = !!ag;
      if (ag) report.eventIdHeader = String(ag.getRange(1, CFS_EVENT_ID_COLUMN).getDisplayValue() || "").trim();
      var names = ["Serviços", "Servicos", "Depilação", "Depilacao"];
      names.forEach(function(name) { if (ss.getSheetByName(name)) report.serviceTabs.push(name); });
    } catch (e) {
      report.blockers.push("Planilha inacessível: " + String(e.message || e));
    }
  }
  if (!report.appointmentsTabFound) report.blockers.push("Aba Agendamentos não encontrada.");
  if (!report.serviceTabs.length) report.blockers.push("Abas oficiais de serviços não encontradas.");
  var calendarId = String(props.getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  if (!calendarId) {
    report.blockers.push("GOOGLE_CALENDAR_ID não configurado.");
  } else {
    try {
      var calendar = CalendarApp.getCalendarById(calendarId);
      report.calendarAccessible = !!calendar;
      report.calendarName = calendar ? calendar.getName() : "";
      if (!calendar) report.blockers.push("Calendário não encontrado ou sem permissão.");
    } catch (e2) {
      report.blockers.push("Calendário inacessível: " + String(e2.message || e2));
    }
  }
  report.readyForDryRun = report.blockers.length === 0;
  report.safety = "Somente leitura: nenhuma célula, propriedade, trigger ou evento foi alterado.";
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function runCalendarFirstSyncDryRun(options) {
  options = options || {};
  options.dryRun = true;
  return syncCalendarBookingsAndDurations(options);
}

function syncCalendarBookingsAndDurations(options) {
  options = options || {};
  var dryRun = options.dryRun !== false || !cfsGetWriteEnabled_();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (lockError) {
    return { status: "error", errorCode: "LOCK_TIMEOUT", dryRun: dryRun };
  }

  try {
    var cache = CacheService.getScriptCache();
    if (!dryRun && cache.get(CFS_LOOP_GUARD_KEY)) {
      return { status: "ignored_loop_guard", dryRun: dryRun };
    }
    var ctx = cfsOpenContext_();
    var sheet = ctx.appointmentsSheet;
    var rowData = cfsReadRows_(sheet);
    var now = new Date();
    var startKey = options.startDate || Utilities.formatDate(now, CFS_TIME_ZONE, "yyyy-MM-dd");
    var endDate = new Date(now.getTime());
    endDate.setDate(endDate.getDate() + Number(options.daysAhead || 365));
    var endKey = options.endDate || Utilities.formatDate(endDate, CFS_TIME_ZONE, "yyyy-MM-dd");
    var allEvents = ctx.calendar.getEvents(
      new Date(startKey + "T00:00:00-03:00"),
      new Date(endKey + "T23:59:59-03:00")
    );

    var claimedRows = {};
    var rowsToAppend = [];
    var rowUpdates = [];
    var needsReview = [];
    var protectedEvents = [];
    var durationResults = [];
    var imported = 0, linked = 0, dateTimeUpdates = 0;

    for (var i = 0; i < allEvents.length; i++) {
      var event = allEvents[i];
      var eventStart = event.getStartTime();
      var eventEnd = event.getEndTime();
      var eventDate = Utilities.formatDate(eventStart, CFS_TIME_ZONE, "yyyy-MM-dd");
      var eventTime = Utilities.formatDate(eventStart, CFS_TIME_ZONE, "HH:mm");
      var eventId = String(event.getId() || "");
      var title = String(event.getTitle() || "");
      var protectedReason = cfsProtectedReason_(event);
      if (protectedReason) {
        protectedEvents.push({ eventId: eventId, title: title, reason: protectedReason });
        continue;
      }
      if (eventStart.getTime() <= now.getTime()) continue;

      var match = cfsFindRowForEvent_(event, eventDate, eventTime, rowData.rows);
      var row = match.row || null;
      var isNew = false;

      if (match.error) {
        needsReview.push({ eventId: eventId, title: title, date: eventDate, time: eventTime, reason: match.error });
        continue;
      }

      if (row) {
        if (claimedRows[row.row]) {
          needsReview.push({ eventId: eventId, title: title, date: eventDate, time: eventTime, reason: "SHEET_ROW_ALREADY_MATCHED_TO_ANOTHER_CALENDAR_EVENT", row: row.row });
          continue;
        }
        var rowGuard = cfsRowGuard_(row);
        if (rowGuard) {
          if (rowGuard === "CANCELLED_ROW") {
            needsReview.push({ eventId: eventId, title: title, date: eventDate, time: eventTime, reason: "CALENDAR_EVENT_LINKED_TO_CANCELLED_SHEET_ROW", row: row.row });
          }
          continue;
        }
        if (row.eventId && !cfsEventIdEqual_(row.eventId, eventId)) {
          needsReview.push({ eventId: eventId, title: title, date: eventDate, time: eventTime, reason: "SHEET_ROW_ALREADY_LINKED_TO_DIFFERENT_EVENT", row: row.row });
          continue;
        }
        claimedRows[row.row] = true;
        linked++;

        var newValues = {};
        if (row.dateKey !== eventDate) newValues.date = eventDate;
        if (row.timeKey !== eventTime) newValues.time = eventTime;
        if (!row.eventId) newValues.eventId = eventId;
        if (Object.keys(newValues).length) {
          rowUpdates.push({ row: row.row, values: newValues });
          dateTimeUpdates++;
          row.dateKey = eventDate;
          row.timeKey = eventTime;
          row.eventId = eventId;
        }
      } else {
        var classification = cfsMatchTitleToCatalog_(title, ctx.catalog);
        if (!classification.ok) {
          needsReview.push({ eventId: eventId, title: title, date: eventDate, time: eventTime, reason: classification.reason });
          continue;
        }
        var aptId = cfsDeterministicAppointmentId_(eventId, eventDate);
        if (rowData.rows.some(function(existing) { return existing.appointmentId === aptId; })) {
          needsReview.push({ eventId: eventId, title: title, date: eventDate, time: eventTime, reason: "DETERMINISTIC_APPOINTMENT_ID_ALREADY_EXISTS" });
          continue;
        }
        var width = rowData.lastCol;
        var newValuesArr = new Array(width);
        for (var c = 0; c < width; c++) newValuesArr[c] = "";
        newValuesArr[0] = new Date();
        newValuesArr[1] = classification.clientName;
        newValuesArr[4] = classification.service.title;
        newValuesArr[5] = eventDate;
        newValuesArr[6] = eventTime;
        newValuesArr[8] = "confirmado";
        newValuesArr[9] = aptId;
        newValuesArr[10] = "Importado do Google Calendar";
        newValuesArr[13] = JSON.stringify(classification.additionalServices.map(function(s) { return s.id; }));
        newValuesArr[15] = classification.service.id;
        newValuesArr[19] = eventId;
        row = {
          row: rowData.lastRow + rowsToAppend.length + 1,
          values: newValuesArr,
          client: classification.clientName,
          procedure: classification.service.title,
          dateKey: eventDate,
          timeKey: eventTime,
          status: "confirmado",
          appointmentId: aptId,
          additionalIds: classification.additionalServices.map(function(s) { return s.id; }),
          serviceId: classification.service.id,
          eventId: eventId
        };
        rowsToAppend.push(newValuesArr);
        rowData.rows.push(row);
        claimedRows[row.row] = true;
        imported++;
        isNew = true;
      }

      var durationGuard = CFS_DURATION_EXCEPTION_IDS[row.appointmentId] ? "AUTHORIZED_DURATION_EXCEPTION" :
        (CFS_REVIEW_APPOINTMENT_IDS[row.appointmentId] ? "PENDING_HUMAN_REVIEW" : "");
      if (durationGuard) {
        durationResults.push({ eventId: eventId, row: row.row, status: durationGuard });
        continue;
      }
      if (!cfsEventIdentityConfirmed_(event, row)) {
        durationResults.push({ eventId: eventId, row: row.row, status: "CLIENT_IDENTITY_NOT_CONFIRMED" });
        continue;
      }

      var lookup = cfsResolveServiceDuration_(ctx.catalog, row.serviceId, row.procedure, row.additionalIds);
      if (!lookup.ok) {
        durationResults.push({ eventId: eventId, row: row.row, status: "DURATION_REVIEW", errorCode: lookup.errorCode, message: lookup.message });
        continue;
      }

      var targetEnd = new Date(eventStart.getTime() + lookup.durationMinutes * 60000);
      if (Utilities.formatDate(targetEnd, CFS_TIME_ZONE, "yyyy-MM-dd") !== eventDate) {
        durationResults.push({ eventId: eventId, row: row.row, status: "CROSSES_MIDNIGHT_REVIEW", durationMinutes: lookup.durationMinutes });
        continue;
      }
      if (eventEnd.getTime() === targetEnd.getTime()) {
        durationResults.push({ eventId: eventId, row: row.row, status: "UNCHANGED", durationMinutes: lookup.durationMinutes });
        continue;
      }
      var conflict = cfsHasConflict_(event, targetEnd, allEvents);
      if (conflict.conflict) {
        durationResults.push({ eventId: eventId, row: row.row, status: "OVERLAP_REVIEW", conflictingEventId: conflict.eventId, conflictingTitle: conflict.title });
        continue;
      }

      if (dryRun) {
        durationResults.push({
          eventId: eventId, row: row.row, status: "WOULD_UPDATE_END_ONLY",
          startPreserved: Utilities.formatDate(eventStart, CFS_TIME_ZONE, "yyyy-MM-dd HH:mm"),
          currentEnd: Utilities.formatDate(eventEnd, CFS_TIME_ZONE, "yyyy-MM-dd HH:mm"),
          proposedEnd: Utilities.formatDate(targetEnd, CFS_TIME_ZONE, "yyyy-MM-dd HH:mm"),
          durationMinutes: lookup.durationMinutes, importedInThisRun: isNew
        });
      } else {
        try {
          cache.put(CFS_LOOP_GUARD_KEY, String(new Date().getTime()), CFS_LOOP_GUARD_SECONDS);
          event.setTime(eventStart, targetEnd);
          durationResults.push({ eventId: eventId, row: row.row, status: "UPDATED_END_ONLY", durationMinutes: lookup.durationMinutes });
        } catch (updateError) {
          durationResults.push({ eventId: eventId, row: row.row, status: "CALENDAR_UPDATE_ERROR", message: String(updateError.message || updateError) });
        }
      }
    }

    if (!dryRun) {
      var header = String(sheet.getRange(1, CFS_EVENT_ID_COLUMN).getDisplayValue() || "").trim();
      if (!header) {
        sheet.getRange(1, CFS_EVENT_ID_COLUMN).setValue(CFS_EVENT_ID_HEADER);
      } else if (cfsNormalize_(header).indexOf("event id") < 0 && cfsNormalize_(header).indexOf("google calendar") < 0) {
        throw new Error("A coluna T já possui outro cabeçalho; escrita bloqueada para preservar a planilha.");
      }

      rowUpdates.forEach(function(update) {
        if (update.values.date) sheet.getRange(update.row, 6).setValue(update.values.date);
        if (update.values.time) sheet.getRange(update.row, 7).setValue(update.values.time);
        if (update.values.eventId) sheet.getRange(update.row, CFS_EVENT_ID_COLUMN).setValue(update.values.eventId);
      });
      if (rowsToAppend.length) {
        sheet.getRange(rowData.lastRow + 1, 1, rowsToAppend.length, rowData.lastCol).setValues(rowsToAppend);
      }
      SpreadsheetApp.flush();
    }

    var result = {
      status: "success",
      dryRun: dryRun,
      writeEnabled: cfsGetWriteEnabled_(),
      range: { start: startKey, end: endKey },
      counts: {
        calendarEventsScanned: allEvents.length,
        existingRowsLinked: linked,
        rowsImported: imported,
        existingRowsUpdatedFromCalendar: dateTimeUpdates,
        calendarEndsWouldBeUpdatedOrUpdated: durationResults.filter(function(x) { return x.status === "WOULD_UPDATE_END_ONLY" || x.status === "UPDATED_END_ONLY"; }).length,
        unchangedDurations: durationResults.filter(function(x) { return x.status === "UNCHANGED"; }).length,
        protectedEvents: protectedEvents.length,
        requiringReview: needsReview.length + durationResults.filter(function(x) { return x.status.indexOf("REVIEW") >= 0 || x.status === "DURATION_REVIEW" || x.status === "CLIENT_IDENTITY_NOT_CONFIRMED"; }).length
      },
      importedRows: rowsToAppend.length,
      rowUpdates: rowUpdates,
      protectedEvents: protectedEvents,
      needsAdminReview: needsReview,
      durationResults: durationResults,
      safety: dryRun
        ? "DRY RUN: nenhuma linha foi criada/alterada e nenhum evento do Calendar foi modificado."
        : "Calendar -> Sheets -> catálogo Serviços!F -> ajuste exclusivo do término. Nenhum evento foi criado, movido ou excluído."
    };
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function handleCalendarFirstSyncCalendarEventUpdated(e) {
  if (CacheService.getScriptCache().get(CFS_LOOP_GUARD_KEY)) return { status: "ignored_loop_guard" };
  return syncCalendarBookingsAndDurations({ dryRun: false });
}

function handleCalendarFirstSyncServiceDurationEdit(e) {
  if (!e || !e.range) return { status: "ignored", reason: "NO_EDIT_RANGE" };
  if (!cfsGetWriteEnabled_()) return { status: "skipped_disabled" };
  if (CacheService.getScriptCache().get(CFS_LOOP_GUARD_KEY)) return { status: "ignored_loop_guard" };
  var range = e.range;
  var sheetName = cfsNormalize_(range.getSheet().getName());
  if (sheetName !== "servicos" && sheetName !== "depilacao") return { status: "ignored", reason: "NOT_SERVICE_CATALOG" };
  if (range.getColumn() > 6 || range.getLastColumn() < 6 || range.getLastRow() < 2) return { status: "ignored", reason: "NOT_DURATION_COLUMN_F" };
  return syncCalendarBookingsAndDurations({ dryRun: false });
}

/**
 * Explicit setup only. Does not delete legacy triggers or install anything unless called
 * manually after CALENDAR_FIRST_SYNC_ENABLED is set to "true".
 */
function installCalendarFirstSyncTriggers() {
  if (!cfsGetWriteEnabled_()) throw new Error("Ative CALENDAR_FIRST_SYNC_ENABLED=true somente após aprovação da operação.");
  var ctx = cfsOpenContext_();
  var triggers = ScriptApp.getProjectTriggers();
  var hasCalendar = false, hasSheetEdit = false;
  triggers.forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (handler === "handleCalendarFirstSyncCalendarEventUpdated") hasCalendar = true;
    if (handler === "handleCalendarFirstSyncServiceDurationEdit") hasSheetEdit = true;
  });
  var installed = [];
  if (!hasCalendar) {
    ScriptApp.newTrigger("handleCalendarFirstSyncCalendarEventUpdated")
      .forUserCalendar(ctx.calendarId).onEventUpdated().create();
    installed.push("handleCalendarFirstSyncCalendarEventUpdated");
  }
  if (!hasSheetEdit) {
    ScriptApp.newTrigger("handleCalendarFirstSyncServiceDurationEdit")
      .forSpreadsheet(ctx.spreadsheet).onEdit().create();
    installed.push("handleCalendarFirstSyncServiceDurationEdit");
  }
  return { status: "success", installed: installed, safety: "Nenhum gatilho existente foi removido." };
}
