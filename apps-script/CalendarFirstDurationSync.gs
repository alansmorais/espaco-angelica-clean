/**
 * Espaço Angélica — Calendar-first sync (safe, opt-in).
 *
 * Google Calendar is authoritative for appointment existence, actual start/date and
 * recurring occurrence identity. Sheets is authoritative for service/add-on durations.
 * Agendamentos!T stores the unique Calendar event/instance ID.
 * Agendamentos!U stores originalStartTime for recurring instances.
 *
 * The sync imports Calendar events into Sheets, then reads the official service
 * catalogue (Services column F) and PATCHES ONLY the event end. It never creates,
 * deletes, moves, renames or rewrites Calendar events.
 *
 * Requires the Apps Script Advanced Google service "Calendar API" v3 (symbol Calendar).
 * Required Script Properties:
 *   SPREADSHEET_ID                 exact TARGET_SPREADSHEET_ID from Code.gs
 *   GOOGLE_CALENDAR_ID             shared studio calendar ID
 *   CALENDAR_FIRST_SYNC_ENABLED    "true" only after explicit production approval
 *
 * No trigger is installed automatically. Write mode is disabled by default.
 */

var CFS_TIME_ZONE = "America/Sao_Paulo";
var CFS_EVENT_ID_COLUMN = 20;          // T
var CFS_ORIGINAL_START_COLUMN = 21;    // U
var CFS_EVENT_ID_HEADER = "Google Calendar Event ID";
var CFS_ORIGINAL_START_HEADER = "Google Calendar Original Start";
var CFS_LOOP_GUARD_KEY = "CFS_INTERNAL_SYNC_LOCK";
var CFS_LOOP_GUARD_SECONDS = 20;
var CFS_APPOINTMENT_TAG_PREFIX = "[ESPACO_ANGELICA_APT_ID:";
var CFS_LAST_SYNC_STATUS_KEY = "CFS_LAST_SYNC_STATUS";

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
  return null;
}

function cfsReadCatalog_(spreadsheet) {
  var names = ["Serviços", "Servicos", "Depilação", "Depilacao"];
  var byId = {}, byTitle = {}, tabsRead = [];
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
      if (id) { byId[id] = byId[id] || []; byId[id].push(item); }
      if (item.normalizedTitle) { byTitle[item.normalizedTitle] = byTitle[item.normalizedTitle] || []; byTitle[item.normalizedTitle].push(item); }
    }
  });
  return { byId: byId, byTitle: byTitle, tabsRead: tabsRead };
}

function cfsResolveServiceDuration_(catalog, mainServiceId, mainServiceTitle, additionalIds) {
  var addIds = additionalIds === null ? null : (additionalIds || []);
  if (addIds === null) return { ok: false, errorCode: "INVALID_ADDITIONAL_SERVICE_LIST", message: "Lista de serviços adicionais inválida." };

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

  if (main.durationMinutes === null) return { ok: false, errorCode: "INVALID_MAIN_DURATION", message: "Duração inválida em " + main.sheetName + "!F" + main.row + "." };
  var total = main.durationMinutes, resolvedAdditional = [];
  for (var a = 0; a < addIds.length; a++) {
    var addId = String(addIds[a] || "").trim();
    var addMatches = catalog.byId[addId] || [];
    if (!addId || addMatches.length !== 1 || addMatches[0].durationMinutes === null) {
      return { ok: false, errorCode: "INVALID_ADDITIONAL_DURATION", message: "Serviço adicional ausente, duplicado ou sem duração válida: " + addId };
    }
    total += addMatches[0].durationMinutes;
    resolvedAdditional.push(addMatches[0]);
  }
  if (total <= 0 || total > 1440) return { ok: false, errorCode: "TOTAL_DURATION_OUT_OF_RANGE", message: "Duração total fora do intervalo permitido." };
  return { ok: true, service: main, additionalServices: resolvedAdditional, durationMinutes: total };
}

function cfsDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, CFS_TIME_ZONE, "yyyy-MM-dd");
  var raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  var br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (br) return br[3] + "-" + ("0" + br[2]).slice(-2) + "-" + ("0" + br[1]).slice(-2);
  return "";
}

function cfsTimeKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, CFS_TIME_ZONE, "HH:mm");
  var raw = String(value || "").trim();
  var match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) return "";
  var hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return ("0" + hours).slice(-2) + ":" + ("0" + minutes).slice(-2);
}

function cfsEventStart_(event) {
  if (!event || !event.start) return null;
  if (event.start.dateTime) return new Date(event.start.dateTime);
  if (event.start.date) return new Date(event.start.date + "T00:00:00-03:00");
  return null;
}

function cfsEventEnd_(event) {
  if (!event || !event.end) return null;
  if (event.end.dateTime) return new Date(event.end.dateTime);
  if (event.end.date) return new Date(event.end.date + "T00:00:00-03:00");
  return null;
}

function cfsOriginalStartRaw_(event) {
  if (!event || !event.originalStartTime) return "";
  return String(event.originalStartTime.dateTime || event.originalStartTime.date || "");
}

function cfsOriginalDateTime_(event) {
  var original = event && event.originalStartTime;
  if (!original) return { date: "", time: "" };
  if (original.dateTime) {
    var date = new Date(original.dateTime);
    return {
      date: Utilities.formatDate(date, CFS_TIME_ZONE, "yyyy-MM-dd"),
      time: Utilities.formatDate(date, CFS_TIME_ZONE, "HH:mm")
    };
  }
  return { date: String(original.date || ""), time: "" };
}

function cfsEventIdEqual_(left, right) {
  var a = String(left || "").trim();
  var b = String(right || "").trim();
  if (a === b) return true;
  return a.replace(/@google\.com$/i, "") === b.replace(/@google\.com$/i, "");
}
function cfsDeterministicAppointmentId_(eventId, occurrenceKey) {
  var source = String(eventId || "") + "|" + String(occurrenceKey || "");
  var hash = 2166136261;
  for (var i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return "apt-gcal-" + (hash >>> 0).toString(16).padStart(8, "0");
}

function cfsProtectedReason_(event) {
  if (!event || !event.start || event.start.date || !event.start.dateTime) return "ALL_DAY_OR_MISSING_START";
  if (event.eventType && event.eventType !== "default") return "NON_STANDARD_EVENT_TYPE";
  var title = cfsNormalize_(event.summary || "");
  if (!title) return "EMPTY_TITLE";
  if (/\b(bloqueio|bloqueado|bloqueada|folga|ferias|feriado|almoco|reuniao|reunioes|pessoal|administrativo|indisponivel|indisponibilidade|compromisso|curso|treinamento|capacitacao|workshop|viagem|teste|integracao|integration|e2e)\b/.test(title)) {
    return "PROTECTED_OR_TEST_EVENT";
  }
  return "";
}

function cfsNormalizePhoneKey_(value) {
  var digits = String(value || "").replace(/\D/g, "");
  if (digits.indexOf("55") === 0 && (digits.length === 12 || digits.length === 13)) {
    digits = digits.substring(2);
  }
  if (digits.indexOf("0") === 0 && (digits.length === 11 || digits.length === 12)) {
    digits = digits.substring(1);
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function cfsPhonesMatch_(phoneA, phoneB) {
  var a = cfsNormalizePhoneKey_(phoneA);
  var b = cfsNormalizePhoneKey_(phoneB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10 && a.substring(0, 2) === b.substring(0, 2) && a.slice(-8) === b.slice(-8)) {
    return true;
  }
  if ((a.length === 8 || a.length === 9) && (b.length === 10 || b.length === 11) && b.slice(-8) === a.slice(-8)) {
    return true;
  }
  if ((b.length === 8 || b.length === 9) && (a.length === 10 || a.length === 11) && a.slice(-8) === b.slice(-8)) {
    return true;
  }
  return false;
}

function cfsCanonicalClientName_(rawName) {
  var clean = String(rawName || "").replace(/\s+/g, " ").trim();
  var norm = cfsNormalize_(clean);
  if (norm === "kristine") return "Kristine Sorensen";
  if (norm === "josefina") return "Josefina Calderón";
  return clean;
}

function cfsIsGenericClientPhrase_(value) {
  var norm = cfsNormalize_(value);
  if (!norm || norm.length < 3) return true;
  if (/^(agendamento|agendamento de unhas|agendamento unhas|agendamentos|atendimento|atendimento de unhas|horario|reserva|unhas|cliente|clientes|lika nails designer|espaco angelica|espaco angelica do carmo|horario bloqueado|bloqueio do google agenda|evento do google agenda|local|location|booking notes|business name|business phone|customer name|customer phone)$/.test(norm)) {
    return true;
  }
  if (/\b(bloqueio|bloqueado|bloqueada|folga|ferias|feriado|almoco|reuniao|reunioes|teste|administrativo|curso|treinamento|capacitacao|workshop|dentista|medico|consulta|evento|pessoal|indisponivel|viagem)\b/.test(norm)) {
    return true;
  }
  if (/^(?:data preferida|horario preferido|location|local|chat with|business|http|https|www\.)/.test(norm)) {
    return true;
  }
  if (/^\d{1,4}[\/-]\d{1,2}(?:[\/-]\d{2,4})?(?:\s+\d{1,2}[:h]\d{0,2}(?:\s*brt)?)?$/.test(norm)) {
    return true;
  }
  if (/^\d+$/.test(norm.replace(/[\s()+-]/g, ""))) {
    return true;
  }
  return false;
}

function cfsReadKnownClients_(spreadsheet, appointmentRows) {
  var byNormalized = {};
  function addClient(nameVal, phoneVal, emailVal) {
    var canonical = cfsCanonicalClientName_(nameVal);
    if (cfsIsGenericClientPhrase_(canonical)) return;
    var normalized = cfsNormalize_(canonical);
    if (!byNormalized[normalized]) {
      byNormalized[normalized] = { normalized: normalized, name: canonical, phones: [], emails: [] };
    }
    var entry = byNormalized[normalized];
    if (canonical.length > entry.name.length) entry.name = canonical;
    var phoneKey = cfsNormalizePhoneKey_(phoneVal);
    if (phoneKey && entry.phones.indexOf(phoneKey) === -1) entry.phones.push(phoneKey);
    var email = String(emailVal || "").trim().toLowerCase();
    if (email && email.indexOf("@") > 0 && entry.emails.indexOf(email) === -1) entry.emails.push(email);
  }
  (appointmentRows || []).forEach(function(row) {
    if (!cfsRowGuard_(row)) {
      addClient(row.client, row.values ? row.values[2] : "", row.values ? row.values[3] : "");
    }
  });
  var profileSheet = spreadsheet.getSheetByName("Perfis de Clientes");
  if (profileSheet && profileSheet.getLastRow() >= 2) {
    var profileCols = Math.min(Math.max(profileSheet.getLastColumn(), 3), 4);
    var profileValues = profileSheet.getRange(2, 1, profileSheet.getLastRow() - 1, profileCols).getValues();
    profileValues.forEach(function(row) {
      var colPhone = String(row[1] || "").trim();
      var rawJson = String(row[2] || "").trim();
      if (rawJson) {
        try {
          var prof = JSON.parse(rawJson);
          if (prof && typeof prof === "object" && prof.name) {
            addClient(prof.name, prof.phone || colPhone, prof.email || "");
            return;
          }
        } catch (e) {}
      }
    });
  }
  var clientsSheet = spreadsheet.getSheetByName("Clientes");
  if (clientsSheet && clientsSheet.getLastRow() >= 2) {
    var clientValues = clientsSheet.getRange(2, 1, clientsSheet.getLastRow() - 1, Math.min(Math.max(clientsSheet.getLastColumn(), 3), 4)).getValues();
    clientValues.forEach(function(row) { addClient(row[1] || row[0], row[2] || "", ""); });
  }
  return Object.keys(byNormalized).map(function(key) { return byNormalized[key]; });
}

function cfsResolveCatalogAlias_(rawService, catalog) {
  var normalized = cfsNormalize_(rawService);
  var exact = catalog.byTitle[normalized] || [];
  if (exact.length === 1) return { ok: true, main: exact[0], additional: [], matchedBy: "EXACT_CATALOG_TITLE" };
  if (exact.length > 1) return { ok: false, reason: "AMBIGUOUS_EXACT_CATALOG_TITLE" };

  var aliases = {
    "mao": { main: "manicure-tradicional", additional: [] },
    "manicure": { main: "manicure-tradicional", additional: [] },
    "manicure tradicional": { main: "manicure-tradicional", additional: [] },
    "manicure convencional": { main: "manicure-tradicional", additional: [] },
    "pe": { main: "pedicure-tradicional", additional: [] },
    "pedicure": { main: "pedicure-tradicional", additional: [] },
    "pedicure tradicional": { main: "pedicure-tradicional", additional: [] },
    "pedicure convencional": { main: "pedicure-tradicional", additional: [] },
    "pe e mao": { main: "manicure-pedicure-tradicional", additional: [] },
    "pe e mao tradicional": { main: "manicure-pedicure-tradicional", additional: [] },
    "pe e mao convencional": { main: "manicure-pedicure-tradicional", additional: [] },
    "pe e mao completo": { main: "manicure-pedicure-tradicional", additional: [] },
    "mao e pe": { main: "manicure-pedicure-tradicional", additional: [] },
    "mao e pe tradicional": { main: "manicure-pedicure-tradicional", additional: [] },
    "mao e pe convencional": { main: "manicure-pedicure-tradicional", additional: [] },
    "manicure e pedicure": { main: "manicure-pedicure-tradicional", additional: [] },
    "manicure e pedicure convencional": { main: "manicure-pedicure-tradicional", additional: [] },
    "pedicure e manicure": { main: "manicure-pedicure-tradicional", additional: [] },
    "pe e mao domicilio": { main: "domicilio-pe-e-mao", additional: [] },
    "pe e mao a domicilio": { main: "domicilio-pe-e-mao", additional: [] },
    "pe e mao em domicilio": { main: "domicilio-pe-e-mao", additional: [] },
    "mao e pe domicilio": { main: "domicilio-pe-e-mao", additional: [] },
    "manicure e pedicure domicilio": { main: "domicilio-pe-e-mao", additional: [] },
    "mao domicilio": { main: "domicilio-mao", additional: [] },
    "mao a domicilio": { main: "domicilio-mao", additional: [] },
    "manicure domicilio": { main: "domicilio-mao", additional: [] },
    "pe domicilio": { main: "domicilio-pe", additional: [] },
    "pe a domicilio": { main: "domicilio-pe", additional: [] },
    "pedicure domicilio": { main: "domicilio-pe", additional: [] },
    "manutencao e pe": { main: "manutencao-fibra-vidro", additional: ["pedicure-tradicional"] },
    "manutencao de crescimento e pe": { main: "manutencao-fibra-vidro", additional: ["pedicure-tradicional"] },
    "manutencao": { main: "manutencao-fibra-vidro", additional: [] },
    "manutencao de crescimento": { main: "manutencao-fibra-vidro", additional: [] },
    "manutencao fibra de vidro": { main: "manutencao-fibra-vidro", additional: [] },
    "alongamento": { main: "alongamento-fibra-slim", additional: [] },
    "fibra de vidro": { main: "alongamento-fibra-slim", additional: [] },
    "fibra slim": { main: "alongamento-fibra-slim", additional: [] },
    "blindagem": { main: "blindagem-homens-incolor", additional: [] },
    "banho de gel": { main: "banho-em-gel", additional: [] },
    "banho em gel": { main: "banho-em-gel", additional: [] },
    "esmaltacao em gel": { main: "esmaltacao-gel-premium", additional: [] }
  };
  var mapping = aliases[normalized];
  if (!mapping) return { ok: false, reason: "SERVICE_ALIAS_NOT_RECOGNIZED" };

  function uniqueService(id) {
    var matches = catalog.byId[id] || [];
    return matches.length === 1 ? matches[0] : null;
  }
  var main = uniqueService(mapping.main);
  if (!main) return { ok: false, reason: "SERVICE_ALIAS_ID_NOT_UNIQUE_IN_OFFICIAL_CATALOG", serviceId: mapping.main };
  var additional = [];
  for (var i = 0; i < mapping.additional.length; i++) {
    var item = uniqueService(mapping.additional[i]);
    if (!item) return { ok: false, reason: "ADDITIONAL_ALIAS_ID_NOT_UNIQUE_IN_OFFICIAL_CATALOG", serviceId: mapping.additional[i] };
    additional.push(item);
  }
  return { ok: true, main: main, additional: additional, matchedBy: "APPROVED_LEGACY_ALIAS" };
}

function cfsResolveServiceList_(rawText, catalog) {
  var pieces = String(rawText || "").split(/\s*(?:\+|&)\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
  if (!pieces.length) return { ok: false, reason: "EMPTY_SERVICE_TEXT" };
  var resolved = [];
  for (var q = 0; q < pieces.length; q++) {
    var match = cfsResolveCatalogAlias_(pieces[q], catalog);
    if (!match.ok) return { ok: false, reason: match.reason };
    resolved.push(match);
  }
  var items = [], seen = {};
  resolved.forEach(function(m) {
    if (m.main && m.main.id && !seen[m.main.id]) { seen[m.main.id] = true; items.push(m.main); }
    (m.additional || []).forEach(function(add) {
      if (add && add.id && !seen[add.id]) { seen[add.id] = true; items.push(add); }
    });
  });
  if (!items.length) return { ok: false, reason: "SERVICE_ID_MISSING_OR_DUPLICATE" };
  return { ok: true, service: items[0], additionalServices: items.slice(1) };
}

function cfsStripHtmlToLines_(html) {
  var text = String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return text.split("\n").map(function(line) { return line.replace(/\s+/g, " ").trim(); }).filter(Boolean);
}

function cfsExtractEventMetadata_(event) {
  var summary = String((event && event.summary) || "").trim();
  var lines = cfsStripHtmlToLines_((event && event.description) || "");
  var customerName = "";
  var customerPhone = "";
  var customerEmail = "";
  var serviceField = "";
  var bookingNotesLines = [];
  var inBookingNotes = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^(?:booking\s*notes|notas\s*do\s*agendamento|observa[cç][õo]es|notas)\s*:/i.test(line)) {
      inBookingNotes = true;
      var inlineNotes = line.replace(/^(?:booking\s*notes|notas\s*do\s*agendamento|observa[cç][õo]es|notas)\s*:/i, "").trim();
      if (inlineNotes) bookingNotesLines.push(inlineNotes);
      continue;
    }
    if (inBookingNotes) {
      if (/^(?:business\s*name|business\s*phone|chat\s*with\s*business|customer\s*name|customer\s*phone|customer\s*email)\s*:/i.test(line)) {
        inBookingNotes = false;
      } else {
        bookingNotesLines.push(line);
        continue;
      }
    }
    var mName = /^(?:customer\s*name|nome\s*d[ao]\s*cliente|cliente)\s*:\s*(.+)$/i.exec(line);
    if (mName && !customerName && !cfsIsGenericClientPhrase_(mName[1])) {
      customerName = cfsCanonicalClientName_(mName[1]);
      continue;
    }
    var mPhone = /^(?:customer\s*phone|telefone\s*d[ao]\s*cliente|telefone|whatsapp)\s*:\s*(.+)$/i.exec(line);
    if (mPhone && !customerPhone) {
      var pVal = String(mPhone[1] || "").trim();
      if (cfsNormalizePhoneKey_(pVal)) customerPhone = pVal;
      continue;
    }
    var mChatCustomer = /^chat\s*with\s*customer\s*:\s*.*wa\.me\/(\d{8,15})/i.exec(line);
    if (mChatCustomer && !customerPhone) {
      customerPhone = "+" + mChatCustomer[1];
      continue;
    }
    var mEmail = /^(?:customer\s*email|e-?mail(?:\s*d[ao]\s*cliente)?)\s*:\s*([^\s@]+@[^\s@]+\.[^\s@]+)$/i.exec(line);
    if (mEmail && !customerEmail) {
      customerEmail = mEmail[1].trim().toLowerCase();
      continue;
    }
    var mService = /^(?:service|servi[cç]o|procedimento)\s*:\s*(.+)$/i.exec(line);
    if (mService && !serviceField) {
      serviceField = mService[1].trim();
      continue;
    }
  }

  var studioEmails = { "angelikm19@gmail.com": true, "alanpkmorais@gmail.com": true };
  var attendees = ((event && event.attendees) || []).filter(function(a) {
    if (!a || a.self || a.resource) return false;
    var em = String(a.email || "").trim().toLowerCase();
    return !studioEmails[em];
  }).map(function(a) {
    return {
      displayName: String(a.displayName || "").trim(),
      email: String(a.email || "").trim().toLowerCase()
    };
  });

  return {
    summary: summary,
    descriptionLines: lines,
    customerName: customerName,
    customerPhone: customerPhone,
    customerEmail: customerEmail,
    serviceField: serviceField,
    bookingNotes: bookingNotesLines.join(" - ").trim(),
    attendees: attendees
  };
}

function cfsResolveClientDeterministically_(candidateNames, phone, email, attendees, knownClients) {
  var list = knownClients || [];
  // 1. Strongest deterministic key: unique phone match against known official clients
  var phoneKey = cfsNormalizePhoneKey_(phone);
  if (phoneKey) {
    var phoneMatches = list.filter(function(c) {
      return (c.phones || []).some(function(p) { return cfsPhonesMatch_(p, phoneKey); });
    });
    if (phoneMatches.length === 1) {
      return { ok: true, clientName: phoneMatches[0].name, method: "KNOWN_CLIENT_BY_PHONE" };
    }
  }

  // 2. Deterministic email match (from description or attendee)
  var emailsToTry = [];
  if (email) emailsToTry.push(String(email).trim().toLowerCase());
  (attendees || []).forEach(function(a) { if (a.email) emailsToTry.push(a.email); });
  for (var eIdx = 0; eIdx < emailsToTry.length; eIdx++) {
    var em = emailsToTry[eIdx];
    var emailMatches = list.filter(function(c) { return (c.emails || []).indexOf(em) >= 0; });
    if (emailMatches.length === 1) {
      return { ok: true, clientName: emailMatches[0].name, method: "KNOWN_CLIENT_BY_EMAIL" };
    }
  }

  // 3. Evaluate explicit candidate names against known clients first, then explicit valid names
  var cleanedCandidates = [];
  (candidateNames || []).forEach(function(raw) {
    var c = cfsCanonicalClientName_(raw);
    if (!cfsIsGenericClientPhrase_(c) && cleanedCandidates.indexOf(c) === -1) cleanedCandidates.push(c);
  });
  (attendees || []).forEach(function(a) {
    var c = cfsCanonicalClientName_(a.displayName);
    if (!cfsIsGenericClientPhrase_(c) && cleanedCandidates.indexOf(c) === -1) cleanedCandidates.push(c);
  });

  for (var i = 0; i < cleanedCandidates.length; i++) {
    var cand = cleanedCandidates[i];
    var norm = cfsNormalize_(cand);
    var exact = list.filter(function(c) { return c.normalized === norm; });
    if (exact.length === 1) return { ok: true, clientName: exact[0].name, method: "KNOWN_CLIENT_EXACT_NAME" };
    var firstHits = list.filter(function(c) {
      var first = c.normalized.split(" ")[0];
      return first && first === norm;
    });
    var fullFirstHits = firstHits.filter(function(c) { return c.normalized.split(" ").length > 1; });
    if (fullFirstHits.length === 1) return { ok: true, clientName: fullFirstHits[0].name, method: "KNOWN_CLIENT_UNIQUE_FIRST_NAME" };
    if (fullFirstHits.length > 1) return { ok: false, reason: "AMBIGUOUS_CLIENT_FIRST_NAME" };
    if (firstHits.length === 1) return { ok: true, clientName: firstHits[0].name, method: "KNOWN_CLIENT_FIRST_NAME" };
  }

  if (cleanedCandidates.length >= 1) {
    return { ok: true, clientName: cleanedCandidates[0], method: "EXPLICIT_STRUCTURED_OR_SEPARATED_CLIENT" };
  }
  return { ok: false, reason: "CLIENT_NAME_NOT_CONFIRMED" };
}

function cfsMatchTitleToCatalog_(title, catalog, knownClients) {
  var rawTitle = String(title || "").trim();
  if (cfsIsGenericClientPhrase_(rawTitle)) {
    return { ok: false, reason: "TITLE_MUST_CONTAIN_KNOWN_CLIENT_AND_APPROVED_SERVICE" };
  }
  var rawParts = rawTitle.split(/\s*[-–—:|]\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
  var candidatePairs = [];

  // First support titles with a clear separator, for example "Client - Service".
  for (var p = 0; p < rawParts.length; p++) {
    var serviceText = rawParts[p];
    var servicePieces = serviceText.split(/\s*(?:\+|&)\s*/).map(function(s) { return s.trim(); }).filter(Boolean);
    if (!servicePieces.length) continue;
    var resolved = [];
    var valid = true;
    for (var q = 0; q < servicePieces.length; q++) {
      var serviceMatch = cfsResolveCatalogAlias_(servicePieces[q], catalog);
      if (!serviceMatch.ok) { valid = false; break; }
      resolved.push(serviceMatch);
    }
    if (!valid) continue;
    var clientParts = rawParts.filter(function(_, index) { return index !== p; });
    if (!clientParts.length) continue;
    var clientText = cfsCanonicalClientName_(clientParts.join(" - ").trim());
    if (cfsIsGenericClientPhrase_(clientText)) continue;
    var clientNorm = cfsNormalize_(clientText);
    var knownExact = (knownClients || []).filter(function(c) { return c.normalized === clientNorm; });
    var knownFirst = (knownClients || []).filter(function(c) {
      var first = c.normalized.split(" ")[0];
      return first && first === clientNorm;
    });
    // If old rows contain only "Kristine" but the official Clients tab has
    // "Kristine Sorensen", prefer the unique full official name.
    var knownFullFirst = knownFirst.filter(function(c) { return c.normalized.split(" ").length > 1; });
    var resolvedClient = knownFullFirst.length === 1 ? knownFullFirst[0].name :
      (knownFullFirst.length > 1 ? "" :
        (knownExact.length === 1 ? knownExact[0].name :
          (knownFirst.length === 1 ? knownFirst[0].name : clientText)));
    if ((knownExact.length > 1) || (knownFullFirst.length > 1) || !resolvedClient) continue;
    candidatePairs.push({ clientName: resolvedClient, resolved: resolved, method: "SEPARATED_TITLE" });
  }

  // Also support historical titles without separators, such as "Josefina Calderón Mão".
  var normalizedTitle = cfsNormalize_(rawTitle);
  var knownMatches = [];
  (knownClients || []).forEach(function(client) {
    var at = normalizedTitle.indexOf(client.normalized);
    if (at >= 0) {
      var before = normalizedTitle.slice(0, at).trim();
      var after = normalizedTitle.slice(at + client.normalized.length).trim();
      if (!before || !after) knownMatches.push({ client: client, serviceText: after || before });
    }
  });
  if (knownMatches.length > 0) {
    var longestNameLength = Math.max.apply(null, knownMatches.map(function(match) { return match.client.normalized.length; }));
    var longestMatches = knownMatches.filter(function(match) { return match.client.normalized.length === longestNameLength; });
    if (longestMatches.length !== 1) return { ok: false, reason: "AMBIGUOUS_KNOWN_CLIENT_IN_TITLE" };
    var serviceMatchNoSeparator = cfsResolveCatalogAlias_(longestMatches[0].serviceText, catalog);
    if (serviceMatchNoSeparator.ok) {
      candidatePairs.push({ clientName: longestMatches[0].client.name, resolved: [serviceMatchNoSeparator], method: "KNOWN_CLIENT_AND_ALIAS" });
    }
  }

  // A single first-name hit may be promoted to the unique full official name.
  if (!candidatePairs.length) {
    var firstNameCandidates = [];
    (knownClients || []).forEach(function(client) {
      var first = client.normalized.split(" ")[0];
      if (first && normalizedTitle.indexOf(first) === 0) {
        var remainder = normalizedTitle.slice(first.length).replace(/^[\s\-–—:|]+/, "").trim();
        firstNameCandidates.push({ client: client, remainder: remainder });
      }
    });
    if (firstNameCandidates.length === 1) {
      var firstAlias = cfsResolveCatalogAlias_(firstNameCandidates[0].remainder, catalog);
      if (firstAlias.ok) {
        candidatePairs.push({ clientName: firstNameCandidates[0].client.name, resolved: [firstAlias], method: "UNIQUE_FIRST_NAME_AND_ALIAS" });
      }
    } else if (firstNameCandidates.length > 1) {
      return { ok: false, reason: "AMBIGUOUS_FIRST_NAME_IN_TITLE" };
    }
  }

  if (candidatePairs.length !== 1) {
    return { ok: false, reason: candidatePairs.length ? "AMBIGUOUS_CLIENT_SERVICE_TITLE" : "TITLE_MUST_CONTAIN_KNOWN_CLIENT_AND_APPROVED_SERVICE" };
  }
  var selected = candidatePairs[0];
  var serviceItems = [];
  selected.resolved.forEach(function(match) {
    serviceItems.push(match.main);
    (match.additional || []).forEach(function(item) { serviceItems.push(item); });
  });
  var uniqueServices = [], seen = {};
  serviceItems.forEach(function(item) {
    if (item.id && !seen[item.id]) { seen[item.id] = true; uniqueServices.push(item); }
  });
  if (!uniqueServices.length) return { ok: false, reason: "SERVICE_ID_MISSING_OR_DUPLICATE" };
  if (cfsIsGenericClientPhrase_(selected.clientName)) {
    return { ok: false, reason: "CLIENT_NAME_NOT_CONFIRMED" };
  }
  return {
    ok: true,
    clientName: selected.clientName,
    service: uniqueServices[0],
    additionalServices: uniqueServices.slice(1),
    matchedBy: selected.method
  };
}

function cfsClassifyCalendarEvent_(event, catalog, knownClients) {
  var meta = cfsExtractEventMetadata_(event);

  // Clean Booking Notes segments (stripping trailing date/time/location/generic fragments)
  var rawNoteSegments = meta.bookingNotes
    ? meta.bookingNotes.split(/\s*[-–—:|]\s*/).map(function(s) { return s.trim(); }).filter(Boolean)
    : [];
  var noteServiceMatches = [];
  var noteClientCandidates = [];
  for (var n = 0; n < rawNoteSegments.length; n++) {
    var seg = rawNoteSegments[n];
    var svcRes = cfsResolveServiceList_(seg, catalog);
    if (svcRes.ok) {
      noteServiceMatches.push(svcRes);
      continue;
    }
    if (!cfsIsGenericClientPhrase_(seg)) {
      noteClientCandidates.push(seg);
    }
  }

  // Priority 1: Direct title match, enriched with deterministic metadata (phone / cleaner full name from description)
  var titleMatch = cfsMatchTitleToCatalog_(meta.summary, catalog, knownClients);
  if (titleMatch.ok) {
    var enrichedCandidates = [];
    if (meta.customerName) enrichedCandidates.push(meta.customerName);
    noteClientCandidates.forEach(function(c) {
      if (cfsNormalize_(c).split(" ").length >= 2) enrichedCandidates.push(c);
    });
    enrichedCandidates.push(titleMatch.clientName);
    var resolvedClient = cfsResolveClientDeterministically_(
      enrichedCandidates, meta.customerPhone, meta.customerEmail, meta.attendees, knownClients
    );
    var finalName = resolvedClient.ok ? resolvedClient.clientName : titleMatch.clientName;
    return {
      ok: true,
      clientName: finalName,
      clientPhone: meta.customerPhone || "",
      service: titleMatch.service,
      additionalServices: titleMatch.additionalServices,
      matchedBy: titleMatch.matchedBy + (resolvedClient.ok && finalName !== titleMatch.clientName ? "+" + resolvedClient.method : "")
    };
  }

  // Priority 2: Structured description / Booking notes + summary segments + attendees + phone/email lookup
  var resolvedService = null;
  if (meta.serviceField) {
    var fieldSvc = cfsResolveServiceList_(meta.serviceField, catalog);
    if (fieldSvc.ok) resolvedService = fieldSvc;
  }
  if (!resolvedService && noteServiceMatches.length === 1) {
    resolvedService = noteServiceMatches[0];
  }
  var summaryParts = meta.summary ? meta.summary.split(/\s*[-–—:|]\s*/).map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var summaryClientCandidates = [];
  for (var sp = 0; sp < summaryParts.length; sp++) {
    var sPart = summaryParts[sp];
    var sPartSvc = cfsResolveServiceList_(sPart, catalog);
    if (sPartSvc.ok) {
      if (!resolvedService) resolvedService = sPartSvc;
    } else if (!cfsIsGenericClientPhrase_(sPart)) {
      summaryClientCandidates.push(sPart);
    }
  }
  // If summary had no separator (e.g. "Elaide Pé e mão") and Booking notes already confirmed service,
  // strip the service phrase from summary to verify consistency without guessing.
  if (!resolvedService && meta.descriptionLines.length) {
    for (var dl = 0; dl < meta.descriptionLines.length; dl++) {
      var dLine = meta.descriptionLines[dl];
      if (/^(?:business|chat with|customer|http|https)/i.test(dLine)) continue;
      var lineSvc = cfsResolveServiceList_(dLine, catalog);
      if (lineSvc.ok) { resolvedService = lineSvc; break; }
    }
  }

  if (!resolvedService) {
    return { ok: false, reason: titleMatch.reason || "TITLE_MUST_CONTAIN_KNOWN_CLIENT_AND_APPROVED_SERVICE" };
  }

  var candidateNames = [];
  if (meta.customerName) candidateNames.push(meta.customerName);
  noteClientCandidates.forEach(function(c) { candidateNames.push(c); });
  // Only include summary parts as client candidates if we didn't get an explicit name from structured notes
  if (!candidateNames.length) {
    summaryClientCandidates.forEach(function(c) { candidateNames.push(c); });
  }

  var clientRes = cfsResolveClientDeterministically_(
    candidateNames, meta.customerPhone, meta.customerEmail, meta.attendees, knownClients
  );
  if (!clientRes.ok) {
    return { ok: false, reason: clientRes.reason || "TITLE_MUST_CONTAIN_KNOWN_CLIENT_AND_APPROVED_SERVICE" };
  }

  return {
    ok: true,
    clientName: clientRes.clientName,
    clientPhone: meta.customerPhone || "",
    service: resolvedService.service,
    additionalServices: resolvedService.additionalServices,
    matchedBy: "DESCRIPTION_OR_METADATA:" + clientRes.method
  };
}

function cfsReadRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), CFS_ORIGINAL_START_COLUMN);
  var values = lastRow ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [];
  var display = lastRow ? sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues() : [];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i], d = display[i];
    rows.push({
      row: i + 1,
      values: r,
      client: String(r[1] || "").trim(),
      phone: String(r[2] || "").trim(),
      procedure: String(r[4] || "").trim(),
      dateKey: cfsDateKey_(r[5] || d[5]),
      timeKey: cfsTimeKey_(r[6] || d[6]),
      status: cfsNormalize_(r[8]),
      appointmentId: String(r[9] || "").trim(),
      notes: String(r[10] || "").trim(),
      additionalIds: cfsParseAdditionalIds_(r[13]),
      serviceId: String(r[15] || "").trim(),
      eventId: String(r[19] || "").trim(),
      originalStartKey: String(r[20] || "").trim()
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
  var description = String((event && event.description) || "");
  if (row.appointmentId && description.indexOf(CFS_APPOINTMENT_TAG_PREFIX + row.appointmentId + "]") >= 0) return true;
  var meta = cfsExtractEventMetadata_(event);
  if (meta.customerPhone && row.phone && cfsPhonesMatch_(meta.customerPhone, row.phone)) return true;
  var searchText = cfsNormalize_(meta.summary + " " + meta.customerName + " " + meta.bookingNotes + " " + meta.descriptionLines.join(" "));
  var client = cfsNormalize_(row.client);
  if (!client) return false;
  if (searchText.indexOf(client) >= 0) return true;
  var tokens = client.split(" ").filter(function(token) { return token.length >= 3; });
  if (tokens.length >= 2) return tokens.filter(function(token) { return searchText.indexOf(token) >= 0; }).length >= 2;
  return tokens.length === 1 && tokens[0].length >= 4 && searchText.indexOf(tokens[0]) >= 0;
}

function cfsFindRowForEvent_(event, eventDate, eventTime, rows) {
  var id = String(event.id || "");
  var recurringId = String(event.recurringEventId || "");
  var originalRaw = cfsOriginalStartRaw_(event);
  var original = cfsOriginalDateTime_(event);

  // A pre-existing appointment ID tag is the strongest migration key when a Calendar
  // event was moved before its first sync and the Sheet had no event ID yet.
  var description = String(event.description || "");
  var taggedRows = rows.filter(function(row) {
    return row.appointmentId && description.indexOf(CFS_APPOINTMENT_TAG_PREFIX + row.appointmentId + "]") >= 0;
  });
  if (taggedRows.length > 1) return { error: "AMBIGUOUS_APPOINTMENT_ID_DESCRIPTION_TAG" };
  if (taggedRows.length === 1) {
    var taggedRow = taggedRows[0];
    if (taggedRow.eventId && !cfsEventIdEqual_(taggedRow.eventId, id) && !cfsEventIdEqual_(taggedRow.eventId, recurringId)) {
      return { error: "DESCRIPTION_TAG_ROW_LINKED_TO_DIFFERENT_EVENT" };
    }
    return { row: taggedRow, method: "DESCRIPTION_APPOINTMENT_ID_TAG" };
  }

  var byId = rows.filter(function(row) { return row.eventId && cfsEventIdEqual_(row.eventId, id); });

  if (byId.length) {
    var exact = byId.filter(function(row) {
      if (!recurringId) return true;
      if (row.originalStartKey) return row.originalStartKey === originalRaw;
      return row.dateKey === original.date && row.timeKey === original.time;
    });
    if (exact.length === 1) return { row: exact[0], method: recurringId ? "INSTANCE_EVENT_ID_AND_ORIGINAL_START" : "UNIQUE_EVENT_ID" };
    if (exact.length > 1) return { error: "DUPLICATE_EVENT_ID_AND_OCCURRENCE_ROWS" };
    if (recurringId) return { error: "INSTANCE_EVENT_ID_ORIGINAL_START_MISMATCH" };
    return { error: "DUPLICATE_NON_RECURRING_EVENT_ID_ROWS" };
  }

  if (recurringId) {
    var legacySeriesRows = rows.filter(function(row) { return row.eventId && cfsEventIdEqual_(row.eventId, recurringId); });
    var legacyMatches = legacySeriesRows.filter(function(row) {
      if (row.originalStartKey) return row.originalStartKey === originalRaw;
      return row.dateKey === original.date && row.timeKey === original.time;
    });
    if (legacyMatches.length === 1) return { row: legacyMatches[0], method: "LEGACY_SERIES_ID_AND_ORIGINAL_START" };
    if (legacyMatches.length > 1) return { error: "AMBIGUOUS_LEGACY_RECURRING_OCCURRENCE" };
    // A recurring instance with a different originalStartTime is a distinct occurrence.
  }

  var titleNorm = cfsNormalize_(event.summary || "");
  function rowClientMatches(row) {
    if (row.eventId || cfsRowGuard_(row)) return false;
    var client = cfsNormalize_(row.client);
    if (!client) return false;
    if (titleNorm.indexOf(client) >= 0) return true;
    var tokens = client.split(" ").filter(function(token) { return token.length >= 3; });
    if (tokens.length >= 2) return tokens.filter(function(token) { return titleNorm.indexOf(token) >= 0; }).length >= 2;
    return tokens.length === 1 && tokens[0].length >= 5 && titleNorm.indexOf(tokens[0]) >= 0;
  }
  var exactStartCandidates = rows.filter(function(row) {
    return row.dateKey === eventDate && row.timeKey === eventTime && rowClientMatches(row);
  });
  if (exactStartCandidates.length === 1) return { row: exactStartCandidates[0], method: "UNIQUE_DATE_TIME_AND_CLIENT" };
  if (exactStartCandidates.length > 1) return { error: "AMBIGUOUS_DATE_TIME_AND_CLIENT_MATCH" };

  // Calendar owns the start time. If there is exactly one unlinked appointment for
  // this client on this date, link it and let Calendar overwrite the old Sheet time.
  var sameDayClientCandidates = rows.filter(function(row) {
    return row.dateKey === eventDate && rowClientMatches(row);
  });
  if (sameDayClientCandidates.length === 1) return { row: sameDayClientCandidates[0], method: "UNIQUE_DATE_AND_CLIENT_START_TIME_CHANGED" };
  if (sameDayClientCandidates.length > 1) return { error: "AMBIGUOUS_DATE_AND_CLIENT_MATCH" };

  var occurrenceKey = originalRaw || (event.start && (event.start.dateTime || event.start.date)) || eventDate;
  var newId = cfsDeterministicAppointmentId_(id, occurrenceKey);
  var byDeterministicId = rows.filter(function(row) { return row.appointmentId === newId; });
  if (byDeterministicId.length === 1) return { row: byDeterministicId[0], method: "DETERMINISTIC_APPOINTMENT_ID" };
  if (byDeterministicId.length > 1) return { error: "DUPLICATE_DETERMINISTIC_APPOINTMENT_ID" };
  return { row: null, method: recurringId ? "NEW_RECURRING_INSTANCE" : "NEW_CALENDAR_EVENT" };
}

function cfsFindRowForCancelledEvent_(event, rows) {
  var id = String(event.id || "");
  var recurringId = String(event.recurringEventId || "");
  var originalRaw = cfsOriginalStartRaw_(event);
  var original = cfsOriginalDateTime_(event);

  var direct = rows.filter(function(row) { return row.eventId && cfsEventIdEqual_(row.eventId, id); });
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) return null;

  if (recurringId) {
    var seriesRows = rows.filter(function(row) { return row.eventId && cfsEventIdEqual_(row.eventId, recurringId); });
    var matches = seriesRows.filter(function(row) {
      if (row.originalStartKey) return row.originalStartKey === originalRaw;
      return row.dateKey === original.date && row.timeKey === original.time;
    });
    return matches.length === 1 ? matches[0] : null;
  }
  return null;
}

function cfsHasConflict_(event, targetEnd, allEvents) {
  var startObj = cfsEventStart_(event);
  if (!startObj) return { conflict: true, reason: "EVENT_START_MISSING" };
  var startMs = startObj.getTime(), endMs = targetEnd.getTime();
  var eventId = String(event.id || "");
  for (var i = 0; i < allEvents.length; i++) {
    var other = allEvents[i];
    if (!other || other.status === "cancelled" || String(other.id || "") === eventId) continue;
    var otherStart = cfsEventStart_(other), otherEnd = cfsEventEnd_(other);
    if (!otherStart || !otherEnd) continue;
    if (otherStart.getTime() < endMs && otherEnd.getTime() > startMs) {
      return { conflict: true, eventId: other.id, title: other.summary || "", start: otherStart, end: otherEnd };
    }
  }
  return { conflict: false };
}

function cfsGetWriteEnabled_() {
  return String(PropertiesService.getScriptProperties().getProperty("CALENDAR_FIRST_SYNC_ENABLED") || "").trim().toLowerCase() === "true";
}

function cfsHasAdvancedCalendarApi_() {
  return typeof Calendar !== "undefined" && Calendar.Events && typeof Calendar.Events.list === "function" && typeof Calendar.Events.patch === "function";
}

function cfsListCalendarEvents_(calendarId, startKey, endKey) {
  if (!cfsHasAdvancedCalendarApi_()) throw new Error("Ative o serviço avançado Google Calendar API v3 no projeto Apps Script.");
  var events = [], pageToken = null;
  do {
    var params = {
      timeMin: startKey + "T00:00:00-03:00",
      timeMax: endKey + "T23:59:59-03:00",
      singleEvents: true,
      orderBy: "startTime",
      showDeleted: true,
      maxResults: 2500
    };
    if (pageToken) params.pageToken = pageToken;
    var response = Calendar.Events.list(calendarId, params);
    var items = response.items || [];
    items.forEach(function(item) { events.push(item); });
    pageToken = response.nextPageToken || null;
  } while (pageToken);
  return events;
}

function cfsOpenContext_() {
  var props = PropertiesService.getScriptProperties();
  var configuredId = String(props.getProperty("SPREADSHEET_ID") || "").trim();
  var targetId = typeof TARGET_SPREADSHEET_ID !== "undefined" ? String(TARGET_SPREADSHEET_ID || "").trim() : "";
  if (!configuredId || !targetId || configuredId !== targetId) throw new Error("SPREADSHEET_ID ausente ou diferente de TARGET_SPREADSHEET_ID. Sincronização bloqueada.");
  var calendarId = String(props.getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID ausente nas Script Properties.");
  if (!cfsHasAdvancedCalendarApi_()) throw new Error("O serviço avançado Google Calendar API v3 não está habilitado.");
  var spreadsheet = SpreadsheetApp.openById(configuredId);
  var appointmentsSheet = spreadsheet.getSheetByName("Agendamentos");
  if (!appointmentsSheet) throw new Error("Aba Agendamentos não encontrada.");
  var catalog = cfsReadCatalog_(spreadsheet);
  if (!catalog.tabsRead.length) throw new Error("Nenhuma aba oficial de serviços foi encontrada.");
  return { spreadsheet: spreadsheet, appointmentsSheet: appointmentsSheet, catalog: catalog, calendarId: calendarId };
}

function cfsGetTriggerAudit_() {
  var result = {
    available: false,
    activeHandlers: [],
    legacyHandlers: [],
    calendarTriggerCount: 0,
    sheetEditTriggerCount: 0,
    periodicTriggerCount: 0
  };
  if (typeof ScriptApp === "undefined" || !ScriptApp.getProjectTriggers) return result;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    result.available = true;
    var legacy = {
      "syncCalendarBookingsToSheet": true,
      "syncCalendarChangesToSheet": true,
      "handleSpreadsheetEditForCalendarSync": true,
      "installBidirectionalCalendarSyncTriggers": false
    };
    triggers.forEach(function(trigger) {
      var handler = String(trigger.getHandlerFunction() || "");
      result.activeHandlers.push(handler);
      if (legacy[handler] === true) result.legacyHandlers.push(handler);
      if (handler === "handleCalendarFirstSyncCalendarEventUpdated") result.calendarTriggerCount++;
      if (handler === "handleCalendarFirstSyncServiceDurationEdit") result.sheetEditTriggerCount++;
      if (handler === "handleCalendarFirstSyncPeriodicSweep") result.periodicTriggerCount++;
    });
  } catch (error) {
    result.error = String(error.message || error);
  }
  return result;
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
    originalStartHeader: "",
    serviceTabs: [],
    advancedCalendarApiEnabled: cfsHasAdvancedCalendarApi_(),
    calendarAccessible: false,
    existingTriggers: [],
    legacySyncTriggers: [],
    newCalendarTriggerCount: 0,
    newSheetEditTriggerCount: 0,
    newPeriodicTriggerCount: 0,
    legacyWriteSyncEnabled: String(props.getProperty("CALENDAR_DURATION_SYNC_ENABLED") || "").trim().toLowerCase() === "true",
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
      if (ag) {
        report.eventIdHeader = String(ag.getRange(1, CFS_EVENT_ID_COLUMN).getDisplayValue() || "").trim();
        report.originalStartHeader = String(ag.getRange(1, CFS_ORIGINAL_START_COLUMN).getDisplayValue() || "").trim();
      }
      ["Serviços", "Servicos", "Depilação", "Depilacao"].forEach(function(name) {
        if (ss.getSheetByName(name)) report.serviceTabs.push(name);
      });
    } catch (e) {
      report.blockers.push("Planilha inacessível: " + String(e.message || e));
    }
  }
  if (!report.appointmentsTabFound) report.blockers.push("Aba Agendamentos não encontrada.");
  if (report.eventIdHeader && cfsNormalize_(report.eventIdHeader).indexOf("event id") < 0 && cfsNormalize_(report.eventIdHeader).indexOf("google calendar") < 0) {
    report.blockers.push("A coluna T possui cabeçalho diferente do ID do Google Calendar.");
  }
  if (report.originalStartHeader && cfsNormalize_(report.originalStartHeader).indexOf("original start") < 0) {
    report.blockers.push("A coluna U já possui outro cabeçalho; não será sobrescrita.");
  }
  if (!report.serviceTabs.length) report.blockers.push("Abas oficiais de serviços não encontradas.");
  if (!report.advancedCalendarApiEnabled) report.blockers.push("Ativar o serviço avançado Google Calendar API v3 no Apps Script.");
  var calendarId = String(props.getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  if (!calendarId) {
    report.blockers.push("GOOGLE_CALENDAR_ID não configurado.");
  } else if (report.advancedCalendarApiEnabled) {
    try {
      Calendar.Events.list(calendarId, { maxResults: 1 });
      report.calendarAccessible = true;
    } catch (e2) {
      report.blockers.push("Calendário inacessível pela Calendar API: " + String(e2.message || e2));
    }
  }
  var triggerAudit = cfsGetTriggerAudit_();
  report.existingTriggers = triggerAudit.activeHandlers;
  report.legacySyncTriggers = triggerAudit.legacyHandlers;
  report.newCalendarTriggerCount = triggerAudit.calendarTriggerCount;
  report.newSheetEditTriggerCount = triggerAudit.sheetEditTriggerCount;
  report.newPeriodicTriggerCount = triggerAudit.periodicTriggerCount || 0;
  if (!triggerAudit.available) report.blockers.push("Não foi possível auditar os gatilhos ativos do projeto Apps Script.");
  if (triggerAudit.error) report.blockers.push("Erro ao auditar gatilhos: " + triggerAudit.error);
  if (triggerAudit.legacyHandlers.length) report.blockers.push("Há gatilhos antigos de sincronização ativos: " + triggerAudit.legacyHandlers.join(", ") + ". Desative-os manualmente somente após revisão.");
  if (triggerAudit.calendarTriggerCount > 1 || triggerAudit.sheetEditTriggerCount > 1) report.blockers.push("Há gatilhos duplicados da nova sincronização; revisar antes de instalar.");
  if (report.legacyWriteSyncEnabled) report.blockers.push("CALENDAR_DURATION_SYNC_ENABLED=true mantém o sincronizador antigo habilitado; revisar antes de continuar.");
  report.readyForDryRun = report.blockers.length === 0;
  report.readyForTriggerInstallation = report.blockers.length === 0 && report.writeEnabled;
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
    if (!dryRun && cache.get(CFS_LOOP_GUARD_KEY)) return { status: "ignored_loop_guard", dryRun: dryRun };

    var ctx = cfsOpenContext_();
    var sheet = ctx.appointmentsSheet;
    var rowData = cfsReadRows_(sheet);
    var knownClients = cfsReadKnownClients_(ctx.spreadsheet, rowData.rows);
    var now = new Date();
    var startKey = options.startDate || Utilities.formatDate(now, CFS_TIME_ZONE, "yyyy-MM-dd");
    var endDate = new Date(now.getTime());
    endDate.setDate(endDate.getDate() + Number(options.daysAhead || 365));
    var endKey = options.endDate || Utilities.formatDate(endDate, CFS_TIME_ZONE, "yyyy-MM-dd");
    var allEvents = cfsListCalendarEvents_(ctx.calendarId, startKey, endKey);

    var claimedRows = {}, rowsToAppend = [], rowUpdates = [], needsReview = [], protectedEvents = [];
    var durationResults = [], calendarUpdates = [], imported = 0, linked = 0, dateTimeUpdates = 0, cancelledRows = 0;
    var blockedRowsImported = 0, blockedRowsUpdated = 0;

    function cfsFormatBlockNote_(reason) {
      var rawReason = String(reason || "");
      if (rawReason.indexOf("ALL_DAY_OR_MISSING_START") >= 0) {
        return "Bloqueio de dia inteiro importado do Google Agenda.";
      }
      if (rawReason.indexOf("PROTECTED_OR_TEST_EVENT") >= 0 || rawReason.indexOf("NON_STANDARD_EVENT_TYPE") >= 0) {
        return "Evento pessoal ou bloqueio protegido importado do Google Agenda.";
      }
      return "Evento não classificado do Google Agenda — revisão recomendada (informe cliente e procedimento oficial no evento).";
    }

    function queueCalendarBlock_(blockedEvent, reason) {
      var blockStart = cfsEventStart_(blockedEvent);
      var blockEnd = cfsEventEnd_(blockedEvent);
      if (!blockStart || !blockEnd || blockEnd <= blockStart) {
        needsReview.push({ eventId: blockedEvent.id || "", title: blockedEvent.summary || "", reason: "BLOCK_EVENT_MISSING_VALID_INTERVAL:" + reason });
        return;
      }
      var blockDate = Utilities.formatDate(blockStart, CFS_TIME_ZONE, "yyyy-MM-dd");
      var allDay = !!(blockedEvent.start && blockedEvent.start.date);
      var blockTime = allDay ? "Dia inteiro" : Utilities.formatDate(blockStart, CFS_TIME_ZONE, "HH:mm");
      var blockTitle = String(blockedEvent.summary || "Evento do Google Agenda").trim();
      var blockOriginalStart = cfsOriginalStartRaw_(blockedEvent);
      var blockNote = cfsFormatBlockNote_(reason);
      var blockMatch = cfsFindRowForEvent_(blockedEvent, blockDate, allDay ? "00:00" : blockTime, rowData.rows);
      if (blockMatch.error) {
        needsReview.push({ eventId: blockedEvent.id || "", title: blockTitle, date: blockDate, time: blockTime, reason: blockMatch.error });
        return;
      }
      var blockRow = blockMatch.row || null;
      if (blockRow) {
        if (claimedRows[blockRow.row]) {
          needsReview.push({ eventId: blockedEvent.id || "", title: blockTitle, date: blockDate, time: blockTime, reason: "SHEET_ROW_ALREADY_MATCHED_TO_ANOTHER_CALENDAR_EVENT", row: blockRow.row });
          return;
        }
        claimedRows[blockRow.row] = true;
        var expectedTimeKey = allDay ? "" : blockTime;
        var currentTimeDisplay = allDay ? String((blockRow.values && blockRow.values[6]) || "").trim() : blockRow.timeKey;
        var blockChanged = (
          blockRow.dateKey !== blockDate ||
          (allDay ? cfsNormalize_(currentTimeDisplay) !== "dia inteiro" : blockRow.timeKey !== expectedTimeKey) ||
          blockRow.status !== "bloqueado" ||
          blockRow.client !== blockTitle ||
          blockRow.procedure !== "Bloqueio do Google Agenda" ||
          !cfsEventIdEqual_(blockRow.eventId, String(blockedEvent.id || "")) ||
          (blockOriginalStart && blockRow.originalStartKey !== blockOriginalStart) ||
          blockRow.notes !== blockNote
        );
        if (blockChanged) {
          rowUpdates.push({ row: blockRow.row, values: {
            date: blockDate, time: blockTime, status: "bloqueado",
            client: blockTitle, procedure: "Bloqueio do Google Agenda",
            notes: blockNote,
            eventId: String(blockedEvent.id || ""), originalStart: blockOriginalStart
          }});
          blockRow.dateKey = blockDate;
          blockRow.timeKey = expectedTimeKey;
          blockRow.status = "bloqueado";
          blockRow.client = blockTitle;
          blockRow.procedure = "Bloqueio do Google Agenda";
          blockRow.notes = blockNote;
          blockRow.eventId = String(blockedEvent.id || "");
          blockRow.originalStartKey = blockOriginalStart;
          blockedRowsUpdated++;
        }
        return;
      }

      var occurrence = blockOriginalStart || (blockedEvent.start && (blockedEvent.start.dateTime || blockedEvent.start.date)) || blockDate;
      var blockAptId = cfsDeterministicAppointmentId_(blockedEvent.id, occurrence);
      var duplicateBlock = rowData.rows.some(function(existing) {
        return existing.appointmentId === blockAptId || (existing.eventId && cfsEventIdEqual_(existing.eventId, blockedEvent.id));
      });
      if (duplicateBlock) {
        needsReview.push({ eventId: blockedEvent.id || "", title: blockTitle, date: blockDate, time: blockTime, reason: "BLOCK_EVENT_ALREADY_PRESENT_WITHOUT_UNIQUE_MATCH" });
        return;
      }
      var blockValues = new Array(rowData.lastCol);
      for (var bc = 0; bc < rowData.lastCol; bc++) blockValues[bc] = "";
      blockValues[0] = new Date();
      blockValues[1] = blockTitle;
      blockValues[4] = "Bloqueio do Google Agenda";
      blockValues[5] = blockDate;
      blockValues[6] = blockTime;
      blockValues[8] = "bloqueado";
      blockValues[9] = blockAptId;
      blockValues[10] = blockNote;
      blockValues[19] = String(blockedEvent.id || "");
      blockValues[20] = blockOriginalStart;
      var newBlockRow = {
        row: rowData.lastRow + rowsToAppend.length + 1, values: blockValues,
        client: blockTitle, phone: "", procedure: "Bloqueio do Google Agenda",
        dateKey: blockDate, timeKey: allDay ? "" : blockTime,
        status: "bloqueado", appointmentId: blockAptId, notes: blockNote, additionalIds: [],
        serviceId: "", eventId: String(blockedEvent.id || ""), originalStartKey: blockOriginalStart
      };
      rowsToAppend.push(blockValues);
      rowData.rows.push(newBlockRow);
      claimedRows[newBlockRow.row] = true;
      blockedRowsImported++;
    }

    for (var i = 0; i < allEvents.length; i++) {
      var event = allEvents[i];
      var eventId = String(event.id || "");
      if (!eventId) continue;

      if (event.status === "cancelled") {
        var cancelledRow = cfsFindRowForCancelledEvent_(event, rowData.rows);
        if (!cancelledRow) {
          needsReview.push({ eventId: eventId, recurringEventId: event.recurringEventId || "", originalStartTime: cfsOriginalStartRaw_(event), reason: "CANCELLED_CALENDAR_EVENT_WITHOUT_UNIQUE_SHEET_MATCH" });
        } else if (cancelledRow.status !== "cancelado" && cancelledRow.status !== "cancelada") {
          if (!claimedRows[cancelledRow.row]) {
            claimedRows[cancelledRow.row] = true;
            rowUpdates.push({ row: cancelledRow.row, values: { status: "cancelado" } });
            cancelledRow.status = "cancelado";
            cancelledRows++;
          }
        }
        continue;
      }

      var protectedReason = cfsProtectedReason_(event);
      if (protectedReason) {
        protectedEvents.push({ eventId: eventId, title: event.summary || "", reason: protectedReason });
        queueCalendarBlock_(event, protectedReason);
        continue;
      }
      var eventStart = cfsEventStart_(event);
      var eventEnd = cfsEventEnd_(event);
      if (!eventStart || !eventEnd || eventEnd.getTime() <= now.getTime()) continue;

      var eventDate = Utilities.formatDate(eventStart, CFS_TIME_ZONE, "yyyy-MM-dd");
      var eventTime = Utilities.formatDate(eventStart, CFS_TIME_ZONE, "HH:mm");
      var originalStart = cfsOriginalStartRaw_(event);
      var match = cfsFindRowForEvent_(event, eventDate, eventTime, rowData.rows);
      var row = match.row || null;
      var isNew = false;

      if (match.error) {
        needsReview.push({ eventId: eventId, title: event.summary || "", date: eventDate, time: eventTime, originalStartTime: originalStart, reason: match.error });
        continue;
      }

      if (row) {
        if (claimedRows[row.row]) {
          needsReview.push({ eventId: eventId, title: event.summary || "", date: eventDate, time: eventTime, reason: "SHEET_ROW_ALREADY_MATCHED_TO_ANOTHER_CALENDAR_EVENT", row: row.row });
          continue;
        }
        var isCalendarImportedBlock = row.status === "bloqueado" && row.eventId && cfsEventIdEqual_(row.eventId, eventId);
        if (isCalendarImportedBlock) {
          var promotedClassification = cfsClassifyCalendarEvent_(event, ctx.catalog, knownClients);
          if (!promotedClassification.ok) {
            needsReview.push({ eventId: eventId, title: event.summary || "", date: eventDate, time: eventTime, reason: promotedClassification.reason });
            queueCalendarBlock_(event, "UNCLASSIFIED_CALENDAR_EVENT:" + promotedClassification.reason);
            continue;
          }
          claimedRows[row.row] = true;
          linked++;
          var addIdsArr = promotedClassification.additionalServices.map(function(s) { return s.id; });
          var promoteValues = {
            client: promotedClassification.clientName,
            procedure: promotedClassification.service.title,
            date: eventDate,
            time: eventTime,
            status: "confirmado",
            notes: "Importado do Google Calendar",
            additionalIds: JSON.stringify(addIdsArr),
            serviceId: promotedClassification.service.id,
            eventId: eventId
          };
          if (promotedClassification.clientPhone && !row.phone) {
            promoteValues.phone = promotedClassification.clientPhone;
            row.phone = promotedClassification.clientPhone;
          }
          if (originalStart) promoteValues.originalStart = originalStart;
          rowUpdates.push({ row: row.row, values: promoteValues });
          dateTimeUpdates++;
          row.client = promotedClassification.clientName;
          row.procedure = promotedClassification.service.title;
          row.dateKey = eventDate;
          row.timeKey = eventTime;
          row.status = "confirmado";
          row.notes = "Importado do Google Calendar";
          row.additionalIds = addIdsArr;
          row.serviceId = promotedClassification.service.id;
          row.eventId = eventId;
          row.originalStartKey = originalStart;
        } else {
          var rowGuard = cfsRowGuard_(row);
          if (rowGuard) {
            if (rowGuard === "CANCELLED_ROW") needsReview.push({ eventId: eventId, title: event.summary || "", date: eventDate, time: eventTime, reason: "CALENDAR_EVENT_LINKED_TO_CANCELLED_SHEET_ROW", row: row.row });
            continue;
          }
          if (row.eventId && !cfsEventIdEqual_(row.eventId, eventId) && !cfsEventIdEqual_(row.eventId, event.recurringEventId || "")) {
            needsReview.push({ eventId: eventId, title: event.summary || "", date: eventDate, time: eventTime, reason: "SHEET_ROW_ALREADY_LINKED_TO_DIFFERENT_EVENT", row: row.row });
            continue;
          }
          claimedRows[row.row] = true;
          linked++;

          var changed = {};
          if (row.dateKey !== eventDate) changed.date = eventDate;
          if (row.timeKey !== eventTime) changed.time = eventTime;
          if (!row.eventId || !cfsEventIdEqual_(row.eventId, eventId)) changed.eventId = eventId;
          if (originalStart && row.originalStartKey !== originalStart) changed.originalStart = originalStart;
          if (Object.keys(changed).length) {
            rowUpdates.push({ row: row.row, values: changed });
            dateTimeUpdates++;
            row.dateKey = eventDate;
            row.timeKey = eventTime;
            row.eventId = eventId;
            row.originalStartKey = originalStart;
          }
        }
      } else {
        var classification = cfsClassifyCalendarEvent_(event, ctx.catalog, knownClients);
        if (!classification.ok) {
          // Unknown Calendar items remain visible in admin as blocked, never as fictitious clients.
          needsReview.push({ eventId: eventId, title: event.summary || "", date: eventDate, time: eventTime, reason: classification.reason });
          queueCalendarBlock_(event, "UNCLASSIFIED_CALENDAR_EVENT:" + classification.reason);
          continue;
        }
        var occurrenceKey = originalStart || (event.start && (event.start.dateTime || event.start.date)) || eventDate;
        var aptId = cfsDeterministicAppointmentId_(eventId, occurrenceKey);
        if (rowData.rows.some(function(existing) { return existing.appointmentId === aptId; })) {
          needsReview.push({ eventId: eventId, title: event.summary || "", date: eventDate, time: eventTime, reason: "DETERMINISTIC_APPOINTMENT_ID_ALREADY_EXISTS" });
          continue;
        }
        var width = rowData.lastCol;
        var newValuesArr = new Array(width);
        for (var c = 0; c < width; c++) newValuesArr[c] = "";
        newValuesArr[0] = new Date();
        newValuesArr[1] = classification.clientName;
        newValuesArr[2] = classification.clientPhone || "";
        newValuesArr[4] = classification.service.title;
        newValuesArr[5] = eventDate;
        newValuesArr[6] = eventTime;
        newValuesArr[8] = "confirmado";
        newValuesArr[9] = aptId;
        newValuesArr[10] = "Importado do Google Calendar";
        newValuesArr[13] = JSON.stringify(classification.additionalServices.map(function(s) { return s.id; }));
        newValuesArr[15] = classification.service.id;
        newValuesArr[19] = eventId;
        newValuesArr[20] = originalStart;

        row = {
          row: rowData.lastRow + rowsToAppend.length + 1,
          values: newValuesArr,
          client: classification.clientName,
          phone: classification.clientPhone || "",
          procedure: classification.service.title,
          dateKey: eventDate,
          timeKey: eventTime,
          status: "confirmado",
          appointmentId: aptId,
          notes: "Importado do Google Calendar",
          additionalIds: classification.additionalServices.map(function(s) { return s.id; }),
          serviceId: classification.service.id,
          eventId: eventId,
          originalStartKey: originalStart
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
          durationMinutes: lookup.durationMinutes,
          originalStartTime: originalStart,
          importedInThisRun: isNew
        });
      } else {
        var pendingUpdate = {
          eventId: eventId,
          end: targetEnd.toISOString(),
          result: { eventId: eventId, row: row.row, status: "PENDING_CALENDAR_UPDATE", durationMinutes: lookup.durationMinutes }
        };
        calendarUpdates.push(pendingUpdate);
        durationResults.push(pendingUpdate.result);
      }
    }

    // Verify any future Calendar-linked row that disappeared from the Calendar list
    // (e.g. permanently deleted without a tombstone in range) via Calendar.Events.get.
    if (typeof Calendar !== "undefined" && Calendar.Events && typeof Calendar.Events.get === "function") {
      for (var mr = 0; mr < rowData.rows.length; mr++) {
        var missingRow = rowData.rows[mr];
        if (!missingRow || !missingRow.eventId || claimedRows[missingRow.row]) continue;
        if (missingRow.status === "cancelado" || missingRow.status === "cancelada" || missingRow.status === "cancelled" || missingRow.status === "excluido") continue;
        if (!missingRow.dateKey || missingRow.dateKey <= startKey || missingRow.dateKey > endKey) continue;
        try {
          var fetchedEv = Calendar.Events.get(ctx.calendarId, missingRow.eventId);
          if (fetchedEv && fetchedEv.status === "cancelled") {
            claimedRows[missingRow.row] = true;
            rowUpdates.push({ row: missingRow.row, values: { status: "cancelado" } });
            missingRow.status = "cancelado";
            cancelledRows++;
          }
        } catch (getErr) {
          var errMsg = String(getErr && (getErr.message || getErr) || "");
          if (/404|410|not found|resource has been deleted/i.test(errMsg)) {
            claimedRows[missingRow.row] = true;
            rowUpdates.push({ row: missingRow.row, values: { status: "cancelado" } });
            missingRow.status = "cancelado";
            cancelledRows++;
          }
        }
      }
    }

    if (!dryRun) {
      var eventHeader = String(sheet.getRange(1, CFS_EVENT_ID_COLUMN).getDisplayValue() || "").trim();
      var originalHeader = String(sheet.getRange(1, CFS_ORIGINAL_START_COLUMN).getDisplayValue() || "").trim();
      if (eventHeader && cfsNormalize_(eventHeader).indexOf("event id") < 0 && cfsNormalize_(eventHeader).indexOf("google calendar") < 0) {
        throw new Error("A coluna T já possui outro cabeçalho; escrita bloqueada.");
      }
      if (originalHeader && cfsNormalize_(originalHeader).indexOf("original start") < 0) {
        throw new Error("A coluna U já possui outro cabeçalho; escrita bloqueada.");
      }
      if (!eventHeader) sheet.getRange(1, CFS_EVENT_ID_COLUMN).setValue(CFS_EVENT_ID_HEADER);
      if (!originalHeader) sheet.getRange(1, CFS_ORIGINAL_START_COLUMN).setValue(CFS_ORIGINAL_START_HEADER);

      rowUpdates.forEach(function(update) {
        if (update.values.date) sheet.getRange(update.row, 6).setValue(update.values.date);
        if (update.values.time) sheet.getRange(update.row, 7).setValue(update.values.time);
        if (update.values.status) sheet.getRange(update.row, 9).setValue(update.values.status);
        if (update.values.client !== undefined) sheet.getRange(update.row, 2).setValue(update.values.client);
        if (update.values.phone !== undefined) sheet.getRange(update.row, 3).setValue(update.values.phone);
        if (update.values.procedure !== undefined) sheet.getRange(update.row, 5).setValue(update.values.procedure);
        if (update.values.notes !== undefined) sheet.getRange(update.row, 11).setValue(update.values.notes);
        if (update.values.additionalIds !== undefined) sheet.getRange(update.row, 14).setValue(update.values.additionalIds);
        if (update.values.serviceId !== undefined) sheet.getRange(update.row, 16).setValue(update.values.serviceId);
        if (update.values.eventId) sheet.getRange(update.row, CFS_EVENT_ID_COLUMN).setValue(update.values.eventId);
        if (update.values.originalStart) sheet.getRange(update.row, CFS_ORIGINAL_START_COLUMN).setValue(update.values.originalStart);
      });
      if (rowsToAppend.length) {
        sheet.getRange(rowData.lastRow + 1, 1, rowsToAppend.length, rowData.lastCol).setValues(rowsToAppend);
      }
      SpreadsheetApp.flush();

      // Persist the Sheet mapping first; then PATCH only the end on the unique event instance.
      for (var cu = 0; cu < calendarUpdates.length; cu++) {
        var update = calendarUpdates[cu];
        try {
          cache.put(CFS_LOOP_GUARD_KEY, String(new Date().getTime()), CFS_LOOP_GUARD_SECONDS);
          Calendar.Events.patch(
            { end: { dateTime: update.end, timeZone: CFS_TIME_ZONE } },
            ctx.calendarId,
            update.eventId
          );
          update.result.status = "UPDATED_END_ONLY";
        } catch (updateError) {
          update.result.status = "CALENDAR_UPDATE_ERROR";
          update.result.message = String(updateError.message || updateError);
        }
      }
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
        blockedRowsImported: blockedRowsImported,
        blockedRowsUpdated: blockedRowsUpdated,
        existingRowsUpdatedFromCalendar: dateTimeUpdates,
        cancelledRowsMarked: cancelledRows,
        calendarEndsWouldBeUpdatedOrUpdated: durationResults.filter(function(x) { return x.status === "WOULD_UPDATE_END_ONLY" || x.status === "UPDATED_END_ONLY"; }).length,
        unchangedDurations: durationResults.filter(function(x) { return x.status === "UNCHANGED"; }).length,
        protectedEvents: protectedEvents.length,
        requiringReview: needsReview.length + durationResults.filter(function(x) { return x.status.indexOf("REVIEW") >= 0 || x.status === "DURATION_REVIEW" || x.status === "CLIENT_IDENTITY_NOT_CONFIRMED"; }).length
      },
      importedRows: rowsToAppend.length,
      plannedRows: dryRun ? rowsToAppend : [],
      rowUpdates: rowUpdates,
      protectedEvents: protectedEvents,
      needsAdminReview: needsReview,
      durationResults: durationResults,
      safety: dryRun
        ? "DRY RUN: nenhuma linha foi criada/alterada e nenhum evento do Calendar foi modificado. Eventos sem identificação segura são planejados como bloqueios."
        : "Calendar -> Sheets: compromissos identificados são importados; demais eventos são registrados como bloqueados. Durações usam Serviços!F; somente o término de compromissos elegíveis pode ser ajustado."
    };
    if (!dryRun) {
      try {
        var statusProps = PropertiesService.getScriptProperties();
        if (statusProps && typeof statusProps.setProperty === "function") {
          statusProps.setProperty(CFS_LAST_SYNC_STATUS_KEY, JSON.stringify({
            status: "success",
            syncedAt: new Date().toISOString(),
            counts: result.counts
          }));
        }
      } catch (statusErr) {}
    }
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } catch (syncErr) {
    try {
      var errProps = PropertiesService.getScriptProperties();
      if (errProps && typeof errProps.setProperty === "function") {
        errProps.setProperty(CFS_LAST_SYNC_STATUS_KEY, JSON.stringify({
          status: "error",
          syncedAt: new Date().toISOString(),
          error: String(syncErr && (syncErr.message || syncErr) || "Erro desconhecido na sincronização")
        }));
      }
    } catch (ignoredErr) {}
    throw syncErr;
  } finally {
    lock.releaseLock();
  }
}

function handleCalendarFirstSyncCalendarEventUpdated(e) {
  if (!cfsGetWriteEnabled_()) return { status: "skipped_disabled" };
  if (CacheService.getScriptCache().get(CFS_LOOP_GUARD_KEY)) return { status: "ignored_loop_guard" };
  return syncCalendarBookingsAndDurations({ dryRun: false });
}

function handleCalendarFirstSyncPeriodicSweep() {
  if (!cfsGetWriteEnabled_()) return { status: "skipped_disabled" };
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
 * Explicit setup only. Requires the sync flag and valid configuration.
 * It adds missing triggers but never deletes legacy or duplicate triggers.
 */
function installCalendarFirstSyncTriggers() {
  if (!cfsGetWriteEnabled_()) throw new Error("Ative CALENDAR_FIRST_SYNC_ENABLED=true somente após aprovação da operação.");
  var audit = auditCalendarFirstSyncConfig();
  if (!audit.readyForTriggerInstallation) {
    throw new Error("Instalação bloqueada pela auditoria: " + audit.blockers.join(" | "));
  }
  var ctx = cfsOpenContext_();
  var triggers = ScriptApp.getProjectTriggers();
  var legacy = {
    "syncCalendarBookingsToSheet": true,
    "syncCalendarChangesToSheet": true,
    "handleSpreadsheetEditForCalendarSync": true
  };
  var calendarCount = 0, sheetCount = 0, periodicCount = 0, legacyFound = [];
  triggers.forEach(function(trigger) {
    var handler = String(trigger.getHandlerFunction() || "");
    if (legacy[handler]) legacyFound.push(handler);
    if (handler === "handleCalendarFirstSyncCalendarEventUpdated") calendarCount++;
    if (handler === "handleCalendarFirstSyncServiceDurationEdit") sheetCount++;
    if (handler === "handleCalendarFirstSyncPeriodicSweep") periodicCount++;
  });
  if (legacyFound.length) throw new Error("Gatilhos antigos ativos; instalação cancelada sem remover nada: " + legacyFound.join(", "));
  if (calendarCount > 1 || sheetCount > 1 || periodicCount > 1) throw new Error("Gatilhos duplicados; instalação cancelada sem remover nada.");

  var installed = [];
  if (calendarCount === 0) {
    ScriptApp.newTrigger("handleCalendarFirstSyncCalendarEventUpdated")
      .forUserCalendar(ctx.calendarId).onEventUpdated().create();
    installed.push("handleCalendarFirstSyncCalendarEventUpdated");
  }
  if (sheetCount === 0) {
    ScriptApp.newTrigger("handleCalendarFirstSyncServiceDurationEdit")
      .forSpreadsheet(ctx.spreadsheet).onEdit().create();
    installed.push("handleCalendarFirstSyncServiceDurationEdit");
  }
  if (periodicCount === 0) {
    ScriptApp.newTrigger("handleCalendarFirstSyncPeriodicSweep")
      .timeBased().everyMinutes(10).create();
    installed.push("handleCalendarFirstSyncPeriodicSweep");
  }
  return { status: "success", installed: installed, safety: "Nenhum gatilho antigo ou duplicado foi removido." };
}
