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


/**
 * Plano de reconciliação baseado nas decisões do administrador.
 * SOMENTE LEITURA: não grava na planilha nem altera o Google Calendar.
 * Executar previewCalendarDecisionPlan() e revisar o relatório antes de
 * implementar qualquer rotina de escrita.
 */
function previewCalendarDecisionPlan() {
  var tz = "America/Sao_Paulo";
  var ss = SpreadsheetApp.openById("1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0");
  var sheet = ss.getSheetByName("Agendamentos");
  if (!sheet) throw new Error("Aba Agendamentos não encontrada.");
  var range = sheet.getDataRange();
  var values = range.getValues();
  var display = range.getDisplayValues();
  var headers = display.length ? display[0] : [];
  var calendarId = String(PropertiesService.getScriptProperties().getProperty("GOOGLE_CALENDAR_ID") || "").trim();
  var calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) throw new Error("Calendário não encontrado ou sem acesso.");

  var decisions = [
    { appointmentId: "apt-1793902283321", client: "Maria de Jesus Abreu", action: "UPDATE_CALENDAR_DURATION", targetDate: "2026-12-23", targetTime: "16:00", targetDuration: 90, source: "SHEET" },
    { appointmentId: "apt-1793902440508", client: "Kristine Sorensen", action: "KEEP_CALENDAR_AND_ALIGN_SHEET", targetDate: "2026-12-24", targetTime: "12:30", targetDuration: 90, source: "CALENDAR" },
    { appointmentId: "apt-1793903713527", client: "Josefina Calderón", action: "NO_CHANGE_EXACT_MATCH", targetDate: "2026-12-23", targetTime: "15:00", targetDuration: 60, source: "BOTH" },
    { appointmentId: "apt-1793903805661", client: "Josefina Calderón", action: "CREATE_CALENDAR_EVENT", targetDate: "2026-12-30", targetTime: "15:00", targetDuration: 60, source: "SHEET" },
    { appointmentId: "apt-1794006950286-rec-4", client: "Alan TesteAdmin", action: "EXCLUDE_FROM_SYNC", targetDate: "2026-12-07", targetTime: "09:30", targetDuration: 180, source: "ADMIN" },
    { appointmentId: "apt-1794603000976", client: "Ana Rosa", action: "CREATE_CALENDAR_EVENT_PENDING_PIX", targetDate: "2026-12-02", targetTime: "15:00", targetDuration: 90, source: "SHEET_ADMIN_OVERRIDE" }
  ];

  var rowsById = {};
  for (var i = 1; i < values.length; i++) {
    var id = String(values[i][9] || "").trim();
    if (id) rowsById[id] = { row: i + 1, values: values[i], display: display[i] };
  }

  var plan = [];
  decisions.forEach(function(decision) {
    var found = rowsById[decision.appointmentId];
    var item = {
      appointmentId: decision.appointmentId,
      client: decision.client,
      action: decision.action,
      target: decision.targetDate + " " + decision.targetTime + " (" + decision.targetDuration + " min)",
      sourceOfTruth: decision.source,
      sheetRow: found ? found.row : null,
      sheetStatus: found ? String(found.values[8] || "") : null,
      sheetDate: found ? _casDateKey_(found.values[5], tz, found.display[5]) : null,
      sheetTime: found ? _casTimeKey_(found.values[6], tz, found.display[6]) : null,
      sheetCalendarIdColumnT: found ? String(found.values[19] || "") : null,
      validation: []
    };
    if (!found) item.validation.push("ERRO: appointmentId não encontrado na planilha; nenhuma ação permitida.");

    if (decision.action === "EXCLUDE_FROM_SYNC") {
      item.validation.push("Registro de teste excluído da sincronização; linha será preservada.");
      plan.push(item);
      return;
    }

    var start = new Date(decision.targetDate + "T" + decision.targetTime + ":00-03:00");
    var end = new Date(start.getTime() + decision.targetDuration * 60000);
    var dayStart = new Date(decision.targetDate + "T00:00:00-03:00");
    var dayEnd = new Date(decision.targetDate + "T23:59:59-03:00");
    var dayEvents = calendar.getEvents(dayStart, dayEnd);
    var overlaps = [];
    dayEvents.forEach(function(ev) {
      var evStart = ev.getStartTime();
      var evEnd = ev.getEndTime();
      var isOverlap = start < evEnd && end > evStart;
      if (isOverlap) {
        var sameClient = _casNormalize_(ev.getTitle()).indexOf(_casNormalize_(decision.client)) >= 0;
        var isExpectedCandidate =
          (decision.client === "Maria de Jesus Abreu" && ev.getId() === "6g07637k50lq60c35h36qt72uo@google.com") ||
          (decision.client === "Kristine Sorensen" && ev.getId() === "gmdts7nvfk56vl6v1iaa068leg@google.com") ||
          (decision.client === "Josefina Calderón" && ev.getId() === "bj320net3mqnvtndi3q201qcis@google.com");
        if (!isExpectedCandidate) {
          overlaps.push({
            eventId: ev.getId(),
            title: ev.getTitle(),
            start: Utilities.formatDate(evStart, tz, "yyyy-MM-dd'T'HH:mm:ss"),
            end: Utilities.formatDate(evEnd, tz, "yyyy-MM-dd'T'HH:mm:ss"),
            allDay: ev.isAllDayEvent(),
            sameClient: sameClient
          });
        }
      }
    });
    item.overlappingEvents = overlaps;
    if (overlaps.length) item.validation.push("CONFLITO: há evento(s) sobrepostos; bloquear gravação até revisão.");
    else item.validation.push("Nenhum outro evento sobreposto ao intervalo pretendido.");

    if (decision.action === "UPDATE_CALENDAR_DURATION") {
      item.validation.push("Atualizar somente o fim do evento existente; confirmar ocorrência exata por ID + início, não apenas pelo ID recorrente.");
      item.expectedCalendarOccurrence = "6g07637k50lq60c35h36qt72uo@google.com|2026-12-23T16:00:00";
    }
    if (decision.action === "KEEP_CALENDAR_AND_ALIGN_SHEET") {
      item.validation.push("A escolha do administrador torna o Calendar a referência: planejar ajuste da linha para 12:30 e exceção de duração de 90 min; verificar cabeçalho/coluna de duração antes de gravar.");
      item.expectedCalendarOccurrence = "gmdts7nvfk56vl6v1iaa068leg@google.com|2026-12-24T12:30:00";
    }
    if (decision.action === "CREATE_CALENDAR_EVENT" || decision.action === "CREATE_CALENDAR_EVENT_PENDING_PIX") {
      item.validation.push("Criar somente após confirmar ausência de evento equivalente e ausência de conflito; persistir vínculo de ocorrência após confirmar coluna correta.");
    }
    plan.push(item);
  });

  var result = {
    status: "success",
    readOnly: true,
    timezone: tz,
    executionAccount: String(Session.getEffectiveUser().getEmail() || ""),
    calendarName: calendar.getName(),
    sheetHeaders: headers.map(function(h, i) { return { column: i + 1, letter: String.fromCharCode(65 + i), header: h }; }),
    decisions: plan,
    safety: "Somente leitura. Nenhuma célula foi alterada. Nenhum evento foi criado, atualizado ou excluído."
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


/**
 * Auditoria estrutural da aba Agendamentos.
 * Somente leitura: não altera cabeçalhos, células ou eventos.
 * Confere se os valores reais seguem o contrato de colunas usado pelo Code.gs.
 */
function auditCalendarSyncSchema() {
  var ss = SpreadsheetApp.openById("1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0");
  var sh = ss.getSheetByName("Agendamentos");
  if (!sh) throw new Error("Aba Agendamentos não encontrada.");
  var lastRow = sh.getLastRow();
  var lastCol = Math.max(sh.getLastColumn(), 20);
  var data = sh.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  var display = sh.getRange(1, 1, Math.max(lastRow, 1), lastCol).getDisplayValues();
  var expected = {
    10:"ID Agendamento (contrato Code.gs)",
    11:"Observações / Anamnese",
    12:"Local do Atendimento",
    13:"Endereço Domiciliar",
    14:"IDs Serviços Adicionais",
    15:"Pedido Personalizado",
    16:"ID Serviço Principal",
    17:"Data de Nascimento",
    18:"Forma de Pagamento",
    19:"Configuração de Recorrência",
    20:"Google Calendar Event ID"
  };
  var headerAudit=[];
  for (var c=10;c<=20;c++) {
    headerAudit.push({
      column:c,
      letter:String.fromCharCode(64+c),
      actualHeader:String(display[0][c-1]||""),
      expectedByCode:expected[c],
      headerMatchesExpected:String(display[0][c-1]||"").trim().toLowerCase()===String(expected[c]||"").trim().toLowerCase()
    });
  }
  var targetIds={
    "apt-1793902283321":true,
    "apt-1793902440508":true,
    "apt-1793903713527":true,
    "apt-1793903805661":true,
    "apt-1794006950286-rec-4":true,
    "apt-1794603000976":true
  };
  var rows=[];
  for (var r=1;r<data.length;r++) {
    var rowId=String(data[r][9]||"").trim();
    if (!targetIds[rowId]) continue;
    var cells=[];
    for (var k=1;k<=20;k++) {
      var val=display[r][k-1];
      if (val!=="" && val!==null && val!==undefined) {
        cells.push({column:k,letter:String.fromCharCode(64+k),header:String(display[0][k-1]||""),displayValue:String(val).substring(0,180),valueType:Object.prototype.toString.call(data[r][k-1])});
      }
    }
    rows.push({
      row:r+1,
      appointmentIdFromJ:rowId,
      clientFromB:String(data[r][1]||""),
      dateFromF:_casDateKey_(data[r][5], "America/Sao_Paulo", display[r][5]),
      timeFromG:_casTimeKey_(data[r][6], "America/Sao_Paulo", display[r][6]),
      statusFromI:String(data[r][8]||""),
      cells:cells
    });
  }
  var result={
    status:"success",
    readOnly:true,
    spreadsheetId:"1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0",
    sheet:"Agendamentos",
    lastRow:lastRow,
    lastColumn:lastCol,
    headerAudit:headerAudit,
    targetRows:rows,
    interpretation:"Comparar valores reais com o contrato de Code.gs. Cabeçalhos divergentes não serão corrigidos automaticamente.",
    safety:"Somente leitura. Nenhuma célula ou evento foi alterado."
  };
  Logger.log(JSON.stringify(result,null,2));
  return result;
}


/**
 * Auditoria compacta das colunas críticas.
 * Somente leitura. Execute auditCalendarSyncCriticalCells().
 */
function auditCalendarSyncCriticalCells() {
  var ss = SpreadsheetApp.openById("1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0");
  var sh = ss.getSheetByName("Agendamentos");
  if (!sh) throw new Error("Aba Agendamentos não encontrada.");
  var ids = {
    "apt-1793902283321": true,
    "apt-1793902440508": true,
    "apt-1793903713527": true,
    "apt-1793903805661": true,
    "apt-1794006950286-rec-4": true,
    "apt-1794603000976": true
  };
  var last = sh.getLastRow();
  var data = sh.getRange(1, 1, last, 20).getDisplayValues();
  var cols = [2,5,6,7,9,10,11,12,13,14,15,16,17,18,19,20];
  var result = {
    status: "success",
    readOnly: true,
    sheet: "Agendamentos",
    columns: cols.map(function(c) {
      return {letter: String.fromCharCode(64+c), header: data[0][c-1] || ""};
    }),
    rows: []
  };
  for (var r = 1; r < data.length; r++) {
    var id = String(data[r][9] || "").trim();
    if (!ids[id]) continue;
    var cells = {};
    cols.forEach(function(c) {
      cells[String.fromCharCode(64+c)] = data[r][c-1] || "";
    });
    result.rows.push({row: r+1, cells: cells});
  }
  Logger.log(JSON.stringify(result));
  return result;
}
