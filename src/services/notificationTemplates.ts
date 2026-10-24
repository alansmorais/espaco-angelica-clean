/**
 * Template oficial aprovado para mensagens de pré-agendamento do Espaço Angelica do Carmo.
 * Preserva integralmente a política de agendamento (sinal de 40% e aviso mínimo de 24h).
 */

export const DEPOSIT_RATE = 0.4;

export function calculateDeposit40(servicePrice: number, depositPercent: number = 40): number {
  const safePercent = Number.isFinite(depositPercent) ? Math.min(100, Math.max(0, depositPercent)) : 40;
  return Math.round(servicePrice * (safePercent / 100) * 100) / 100;
}

export function calculateFullPrepayment(servicePrice: number): number {
  return Math.round(servicePrice * 100) / 100;
}

export function calculateRemainingBalance(servicePrice: number, depositAmount: number): number {
  return Math.max(0, Math.round((servicePrice - depositAmount) * 100) / 100);
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export interface PreBookingTemplateData {
  clientName: string;
  serviceTitle: string;
  servicePrice?: string;
  date: string;
  time: string;
  depositAmount: number;
  remainingBalance?: number;
  paymentMode?: 'sinal_40' | 'pre_pagamento_100';
  pixKey?: string;
  pixBeneficiary?: string;
  depositPercent?: number;
}

/**
 * Constrói a mensagem oficial aprovada pela Angélica com os dados reais da reserva.
 */
export function buildOfficialPreBookingWhatsAppMessage(data: PreBookingTemplateData): string {
  const signalValue = `R$ ${formatBRL(data.depositAmount)}`;
  const totalLine = data.servicePrice ? `\nTotal do procedimento: ${data.servicePrice}` : '';

  let balance = data.remainingBalance;
  if (balance === undefined && data.servicePrice && data.paymentMode !== 'pre_pagamento_100') {
    const rawDigits = data.servicePrice.replace(/[^\d,]/g, '').replace(',', '.');
    const parsed = parseFloat(rawDigits);
    if (!isNaN(parsed) && parsed > 0) {
      balance = calculateRemainingBalance(parsed, data.depositAmount);
    }
  }

  const balanceLine =
    data.paymentMode === 'pre_pagamento_100'
      ? ''
      : balance !== undefined
      ? `\nSaldo restante a pagar no atendimento: R$ ${formatBRL(balance)}`
      : '';
  const depositPercent = Number.isFinite(data.depositPercent) ? Math.min(100, Math.max(0, Number(data.depositPercent))) : 40;
  const paymentPrompt =
    data.paymentMode === 'pre_pagamento_100'
      ? `Para confirmar, faça o PIX do pré-pagamento integral (100%) de ${signalValue}:`
      : `Para confirmar, faça o PIX do sinal (${depositPercent}%) de ${signalValue}:`;
  const pixDetails = data.pixKey?.trim()
    ? `Chave PIX: ${data.pixKey.trim()}\nTitular: ${data.pixBeneficiary?.trim() || 'Titular não informado'}`
    : 'Chave PIX não cadastrada. Entre em contato com o atelier para confirmar os dados de pagamento.';

  return `Olá, ${data.clientName}! Recebemos o seu pré-agendamento na Angelica do Carmo Unhas.
Serviço: ${data.serviceTitle}${totalLine}
Data: ${data.date}
Horário: ${data.time}

${paymentPrompt}${balanceLine}
${pixDetails}

Depois é só enviar o comprovante por aqui. Assim que conferirmos o pagamento, enviamos a confirmação do seu agendamento. 💛

🤎 POLÍTICA DE AGENDAMENTO
- Para confirmar o horário, é necessário pagar um sinal de ${depositPercent}% do valor do procedimento.
- O sinal garante a vaga e é descontado do valor total no dia do atendimento.
- Em caso de desistência ou não comparecimento, o sinal não é reembolsado, pois cobre o bloqueio da vaga e os preparativos.
- Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago.
Agradeço a compreensão e o carinho de sempre! 🤎✨`;
}

/**
 * Retorna o link oficial do WhatsApp da Angélica com a mensagem pré-preenchida.
 */
export function buildOfficialWhatsAppUrl(data: PreBookingTemplateData, phone: string = '5512974062241'): string {
  const cleanPhone = phone.replace(/\D/g, '');
  const message = buildOfficialPreBookingWhatsAppMessage(data);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

const PORTUGUESE_MONTHS: Record<string, string> = {
  jan: '01', janeiro: '01',
  fev: '02', fevereiro: '02',
  mar: '03', marco: '03', março: '03',
  abr: '04', abril: '04',
  mai: '05', maio: '05',
  jun: '06', junho: '06',
  jul: '07', julho: '07',
  ago: '08', agosto: '08',
  set: '09', setembro: '09',
  out: '10', outubro: '10',
  nov: '11', novembro: '11',
  dez: '12', dezembro: '12'
};

/**
 * Normaliza qualquer formato de data (ex: 'Quarta, 13 Nov', '2024-11-13', '13/11/2024', '13 Nov')
 * em uma chave canônica 'MM-DD' sem risco de falsos positivos em comparações parciais.
 */
export function normalizeDateKey(rawDate?: string): string {
  if (!rawDate || typeof rawDate !== 'string') return '';
  const clean = rawDate
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!clean) return '';

  // 1. Formato ISO YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, , m, d] = isoMatch;
    return `${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 2. Formato DD/MM/YYYY ou DD/MM
  const slashMatch = clean.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?/);
  if (slashMatch) {
    const [, d, m] = slashMatch;
    return `${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 3. Formato textual brasileiro: 'Quarta, 13 Nov', '13 de Novembro', '13 Nov'
  const dayMatch = clean.match(/\b([0-3]?\d)\b/);
  const monthMatch = clean.match(/\b(jan(?:eiro)?|fev(?:ereiro)?|mar(?:co)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\b/);

  if (dayMatch && monthMatch) {
    const day = dayMatch[1].padStart(2, '0');
    const monthKey = monthMatch[1];
    const month = PORTUGUESE_MONTHS[monthKey] || monthKey;
    return `${month}-${day}`;
  }

  // Fallback seguro: string limpa sem pontuações nem espaços múltiplos
  return clean.replace(/[,\.\-\/]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Compara se duas representações de data se referem exatamente ao mesmo dia calendário,
 * sem falsos positivos causados por substrings ou dias da semana parciais.
 */
export function areDatesEqual(dateA?: string, dateB?: string): boolean {
  if (!dateA || !dateB) return false;
  const aTrim = dateA.trim().toLowerCase();
  const bTrim = dateB.trim().toLowerCase();
  if (aTrim === bTrim) return true;

  const keyA = normalizeDateKey(aTrim);
  const keyB = normalizeDateKey(bTrim);
  return Boolean(keyA && keyB && keyA === keyB);
}

