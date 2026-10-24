import { Appointment } from '../types';
import { getNotificationWebhookUrl } from './emailNotificationService';

export interface SendConfirmationResult {
  success: boolean;
  status: 'sent' | 'simulated' | 'failed';
  message: string;
  normalizedPhone?: string;
  previewText?: string;
  fallbackUrl?: string;
  error?: string;
  log?: any;
}

export interface WhatsAppStatus {
  status: 'configured' | 'sandbox_simulation';
  mode: string;
  isConfigured: boolean;
  phoneNumberIdConfigured: boolean;
  tokenConfigured: boolean;
  businessAccountIdConfigured: boolean;
  apiVersion: string;
  totalLogs: number;
}

function getAdminSessionToken(authToken?: string): string {
  if (authToken) return authToken.trim();
  try {
    return typeof window !== 'undefined' ? window.sessionStorage.getItem('angelica_admin_session') || '' : '';
  } catch {
    return '';
  }
}

async function callAppsScript(action: string, payload: Record<string, unknown> = {}, authToken?: string): Promise<any> {
  const endpoint = getNotificationWebhookUrl();
  if (!endpoint) throw new Error('URL do Google Apps Script não configurada.');
  const token = getAdminSessionToken(authToken);
  if (!token) throw new Error('Sessão administrativa ausente. Entre novamente no painel.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
    body: JSON.stringify({ action, ...payload, token }),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.message || `Falha ao comunicar com Google Apps Script (HTTP ${response.status}).`);
  }
  if (data.success === false && data.status === 'error') {
    throw new Error(data.message || data.error || 'O Google Apps Script recusou a operação.');
  }
  return data;
}

export function resolveWhatsAppAdminHeaders(authToken?: string): Record<string, string> {
  const token = getAdminSessionToken(authToken);
  return token ? { Authorization: `Bearer ${token}`, 'X-Admin-Token': token } : {};
}

export async function checkWhatsAppStatus(): Promise<WhatsAppStatus> {
  try {
    const data = await callAppsScript('getWhatsAppStatus');
    if (data?.success === true) {
      return {
        status: data.status === 'configured' ? 'configured' : 'sandbox_simulation',
        mode: String(data.mode || 'WhatsApp via Google Apps Script'),
        isConfigured: Boolean(data.isConfigured),
        phoneNumberIdConfigured: Boolean(data.phoneNumberIdConfigured),
        tokenConfigured: Boolean(data.tokenConfigured),
        businessAccountIdConfigured: Boolean(data.businessAccountIdConfigured),
        apiVersion: String(data.apiVersion || 'v20.0'),
        totalLogs: Number(data.totalLogs || 0)
      };
    }
    throw new Error(data?.message || 'Resposta inválida do Apps Script.');
  } catch {
    return {
      status: 'sandbox_simulation',
      mode: 'Apps Script indisponível — envio automático não confirmado',
      isConfigured: false,
      phoneNumberIdConfigured: false,
      tokenConfigured: false,
      businessAccountIdConfigured: false,
      apiVersion: 'v20.0',
      totalLogs: 0
    };
  }
}

export async function fetchWhatsAppLogs(authToken?: string): Promise<any[]> {
  try {
    const data = await callAppsScript('getWhatsAppLogs', {}, authToken);
    return Array.isArray(data.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

export async function sendAppointmentWhatsAppConfirmation(
  apt: Appointment,
  customTemplate?: string,
  studioAddress?: string,
  authToken?: string
): Promise<SendConfirmationResult> {
  try {
    return await callAppsScript('sendWhatsAppConfirmation', {
      appointmentId: apt.id,
      clientName: apt.clientName,
      clientPhone: apt.clientPhone,
      serviceTitle: apt.serviceTitle,
      servicePrice: apt.servicePrice,
      date: apt.date,
      time: apt.time,
      studioAddress,
      depositAmount: apt.depositAmount,
      paymentMode: apt.paymentMode,
      depositStatus: apt.depositStatus,
      customTemplate
    }, authToken) as SendConfirmationResult;
  } catch (err: any) {
    return {
      success: false,
      status: 'failed',
      message: 'Não foi possível confirmar o envio pelo Google Apps Script.',
      error: err?.message || 'Erro de conexão.'
    };
  }
}

export async function testWhatsAppMessage(
  testPhone: string,
  testName: string = 'Cliente Teste',
  authToken?: string
): Promise<SendConfirmationResult> {
  try {
    return await callAppsScript('testWhatsAppMessage', {
      clientName: testName,
      clientPhone: testPhone,
      serviceTitle: 'Teste de WhatsApp',
      servicePrice: '',
      date: 'Teste',
      time: 'Teste',
      depositAmount: 0,
      depositStatus: 'teste_sistema'
    }, authToken) as SendConfirmationResult;
  } catch (err: any) {
    return {
      success: false,
      status: 'failed',
      message: 'Erro ao testar a comunicação com o Google Apps Script.',
      error: err?.message || 'Erro de conexão.'
    };
  }
}
