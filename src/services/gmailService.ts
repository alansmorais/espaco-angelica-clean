import { getNotificationWebhookUrl } from './emailNotificationService';

export const AUTHORIZED_SENDER_EMAIL = 'kontakt@alansmsolutions.com';
export const TARGET_NOTIFICATION_EMAIL = 'angelikm19@gmail.com';

export interface GmailSendResult {
  success: boolean;
  message: string;
  emailSent?: boolean;
  error?: string;
}

function getAdminSessionToken(): string {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage.getItem('angelica_admin_session') || '' : '';
  } catch {
    return '';
  }
}

async function callAppsScriptEmail(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const endpoint = getNotificationWebhookUrl();
  const token = getAdminSessionToken();
  if (!endpoint) throw new Error('URL do Google Apps Script não configurada.');
  if (!token) throw new Error('Sessão administrativa ausente. Entre novamente no painel.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8', Accept: 'application/json' },
    body: JSON.stringify({ action, ...payload, token }),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || `Falha de comunicação com Apps Script (HTTP ${response.status}).`);
  return data;
}

/** Legacy UI compatibility: email sending now runs under the Apps Script owner, not Firebase OAuth. */
export async function signInWithGmail(): Promise<{ userEmail: string } | null> {
  try {
    const data = await callAppsScriptEmail('getEmailStatus');
    return data?.success && data?.configured ? { userEmail: AUTHORIZED_SENDER_EMAIL } : null;
  } catch {
    return null;
  }
}

export async function logoutGmail(): Promise<void> {
  // No browser OAuth session exists; the admin Apps Script session controls access.
}

export function getConnectedSenderEmail(): string | null {
  return null;
}

export async function getGmailAccessToken(): Promise<string | null> {
  return null;
}

export async function sendGmailConfirmation(
  _accessToken: string,
  toEmail: string,
  clientName: string,
  serviceTitle: string,
  date: string,
  time: string,
  servicePrice?: string,
  depositAmount?: number,
  notes?: string
): Promise<GmailSendResult> {
  try {
    const data = await callAppsScriptEmail('sendAdminEmail', {
      toEmail,
      clientName,
      serviceTitle,
      date,
      time,
      servicePrice,
      depositAmount,
      notes
    });
    return {
      success: data?.success === true && data?.emailSent === true,
      emailSent: data?.emailSent === true,
      message: data?.message || 'O Apps Script não confirmou o envio do e-mail.',
      error: data?.success ? undefined : data?.message
    };
  } catch (error: any) {
    return { success: false, emailSent: false, message: error?.message || 'Falha ao enviar e-mail via Apps Script.', error: error?.message };
  }
}

export async function sendDirectGmailFromBrowser(payload: {
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  serviceTitle: string;
  servicePrice?: string;
  date: string;
  time: string;
  depositAmount: number;
  status: string;
  appointmentId: string;
  notes?: string;
  timestamp?: string;
}): Promise<GmailSendResult> {
  try {
    const data = await callAppsScriptEmail('testEmailNotification', { requestedAt: payload.timestamp || new Date().toISOString() });
    return {
      success: data?.success === true && data?.emailSent === true,
      emailSent: data?.emailSent === true,
      message: data?.message || 'O Apps Script não confirmou o envio do e-mail de teste.',
      error: data?.success ? undefined : data?.message
    };
  } catch (error: any) {
    return { success: false, emailSent: false, message: error?.message || 'Falha ao testar o envio de e-mail.', error: error?.message };
  }
}
