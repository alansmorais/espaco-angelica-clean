import { Appointment, Service, ClientProfile, StudioAddressConfig, BlacklistEntry, WhatsAppConfig, PaymentConfig } from '../types';
import {
  AUTHORIZED_SENDER_EMAIL,
  TARGET_NOTIFICATION_EMAIL
} from './gmailService';

export { AUTHORIZED_SENDER_EMAIL, TARGET_NOTIFICATION_EMAIL };

export const DEFAULT_APPS_SCRIPT_WEBHOOK_URL =
  'https://script.google.com/macros/s/AKfycbysNBMLthA_GvAZJR1irBGcS-3Lspbfz0NIsvz0P2ax6jzE4M01RwVJ0za6zFsq8bGojw/exec';

export interface EmailNotificationPayload {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceId?: string;
  additionalServiceIds?: string[];
  customRequest?: string;
  appointmentLocation?: 'salon' | 'home';
  homeAddress?: string;
  serviceTitle: string;
  servicePrice?: string;
  date: string;
  time: string;
  depositAmount: number;
  depositStatus?: Appointment['depositStatus'];
  paymentMode?: 'sinal_40' | 'pre_pagamento_100';
  status: string;
  appointmentId: string;
  nailCondition?: string;
  notes?: string;
  timestamp: string;
  isTest?: boolean;
}

export interface EmailDispatchResult {
  success: boolean;
  persisted?: boolean;
  duplicate?: boolean;
  delivered?: boolean;
  emailSent?: boolean;
  emailSuppressed?: boolean;
  emailError?: string;
  appointmentId: string;
  mode:
    | 'webhook_delivered'
    | 'webhook_rejected'
    | 'webhook_unverified'
    | 'browser_gmail_dispatched'
    | 'server_dispatched'
    | 'static_recorded'
    | 'already_notified';
  message: string;
  payload: EmailNotificationPayload;
}

const STORAGE_KEY_NOTIFIED_BOOKINGS = 'angelica_notified_bookings';

// URL is public configuration. Admin credentials and sessions must never be stored in localStorage.
const NOTIFICATION_WEBHOOK_STORAGE_KEY = 'angelica_notification_webhook';
const NOTIFICATION_WEBHOOK_TOKEN_KEY = 'angelica_notification_webhook_token';

function getAdminSessionToken(explicitToken?: string): string {
  if (explicitToken && explicitToken.trim()) return explicitToken.trim();
  if (typeof window !== 'undefined') {
    try { return window.sessionStorage.getItem('angelica_admin_session') || ''; } catch {}
  }
  return '';
}

/**
 * Verifica se uma reserva já teve notificação registrada para evitar duplicações.
 */
export function isAppointmentAlreadyNotified(appointmentId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NOTIFIED_BOOKINGS);
    const list: string[] = raw ? JSON.parse(raw) : [];
    return list.includes(appointmentId);
  } catch {
    return false;
  }
}

/**
 * Marca o ID da reserva como já notificado.
 */
export function markAppointmentAsNotified(appointmentId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NOTIFIED_BOOKINGS);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(appointmentId)) {
      list.push(appointmentId);
      // Limita o histórico aos últimos 200 IDs para não acumular
      if (list.length > 200) list.shift();
      localStorage.setItem(STORAGE_KEY_NOTIFIED_BOOKINGS, JSON.stringify(list));
    }
  } catch {}
}

/**
 * Monta o payload padronizado da notificação para a Angélica partindo da conta autorizada kontakt@alansmsolutions.com.
 */
export function buildPreBookingEmailPayload(apt: Appointment): EmailNotificationPayload {
  const isTest = Boolean(
    apt.status === 'teste_sistema' ||
    (typeof apt.id === 'string' && apt.id.startsWith('test-')) ||
    (typeof apt.clientName === 'string' && apt.clientName.toLowerCase().includes('teste_sistema'))
  );

  return {
    from: AUTHORIZED_SENDER_EMAIL,
    to: TARGET_NOTIFICATION_EMAIL,
    replyTo: apt.clientEmail || AUTHORIZED_SENDER_EMAIL,
    subject: `${isTest ? '[TESTE] ' : ''}Novo pré-agendamento — ${apt.clientName} — ${apt.date} às ${apt.time}`,
    clientName: apt.clientName,
    clientPhone: apt.clientPhone,
    clientEmail: apt.clientEmail,
    serviceId: apt.serviceId,
    additionalServiceIds: apt.additionalServiceIds,
    customRequest: apt.customRequest,
    appointmentLocation: apt.appointmentLocation,
    homeAddress: apt.homeAddress,
    serviceTitle: apt.serviceTitle,
    servicePrice: apt.servicePrice,
    date: apt.date,
    time: apt.time,
    depositAmount: apt.depositAmount,
    depositStatus: apt.depositStatus,
    paymentMode: apt.paymentMode,
    status: apt.status || 'pendente_pix',
    appointmentId: apt.id,
    nailCondition: apt.nailCondition,
    notes: [
      apt.notes,
      apt.appointmentLocation ? `Local: ${apt.appointmentLocation === 'home' ? 'Domicílio' : 'Salão'}` : '',
      apt.appointmentLocation === 'home' && apt.homeAddress ? `Endereço: ${apt.homeAddress}` : '',
      apt.additionalServiceIds?.length ? `Serviços adicionais (IDs): ${apt.additionalServiceIds.join(', ')}` : '',
      apt.customRequest ? `Pedido personalizado (confirmar preço): ${apt.customRequest}` : ''
    ].filter(Boolean).join('\n') || undefined,
    timestamp: new Date().toISOString(),
    isTest
  };
}

export function isLocalOrStagingFrontend(): boolean {
  const envMode = (import.meta as any).env?.VITE_APP_ENV || (import.meta as any).env?.MODE;
  if (envMode === 'staging') return true;
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  }
  return false;
}

/**
 * Obtém a URL do Webhook configurada para envio de notificações por e-mail e Sheets.
 * Em ambiente local/staging, nunca faz fallback para a URL de produção.
 */
export function getNotificationWebhookUrl(): string {
  if (typeof window === 'undefined') {
    return isLocalOrStagingFrontend() ? '' : DEFAULT_APPS_SCRIPT_WEBHOOK_URL;
  }
  const explicitUrl = (
    (import.meta as any).env?.VITE_NOTIFICATION_WEBHOOK_URL ||
    localStorage.getItem(NOTIFICATION_WEBHOOK_STORAGE_KEY) ||
    ''
  ).trim();
  if (isLocalOrStagingFrontend()) {
    if (!explicitUrl || explicitUrl === DEFAULT_APPS_SCRIPT_WEBHOOK_URL) {
      return '';
    }
    return explicitUrl;
  }
  return explicitUrl || DEFAULT_APPS_SCRIPT_WEBHOOK_URL;
}

/**
 * Salva a URL do Webhook nas configurações do atelier.
 */
export function setNotificationWebhookUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const clean = url.trim();
  if (!clean || clean === DEFAULT_APPS_SCRIPT_WEBHOOK_URL) {
    localStorage.removeItem(NOTIFICATION_WEBHOOK_STORAGE_KEY);
  } else {
    localStorage.setItem(NOTIFICATION_WEBHOOK_STORAGE_KEY, clean);
  }
}

/**
 * Obtém o token de autorização opcional do Webhook (armazenado apenas localmente no navegador do admin).
 */
export function getNotificationWebhookToken(): string {
  // Long-lived credentials are never stored in localStorage or compiled into the public bundle.
  return getAdminSessionToken();
}

/** Legacy API kept for callers; only a short-lived session token is held in sessionStorage. */
export function setNotificationWebhookToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = token.trim();
    if (clean) window.sessionStorage.setItem('angelica_admin_session', clean);
    else window.sessionStorage.removeItem('angelica_admin_session');
  } catch {}
}

/**
 * Executa a comunicação segura com o Google Apps Script.
 * Usa 'text/plain' para compatibilidade CORS e lê a resposta real do script sem assumir falso positivo.
 */
export async function sendWebhookNotification(
  url: string,
  payload: EmailNotificationPayload,
  token?: string
): Promise<{ success: boolean; delivered: boolean; message: string; rawResponse?: string }> {
  const authToken = token !== undefined ? token : getNotificationWebhookToken();
  const requestBody = {
    ...payload,
    ...(authToken ? { token: authToken, authToken, key: authToken } : {})
  };

  const bodyString = JSON.stringify(requestBody);

  // 1. Tenta envio com Content-Type text/plain e mode cors
  // text/plain é compatível com preflight CORS e permite que o navegador siga o redirect e leia a resposta
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: bodyString
    });

    if (response.ok) {
      const responseText = await response.text();
      let resJson: any = null;
      try {
        resJson = JSON.parse(responseText);
      } catch {}

      if (resJson && resJson.status === 'error') {
        return {
          success: false,
          delivered: false,
          message: `O Google Apps Script recusou a solicitação: "${resJson.message || 'Erro não especificado'}".`,
          rawResponse: responseText
        };
      }

      if (resJson && (resJson.status === 'success' || resJson.success === true || resJson.test === true)) {
        return {
          success: true,
          delivered: Boolean(resJson.emailSent),
          message: resJson.message || 'Notificação por e-mail confirmada com sucesso pelo Google Apps Script!',
          rawResponse: responseText
        };
      }

      return {
        success: true,
        delivered: true,
        message: 'Google Apps Script processou a requisição com sucesso.',
        rawResponse: responseText
      };
    } else {
      return {
        success: false,
        delivered: false,
        message: `HTTP ${response.status} ao conectar com Google Apps Script.`
      };
    }
  } catch (corsErr: any) {
    // 2. Se o navegador bloquear leitura devido a restrição externa, tenta modo no-cors transparente
    // Não afirmamos falsamente que o e-mail foi entregue (delivered: false)
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: bodyString,
        mode: 'no-cors'
      });
      return {
        success: true,
        delivered: false,
        message: 'Requisição transmitida silenciosamente ao Apps Script. Entrega final pendente de verificação pelo Google.'
      };
    } catch (fallbackErr: any) {
      return {
        success: false,
        delivered: false,
        message: `Falha na comunicação de rede com o Apps Script: ${fallbackErr.message || 'Erro de rede'}`
      };
    }
  }
}

/**
 * Realiza um disparo de teste seguro para o Webhook sem gravar em agendamentos reais.
 */
export async function testNotificationWebhook(
  webhookUrl?: string,
  token?: string
): Promise<{ success: boolean; message: string }> {
  const url = webhookUrl || getNotificationWebhookUrl();
  if (!url) {
    return { success: false, message: 'Nenhuma URL de webhook configurada.' };
  }

  const testPayload: EmailNotificationPayload & { action?: string } = {
    action: 'testConnection',
    from: AUTHORIZED_SENDER_EMAIL,
    to: TARGET_NOTIFICATION_EMAIL,
    replyTo: AUTHORIZED_SENDER_EMAIL,
    subject: '🧪 [Teste de Conexão] Webhook de Notificações • Espaço Angélica do Carmo',
    clientName: 'Cliente Teste (Sistema)',
    clientPhone: '(12) 97406-2241',
    clientEmail: 'angelikm19@gmail.com',
    serviceId: 'alongamento-fibra-slim',
    serviceTitle: 'Alongamento em Fibra Slim',
    servicePrice: 'R$ 220,00',
    date: 'Hoje',
    time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    depositAmount: 88,
    paymentMode: 'sinal_40',
    status: 'teste_sistema',
    appointmentId: `test-${Date.now()}`,
    notes: `Disparo de verificação de conectividade. Nenhuma linha deve ser gravada na planilha oficial.`,
    timestamp: new Date().toISOString(),
    isTest: true
  };

  const sessionToken = typeof window !== 'undefined'
    ? window.sessionStorage?.getItem('angelica_admin_session') || ''
    : '';
  const effectiveToken = (token || getNotificationWebhookToken() || sessionToken).trim();
  const res = await sendWebhookNotification(url, testPayload, effectiveToken);
  return {
    success: res.success,
    message: res.message
  };
}

/**
 * Dispara automaticamente a notificação de novo pré-agendamento para a Angélica
 * a partir do remetente autorizado kontakt@alansmsolutions.com.
 * Previne duplicidades e se adapta de forma segura tanto a Webhooks 24/7 quanto ao envio pelo navegador.
 */
export async function triggerNewPreBookingEmailNotification(
  apt: Appointment,
  _authToken?: string
): Promise<EmailDispatchResult> {
  const payload = buildPreBookingEmailPayload(apt);
  const url = getNotificationWebhookUrl();

  if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
    return {
      success: false, persisted: false, appointmentId: apt.id, mode: 'webhook_rejected',
      message: 'Criação de agendamentos está desativada na pré-visualização GitHub Pages.',
      payload
    };
  }

  if (!url) {
    return {
      success: false,
      persisted: false,
      appointmentId: apt.id,
      mode: 'webhook_rejected',
      message: 'A URL oficial do Google Apps Script não está configurada.',
      payload
    };
  }

  // O agendamento público grava diretamente no Google Apps Script e na planilha oficial.
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action: 'createBooking' })
    });

    const responseText = await response.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error('O Google Apps Script devolveu uma resposta que não é JSON. A gravação não pôde ser confirmada.');
    }

    if (!response.ok || data?.status !== 'success' || data?.persisted !== true) {
      return {
        success: false,
        persisted: false,
        duplicate: Boolean(data?.duplicate),
        appointmentId: apt.id,
        mode: 'webhook_rejected',
        message: data?.message || `Google Apps Script não confirmou a gravação (HTTP ${response.status}).`,
        payload
      };
    }

    markAppointmentAsNotified(apt.id);
    return {
      success: true,
      persisted: true,
      duplicate: Boolean(data.duplicate),
      delivered: Boolean(data.emailSent),
      emailSent: Boolean(data.emailSent),
      emailError: data.emailError || undefined,
      emailSuppressed: Boolean(data.emailSuppressed),
      appointmentId: apt.id,
      mode: 'webhook_delivered',
      message: data.message || 'Pré-agendamento gravado na planilha oficial.',
      payload
    };
  } catch (err: any) {
    console.error('[Apps Script Booking Error]', err);
    return {
      success: false,
      persisted: false,
      appointmentId: apt.id,
      mode: 'webhook_rejected',
      message: err?.message || 'Não foi possível confirmar a comunicação com o Google Apps Script. Tente novamente com o mesmo agendamento.',
      payload
    };
  }
}

/**
 * Persiste um agendamento manual criado no painel administrativo diretamente no Google Sheets
 * através do endpoint oficial do backend seguro (/api/notifications/new-booking).
 * Transmite a credencial administrativa para validação e persistência prioritária.
 */
export async function submitManualBooking(
  apt: Appointment,
  authToken?: string
): Promise<EmailDispatchResult> {
  return triggerNewPreBookingEmailNotification(apt, authToken);
}

export interface AdminSessionResult {
  success: boolean;
  token?: string;
  error?: string;
  statusCode?: number;
}

export async function createAdminSession(password: string): Promise<AdminSessionResult> {
  try {
    const url = getNotificationWebhookUrl();
    if (!url) return { success: false, error: 'URL do Google Apps Script não configurada.' };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'createAdminSession', password })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.status === 'success' && typeof data.token === 'string' && data.token.length > 0) {
      return { success: true, token: data.token, statusCode: response.status };
    }
    return { success: false, error: data?.message || 'Falha ao autenticar no Google Apps Script.', statusCode: response.status };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha de conexão ao autenticar o painel.' };
  }
}

export async function revokeAdminSession(token: string): Promise<void> {
  if (!token) return;
  try {
    const url = getNotificationWebhookUrl();
    if (!url) return;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'revokeAdminSession', token })
    });
  } catch {
    // Logout still clears local session if Apps Script is unreachable.
  }
}

export interface PublicAvailabilityResult {
  success: boolean;
  appointments: Appointment[];
  blockedDates: string[];
  updatedAt?: string;
  weeklySchedule?: Record<string, any> | null;
  error?: string;
}

export async function fetchPublicAvailability(): Promise<PublicAvailabilityResult> {
  try {
    const endpoint = getNotificationWebhookUrl();
    if (!endpoint) return { success: false, appointments: [], blockedDates: [], error: 'URL do Google Apps Script não configurada.' };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'getPublicAvailability' }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.status !== 'success' || data?.success !== true || !Array.isArray(data.slots)) {
      return { success: false, appointments: [], blockedDates: [], error: data?.message || `Falha ao consultar disponibilidade oficial (HTTP ${response.status}).` };
    }
    const appointments: Appointment[] = data.slots.map((slot: any) => ({
      id: String(slot.id || ''),
      clientName: '',
      clientPhone: '',
      serviceTitle: '',
      date: String(slot.date || ''),
      time: String(slot.time || ''),
      serviceDuration: String(slot.serviceDuration || ''),
      status: String(slot.status || 'pendente_pix') as Appointment['status']
    }));
    const blockedDates = new Set<string>((Array.isArray(data.blockedDates) ? data.blockedDates : []).map(String));
    if (Array.isArray(data.scheduleBlocks)) {
      data.scheduleBlocks.forEach((block: any) => {
        if (block?.active !== false && block?.allDay === true && block?.date) blockedDates.add(String(block.date));
      });
    }
    return {
      success: true,
      appointments,
      blockedDates: Array.from(blockedDates),
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
      weeklySchedule: data.weeklySchedule && typeof data.weeklySchedule === 'object' ? data.weeklySchedule : null
    };
  } catch (error: any) {
    return { success: false, appointments: [], blockedDates: [], error: error?.message || 'Falha de conexão ao consultar disponibilidade oficial.' };
  }
}

export interface FetchAppointmentsDetailedResult {
  success: boolean;
  appointments: Appointment[];
  source?: string;
  total?: number;
  error?: string;
  statusCode?: number;
}

/**
 * Consulta agendamentos com resultado detalhado (para exibir status de carregamento,
 * erros de credencial e lista vazia no painel administrativo).
 */
export async function fetchRemoteAppointmentsDetailed(authToken?: string): Promise<FetchAppointmentsDetailedResult> {
  try {
    const endpoint = getNotificationWebhookUrl();
    if (!endpoint) return { success: false, appointments: [], error: 'URL do Google Apps Script não configurada.' };
    const token = getAdminSessionToken(authToken);
    if (!token) return { success: false, appointments: [], error: 'Sessão administrativa ausente. Entre novamente no painel.', statusCode: 401 };
    const data = await postAppsScriptAction(endpoint, 'getAppointments', { token });
    if (Array.isArray(data.appointments)) {
      return { success: true, appointments: data.appointments as Appointment[], source: 'google_sheets', total: data.total ?? data.appointments.length };
    }
    return { success: false, appointments: [], error: 'Resposta do Apps Script sem lista de agendamentos.', statusCode: 502 };
  } catch (err: any) {
    const unauthorized = /não autorizado|sessão inválida|token de autorização|sessão administrativa/i.test(String(err?.message || ''));
    return { success: false, appointments: [], error: `Falha ao consultar agendamentos oficiais: ${err.message || 'serviço indisponível'}`, statusCode: unauthorized ? 401 : 502 };
  }
}

export interface DeleteAppointmentResult {
  success: boolean;
  error?: string;
  statusCode?: number;
}

export async function deleteRemoteAppointment(
  appointmentId: string,
  authToken?: string
): Promise<DeleteAppointmentResult> {
  try {
    const endpoint = getNotificationWebhookUrl();
    const token = (authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '')).trim();
    if (!endpoint || !token) return { success: false, error: 'URL do Apps Script ou sessão administrativa ausente.' };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'deleteAppointment', appointmentId, token })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.status === 'success' && (data.deleted === true || data.notFound === true)) return { success: true, statusCode: response.status };
    return { success: false, error: data?.message || `Falha ao excluir agendamento (HTTP ${response.status}).`, statusCode: response.status };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha de conexão ao excluir agendamento.' };
  }
}

/**
 * Busca agendamentos diretamente do Google Apps Script e da planilha oficial.
 */
export async function fetchRemoteAppointments(authToken?: string): Promise<Appointment[]> {
  const result = await fetchRemoteAppointmentsDetailed(authToken);
  return result.success ? result.appointments : [];
}

export interface BlockScheduleResult {
  success: boolean;
  persisted: boolean;
  appointmentId?: string;
  message?: string;
  error?: string;
}

/**
 * Persiste o bloqueio de uma data no armazenamento oficial (Google Sheets / backend).
 * Requer token de autenticação administrativa.
 */
export async function submitBlockSchedule(
  blockApt: Appointment,
  authToken?: string
): Promise<BlockScheduleResult> {
  try {
    const endpoint = getNotificationWebhookUrl();
    const token = (authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '')).trim();
    if (!endpoint || !token) return { success: false, persisted: false, error: 'URL do Apps Script ou sessão administrativa ausente.' };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({
        action: 'blockSchedule', token, appointmentId: blockApt.id, date: blockApt.date, time: blockApt.time,
        blockReason: blockApt.blockReason || blockApt.serviceTitle, notes: blockApt.notes,
        clientName: blockApt.clientName || 'Protocolo Ateliê'
      })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.status === 'success' && data.persisted === true) {
      return { success: true, persisted: true, appointmentId: blockApt.id, message: data.message || 'Bloqueio gravado na planilha oficial.' };
    }
    return { success: false, persisted: false, appointmentId: blockApt.id, error: data?.message || `Falha ao gravar bloqueio (HTTP ${response.status}).` };
  } catch (err: any) {
    return { success: false, persisted: false, appointmentId: blockApt.id, error: err?.message || 'Falha de conexão ao gravar bloqueio.' };
  }
}

export async function fetchRemoteBlockedDates(): Promise<string[]> {
  const result = await fetchPublicAvailability();
  return result.success ? result.blockedDates : [];
}

export interface UpdateAppointmentResult {
  success: boolean;
  persisted?: boolean;
  appointment?: Appointment;
  error?: string;
  statusCode?: number;
}

export async function updateRemoteAppointment(
  appointment: Partial<Appointment> & { id: string },
  authToken?: string
): Promise<UpdateAppointmentResult> {
  try {
    const endpoint = getNotificationWebhookUrl();
    const token = (authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '')).trim();
    if (!endpoint || !token) return { success: false, persisted: false, error: 'URL do Apps Script ou sessão administrativa ausente.' };
    const { id, ...fields } = appointment;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'updateAppointment', appointmentId: id, ...fields, token })
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.status === 'success' && data?.persisted === true) {
      return { success: true, persisted: true, appointment: appointment as Appointment, statusCode: response.status };
    }
    return { success: false, persisted: false, error: data?.message || `Falha ao atualizar agendamento (HTTP ${response.status}).`, statusCode: response.status };
  } catch (err: any) {
    return { success: false, persisted: false, error: err?.message || 'Falha de conexão ao atualizar agendamento.' };
  }
}

export interface SavedScheduleBlock {
  id: string;
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  reason?: string;
  active?: boolean;
}

export interface RemoteScheduleConfig {
  success: boolean;
  weeklySchedule: Record<string, any> | null;
  blocks: SavedScheduleBlock[];
  error?: string;
}

async function callScheduleAction(action: string, extra: Record<string, unknown> = {}, authToken?: string): Promise<any> {
  const url = getNotificationWebhookUrl();
  const token = getAdminSessionToken(authToken);
  if (!url) throw new Error('URL do Google Apps Script não configurada.');
  if (!token) throw new Error('Sessão administrativa ausente. Entre novamente no painel.');
  return postAppsScriptAction(url, action, { ...extra, token });
}

async function postAppsScriptAction(url: string, action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
    body: JSON.stringify({ action, ...payload }),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.status === 'error' || data.status !== 'success') {
    throw new Error(data?.message || `Apps Script recusou a ação ${action} (HTTP ${response.status}).`);
  }
  return data;
}

export async function fetchRemoteScheduleConfig(authToken?: string): Promise<RemoteScheduleConfig> {
  try {
    const data = await callScheduleAction('getScheduleConfig', {}, authToken);
    return {
      success: true,
      weeklySchedule: data.weeklySchedule && typeof data.weeklySchedule === 'object' ? data.weeklySchedule : null,
      blocks: Array.isArray(data.blocks) ? data.blocks : []
    };
  } catch (error: any) {
    return { success: false, weeklySchedule: null, blocks: [], error: error?.message || 'Falha ao ler configuração da agenda.' };
  }
}

export async function saveRemoteWeeklySchedule(
  weeklySchedule: Record<string, unknown>,
  authToken?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await callScheduleAction('saveWeeklySchedule', { weeklySchedule }, authToken);
    return data.saved === true
      ? { success: true }
      : { success: false, error: 'Apps Script não confirmou a gravação da agenda semanal.' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao salvar agenda semanal.' };
  }
}

export async function saveRemoteScheduleBlock(
  block: SavedScheduleBlock,
  authToken?: string
): Promise<{ success: boolean; block?: SavedScheduleBlock; error?: string }> {
  try {
    const data = await callScheduleAction('saveScheduleBlock', { block }, authToken);
    return data.saved === true
      ? { success: true, block: data.block }
      : { success: false, error: 'Apps Script não confirmou a gravação do bloqueio.' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao salvar bloqueio de agenda.' };
  }
}

export async function deleteRemoteScheduleBlock(
  blockId: string,
  authToken?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await callScheduleAction('deleteScheduleBlock', { blockId }, authToken);
    return data.deleted === true || data.notFound === true
      ? { success: true }
      : { success: false, error: 'Apps Script não confirmou a exclusão do bloqueio.' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao excluir bloqueio de agenda.' };
  }
}

export interface RemoteAppSettingsResult {
  success: boolean;
  settings?: Record<string, unknown>;
  error?: string;
}

export async function fetchRemoteAppSettings(authToken?: string): Promise<RemoteAppSettingsResult> {
  try {
    const data = await callScheduleAction('getAppSettings', {}, authToken);
    return { success: true, settings: data.settings && typeof data.settings === 'object' ? data.settings : {} };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao ler configurações da planilha oficial.' };
  }
}

export async function saveRemoteAppSetting(
  settingKey: 'STUDIO_ADDRESS' | 'BLACKLIST' | 'WHATSAPP_CONFIG' | 'PAYMENT_CONFIG',
  value: StudioAddressConfig | BlacklistEntry[] | WhatsAppConfig | PaymentConfig | Record<string, unknown>,
  authToken?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await callScheduleAction('saveAppSetting', { settingKey, value }, authToken);
    return data.saved === true
      ? { success: true }
      : { success: false, error: data.message || 'Apps Script não confirmou a gravação da configuração.' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao salvar configuração na planilha oficial.' };
  }
}

export async function fetchPublicStudioAddress(): Promise<{ success: boolean; address?: StudioAddressConfig | null; error?: string }> {
  try {
    const endpoint = getNotificationWebhookUrl();
    if (!endpoint) return { success: false, error: 'URL do Google Apps Script não configurada.' };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'getPublicStudioAddress' }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.status !== 'success') {
      return { success: false, error: data?.message || 'Não foi possível carregar o endereço oficial.' };
    }
    return { success: true, address: data.address && typeof data.address === 'object' ? data.address as StudioAddressConfig : null };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao carregar o endereço oficial.' };
  }
}

export async function fetchPublicPaymentConfig(): Promise<{ success: boolean; configured: boolean; paymentConfig?: PaymentConfig; error?: string }> {
  try {
    const endpoint = getNotificationWebhookUrl();
    if (!endpoint) return { success: false, configured: false, error: 'URL do Google Apps Script não configurada.' };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'getPublicPaymentConfig' }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.status !== 'success' || !data.paymentConfig) {
      return { success: false, configured: false, error: data?.message || 'Configuração de Pix indisponível.' };
    }
    const config = data.paymentConfig;
    return {
      success: true,
      configured: data.configured === true,
      paymentConfig: {
        pixKey: String(config.pixKey || ''),
        pixBeneficiary: String(config.pixBeneficiary || ''),
        depositAmount: Number(config.depositAmount ?? 40),
      }
    };
  } catch (error: any) {
    return { success: false, configured: false, error: error?.message || 'Falha ao ler configuração de Pix da planilha.' };
  }
}

export async function fetchRemoteClients(authToken?: string): Promise<{ success: boolean; clients: ClientProfile[]; error?: string }> {
  try {
    const data = await callScheduleAction('getClients', {}, authToken);
    return { success: true, clients: Array.isArray(data.clients) ? data.clients as ClientProfile[] : [] };
  } catch (error: any) {
    return { success: false, clients: [], error: error?.message || 'Falha ao ler clientes da planilha oficial.' };
  }
}

export async function saveRemoteClient(
  client: ClientProfile,
  authToken?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await callScheduleAction('saveClient', { client }, authToken);
    return data.saved === true
      ? { success: true }
      : { success: false, error: data.message || 'Apps Script não confirmou a gravação da cliente.' };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Falha ao salvar perfil na planilha oficial.' };
  }
}

export async function fetchRemoteServices(): Promise<Service[]> {
  const endpoint = getNotificationWebhookUrl();
  if (!endpoint) throw new Error('URL do Google Apps Script não configurada.');
  const data = await postAppsScriptAction(endpoint, 'getServices');
  if (!Array.isArray(data.services)) throw new Error('Resposta do Apps Script sem catálogo oficial de serviços.');
  return data.services as Service[];
}

export async function saveRemoteService(
  service: Service,
  authToken?: string
): Promise<{ success: boolean; saved?: boolean; error?: string; service?: Service }> {
  try {
    const endpoint = getNotificationWebhookUrl();
    const token = (authToken || getNotificationWebhookToken()).trim();
    if (!endpoint) return { success: false, error: 'URL do Google Apps Script não configurada.' };
    if (!token) return { success: false, error: 'Token administrativo do Apps Script não configurado. Configure-o nas definições do painel.' };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'saveService', token, ...service })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.status !== 'success' || data?.saved !== true) {
      return { success: false, error: data?.message || 'A planilha oficial não confirmou a gravação do serviço.' };
    }
    return { success: true, saved: true, service };
  } catch (err: any) {
    return { success: false, error: `Falha ao salvar na planilha oficial: ${err.message || 'erro de conexão'}.` };
  }
}

export async function deleteRemoteService(
  serviceId: string,
  authToken?: string
): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
  // Never delete catalog rows. Retire the service by setting active=false in the official sheet.
  try {
    const services = await fetchRemoteServices();
    const service = services.find(item => item.id === serviceId);
    if (!service) return { success: false, error: 'Serviço não encontrado na planilha oficial; nenhum dado foi alterado.' };
    const result = await saveRemoteService({ ...service, active: false }, authToken);
    return result.success
      ? { success: true, deleted: true }
      : { success: false, error: result.error };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha ao desativar serviço na planilha oficial.' };
  }
}

export interface DrivePhoto {
  id: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  updatedAt?: string;
}

/** Lista fotos da pasta oficial via Apps Script, protegendo a ação com o token administrativo configurado. */
export async function listDrivePhotos(authToken?: string): Promise<{ success: boolean; photos?: DrivePhoto[]; error?: string }> {
  const endpoint = getNotificationWebhookUrl();
  const token = (authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '') || getNotificationWebhookToken()).trim();
  if (!endpoint) return { success: false, error: 'Configure o URL do Google Apps Script nas definições antes de selecionar fotos.' };
  if (!token) return { success: false, error: 'Token administrativo do Google Apps Script não configurado.' };
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'listDrivePhotos', token })
    });
    const data = await response.json();
    if (response.ok && data?.status === 'success' && Array.isArray(data.photos)) {
      return { success: true, photos: data.photos as DrivePhoto[] };
    }
    return { success: false, error: data?.message || 'Não foi possível carregar as fotos do Google Drive.' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha de ligação ao Google Apps Script.' };
  }
}

export interface PublicGalleryPhoto {
  id: string;
  title: string;
  subtitle: string;
  url: string;
  thumbnailUrl: string;
}

export async function fetchPublicGalleryPhotos(): Promise<{ success: boolean; photos: PublicGalleryPhoto[]; error?: string }> {
  try {
    const endpoint = getNotificationWebhookUrl();
    if (!endpoint) return { success: false, photos: [], error: 'URL do Google Apps Script não configurada.' };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ action: 'getPublicGalleryPhotos' }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.status !== 'success' || !Array.isArray(data.photos)) {
      return { success: false, photos: [], error: data?.message || 'Galeria oficial indisponível.' };
    }
    return {
      success: true,
      photos: data.photos.map((photo: any) => ({
        id: String(photo.id || ''),
        title: String(photo.title || 'Criação'),
        subtitle: String(photo.subtitle || 'Portfólio Espaço Angélica do Carmo'),
        url: String(photo.url || ''),
        thumbnailUrl: String(photo.thumbnailUrl || photo.url || '')
      })).filter((photo: PublicGalleryPhoto) => photo.id && photo.url)
    };
  } catch (error: any) {
    return { success: false, photos: [], error: error?.message || 'Falha ao carregar fotos do Google Drive.' };
  }
}

export async function uploadServicePhoto(
  file: File,
  authToken?: string
): Promise<{ success: boolean; url?: string; error?: string }> {
  const validMimes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!validMimes.includes(file.type)) {
    return { success: false, error: 'Formato não suportado. Por favor utilize JPEG, PNG ou WebP.' };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { success: false, error: 'A imagem deve ter no máximo 5MB.' };
  }
  const token = (authToken || (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '') || getNotificationWebhookToken()).trim();
  if (!token) return { success: false, error: 'Sessão administrativa do Google Apps Script não configurada.' };
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Não foi possível ler o arquivo de imagem.'));
      reader.readAsDataURL(file);
    });
    const imageBase64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
    const data = await callScheduleAction('uploadPhoto', {
      imageBase64,
      fileName: file.name,
      mimeType: file.type
    }, token);
    if (typeof data.url === 'string' && data.url) return { success: true, url: data.url };
    return { success: false, error: data.message || 'O Apps Script não confirmou o upload para o Google Drive.' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Falha ao enviar a foto para o Google Drive.' };
  }
}
