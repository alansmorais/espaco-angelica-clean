/**
 * Espaço Angélica do Carmo - Google Apps Script Backend (Code.gs)
 * Configuração Segura de Produção com validação obrigatória via ScriptProperties.
 *
 * Planilha Oficial: https://docs.google.com/spreadsheets/d/1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0/edit
 * Aba: Agendamentos
 */

var TARGET_SPREADSHEET_ID = "1dB23gq_EiQtCT-TQcdEK1yHV0lk5X0TkkIZKbnqTRs0";

function uploadImageToDrive(base64Data, fileName, mimeType) {
  try {
    if (!base64Data || !fileName || !mimeType) {
      throw new Error(
        'Image data, file name and MIME type are required.'
      );
    }

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif'
    ];

    if (allowedTypes.indexOf(mimeType) === -1) {
      throw new Error('Unsupported image file type.');
    }

    const decodedData = Utilities.base64Decode(base64Data);

    if (decodedData.length > 10 * 1024 * 1024) {
      throw new Error('Image must be 10 MB or smaller.');
    }

    const folder = DriveApp.getFolderById(FOLDER_ID);

    const safeFileName = String(fileName)
      .replace(/[\\/:*?"<>|]/g, '_');

    const blob = Utilities.newBlob(
      decodedData,
      mimeType,
      safeFileName
    );

    const file = folder.createFile(blob);

    return 'https://drive.google.com/thumbnail?id=' +
      file.getId() +
      '&sz=w1000';

  } catch (error) {
    console.error('Image upload failed:', error);

    throw new Error(
      'Image upload failed: ' + error.message
    );
  }
}

function validateAuthorization(tokenProvided) {
  var provided = String(tokenProvided || "").trim();
  if (!provided) return { valid: false, error: "Acesso não autorizado: token de autorização inválido ou ausente." };

  var expectedToken = String(PropertiesService.getScriptProperties().getProperty("APPS_SCRIPT_TOKEN") || "").trim();
  if (expectedToken && provided === expectedToken) return { valid: true };

  try {
    if (CacheService.getScriptCache().get("ADMIN_SESSION_" + provided) === "1") {
      return { valid: true, session: true };
    }
  } catch (cacheError) {
    console.error("Unable to validate admin session: " + cacheError);
  }

  return {
    valid: false,
    error: expectedToken
      ? "Acesso não autorizado: sessão inválida ou expirada."
      : "Configuração incompleta: APPS_SCRIPT_TOKEN ausente nas Propriedades do Script."
  };
}

function createAdminSession(password) {
  var configuredPassword = String(PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD") || "");
  if (!configuredPassword) {
    return { status: "error", success: false, message: "Configure ADMIN_PASSWORD nas Propriedades do Script do Google Apps Script antes de entrar no painel." };
  }
  if (!password || String(password) !== configuredPassword) {
    return { status: "error", success: false, message: "Senha administrativa incorreta." };
  }
  var token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  CacheService.getScriptCache().put("ADMIN_SESSION_" + token, "1", 21600);
  return { status: "success", success: true, token: token, expiresInSeconds: 21600 };
}

function revokeAdminSession(token) {
  var provided = String(token || "").trim();
  if (provided) CacheService.getScriptCache().remove("ADMIN_SESSION_" + provided);
  return { status: "success", success: true };
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOfficialSheet() {
  try {
    var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    return ss ? ss.getSheetByName("Agendamentos") : null;
  } catch (e) {
    return null;
  }
}

// Called only on explicit write paths after validation, never during reads.
function ensureOptionalBookingHeaders(sheet) {
  if (!sheet) throw new Error("Aba 'Agendamentos' não encontrada na planilha oficial.");
  var extensionHeaders = ["Local do Atendimento", "Endereço Domiciliar", "IDs Serviços Adicionais", "Pedido Personalizado", "ID Serviço Principal"];
  for (var h = 0; h < extensionHeaders.length; h++) {
    var cell = sheet.getRange(1, 12 + h);
    if (!String(cell.getValue() || "").trim()) cell.setValue(extensionHeaders[h]);
  }
}

function getServicesSheets() {
  try {
    var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    if (!ss) return [];
    // Read existing official tabs only. Do not create or seed a replacement catalogue.
    var names = ["Serviços", "Servicos", "Depilação", "Depilacao"];
    var sheets = [];
    names.forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (sheet && sheets.indexOf(sheet) === -1) sheets.push(sheet);
    });
    return sheets;
  } catch (e) {
    return [];
  }
}

// Legacy write paths continue targeting the main services tab only.
function getServicesSheet() {
  var sheets = getServicesSheets();
  return sheets.length ? sheets[0] : null;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  var trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  var re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(trimmed);
}

function timeToMinutes(value) {
  var match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  var hours = Number(match[1]), minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseDurationMinutes(value) {
  var text = String(value || "").toLowerCase();
  var hours = text.match(/(\d+)\s*h/);
  var minutes = text.match(/(\d+)\s*(?:min|m\b)/);
  var total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return total > 0 ? total : 30;
}

function getServiceDurationMinutes(serviceId, serviceTitle) {
  try {
    var sheets = getServicesSheets();
    for (var sh = 0; sh < sheets.length; sh++) {
      var rows = sheets[sh].getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var idMatches = serviceId && String(rows[i][0] || "").trim() === String(serviceId).trim();
        var titleMatches = serviceTitle && String(rows[i][1] || "").trim().toLowerCase() === String(serviceTitle).trim().toLowerCase();
        if (idMatches || titleMatches) return parseDurationMinutes(rows[i][5]);
      }
    }
  } catch (e) {
    console.error("Unable to read service duration: " + e);
  }
  return 30;
}

// Strict duration lookup resolves services across the official services and depilation tabs.
function getConfiguredServiceDurationMinutes(serviceId, serviceTitle) {
  try {
    var sheets = getServicesSheets();
    for (var sh = 0; sh < sheets.length; sh++) {
      var rows = sheets[sh].getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var rowId = String(rows[i][0] || "").trim();
        var rowTitle = String(rows[i][1] || "").trim();
        var idMatches = serviceId && rowId === String(serviceId).trim();
        var titleMatches = serviceTitle && rowTitle.toLowerCase() === String(serviceTitle).trim().toLowerCase();
        if (!idMatches && !titleMatches) continue;
        if (rows[i][11] === false || String(rows[i][11]).toLowerCase() === "false") return null;
        var durationText = String(rows[i][5] || "").toLowerCase();
        var hoursMatch = durationText.match(/(\d+)\s*h/);
        var minutesMatch = durationText.match(/(\d+)\s*(?:min|m\b)/);
        var total = (hoursMatch ? Number(hoursMatch[1]) * 60 : 0) +
          (minutesMatch ? Number(minutesMatch[1]) : 0);
        return total > 0 && Number.isFinite(total) ? total : null;
      }
    }
  } catch (e) {
    console.error("Unable to validate official service duration: " + e);
  }
  return null;
}
function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function parseBlockInterval(value) {
  var match = String(value || "").trim().match(/^(\d{1,2}:\d{2})\s*(?:às|as|-)\s*(\d{1,2}:\d{2})$/i);
  if (!match) return null;
  var start = timeToMinutes(match[1]), end = timeToMinutes(match[2]);
  return start !== null && end !== null && end > start ? { start: start, end: end } : null;
}

function getPublicScheduleData() {
  try {
    var data = getScheduleConfigData();
    return {
      status: "success",
      weeklySchedule: data.weeklySchedule || null,
      blocks: (data.blocks || []).filter(function(block) { return block && block.active !== false; })
    };
  } catch (err) {
    console.error("Unable to read public schedule config: " + err);
    return { status: "error", message: "Configuração da agenda indisponível." };
  }
}

function getPublicAvailabilityData() {
  var sheet = getOfficialSheet();
  if (!sheet) return { status: "error", success: false, message: "Aba 'Agendamentos' não encontrada na planilha oficial." };

  var values = sheet.getDataRange().getValues();
  var slots = [];
  var blockedDates = [];
  var tz = Session.getScriptTimeZone() || "America/Sao_Paulo";
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[5]) continue;
    var dateKey = normalizeBookingDate(row[5]);
    var timeKey = normalizeBookingTime(row[6]);
    var status = String(row[8] || "pendente_pix").trim();
    if (!dateKey) continue;
    if (status.toLowerCase() === "bloqueado" && (!timeKey || timeKey.toLowerCase() === "dia inteiro")) {
      blockedDates.push(dateKey);
      continue;
    }
    if (!row[9] && !row[1]) continue;
    slots.push({
      id: String(row[9] || ("apt-sheet-" + i)),
      date: dateKey,
      time: timeKey,
      status: status,
      serviceDuration: getServiceDurationMinutes(String(row[15] || ""), String(row[4] || "")) + " min"
    });
  }

  var schedule = getPublicScheduleData();
  if (schedule.status !== "success") {
    return { status: "error", success: false, message: schedule.message || "Configuração da agenda indisponível." };
  }
  var scheduleBlocks = schedule.blocks || [];
  scheduleBlocks.forEach(function(block) {
    if (block && block.active !== false && block.allDay === true && block.date) blockedDates.push(String(block.date));
  });
  return {
    status: "success",
    success: true,
    slots: slots,
    blockedDates: Array.from(new Set(blockedDates)),
    scheduleBlocks: scheduleBlocks,
    weeklySchedule: schedule.weeklySchedule || null,
    updatedAt: new Date().toISOString()
  };
}

function validateAgainstSavedSchedule(dateKey, timeKey, durationMinutes) {
  var config = getScheduleConfigData();
  var start = timeToMinutes(timeKey);
  // Availability is controlled by manually configured slots, not service duration.
  var end = start;
  var parts = dateKey.split("-");
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  var dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  var dayName = dayNames[date.getUTCDay()];
  var weekly = config.weeklySchedule;

  if (weekly && weekly[dayName]) {
    var day = weekly[dayName];
    if (day.open === false) return { allowed: false, message: "O atelier não atende neste dia. Escolha outra data." };
    if (day.open === true) {
      var open = timeToMinutes(String(day.openTime || ""));
      var close = timeToMinutes(String(day.closeTime || ""));
      if (open === null || close === null || start < open || start >= close) {
        return { allowed: false, message: "Este horário está fora do expediente configurado. Escolha outro horário." };
      }
    }
  }

  if (weekly && Array.isArray(weekly.slots)) {
    for (var si = 0; si < weekly.slots.length; si++) {
      var slot = weekly.slots[si];
      if (!slot || slot.active === false) continue;
      var slotStatus = String(slot.status || "").toLowerCase();
      if (["bloqueado", "autoclave", "almoco"].indexOf(slotStatus) === -1) continue;
      var slotStart = timeToMinutes(String(slot.time || ""));
      if (slotStart !== null && start >= slotStart && start < slotStart + 30) {
        return { allowed: false, message: "Este horário está bloqueado na configuração semanal. Escolha outro horário." };
      }
    }
  }

  var blocks = config.blocks || [];
  for (var bi = 0; bi < blocks.length; bi++) {
    var block = blocks[bi];
    if (!block || block.active === false || String(block.date || "") !== dateKey) continue;
    if (block.allDay === true) return { allowed: false, message: "Esta data está bloqueada para atendimentos. Escolha outro dia." };
    var blockStart = timeToMinutes(String(block.startTime || ""));
    var blockEnd = timeToMinutes(String(block.endTime || ""));
    if (blockStart !== null && blockEnd !== null && start >= blockStart && start < blockEnd) {
      return { allowed: false, message: "Este intervalo está bloqueado. Escolha outro horário." };
    }
  }
  return { allowed: true };
}

function normalizeWhatsAppPhone(value) {
  var digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 8 || digits.length === 9) digits = "5512" + digits;
  else if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return { normalized: digits, valid: /^55\d{10,11}$/.test(digits) };
}

function formatWhatsAppBRL(value) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildWhatsAppConfirmationText(data) {
  var appSettings = getAppSettingsData().settings || {};
    var configuredAddress = appSettings.STUDIO_ADDRESS && typeof appSettings.STUDIO_ADDRESS === "object" ? appSettings.STUDIO_ADDRESS : {};
    var addressFromSettings = String(configuredAddress.fullAddress || [configuredAddress.street, configuredAddress.number, configuredAddress.neighborhood, configuredAddress.city, configuredAddress.state].map(function(value) { return String(value || "").trim(); }).filter(Boolean).join(", "));
    var address = String(data.studioAddress || addressFromSettings);
  var price = String(data.servicePrice || "");
  var deposit = data.depositAmount !== undefined && data.depositAmount !== null && data.depositAmount !== ""
    ? "R$ " + formatWhatsAppBRL(data.depositAmount) : "";
  var paymentLabel = data.paymentMode === "pre_pagamento_100" ? "Pré-pagamento (100%)" : "Sinal (40%)";
  var custom = String(data.customTemplate || "").trim();
  if (custom) {
    return custom.replace(/{cliente}/g, String(data.clientName || ""))
      .replace(/{servico}/g, String(data.serviceTitle || "Procedimento"))
      .replace(/{data}/g, String(data.date || "Hoje"))
      .replace(/{horario}/g, String(data.time || "Horário agendado"))
      .replace(/{valor}/g, price)
      .replace(/{endereco}/g, address)
      .replace(/{sinal}/g, deposit);
  }

  var text = "✨ *Confirmação de Agendamento • Espaço Angélica do Carmo* ✨\n\n" +
    "Olá, *" + String(data.clientName || "") + "*! Seu horário no nosso atelier privativo foi *CONFIRMADO* com sucesso na grade. 💅✨\n\n" +
    "📋 *Detalhes do seu atendimento:*\n" +
    "• *Procedimento:* " + String(data.serviceTitle || "Procedimento de Nail Design") + "\n" +
    "• *Data:* " + String(data.date || "Hoje") + "\n" +
    "• *Horário:* às " + String(data.time || "Horário agendado");
  if (price) text += "\n💳 *Valor do Procedimento:* " + price;
  if (deposit) text += "\n💰 *" + paymentLabel + ":* " + deposit + " (" + (data.depositStatus === "liquidado" ? "Confirmado via Pix" : "Aguardando validação") + ")";
  text += "\n\n📍 *Endereço:* " + address + "\n\n" +
    "ℹ️ *Orientações importantes:*\n" +
    "• Pedimos a gentileza de chegar com 5 a 10 minutos de antecedência.\n" +
    "• Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago.\n" +
    "• Em caso de desistência ou não comparecimento, o sinal não é reembolsado.\n\n" +
    "Qualquer dúvida ou caso queira enviar uma foto de referência de nail art, pode responder a esta mensagem. Mal podemos esperar para cuidar de você! 💕";
  return text;
}

function getWhatsAppStatusData() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("WHATSAPP_API_TOKEN") || props.getProperty("WHATSAPP_TOKEN") || props.getProperty("META_WA_TOKEN");
  var phoneId = props.getProperty("WHATSAPP_PHONE_NUMBER_ID") || props.getProperty("META_PHONE_NUMBER_ID");
  var businessId = props.getProperty("WHATSAPP_BUSINESS_ACCOUNT_ID");
  var version = props.getProperty("WHATSAPP_API_VERSION") || "v20.0";
  var configured = Boolean(token && phoneId);
  var logs = getWhatsAppLogsData();
  return {
    status: configured ? "configured" : "sandbox_simulation",
    mode: configured ? "Meta WhatsApp Cloud API (via Apps Script)" : "Modo manual/simulação — configure as chaves Meta nas Propriedades do Script",
    isConfigured: configured,
    phoneNumberIdConfigured: Boolean(phoneId),
    tokenConfigured: Boolean(token),
    businessAccountIdConfigured: Boolean(businessId),
    apiVersion: version,
    totalLogs: logs.length
  };
}

function getWhatsAppLogsData() {
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Logs WhatsApp");
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.min(10, sheet.getLastColumn())).getValues();
  return values.reverse().slice(0, 50).map(function(row) {
    return {
      id: String(row[0] || ""),
      recipientPhone: String(row[1] || ""),
      recipientName: String(row[2] || ""),
      appointmentId: String(row[3] || ""),
      serviceTitle: String(row[4] || ""),
      dateTime: String(row[5] || ""),
      status: String(row[6] || "failed"),
      timestamp: row[7] instanceof Date ? row[7].toISOString() : String(row[7] || ""),
      messageText: String(row[8] || ""),
      error: String(row[9] || "") || undefined
    };
  });
}

function saveWhatsAppLog(log) {
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Logs WhatsApp");
  if (!sheet) {
    sheet = ss.insertSheet("Logs WhatsApp");
    sheet.getRange(1, 1, 1, 10).setValues([["ID", "Telefone", "Nome", "ID Agendamento", "Serviço", "Data/Hora", "Status", "Criado em", "Mensagem", "Erro"]]);
    sheet.setFrozenRows(1);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 10).setValues([[log.id, log.recipientPhone, log.recipientName, log.appointmentId || "", log.serviceTitle || "", log.dateTime || "", log.status, new Date(log.timestamp), log.messageText, log.error || ""]]);
}

function processWhatsAppConfirmation(data, forceSimulation) {
  if (!data.clientName || !data.clientPhone) {
    return { success: false, status: "failed", error: "Nome e telefone da cliente são obrigatórios para envio da confirmação." };
  }
  var phone = normalizeWhatsAppPhone(data.clientPhone);
  if (!phone.valid) return { success: false, status: "failed", error: "Número de telefone inválido para envio via WhatsApp." };

  var messageText = buildWhatsAppConfirmationText(data);
  var fallbackUrl = "https://wa.me/" + phone.normalized + "?text=" + encodeURIComponent(messageText);
  var isTest = forceSimulation || (String(data.appointmentId || "").indexOf("test-") === 0) ||
    String(data.depositStatus || "") === "teste_sistema" ||
    String(data.clientName || "").toLowerCase().indexOf("teste_sistema") >= 0;

  var props = PropertiesService.getScriptProperties();
  var apiToken = props.getProperty("WHATSAPP_API_TOKEN") || props.getProperty("WHATSAPP_TOKEN") || props.getProperty("META_WA_TOKEN");
  var phoneNumberId = props.getProperty("WHATSAPP_PHONE_NUMBER_ID") || props.getProperty("META_PHONE_NUMBER_ID");
  var apiVersion = props.getProperty("WHATSAPP_API_VERSION") || "v20.0";
  var log = {
    id: "wa-log-" + Utilities.getUuid(),
    recipientPhone: phone.normalized,
    recipientName: String(data.clientName),
    appointmentId: String(data.appointmentId || ""),
    serviceTitle: String(data.serviceTitle || ""),
    dateTime: String(data.date || "") + " às " + String(data.time || ""),
    status: "simulated",
    timestamp: new Date().toISOString(),
    messageText: messageText,
    error: ""
  };

  if (isTest) {
    return { success: true, status: "simulated", mode: "test_isolated", normalizedPhone: phone.normalized, previewText: messageText, fallbackUrl: fallbackUrl, message: "Teste isolado: nenhuma mensagem foi enviada nem gravada nos logs reais." };
  }

  if (apiToken && phoneNumberId) {
    try {
      var metaResponse = UrlFetchApp.fetch("https://graph.facebook.com/" + apiVersion + "/" + phoneNumberId + "/messages", {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + apiToken },
        payload: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone.normalized,
          type: "text",
          text: { preview_url: false, body: messageText }
        }),
        muteHttpExceptions: true
      });
      var metaText = metaResponse.getContentText();
      var metaData;
      try { metaData = JSON.parse(metaText); } catch (parseError) { metaData = { raw: metaText }; }
      if (metaResponse.getResponseCode() >= 200 && metaResponse.getResponseCode() < 300) {
        log.status = "sent";
        saveWhatsAppLog(log);
        return { success: true, status: "sent", normalizedPhone: phone.normalized, metaResponse: metaData, message: "Mensagem enviada via WhatsApp Business API.", log: log };
      }
      log.status = "failed";
      log.error = metaData && metaData.error && metaData.error.message ? metaData.error.message : "Erro retornado pela API do WhatsApp.";
      saveWhatsAppLog(log);
      return { success: false, status: "failed", error: log.error, normalizedPhone: phone.normalized, fallbackUrl: fallbackUrl, log: log };
    } catch (sendError) {
      log.status = "failed";
      log.error = String(sendError);
      saveWhatsAppLog(log);
      return { success: false, status: "failed", error: "Falha de comunicação com a API do WhatsApp.", fallbackUrl: fallbackUrl, log: log };
    }
  }

  log.status = "simulated";
  saveWhatsAppLog(log);
  return { success: true, status: "simulated", mode: "manual_fallback", normalizedPhone: phone.normalized, previewText: messageText, fallbackUrl: fallbackUrl, message: "WhatsApp API não configurada. A mensagem foi registrada como tentativa simulada; abra o link para enviar manualmente.", log: log };
}

function getAppSettingsData() {
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SCHEDULE_CONFIG_SHEET) || ss.getSheetByName(LEGACY_SCHEDULE_CONFIG_SHEET);
  var settings = {};
  if (!sheet) return { status: "success", settings: settings };
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0] || "").trim() !== "APP_SETTING") continue;
    var key = String(values[i][1] || "").trim();
    var raw = String(values[i][2] || "");
    if (!key || !raw) continue;
    try { settings[key] = JSON.parse(raw); } catch (parseError) {
      console.error("Invalid APP_SETTING JSON for " + key);
    }
  }
  return { status: "success", settings: settings };
}

function saveAppSetting(settingKey, value) {
  var key = String(settingKey || "").trim();
  var allowed = ["STUDIO_ADDRESS", "BLACKLIST", "WHATSAPP_CONFIG", "PAYMENT_CONFIG"];
  if (allowed.indexOf(key) === -1) {
    return { status: "error", saved: false, message: "Tipo de configuração não permitido." };
  }
  if (value === undefined) {
    return { status: "error", saved: false, message: "Valor da configuração ausente." };
  }
  var serialized;
  try { serialized = JSON.stringify(value); } catch (serializeError) {
    return { status: "error", saved: false, message: "Configuração inválida para serialização." };
  }
  var sheet = getOrCreateScheduleConfigSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || "").trim() === "APP_SETTING" && String(rows[i][1] || "").trim() === key) {
        sheet.getRange(i + 1, 1, 1, 4).setValues([["APP_SETTING", key, serialized, new Date()]]);
        return { status: "success", saved: true, settingKey: key };
      }
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 4).setValues([["APP_SETTING", key, serialized, new Date()]]);
    return { status: "success", saved: true, settingKey: key };
  } finally {
    lock.releaseLock();
  }
}

function getPublicStudioAddressData() {
  var data = getAppSettingsData();
  return { status: "success", address: data.settings && data.settings.STUDIO_ADDRESS ? data.settings.STUDIO_ADDRESS : null };
}

function normalizeClientPhoneKey(value) {
  return String(value || "").replace(/\D/g, "");
}

function getOrCreateClientsSheet() {
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Perfis de Clientes");
  if (!sheet) {
    sheet = ss.insertSheet("Perfis de Clientes");
    sheet.getRange(1, 1, 1, 4).setValues([["ID", "Telefone Normalizado", "Perfil JSON", "Atualizado em"]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getClientsData() {
  var profilesByPhone = {};
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var clientSheet = ss.getSheetByName("Perfis de Clientes");
  var savedRows = clientSheet ? clientSheet.getDataRange().getValues() : [];
  for (var i = 1; i < savedRows.length; i++) {
    var savedPhone = normalizeClientPhoneKey(savedRows[i][1]);
    var rawProfile = String(savedRows[i][2] || "");
    if (!savedPhone || !rawProfile) continue;
    try { profilesByPhone[savedPhone] = JSON.parse(rawProfile); } catch (parseError) {
      console.error("Invalid client profile JSON on row " + (i + 1));
    }
  }

  var appointmentsSheet = getOfficialSheet();
  if (appointmentsSheet) {
    var rows = appointmentsSheet.getDataRange().getValues();
    var derived = {};
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var phone = String(row[2] || "");
      var phoneKey = normalizeClientPhoneKey(phone);
      var name = String(row[1] || "").trim();
      if (!phoneKey || !name || String(row[8] || "").toLowerCase() === "bloqueado") continue;
      var profile = derived[phoneKey];
      if (!profile) {
        var saved = profilesByPhone[phoneKey] || {};
        var initials = name.split(/\s+/).map(function(part) { return part.charAt(0); }).slice(0, 2).join("").toUpperCase();
        profile = {
          id: saved.id || ("client-" + phoneKey),
          name: name,
          initials: initials,
          phone: phone,
          tier: saved.tier || "1ª Sessão",
          status: saved.status || "nova",
          lastVisit: saved.lastVisit || "",
          lastService: "",
          nextMaintenanceDays: Number(saved.nextMaintenanceDays || 0),
          daysRemainingOrOverdue: String(saved.daysRemainingOrOverdue || ""),
          isOverdue: saved.isOverdue === true,
          ltv: Number(saved.ltv || 0),
          ltvFormatted: String(saved.ltvFormatted || "R$ 0,00"),
          laminaType: String(saved.laminaType || ""),
          oiliness: String(saved.oiliness || ""),
          allergies: String(saved.allergies || ""),
          onycholysis: String(saved.onycholysis || ""),
          preferredShape: String(saved.preferredShape || ""),
          preferredColor: String(saved.preferredColor || ""),
          products: saved.products && typeof saved.products === "object" ? saved.products : { preparer: "", baseGel: "", tensionPoint: "", topCoat: "" },
          privateNotes: String(saved.privateNotes || ""),
          isBlacklisted: saved.isBlacklisted === true,
          blacklistReason: String(saved.blacklistReason || "")
        };
        derived[phoneKey] = profile;
      }
      profile.name = name;
      profile.phone = phone;
      profile.initials = name.split(/\s+/).map(function(part) { return part.charAt(0); }).slice(0, 2).join("").toUpperCase();
      profile.lastService = String(row[4] || profile.lastService || "");
      if (String(row[8] || "").toLowerCase() === "concluido") {
        profile.lastVisit = String(row[5] || "") + (row[6] ? " às " + String(row[6]) : "");
      }
      profile._bookingCount = Number(profile._bookingCount || 0) + 1;
      if (profile._bookingCount > 1 && !profilesByPhone[phoneKey]?.tier) {
        profile.tier = "Frequente";
        profile.status = "frequente";
      }
    }
    Object.keys(derived).forEach(function(key) { profilesByPhone[key] = derived[key]; });
  }

  return { status: "success", clients: Object.keys(profilesByPhone).map(function(key) {
    var profile = profilesByPhone[key];
    delete profile._bookingCount;
    return profile;
  }) };
}

function saveClientProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { status: "error", saved: false, message: "Perfil de cliente inválido." };
  }
  var name = String(profile.name || "").trim();
  var phone = String(profile.phone || "").trim();
  var phoneKey = normalizeClientPhoneKey(phone);
  var id = String(profile.id || "").trim();
  if (!name || !phoneKey || !id) {
    return { status: "error", saved: false, message: "Nome, telefone e ID são obrigatórios para salvar a cliente." };
  }
  var sheet = getOrCreateClientsSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || "") === id || normalizeClientPhoneKey(rows[i][1]) === phoneKey) {
        sheet.getRange(i + 1, 1, 1, 4).setValues([[id, phoneKey, JSON.stringify(profile), new Date()]]);
        return { status: "success", saved: true, clientId: id };
      }
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 4).setValues([[id, phoneKey, JSON.stringify(profile), new Date()]]);
    return { status: "success", saved: true, clientId: id };
  } finally {
    lock.releaseLock();
  }
}

function getPublicPaymentConfigData() {
  var data = getAppSettingsData();
  var payment = data.settings && data.settings.PAYMENT_CONFIG && typeof data.settings.PAYMENT_CONFIG === "object"
    ? data.settings.PAYMENT_CONFIG : {};
  var config = {
    pixKey: String(payment.pixKey || ""),
    pixBeneficiary: String(payment.pixBeneficiary || ""),
    depositAmount: Number(payment.depositAmount === undefined ? 40 : payment.depositAmount),
  };
  return {
    status: "success",
    configured: Boolean(config.pixKey.trim() && config.pixBeneficiary.trim()),
    paymentConfig: config
  };
}

function getPublicGalleryPhotosData() {
  try {
    var folder = DriveApp.getFolderById("1JGypjL9OqGL5i2OUrjiGMKxkWD11YuAw");
    var files = folder.getFiles();
    var photos = [];
    while (files.hasNext()) {
      var file = files.next();
      if (file.isTrashed() || String(file.getMimeType() || "").indexOf("image/") !== 0) continue;
      var id = file.getId();
      photos.push({
        id: id,
        title: "Nail Art",
        subtitle: "Portfólio Espaço Angélica do Carmo",
        url: "https://drive.google.com/uc?export=view&id=" + id,
        thumbnailUrl: "https://drive.google.com/thumbnail?id=" + id + "&sz=w800"
      });
    }
    return { status: "success", photos: photos };
  } catch (error) {
    console.error("Public gallery read failed: " + error);
    return { status: "error", message: "A galeria oficial do Google Drive está indisponível." };
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return responseJSON({ status: "error", message: "Corpo da requisição vazio." });
    }

    var data = JSON.parse(e.postData.contents);

    // Agendamento público: usa validações de cliente, catálogo, data, horário,
    // concorrência e duplicidade abaixo. Ações administrativas continuam exigindo token.
    var isPublicBooking = data.action === "createBooking" || data.action === "getPublicSchedule" || data.action === "getPublicAvailability" || data.action === "getPublicStudioAddress" || data.action === "getPublicPaymentConfig" || data.action === "getPublicGalleryPhotos" || data.action === "getServices" || data.action === "createAdminSession";
    if (!isPublicBooking) {
      var tokenProvided = data.token || data.authToken || data.key || (e.parameter && e.parameter.token);
      var auth = validateAuthorization(tokenProvided);
      if (!auth.valid) {
        return responseJSON({ status: "error", message: auth.error });
      }
    }

    // Public createBooking requests deliberately continue into the single validated
    // booking flow below. Do not persist bookings in an early shortcut that bypasses
    // official service, payment, duration, conflict and concurrency validation.

    if (data.action === "createAdminSession") return responseJSON(createAdminSession(data.password));
    if (data.action === "revokeAdminSession") return responseJSON(revokeAdminSession(data.token));
    if (data.action === "getPublicAvailability") return responseJSON(getPublicAvailabilityData());
    if (data.action === "getPublicStudioAddress") return responseJSON(getPublicStudioAddressData());
    if (data.action === "getPublicPaymentConfig") return responseJSON(getPublicPaymentConfigData());
    if (data.action === "getPublicGalleryPhotos") return responseJSON(getPublicGalleryPhotosData());

    if (data.action === "getPublicSchedule") {    return responseJSON(getPublicScheduleData());  }    // Persistent weekly schedule and date/time blocks.
    // These administrative actions use the authorization check above.
    if (data.action === "getScheduleConfig") {
      return responseJSON(getScheduleConfigData());
    }

    if (data.action === "saveWeeklySchedule") {
      return responseJSON(saveWeeklyScheduleConfig(data.weeklySchedule));
    }

    if (data.action === "saveScheduleBlock") {
      return responseJSON(saveScheduleBlock(data.block));
    }

    if (data.action === "deleteScheduleBlock") {
      return responseJSON(deleteScheduleBlock(data.blockId));
    }

    if (data.action === "getAppSettings") {
      return responseJSON(getAppSettingsData());
    }
    if (data.action === "saveAppSetting") {
      return responseJSON(saveAppSetting(data.settingKey, data.value));
    }

    if (data.action === "getEmailStatus") {
      return responseJSON(getEmailStatusData());
    }
    if (data.action === "sendAdminEmail") {
      return responseJSON(sendAdminEmailNotification(data));
    }
    if (data.action === "testEmailNotification") {
      return responseJSON(sendTestEmailNotification());
    }

    if (data.action === "getWhatsAppStatus") {
      return responseJSON({ status: "success", success: true, ...getWhatsAppStatusData() });
    }
    if (data.action === "getWhatsAppLogs") {
      return responseJSON({ status: "success", success: true, logs: getWhatsAppLogsData() });
    }
    if (data.action === "testWhatsAppMessage") {
      return responseJSON(processWhatsAppConfirmation(data, true));
    }
    if (data.action === "sendWhatsAppConfirmation") {
      return responseJSON(processWhatsAppConfirmation(data, false));
    }

    if (data.action === "getClients") {
      return responseJSON(getClientsData());
    }
    if (data.action === "saveClient") {
      return responseJSON(saveClientProfile(data.client));
    }

    // 2. Leitura administrativa segura via POST (token no corpo)
    if (data.action === "getAppointments") {
      return fetchAppointmentsFromSheet();
    }

    if (data.action === "deleteAppointment") {
      var appointmentIdToDelete = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(appointmentIdToDelete)) {
        return responseJSON({ status: "error", message: "ID do agendamento inválido." });
      }

      var deleteLock = LockService.getScriptLock();
      try {
        deleteLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio para exclusão." });
      }

      try {
        var deleteSheet = getOfficialSheet();
        if (!deleteSheet) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }

        var appointmentRows = deleteSheet.getDataRange().getValues();
        var deletedCount = 0;
        for (var rowIndex = appointmentRows.length - 1; rowIndex >= 1; rowIndex--) {
          var rowAppointmentId = appointmentRows[rowIndex][9] ? String(appointmentRows[rowIndex][9]).trim() : "";
          if (rowAppointmentId === appointmentIdToDelete) {
            deleteSheet.deleteRow(rowIndex + 1);
            deletedCount++;
          }
        }

        return responseJSON({
          status: "success",
          deleted: deletedCount > 0,
          notFound: deletedCount === 0,
          deletedCount: deletedCount,
          appointmentId: appointmentIdToDelete,
          message: deletedCount > 0
            ? "Agendamento removido da planilha."
            : "Agendamento já não consta na planilha."
        });
      } finally {
        deleteLock.releaseLock();
      }
    }

    if (data.action === "updateAppointment") {
      var rawUpdateId = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!rawUpdateId || !/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(rawUpdateId)) {
        return responseJSON({ status: "error", message: "ID do agendamento inválido ou ausente para atualização." });
      }

      var updateLock = LockService.getScriptLock();
      try {
        updateLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio para atualização." });
      }

      try {
        var updateSheet = getOfficialSheet();
        if (!updateSheet) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }

        ensureOptionalBookingHeaders(updateSheet);
        var updateRows = updateSheet.getDataRange().getValues();
        var foundRowIndex = -1;
        for (var u = 1; u < updateRows.length; u++) {
          var rowId = updateRows[u][9] ? String(updateRows[u][9]).trim() : "";
          if (rowId && rowId.toLowerCase() === rawUpdateId.toLowerCase()) {
            foundRowIndex = u + 1;
            break;
          }
        }

        if (foundRowIndex === -1) {
          return responseJSON({
            status: "error",
            notFound: true,
            appointmentId: rawUpdateId,
            message: "Agendamento " + rawUpdateId + " não encontrado na planilha oficial."
          });
        }

        if (data.clientName !== undefined) updateSheet.getRange(foundRowIndex, 2).setValue(String(data.clientName).trim());
        if (data.clientPhone !== undefined) updateSheet.getRange(foundRowIndex, 3).setValue(String(data.clientPhone).trim());
        if (data.clientEmail !== undefined) updateSheet.getRange(foundRowIndex, 4).setValue(String(data.clientEmail).trim());
        if (data.serviceTitle !== undefined) updateSheet.getRange(foundRowIndex, 5).setValue(String(data.serviceTitle).trim());
        if (data.date !== undefined) updateSheet.getRange(foundRowIndex, 6).setValue(String(data.date).trim());
        if (data.time !== undefined) updateSheet.getRange(foundRowIndex, 7).setValue(String(data.time).trim());
        if (data.depositAmount !== undefined) updateSheet.getRange(foundRowIndex, 8).setValue(Number(data.depositAmount));
        if (data.status !== undefined) updateSheet.getRange(foundRowIndex, 9).setValue(String(data.status).trim());
        if (data.notes !== undefined) updateSheet.getRange(foundRowIndex, 11).setValue(String(data.notes).trim());
        if (data.appointmentLocation !== undefined) updateSheet.getRange(foundRowIndex, 12).setValue(String(data.appointmentLocation).trim());
        if (data.homeAddress !== undefined) updateSheet.getRange(foundRowIndex, 13).setValue(String(data.homeAddress).trim());
        if (data.additionalServiceIds !== undefined) updateSheet.getRange(foundRowIndex, 14).setValue(JSON.stringify(Array.isArray(data.additionalServiceIds) ? data.additionalServiceIds : []));
        if (data.customRequest !== undefined) updateSheet.getRange(foundRowIndex, 15).setValue(String(data.customRequest).trim());
        if (data.serviceId !== undefined) updateSheet.getRange(foundRowIndex, 16).setValue(String(data.serviceId).trim());

        return responseJSON({
          status: "success",
          updated: true,
          persisted: true,
          appointmentId: rawUpdateId,
          message: "Agendamento atualizado com sucesso na planilha oficial."
        });
      } finally {
        updateLock.releaseLock();
      }
    }

    if (data.action === "getServices") {
      var serviceSheets = getServicesSheets();
      if (!serviceSheets.length) {
        return responseJSON({ status: "error", message: "Nenhuma aba oficial de serviços encontrada (Serviços, Servicos ou Depilação)." });
      }
      var servicesList = [];
      var seenServiceIds = {};
      serviceSheets.forEach(function(servSheet) {
        var sRows = servSheet.getDataRange().getValues();
        for (var s = 1; s < sRows.length; s++) {
          var sRow = sRows[s];
          var sId = String(sRow[0] || '').trim();
          var sTitle = String(sRow[1] || '').trim();
          var sCategory = String(sRow[2] || '').trim();
          var sPriceRaw = sRow[3];
          var sDuration = String(sRow[5] || '').trim();
          if (!sId || !sTitle || !sCategory || sPriceRaw === "" || sPriceRaw === null || sPriceRaw === undefined || !isFinite(Number(sPriceRaw)) || !sDuration) continue;
          if (seenServiceIds[sId]) continue;
          seenServiceIds[sId] = true;
          var specsVal = String(sRow[10] || '');
          var specsArr = specsVal ? specsVal.split(',').map(function(item) { return item.trim(); }).filter(Boolean) : [];
          var category = sCategory;
          if (/^depila[cç][aã]o$/i.test(servSheet.getName())) category = "depilacao";
          servicesList.push({
            id: sId, title: sTitle, category: category, price: Number(sPriceRaw),
            priceFormatted: String(sRow[4] || ''), duration: sDuration,
            badge: String(sRow[6] || ''), description: String(sRow[7] || ''),
            note: String(sRow[8] || ''), imageUrl: String(sRow[9] || ''),
            specs: specsArr,
            active: sRow[11] !== false && String(sRow[11]).toLowerCase() !== 'false',
            updatedAt: sRow[12] ? new Date(sRow[12]).toISOString() : ''
          });
        }
      });
      return responseJSON({ status: "success", services: servicesList, total: servicesList.length });
    }

    if (data.action === "saveService") {
      var sIdToSave = data.id ? String(data.id).trim() : "";
      if (!sIdToSave) {
        return responseJSON({ status: "error", message: "ID do serviço obrigatório." });
      }

      var servLock = LockService.getScriptLock();
      try {
        servLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite ao aguardar bloqueio para salvar serviço." });
      }

      try {
        var saveServSheet = getServicesSheet();
        if (!saveServSheet) {
          return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
        }

        var existingRows = saveServSheet.getDataRange().getValues();
        var foundServRow = -1;
        for (var sr = 1; sr < existingRows.length; sr++) {
          if (String(existingRows[sr][0] || '').trim().toLowerCase() === sIdToSave.toLowerCase()) {
            foundServRow = sr + 1;
            break;
          }
        }

        var specsStr = Array.isArray(data.specs) ? data.specs.join(', ') : String(data.specs || '');
        var priceNum = Number(data.price || 0);
        var priceFmt = data.priceFormatted || ('R$ ' + priceNum.toFixed(2).replace('.', ','));
        var isActive = data.active !== false && String(data.active).toLowerCase() !== 'false';

        var rowData = [
          sIdToSave,
          String(data.title || '').trim(),
          String(data.category || 'alongamento').trim(),
          priceNum,
          priceFmt,
          String(data.duration || '1h 30min').trim(),
          String(data.badge || '').trim(),
          String(data.description || '').trim(),
          String(data.note || '').trim(),
          String(data.imageUrl || '').trim(),
          specsStr,
          isActive,
          new Date()
        ];

        if (foundServRow > 0) {
          saveServSheet.getRange(foundServRow, 1, 1, 13).setValues([rowData]);
        } else {
          saveServSheet.appendRow(rowData);
        }

        return responseJSON({
          status: "success",
          saved: true,
          serviceId: sIdToSave,
          message: "Serviço salvo com sucesso na planilha oficial."
        });
      } finally {
        servLock.releaseLock();
      }
    }

    if (data.action === "deleteService") {
      var sIdToDelete = data.id ? String(data.id).trim() : "";
      if (!sIdToDelete) {
        return responseJSON({ status: "error", message: "ID do serviço obrigatório para exclusão." });
      }

      var delServLock = LockService.getScriptLock();
      try {
        delServLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite ao aguardar bloqueio para exclusão de serviço." });
      }

      try {
        var delServSheet = getServicesSheet();
        if (!delServSheet) {
          return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
        }

        var allServRows = delServSheet.getDataRange().getValues();
        var deletedServCount = 0;
        for (var ds = allServRows.length - 1; ds >= 1; ds--) {
          if (String(allServRows[ds][0] || '').trim().toLowerCase() === sIdToDelete.toLowerCase()) {
            delServSheet.deleteRow(ds + 1);
            deletedServCount++;
          }
        }

        return responseJSON({
          status: "success",
          deleted: deletedServCount > 0,
          notFound: deletedServCount === 0,
          serviceId: sIdToDelete,
          message: deletedServCount > 0 ? "Serviço excluído da planilha oficial." : "Serviço não encontrado na planilha."
        });
      } finally {
        delServLock.releaseLock();
      }
    }

    if (data.action === "listDrivePhotos") {
      var driveFolder;
      try {
        driveFolder = DriveApp.getFolderById("1JGypjL9OqGL5i2OUrjiGMKxkWD11YuAw");
      } catch (folderError) {
        return responseJSON({ status: "error", message: "Não foi possível abrir a pasta oficial de fotos no Google Drive." });
      }
      var driveFiles = driveFolder.getFiles();
      var photos = [];
      while (driveFiles.hasNext()) {
        var driveFile = driveFiles.next();
        if (driveFile.isTrashed() || String(driveFile.getMimeType() || "").indexOf("image/") !== 0) continue;
        var fileId = driveFile.getId();
        photos.push({
          id: fileId,
          name: driveFile.getName(),
          url: "https://drive.google.com/uc?export=view&id=" + fileId,
          thumbnailUrl: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w600",
          updatedAt: driveFile.getLastUpdated().toISOString()
        });
      }
      photos.sort(function(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
      return responseJSON({ status: "success", photos: photos, total: photos.length });
    }

    if (data.action === "uploadPhoto") {
      if (!data.imageBase64) {
        return responseJSON({ status: "error", message: "Conteúdo da imagem (base64) ausente." });
      }

      var photoLock = LockService.getScriptLock();
      try {
        photoLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite ao aguardar bloqueio para upload de foto." });
      }

      try {
        // Pasta oficial de fotos dos serviços e imagens de apresentação.
        // O usuário/conta que executa este Apps Script precisa ter permissão de editor nesta pasta.
        var folderId = "1JGypjL9OqGL5i2OUrjiGMKxkWD11YuAw";
        var folder = DriveApp.getFolderById(folderId);
        var contentType = data.mimeType || "image/jpeg";
        var decoded = Utilities.base64Decode(data.imageBase64);
        var fileName = data.fileName || ("servico-" + new Date().getTime() + ".jpg");
        var blob = Utilities.newBlob(decoded, contentType, fileName);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var fileId = file.getId();
        // URL direta para incorporar a imagem em cartões, ícones e catálogo público.
        var photoUrl = "https://drive.google.com/uc?export=view&id=" + fileId;

        return responseJSON({
          status: "success",
          url: photoUrl,
          fileId: fileId,
          message: "Foto armazenada com sucesso no Google Drive."
        });
      } finally {
        photoLock.releaseLock();
      }
    }

    if (data.action === "blockSchedule" || data.status === "bloqueado") {
      var rawBlockId = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!rawBlockId || !/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(rawBlockId)) {
        return responseJSON({ status: "error", message: "ID de bloqueio inválido ou fora do padrão (permitido: apt-*, test-* ou e2e-*)." });
      }

      var blockDate = data.date ? String(data.date).trim() : "";
      if (!blockDate) {
        return responseJSON({ status: "error", message: "Data do bloqueio ausente." });
      }

      var blockLock = LockService.getScriptLock();
      try {
        blockLock.waitLock(15000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio para gravar bloqueio de data." });
      }

      try {
        var blockSheet = getOfficialSheet();
        if (!blockSheet) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }

        var blockRows = blockSheet.getDataRange().getValues();
        for (var b = 1; b < blockRows.length; b++) {
          var rowBlockId = blockRows[b][9] ? String(blockRows[b][9]).trim() : "";
          if (rowBlockId && rowBlockId.toLowerCase() === rawBlockId.toLowerCase()) {
            return responseJSON({
              status: "success",
              duplicate: true,
              persisted: true,
              emailSent: false,
              emailSuppressed: true,
              message: "Bloqueio " + rawBlockId + " já consta na planilha oficial.",
              appointmentId: rawBlockId
            });
          }
        }

        blockSheet.appendRow([
          new Date(),
          data.clientName ? String(data.clientName).trim() : 'Protocolo Ateliê',
          data.clientPhone ? String(data.clientPhone).trim() : '',
          data.clientEmail ? String(data.clientEmail).trim() : '',
          data.serviceTitle ? String(data.serviceTitle).trim() : 'Bloqueio de Agenda',
          blockDate,
          data.time ? String(data.time).trim() : 'Dia Inteiro',
          0,
          'bloqueado',
          rawBlockId,
          data.notes ? String(data.notes).trim() : (data.blockReason || 'Bloqueio administrativo')
        ]);

        return responseJSON({
          status: "success",
          persisted: true,
          duplicate: false,
          emailSent: false,
          emailSuppressed: true,
          message: "Bloqueio registrado com sucesso na planilha oficial.",
          appointmentId: rawBlockId
        });
      } finally {
        blockLock.releaseLock();
      }
    }

    // 3. Mecanismo de Teste Autenticado e Controlado pelo Backend
    // Testes NÃO gravam na aba oficial 'Agendamentos' e NÃO enviam e-mails/WhatsApp
    var isTestExecution = Boolean(
      data.action === "testConnection" ||
      data.action === "verifyWebhook" ||
      data.isTest === true ||
      data.isTest === "true"
    );

    if (isTestExecution) {
      var lockTest = LockService.getScriptLock();
      try {
        lockTest.waitLock(5000);
      } catch (lockErr) {
        return responseJSON({ status: "error", message: "Tempo limite esgotado ao testar bloqueio de concorrência." });
      }
      try {
        var sheetTest = getOfficialSheet();
        if (!sheetTest) {
          return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
        }
        return responseJSON({
          status: "success",
          test: true,
          persisted: false,
          emailSent: false,
          emailSuppressed: true,
          message: "Teste autenticado de conectividade e permissões validado com sucesso. Nenhuma linha foi gravada na aba oficial Agendamentos e nenhum e-mail foi disparado.",
          appointmentId: data.appointmentId ? String(data.appointmentId).trim() : ("test-" + new Date().getTime())
        });
      } finally {
        lockTest.releaseLock();
      }
    }

    // 4. Bloqueio de concorrência atômico para gravação de reserva real
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(15000);
    } catch (lockErr) {
      return responseJSON({ status: "error", message: "Tempo limite esgotado ao aguardar bloqueio de concorrência." });
    }

    try {
      // 5. Validação estrita do ID da reserva (reservas reais públicas exigem prefixo apt-*)
      var rawId = data.appointmentId ? String(data.appointmentId).trim() : "";
      if (!rawId || !/^(apt|test|e2e)-[a-zA-Z0-9_-]{1,64}$/.test(rawId)) {
        return responseJSON({
          status: "error",
          message: "ID da reserva inválido, ausente ou fora do padrão (permitido: apt-*, test-* ou e2e-*)."
        });
      }

      // 6. Validação estrita dos dados da cliente
      var clientName = data.clientName ? String(data.clientName).trim() : "";
      if (clientName.length < 2) {
        return responseJSON({
          status: "error",
          message: "Nome da cliente inválido ou ausente (mínimo de 2 caracteres)."
        });
      }

      var clientPhone = data.clientPhone ? String(data.clientPhone).trim() : "";
      var phoneDigits = clientPhone.replace(/\D/g, "");
      if (phoneDigits.length < 8 || phoneDigits.length > 15) {
        return responseJSON({
          status: "error",
          message: "Telefone da cliente inválido (deve conter entre 8 e 15 dígitos)."
        });
      }

      // 7. Validação financeira baseada exclusivamente na aba oficial 'Serviços'.
// Não aceitar preços ou títulos enviados pelo navegador como fonte de verdade.
      var servicesSheetForBooking = getServicesSheet();
      if (!servicesSheetForBooking) {
        return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
      }

      var serviceRowsForBooking = servicesSheetForBooking.getDataRange().getValues();
      if (serviceRowsForBooking.length < 2) {
        return responseJSON({ status: "error", message: "O catálogo oficial de serviços está vazio. Nenhum agendamento foi gravado." });
      }

      function findOfficialService(serviceId, serviceTitle) {
        var idToFind = String(serviceId || "").trim().toLowerCase();
        var titleToFind = String(serviceTitle || "").trim().toLowerCase();
        for (var rowIndex = 1; rowIndex < serviceRowsForBooking.length; rowIndex++) {
          var serviceRow = serviceRowsForBooking[rowIndex];
          var rowId = String(serviceRow[0] || "").trim();
          if (!rowId) continue;
          var isActive = serviceRow[11] !== false && String(serviceRow[11]).toLowerCase() !== "false";
          if (!isActive) continue;
          if (idToFind && rowId.toLowerCase() === idToFind) {
            return { id: rowId, title: String(serviceRow[1] || "").trim(), price: Number(serviceRow[3]), active: true };
          }
          if (!idToFind && titleToFind && String(serviceRow[1] || "").trim().toLowerCase() === titleToFind) {
            return { id: rowId, title: String(serviceRow[1] || "").trim(), price: Number(serviceRow[3]), active: true };
          }
        }
        return null;
      }

      var serviceKey = data.serviceId ? String(data.serviceId).trim() : "";
      var canonical = findOfficialService(serviceKey, data.serviceTitle);
      if (!canonical || !canonical.title || !isFinite(canonical.price) || canonical.price < 0) {
        return responseJSON({ status: "error", message: "Procedimento não encontrado, inativo ou com preço inválido no catálogo oficial. Nenhum agendamento foi gravado." });
      }

      var additionalIds = Array.isArray(data.additionalServiceIds) ? data.additionalServiceIds : [];
      var additionalTitles = [];
      var additionalTotal = 0;
      var seenAdditionalIds = {};
      for (var ai = 0; ai < additionalIds.length; ai++) {
        var additionalId = String(additionalIds[ai] || "").trim();
        var additionalIdKey = additionalId.toLowerCase();
        if (!additionalId || additionalIdKey === String(canonical.id).toLowerCase() || seenAdditionalIds[additionalIdKey]) {
          return responseJSON({ status: "error", message: "Serviço adicional inválido ou duplicado." });
        }
        seenAdditionalIds[additionalIdKey] = true;
        var additionalCanonical = findOfficialService(additionalId, "");
        if (!additionalCanonical || !additionalCanonical.title || !isFinite(additionalCanonical.price) || additionalCanonical.price < 0) {
          return responseJSON({ status: "error", message: "Serviço adicional não encontrado, inativo ou com preço inválido no catálogo oficial: " + additionalId });
        }
        additionalTitles.push(additionalCanonical.title);
        additionalTotal += additionalCanonical.price;
      }

      var referencePrice = canonical.price + additionalTotal;
      var bookingSettings = getAppSettingsData().settings || {};
      var bookingPaymentConfig = bookingSettings.PAYMENT_CONFIG && typeof bookingSettings.PAYMENT_CONFIG === "object" ? bookingSettings.PAYMENT_CONFIG : {};
      if (!String(bookingPaymentConfig.pixKey || "").trim() || !String(bookingPaymentConfig.pixBeneficiary || "").trim()) {
        return responseJSON({ status: "error", persisted: false, configurationError: true, message: "Os dados oficiais de Pix ainda não estão configurados. Nenhum agendamento foi gravado." });
      }
      var expectedServiceTitle = [canonical.title].concat(additionalTitles).join(" + ");
      if (String(data.serviceTitle || "").trim().toLowerCase() !== expectedServiceTitle.toLowerCase()) {
        return responseJSON({ status: "error", message: "Os serviços informados não correspondem ao catálogo oficial." });
      }
      var expected40 = Math.round(referencePrice * 0.4 * 100) / 100;
      var expected100 = Math.round(referencePrice * 100) / 100;
      var depositNum = Number(data.depositAmount);

      if (isNaN(depositNum) || !isFinite(depositNum) || depositNum <= 0) {
        return responseJSON({ status: "error", message: "Valor do sinal/pagamento inválido ou ausente." });
      }

      // O sinal é uma orientação de pagamento; não rejeitar a reserva por divergência percentual.
      var matches100 = data.paymentMode === "pre_pagamento_100";
      var resolvedMode = data.paymentMode || "sinal_40";
      var serviceTitle = expectedServiceTitle;
      var balanceNum = resolvedMode === "pre_pagamento_100" ? 0 : Math.max(0, referencePrice - depositNum);
      var amountFormatted = depositNum.toFixed(2).replace(".", ",");
      var balanceFormatted = balanceNum.toFixed(2).replace(".", ",");
      var paymentLabel = resolvedMode === "pre_pagamento_100" ? "Pré-pagamento Pix (100%)" : "Sinal Pix (40%)";

      // 8. Validação de data, horário e local no servidor (fuso oficial do estúdio)
      var bookingDate = data.date ? String(data.date).trim() : "";
      var bookingTime = data.time ? String(data.time).trim() : "";
      if (!bookingDate || !bookingTime) {
        return responseJSON({ status: "error", message: "Data ou horário do agendamento ausentes." });
      }

      var requestedDateKey = normalizeBookingDate(bookingDate);
      var requestedTimeKey = normalizeBookingTime(bookingTime);
      // Duration is stored for reference, but it does not determine slot availability.
      var requestedServiceDuration = getConfiguredServiceDurationMinutes(data.serviceId, serviceTitle) || 0;
      if (!isValidBookingDateKey(requestedDateKey)) {
        return responseJSON({ status: "error", message: "Data inválida. Use uma data real no formato AAAA-MM-DD." });
      }
      if (!isBookingDateInFutureOrToday(requestedDateKey)) {
        return responseJSON({ status: "error", message: "Não é possível agendar em uma data passada. Selecione hoje ou uma data futura." });
      }
      if (!isValidBookingTime(requestedTimeKey)) {
        return responseJSON({ status: "error", message: "Horário inválido. Use o formato HH:mm." });
      }

      // Enforce persisted weekly hours and date/time blocks on the authoritative
      // booking endpoint, not only in the public calendar UI.
      var savedScheduleValidation = validateAgainstSavedSchedule(
        requestedDateKey, requestedTimeKey, 0
      );
      if (!savedScheduleValidation.allowed) {
        return responseJSON({
          status: "error",
          persisted: false,
          conflict: true,
          message: savedScheduleValidation.message
        });
      }
      var location = data.appointmentLocation === undefined ? "salon" : String(data.appointmentLocation).trim();
      if (location !== "salon" && location !== "home") {
        return responseJSON({ status: "error", message: "Local de atendimento inválido." });
      }
      var homeAddress = data.homeAddress === undefined || data.homeAddress === null ? "" : String(data.homeAddress).trim();
      if (location === "home" && homeAddress.length < 8) {
        return responseJSON({ status: "error", message: "Informe o endereço completo para atendimento em domicílio." });
      }

      var sheet = getOfficialSheet();
      if (!sheet) {
        return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
      }

      // 9. Proteção anti-duplicidade atômica na planilha (Coluna J: ID Agendamento)
      ensureOptionalBookingHeaders(sheet);
      var existing = sheet.getDataRange().getValues();
      for (var i = 1; i < existing.length; i++) {
        var existingId = existing[i][9] ? String(existing[i][9]).trim() : "";
        if (existingId && existingId.toLowerCase() === rawId.toLowerCase()) {
          return responseJSON({
            status: "success",
            duplicate: true,
            persisted: true,
            emailSent: false,
            emailSuppressed: true,
            message: "Reserva " + rawId + " já confirmada anteriormente no Sheets.",
            appointmentId: rawId,
            existingAppointment: {
              id: existingId,
              clientName: String(existing[i][1] || ''),
              clientPhone: String(existing[i][2] || ''),
              clientEmail: String(existing[i][3] || ''),
              serviceTitle: String(existing[i][4] || ''),
              date: String(existing[i][5] || ''),
              time: String(existing[i][6] || ''),
              depositAmount: Number(existing[i][7] || 0),
              status: String(existing[i][8] || 'pendente_pix')
            }
          });
        }
        var existingStatus = String(existing[i][8] || 'pendente_pix').toLowerCase();
        var existingDateKey = normalizeBookingDate(existing[i][5]);
        var existingTimeRaw = String(existing[i][6] || '').trim();
        var existingTimeKey = normalizeBookingTime(existingTimeRaw);
        var sameDate = requestedDateKey === existingDateKey;
        var requestedStart = timeToMinutes(requestedTimeKey);
        var requestedEnd = requestedStart;
        var allDayBlocked = existingStatus === 'bloqueado' && sameDate &&
          ['dia inteiro', 'dia todo', 'all day'].indexOf(existingTimeRaw.toLowerCase()) !== -1;
        var blockInterval = existingStatus === 'bloqueado' && sameDate ? parseBlockInterval(existingTimeRaw) : null;
        var slotBlocked = Boolean(blockInterval && requestedStart >= blockInterval.start && requestedStart < blockInterval.end);
        var activeBookingConflict = false;
        if (sameDate && ['cancelado', 'teste_sistema', 'bloqueado'].indexOf(existingStatus) === -1) {
          var existingStart = timeToMinutes(existingTimeKey);
          if (existingStart !== null) {
            // Prevent duplicate bookings at the same configured start time only.
            activeBookingConflict = requestedStart === existingStart;
          }
        }
        if (allDayBlocked || slotBlocked || activeBookingConflict) {
          return responseJSON({
            status: "error",
            conflict: true,
            message: allDayBlocked
              ? "Esta data está bloqueada para atendimentos. Escolha outro dia."
              : slotBlocked
                ? "Este intervalo está bloqueado. Escolha outro horário."
                : "Este horário se sobrepõe a outro atendimento. Escolha outro horário."
          });
        }
      }

      // 10. Grava linha na aba oficial 'Agendamentos' (apenas após validação completa)
      sheet.appendRow([
        new Date(),
        clientName,
        clientPhone,
        data.clientEmail ? String(data.clientEmail).trim() : '',
        serviceTitle,
        bookingDate,
        bookingTime,
        depositNum,
        data.status || 'pendente_pix',
        rawId,
        data.notes ? String(data.notes).trim() : '',
        location,
        location === 'home' ? homeAddress : '',
        JSON.stringify(Array.isArray(data.additionalServiceIds) ? data.additionalServiceIds : []),
        data.customRequest ? String(data.customRequest).trim() : '',
        data.serviceId ? String(data.serviceId).trim() : ''
      ]);

      // 11. Disparo de e-mails para reserva real
      // Reservas E2E autorizadas gravam na planilha oficial mas suprimem estritamente e-mails e notificações
      var isE2EExecution = Boolean(
        data.action === "e2eTestBooking" ||
        data.isE2ETest === true ||
        data.isE2ETest === "true" ||
        rawId.indexOf("e2e-") === 0 ||
        rawId.indexOf("apt-e2e-") === 0
      );

      var emailSent = false;
      var emailError = null;
      var adminEmailSent = false;
      var clientEmailSent = false;
      var errorsList = [];

      if (!isE2EExecution) {
        // 11.1 Notificação administrativa para a responsável oficial (angelikm19@gmail.com)
        try {
          var recipient = "angelikm19@gmail.com";
          var subject = "Novo pré-agendamento — " + clientName + " — " + bookingDate + " às " + bookingTime;
          var body = "Olá Angélica,\n\nUm novo pré-agendamento foi realizado pelo site!\n\n" +
            "• Cliente: " + clientName + "\n" +
            "• Telefone: " + clientPhone + "\n" +
            (data.clientEmail ? "• E-mail: " + String(data.clientEmail).trim() + "\n" : "") +
            "• Procedimento: " + serviceTitle + " (R$ " + referencePrice.toFixed(2).replace(".", ",") + ")\n" +
            "• Data & Horário: " + bookingDate + " às " + bookingTime + "\n" +
            "• " + paymentLabel + ": R$ " + amountFormatted + "\n" +
            "• Saldo restante: R$ " + balanceFormatted + "\n" +
            "• ID da Reserva: " + rawId + "\n" +
            (data.notes ? "• Observações: " + String(data.notes).trim() + "\n\n" : "\n") +
            "Verifique o recebimento do Pix de R$ " + amountFormatted + " na sua conta bancária para validar o agendamento.";

          MailApp.sendEmail({
            to: recipient,
            replyTo: (data.clientEmail && isValidEmail(data.clientEmail)) ? String(data.clientEmail).trim() : "kontakt@alansmsolutions.com",
            subject: subject,
            body: body
          });
          adminEmailSent = true;
        } catch (mailErr) {
          errorsList.push("Admin: " + mailErr.toString());
        }

        // Use only configured business values; do not embed sample Pix keys or addresses in email templates.
        var emailSettings = getAppSettingsData().settings || {};
        var configuredPayment = emailSettings.PAYMENT_CONFIG && typeof emailSettings.PAYMENT_CONFIG === "object" ? emailSettings.PAYMENT_CONFIG : {};
        var configuredAddress = emailSettings.STUDIO_ADDRESS && typeof emailSettings.STUDIO_ADDRESS === "object" ? emailSettings.STUDIO_ADDRESS : {};
        var configuredWhatsApp = emailSettings.WHATSAPP_CONFIG && typeof emailSettings.WHATSAPP_CONFIG === "object" ? emailSettings.WHATSAPP_CONFIG : {};
        var officialPixKey = String(configuredPayment.pixKey || "").trim();
        var officialPixBeneficiary = String(configuredPayment.pixBeneficiary || "").trim();
        var officialStudioAddress = String(configuredAddress.fullAddress || "").trim();
        if (!officialStudioAddress) officialStudioAddress = [configuredAddress.street, configuredAddress.number, configuredAddress.neighborhood, configuredAddress.city, configuredAddress.state].map(function(value) { return String(value || "").trim(); }).filter(Boolean).join(", ");
        var officialWhatsAppDigits = String(configuredWhatsApp.phoneNumber || configuredWhatsApp.phone || configuredWhatsApp.number || "").replace(/\\D/g, "");
        var configuredWhatsAppLink = officialWhatsAppDigits ? "https://wa.me/" + officialWhatsAppDigits : "";
        var configuredPixText = officialPixKey ? "Chave Pix: " + officialPixKey + (officialPixBeneficiary ? " — Beneficiário: " + officialPixBeneficiary : "") : "A chave Pix oficial ainda não está configurada. Entre em contato com o espaço antes de efetuar o pagamento.";
        var configuredAddressText = officialStudioAddress ? "Endereço: " + officialStudioAddress : "";

        // 11.2 Confirmação automática para o e-mail da cliente (se informado e válido)
        var clientEmailRaw = data.clientEmail ? String(data.clientEmail).trim() : "";
        if (clientEmailRaw && isValidEmail(clientEmailRaw)) {
          try {
            var clientRecipient = clientEmailRaw;
            var clientSubject = "Recebemos seu pré-agendamento no Espaço Angélica do Carmo — ID: " + rawId;

            // Link estruturado do WhatsApp com parâmetros válidos e codificados
            var waMessage = "Olá Angélica! Segue o comprovante do meu pré-agendamento no Espaço Angélica:\n" +
              "• Procedimento: " + serviceTitle + "\n" +
              "• Data: " + bookingDate + " às " + bookingTime + "\n" +
              "• Cliente: " + clientName + "\n" +
              "• ID da Reserva: " + rawId;
            var waLink = configuredWhatsAppLink ? configuredWhatsAppLink + "?text=" + encodeURIComponent(waMessage) : "";

            var clientBody = "Olá " + clientName + ",\n\n" +
              "Recebemos sua solicitação de pré-agendamento no Espaço Angélica do Carmo!\n\n" +
              "IMPORTANTE: Seu horário foi reservado temporariamente e o agendamento será confirmado definitivamente após a validação do recebimento do Pix pela Angélica.\n\n" +
              "Resumo da sua solicitação:\n" +
              "• Procedimento: " + serviceTitle + " (R$ " + referencePrice.toFixed(2).replace(".", ",") + ")\n" +
              "• Data & Horário: " + bookingDate + " às " + bookingTime + "\n" +
              "• " + paymentLabel + ": R$ " + amountFormatted + "\n" +
              "• Saldo restante a acertar no dia: R$ " + balanceFormatted + "\n" +
              "• ID da Reserva: " + rawId + "\n\n" +
              configuredPixText + "\\n\\n" +
              (waLink ? "Para agilizar a confirmação, envie o comprovante pelo WhatsApp:\\n" + waLink + "\\n\\n" : "") +
              (configuredAddressText ? configuredAddressText + "\\n\\n" : "") +
              "Agradecemos pela confiança!\\n" +
              "Espaço Angélica do Carmo";

            // Conteúdo HTML com escape rigoroso contra XSS e injeção
            var clientHtmlBody = "<div style=\"font-family: Arial, sans-serif; color: #49382E; line-height: 1.6; max-width: 600px;\">" +
              "<h2 style=\"color: #D4AF37;\">Espaço Angélica do Carmo</h2>" +
              "<p>Olá <strong>" + escapeHtml(clientName) + "</strong>,</p>" +
              "<p>Recebemos sua solicitação de pré-agendamento!</p>" +
              "<p style=\"background: #FFF8E7; padding: 12px; border-left: 4px solid #D4AF37; border-radius: 4px;\">" +
              "<strong>Atenção:</strong> Seu horário está reservado temporariamente e o agendamento será confirmado definitivamente após a validação do recebimento do Pix pela Angélica." +
              "</p>" +
              "<h3 style=\"border-bottom: 1px solid #E8D9B5; padding-bottom: 6px;\">Resumo do Agendamento</h3>" +
              "<ul>" +
              "<li><strong>Procedimento:</strong> " + escapeHtml(serviceTitle) + " (R$ " + escapeHtml(referencePrice.toFixed(2).replace(".", ",")) + ")</li>" +
              "<li><strong>Data e Horário:</strong> " + escapeHtml(bookingDate) + " às " + escapeHtml(bookingTime) + "</li>" +
              "<li><strong>" + escapeHtml(paymentLabel) + ":</strong> R$ " + escapeHtml(amountFormatted) + "</li>" +
              "<li><strong>Saldo restante no dia:</strong> R$ " + escapeHtml(balanceFormatted) + "</li>" +
              "<li><strong>ID da Reserva:</strong> <code>" + escapeHtml(rawId) + "</code></li>" +
              "</ul>" +
              "<p><strong>Dados Pix:</strong> " + escapeHtml(configuredPixText) + "</p>" +
              (waLink ? "<p style=\"margin: 24px 0;\"><a href=\"" + escapeHtml(waLink) + "\" style=\"background-color: #25D366; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;\">📲 Enviar Comprovante pelo WhatsApp</a></p>" : "") +
              (configuredAddressText ? "<p style=\"font-size: 13px; color: #786C63;\">" + escapeHtml(configuredAddressText) + "</p>" : "") +
              "</div>";

            MailApp.sendEmail({
              to: clientRecipient,
              replyTo: "kontakt@alansmsolutions.com",
              subject: clientSubject,
              body: clientBody,
              htmlBody: clientHtmlBody
            });
            clientEmailSent = true;
          } catch (clientErr) {
            errorsList.push("Cliente: " + clientErr.toString());
          }
        }
      }

      emailSent = adminEmailSent || clientEmailSent;
      if (errorsList.length > 0) {
        emailError = errorsList.join("; ");
      }

      return responseJSON({
        status: "success",
        persisted: true,
        duplicate: false,
        emailSent: emailSent,
        emailSuppressed: isE2EExecution ? true : false,
        emailError: emailError,
        message: isE2EExecution
          ? "Reserva de teste E2E gravada com sucesso no Sheets (e-mails e notificações suprimidos)."
          : "Reserva registrada com sucesso no Sheets.",
        appointmentId: rawId
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}

function normalizeBookingDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, "America/Sao_Paulo", "yyyy-MM-dd");
  }
  var text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  var dmy = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return dmy[3] + "-" + dmy[2] + "-" + dmy[1];
  return text;
}

function isValidBookingDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return false;
  var parts = dateKey.split("-");
  var year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  var date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isBookingDateInFutureOrToday(dateKey) {
  var today = Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd");
  return isValidBookingDateKey(dateKey) && dateKey >= today;
}

function isValidBookingTime(timeKey) {
  if (!/^\d{2}:\d{2}$/.test(String(timeKey || ""))) return false;
  var parts = timeKey.split(":");
  return Number(parts[0]) >= 0 && Number(parts[0]) <= 23 &&
    Number(parts[1]) >= 0 && Number(parts[1]) <= 59;
}

function normalizeBookingTime(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || "America/Sao_Paulo", "HH:mm");
  }
  var text = String(value || "").trim();
  var match = text.match(/^(\d{1,2}):(\d{2})/);
  return match ? ("0" + match[1]).slice(-2) + ":" + match[2] : text;
}

function fetchAppointmentsFromSheet() {
  var sheet = getOfficialSheet();
  if (!sheet) {
    return responseJSON({ status: "error", message: "Aba 'Agendamentos' não encontrada na planilha oficial." });
  }

  var values = sheet.getDataRange().getValues();
  var appointments = [];
  var tz = Session.getScriptTimeZone() || "America/Sao_Paulo";

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[9] && !row[1]) continue;

    var dateStr = row[5] instanceof Date ? Utilities.formatDate(row[5], tz, "dd/MM/yyyy") : String(row[5] || "");
    var timeStr = row[6] instanceof Date ? Utilities.formatDate(row[6], tz, "HH:mm") : String(row[6] || "");

    appointments.push({
      id: String(row[9] || ('apt-sheet-' + i)),
      clientName: String(row[1] || ''),
      clientPhone: String(row[2] || ''),
      clientEmail: String(row[3] || ''),
      serviceTitle: String(row[4] || ''),
      serviceDuration: getServiceDurationMinutes(String(row[15] || ''), String(row[4] || '')) + ' min',
      date: dateStr,
      time: timeStr,
      depositAmount: Number(row[7] || 0),
      status: String(row[8] || 'pendente_pix'),
      notes: String(row[10] || ''),
      appointmentLocation: String(row[11] || 'salon') === 'home' ? 'home' : 'salon',
      homeAddress: String(row[12] || '') || undefined,
      additionalServiceIds: (function() { try { var parsed = JSON.parse(String(row[13] || '[]')); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; } })(),
      customRequest: String(row[14] || '') || undefined,
      serviceId: String(row[15] || '') || undefined
    });
  }
  return responseJSON({ status: "success", appointments: appointments, total: appointments.length });
}

function doGet(e) {
  try {
    if (!e || !e.parameter || Object.keys(e.parameter).length === 0 || e.parameter.action === "health") {
      return responseJSON({
        status: "ok",
        service: "espaco-angelica-apps-script",
        timestamp: new Date().toISOString()
      });
    }

    // O catálogo público é somente leitura e não exige token.
    // Qualquer outra ação GET continua protegida por autenticação.
    if (e.parameter.action !== "getServices") {
      var tokenProvided = e.parameter.token || e.parameter.authToken || e.parameter.key;
      var auth = validateAuthorization(tokenProvided);
      if (!auth.valid) {
        return responseJSON({ status: "error", message: auth.error });
      }
    }

    if (e.parameter.action === "getServices") {
      var servSheet = getServicesSheet();
      if (!servSheet) {
        return responseJSON({ status: "error", message: "Aba 'Serviços' (ou 'Servicos') não encontrada na planilha oficial." });
      }
      var sRows = servSheet.getDataRange().getValues();
      var servicesList = [];
      for (var s = 1; s < sRows.length; s++) {
        var sRow = sRows[s];
        var sId = String(sRow[0] || '').trim();
        var sTitle = String(sRow[1] || '').trim();
        var sCategory = String(sRow[2] || '').trim();
        var sPriceRaw = sRow[3];
        var sDuration = String(sRow[5] || '').trim();
        // Ignore incomplete official rows instead of publishing invented category,
        // price or duration defaults as if they were real services.
        if (!sId || !sTitle || !sCategory || sPriceRaw === "" || sPriceRaw === null || sPriceRaw === undefined || !isFinite(Number(sPriceRaw)) || !sDuration) continue;
        var specsVal = String(sRow[10] || '');
        var specsArr = specsVal ? specsVal.split(',').map(function(item) { return item.trim(); }).filter(Boolean) : [];
        servicesList.push({
          id: sId,
          title: sTitle,
          category: sCategory,
          price: Number(sPriceRaw),
          priceFormatted: String(sRow[4] || ''),
          duration: sDuration,
          badge: String(sRow[6] || ''),
          description: String(sRow[7] || ''),
          note: String(sRow[8] || ''),
          imageUrl: String(sRow[9] || ''),
          specs: specsArr,
          active: sRow[11] !== false && String(sRow[11]).toLowerCase() !== 'false',
          updatedAt: sRow[12] ? new Date(sRow[12]).toISOString() : ''
        });
      }
      return responseJSON({ status: "success", services: servicesList, total: servicesList.length });
    }

    return fetchAppointmentsFromSheet();
  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}

/**
 * Persistent schedule configuration.
 * Creates "Configuração da Agenda" on first use without changing existing tabs.
 * Rows use: Tipo | ID | Dados JSON | Atualizado em
 */
var SCHEDULE_CONFIG_SHEET = "Bloqueios e Disponibilidade";
var LEGACY_SCHEDULE_CONFIG_SHEET = "Configuração da Agenda";

function getOrCreateScheduleConfigSheet() {
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SCHEDULE_CONFIG_SHEET);

  if (!sheet) {
    // Create the dedicated tab without modifying or deleting the legacy tab.
    sheet = ss.insertSheet(SCHEDULE_CONFIG_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([[
      "Tipo", "ID", "Dados JSON", "Atualizado em"
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 4).setFontWeight("bold");
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 500);
    sheet.setColumnWidth(4, 180);

    // One-time, non-destructive migration: copy legacy rows into the new tab.
    // The original "Configuração da Agenda" tab is deliberately left untouched.
    var legacy = ss.getSheetByName(LEGACY_SCHEDULE_CONFIG_SHEET);
    if (legacy && legacy.getLastRow() > 1) {
      var legacyRows = legacy.getRange(2, 1, legacy.getLastRow() - 1, 4).getValues();
      var validRows = legacyRows.filter(function(row) {
        return String(row[0] || "").trim() && String(row[2] || "").trim();
      });
      if (validRows.length) {
        sheet.getRange(2, 1, validRows.length, 4).setValues(validRows);
      }
    }
  }

  return sheet;
}

function getScheduleConfigData() {
  var ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SCHEDULE_CONFIG_SHEET) || ss.getSheetByName(LEGACY_SCHEDULE_CONFIG_SHEET);
  var weeklySchedule = null;
  var blocks = [];
  if (!sheet) return { status: "success", weeklySchedule: weeklySchedule, blocks: blocks };
  var values = sheet.getDataRange().getValues();

  for (var i = 1; i < values.length; i++) {
    var type = String(values[i][0] || "").trim();
    var id = String(values[i][1] || "").trim();
    var raw = String(values[i][2] || "");
    if (!type || !raw) continue;

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("Invalid schedule JSON on row " + (i + 1));
      continue;
    }

    if (type === "WEEKLY_SCHEDULE") weeklySchedule = parsed;
    if (type === "BLOCK" && id) blocks.push(parsed);
  }

  return {
    status: "success",
    weeklySchedule: weeklySchedule,
    blocks: blocks
  };
}

function saveWeeklyScheduleConfig(schedule) {
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) {
    throw new Error("Envie uma configuração semanal válida.");
  }

  var allowedDays = [
    "monday", "tuesday", "wednesday", "thursday",
    "friday", "saturday", "sunday"
  ];

  allowedDays.forEach(function(day) {
    var config = schedule[day];
    if (config === undefined) return;
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Configuração inválida para " + day + ".");
    }

    if (config.open === true) {
      if (!isValidBookingTime(String(config.openTime || "")) ||
          !isValidBookingTime(String(config.closeTime || ""))) {
        throw new Error("Horários inválidos para " + day + ".");
      }
      if (timeToMinutes(config.closeTime) <= timeToMinutes(config.openTime)) {
        throw new Error("O encerramento deve ser posterior à abertura em " + day + ".");
      }
    }
  });

  var sheet = getOrCreateScheduleConfigSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var values = sheet.getDataRange().getValues();
    var foundRow = -1;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === "WEEKLY_SCHEDULE") {
        foundRow = i + 1;
        break;
      }
    }

    var row = ["WEEKLY_SCHEDULE", "weekly", JSON.stringify(schedule), new Date()];
    if (foundRow > 0) {
      sheet.getRange(foundRow, 1, 1, 4).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    return { status: "success", saved: true, weeklySchedule: schedule };
  } finally {
    lock.releaseLock();
  }
}

function saveScheduleBlock(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    throw new Error("Envie um bloqueio válido.");
  }

  var date = String(block.date || "").trim();
  var id = String(block.id || "").trim();
  var allDay = block.allDay === true;
  var startTime = String(block.startTime || "").trim();
  var endTime = String(block.endTime || "").trim();

  if (!isValidBookingDateKey(date)) {
    throw new Error("Data do bloqueio inválida. Use AAAA-MM-DD.");
  }
  if (!id) id = Utilities.getUuid();

  if (!allDay) {
    if (!isValidBookingTime(startTime) ||
        !isValidBookingTime(endTime) ||
        timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      throw new Error("Intervalo de horas inválido.");
    }
  }

  var record = {
    id: id,
    date: date,
    allDay: allDay,
    startTime: allDay ? "" : startTime,
    endTime: allDay ? "" : endTime,
    reason: String(block.reason || "").trim(),
    active: block.active !== false,
    updatedAt: new Date().toISOString()
  };

  var sheet = getOrCreateScheduleConfigSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === "BLOCK" &&
          String(values[i][1]) === id) {
        sheet.getRange(i + 1, 1, 1, 4).setValues([[
          "BLOCK", id, JSON.stringify(record), new Date()
        ]]);
        return { status: "success", saved: true, block: record };
      }
    }

    sheet.appendRow(["BLOCK", id, JSON.stringify(record), new Date()]);
    return { status: "success", saved: true, block: record };
  } finally {
    lock.releaseLock();
  }
}

function deleteScheduleBlock(blockId) {
  var id = String(blockId || "").trim();
  if (!id) throw new Error("ID do bloqueio obrigatório.");

  var sheet = getOrCreateScheduleConfigSheet();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);

  try {
    var values = sheet.getDataRange().getValues();
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]) === "BLOCK" &&
          String(values[i][1]) === id) {
        sheet.deleteRow(i + 1);
        return { status: "success", deleted: true, id: id };
      }
    }

    return { status: "success", deleted: false, notFound: true, id: id };
  } finally {
    lock.releaseLock();
  }
}


function getEmailStatusData() {
  try {
    return {
      status: "success",
      success: true,
      configured: true,
      sender: "kontakt@alansmsolutions.com",
      recipient: "angelikm19@gmail.com",
      remainingDailyQuota: MailApp.getRemainingDailyQuota(),
      mode: "Google Apps Script MailApp"
    };
  } catch (error) {
    return { status: "error", success: false, configured: false, message: "Autorize o serviço MailApp no projeto Apps Script: " + String(error) };
  }
}

function sendTestEmailNotification() {
  try {
    var recipient = "angelikm19@gmail.com";
    MailApp.sendEmail({
      to: recipient,
      subject: "[TESTE] Integração de e-mail — Espaço Angélica do Carmo",
      body: "Este é um teste solicitado pelo painel administrativo. Nenhum agendamento ou cliente foi criado.",
      name: "Espaço Angélica do Carmo",
      replyTo: "kontakt@alansmsolutions.com"
    });
    return { status: "success", success: true, emailSent: true, recipient: recipient, message: "E-mail de teste enviado pelo Google Apps Script." };
  } catch (error) {
    return { status: "error", success: false, emailSent: false, message: String(error) };
  }
}

function sendAdminEmailNotification(data) {
  var recipient = String(data.toEmail || "").trim();
  if (!isValidEmail(recipient)) return { status: "error", success: false, emailSent: false, message: "O e-mail de destino não é válido." };
  var clientName = String(data.clientName || "").trim();
  var serviceTitle = String(data.serviceTitle || "Procedimento").trim();
  var date = String(data.date || "").trim();
  var time = String(data.time || "").trim();
  if (!clientName || !date || !time) return { status: "error", success: false, emailSent: false, message: "Nome da cliente, data e horário são obrigatórios." };

  var subject = "Confirmação de agendamento — Espaço Angélica do Carmo";
  var textBody = "Olá, " + clientName + "!\n\n" +
    "Segue a confirmação do seu atendimento no Espaço Angélica do Carmo.\n\n" +
    "Procedimento: " + serviceTitle + "\n" +
    "Data: " + date + "\n" +
    "Horário: " + time + "\n" +
    (data.servicePrice ? "Valor: " + String(data.servicePrice) + "\n" : "") +
    (data.depositAmount !== undefined ? "Sinal: R$ " + formatWhatsAppBRL(data.depositAmount) + "\n" : "") +
    "\nEm caso de dúvidas ou necessidade de alteração, entre em contato com o atelier.\n\n" +
    "Espaço Angélica do Carmo";
  var htmlBody = "<div style=\"font-family:Arial,sans-serif;color:#49382e;line-height:1.6\">" +
    "<h2>Confirmação de agendamento</h2><p>Olá, <strong>" + escapeHtml(clientName) + "</strong>!</p>" +
    "<p>Segue a confirmação do seu atendimento no Espaço Angélica do Carmo.</p>" +
    "<ul><li><strong>Procedimento:</strong> " + escapeHtml(serviceTitle) + "</li>" +
    "<li><strong>Data:</strong> " + escapeHtml(date) + "</li><li><strong>Horário:</strong> " + escapeHtml(time) + "</li>" +
    (data.servicePrice ? "<li><strong>Valor:</strong> " + escapeHtml(String(data.servicePrice)) + "</li>" : "") +
    "</ul><p>Em caso de dúvidas ou necessidade de alteração, entre em contato com o atelier.</p></div>";
  try {
    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: "Espaço Angélica do Carmo",
      replyTo: "kontakt@alansmsolutions.com"
    });
    return { status: "success", success: true, emailSent: true, recipient: recipient, message: "E-mail enviado pelo Google Apps Script." };
  } catch (error) {
    return { status: "error", success: false, emailSent: false, message: "Falha ao enviar e-mail: " + String(error) };
  }
}
