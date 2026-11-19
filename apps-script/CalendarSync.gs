/**
 * Espaço Angélica — alinhamento futuro Planilha x Google Calendar.
 *
 * SOMENTE LEITURA. Não grava na planilha e não altera eventos.
 * Execute previewFutureCalendarAlignment() no Apps Script.
 *
 * Colunas oficiais (1-based): B cliente, E serviço, F data, G hora,
 * I status, J ID interno, N IDs adicionais, P ID serviço principal,
 * T ID Google Calendar.
 */
function previewFutureCalendarAlignment() {
  var tz = "America/Sao_Paulo";
  var today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var endDate = new Date();
  endDate.setDate(endDate.getDate() + 365);
  var endKey = Utilities.formatDate(endDate, tz, "yyyy-MM-dd");

  var ss = SpreadsheetApp.openById("1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0");
  var sheet = ss.getSheetByName("Agendamentos");
  if (!sheet) throw new Error("Aba Agendamentos não encontrada.");

  var calendarId = String(PropertiesService.getScriptProperties().getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID não configurado nas Propriedades do Script.");
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) throw new Error("Calendário não encontrado ou sem acesso.");

  var rows = sheet.getDataRange().getValues();
  var display = sheet.getDataRange().getDisplayValues();
  var services = _casReadServiceDurations_(ss);
  var events = calendar.getEvents(
    new Date(today + "T00:00:00-03:00"),
    new Date(endKey + "T23:59:59-03:00")
  );

  var eventRows = events.map(function(ev) {
    return {
      event: ev,
      id: ev.getId(),
      title: ev.getTitle(),
      name: _casNormalize_(ev.getTitle()),
      start: Utilities.formatDate(ev.getStartTime(), tz, "yyyy-MM-dd'T'HH:mm:ss"),
      end: Utilities.formatDate(ev.getEndTime(), tz, "yyyy-MM-dd'T'HH:mm:ss"),
      allDay: ev.isAllDayEvent()
    };
  });

  var report = [];
  var counts = { sheetFuture: 0, exactMatches: 0, possibleMatches: 0, missingInCalendar: 0,
    calendarEvents: events.length, durationUnknown: 0, skipped: 0 };

  for (var i = 1; i < rows.length; i++) {
    var r = rows[i], d = display[i];
    var client = String(r[1] || "").trim();
    var appointmentId = String(r[9] || "").trim();
    if (!client && !appointmentId) continue;

    var dateKey = _casDateKey_(r[5], tz, d[5]);
    if (!dateKey || dateKey < today || dateKey > endKey) continue;

    var status = String(r[8] || "").trim().toLowerCase();
    if (status === "cancelado") {
      counts.skipped++;
      report.push({ row: i + 1, client: client, date: dateKey, status: status, classification: "IGNORAR_CANCELADO" });
      continue;
    }

    var timeKey = _casTimeKey_(r[6], tz, d[6]);
    var service = String(r[4] || "").trim();
    var serviceId = String(r[15] || "").trim();
    var additionalIds = [];
    try {
      var parsed = JSON.parse(String(r[13] || "[]"));
      if (Array.isArray(parsed)) additionalIds = parsed.map(String);
    } catch (e) {}
    var duration = services.byId[serviceId] || services.byTitle[_casNormalize_(service)] || null;
    var unknownServices = [];
    if (duration === null) unknownServices.push(service || serviceId || "serviço principal");
    additionalIds.forEach(function(id) {
      var extra = services.byId[String(id)] || null;
      if (extra === null) unknownServices.push("adicional:" + id);
      else if (duration !== null) duration += extra;
    });
    if (duration === null || unknownServices.length) counts.durationUnknown++;

    counts.sheetFuture++;
    var clientKey = _casNormalize_(client);
    var tokens = clientKey.split(" ").filter(function(t) { return t.length >= 3; });
    var linkedById = String(r[19] || "").trim();
    var candidates = eventRows.filter(function(e) {
      if (e.allDay) return false;
      if (linkedById && e.id === linkedById) return true;
      if (e.start.substring(0, 10) !== dateKey) return false;
      var overlap = tokens.filter(function(t) { return e.name.indexOf(t) >= 0; }).length;
      return tokens.length ? overlap >= Math.min(2, tokens.length) : false;
    }).map(function(e) {
      var exactStart = e.start.substring(11, 16) === timeKey;
      var minutes = Math.round((new Date(e.end.replace(" ", "T") + "-03:00").getTime() -
        new Date(e.start.replace(" ", "T") + "-03:00").getTime()) / 60000);
      return {
        eventId: e.id,
        title: e.title,
        start: e.start,
        end: e.end,
        durationMinutes: minutes,
        exactStart: exactStart,
        linkedByColumnT: !!linkedById && e.id === linkedById,
        occurrenceKey: e.id + "|" + e.start
      };
    });

    var exact = candidates.filter(function(c) {
      return c.exactStart || c.linkedByColumnT;
    });
    var classification;
    if (exact.length === 1) {
      classification = "CORRESPONDENCIA_EXATA";
      counts.exactMatches++;
    } else if (candidates.length) {
      classification = "REVISAR_CANDIDATOS";
      counts.possibleMatches++;
    } else {
      classification = "NAO_ENCONTRADO_NO_CALENDARIO";
      counts.missingInCalendar++;
    }

    report.push({
      row: i + 1,
      appointmentId: appointmentId,
      client: client,
      service: service,
      additionalServiceIds: additionalIds,
      date: dateKey,
      time: timeKey,
      status: status,
      expectedDurationMinutes: duration,
      unknownServices: unknownServices,
      currentCalendarIdInT: linkedById,
      classification: classification,
      candidates: candidates
    });
  }

  var result = {
    status: "success",
    readOnly: true,
    timezone: tz,
    range: { start: today, end: endKey },
    calendarName: calendar.getName(),
    executionAccount: String(Session.getEffectiveUser().getEmail() || ""),
    counts: counts,
    serviceCatalog: { ids: Object.keys(services.byId).length, titles: Object.keys(services.byTitle).length },
    appointments: report,
    safety: "Nenhuma célula foi alterada. Nenhum evento foi criado, atualizado ou excluído."
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function _casReadServiceDurations_(ss) {
  var byId = {}, byTitle = {};
  ["Serviços", "Servicos", "Depilação", "Depilacao"].forEach(function(tabName) {
    var sh = ss.getSheetByName(tabName);
    if (!sh || sh.getLastRow() < 2) return;
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var id = String(values[i][0] || "").trim();
      var title = String(values[i][1] || "").trim();
      var raw = String(values[i][5] || "").trim();
      var mins = _casParseDuration_(raw);
      if (!mins) continue;
      if (id) byId[id] = mins;
      if (title) byTitle[_casNormalize_(title)] = mins;
    }
  });
  return { byId: byId, byTitle: byTitle };
}

function _casParseDuration_(value) {
  var s = String(value || "").toLowerCase().trim();
  if (!s) return null;
  var h = s.match(/(\d+)\s*h/);
  var m = s.match(/(\d+)\s*(?:min|m\b)/);
  var total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  if (!total && /^\d+$/.test(s)) total = Number(s);
  return total > 0 ? total : null;
}

function _casNormalize_(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function _casDateKey_(raw, tz, displayed) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return Utilities.formatDate(raw, tz, "yyyy-MM-dd");
  var s = String(displayed || raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br ? br[3] + "-" + br[2] + "-" + br[1] : "";
}

function _casTimeKey_(raw, tz, displayed) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return Utilities.formatDate(raw, tz, "HH:mm");
  var s = String(displayed || raw || "").trim();
  var m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? ("0" + m[1]).slice(-2) + ":" + m[2] : "";
}
