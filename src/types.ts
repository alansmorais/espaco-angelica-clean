export type ServiceCategory = 'alongamento' | 'blindagem' | 'nailart' | 'spa' | 'depilacao';

export interface Service {
  id: string;
  title: string;
  category: ServiceCategory;
  price: number;
  priceFormatted: string;
  duration: string;
  badge?: string;
  badgeType?: 'primary' | 'secondary' | 'neutral';
  specs: string[];
  description: string;
  note: string;
  imageUrl: string;
  active?: boolean;
}

export type SlotStatus = 'concluido' | 'em_andamento' | 'bloqueado' | 'pendente_pix' | 'confirmado' | 'disponivel' | 'cancelado' | 'teste_sistema';

export interface RecurrenceConfig {
  frequencyDays: number; // e.g. 15, 21, 30
  frequencyLabel: string; // e.g. "A cada 21 dias (Recomendado Fibra)"
  totalSessions: number; // e.g. 2, 3, 4
  seriesId: string;
  currentSession: number;
  upcomingDates?: string[];
}

export interface Appointment {
  id: string;
  clientName: string;
  clientPhone: string;
  clientEmail?: string;
  clientInstagram?: string;
  nailCondition?: string;
  notes?: string;
  serviceId?: string;
  additionalServiceIds?: string[];
  customRequest?: string;
  appointmentLocation?: 'salon' | 'home';
  homeAddress?: string;
  serviceTitle: string;
  servicePrice: string;
  serviceDuration: string;
  date: string; // e.g. "Quinta, 14 Nov" or ISO
  time: string; // e.g. "11:30"
  status: SlotStatus;
  depositAmount: number;
  depositStatus: 'liquidado' | 'pendente' | 'estornado' | 'retido' | 'recusado' | 'teste_sistema';
  paymentMode?: 'sinal_40' | 'pre_pagamento_100';
  isVip?: boolean;
  vipTag?: string;
  isAutoclave?: boolean;
  blockReason?: string;
  receiptFile?: string;
  receiptFileName?: string;
  e2eCode?: string;
  clientInitials?: string;
  recurrence?: RecurrenceConfig;
  requiresFullPrepayment?: boolean;
  isBlacklisted?: boolean;
  whatsappStatus?: 'enviado' | 'pendente' | 'falha' | 'simulado';
  whatsappSentAt?: string;
  whatsappLastMessage?: string;
  gmailStatus?: 'enviado' | 'pendente' | 'falha' | 'simulado';
  gmailSentAt?: string;
}

export interface PaymentConfig {
  pixKey: string;
  pixBeneficiary: string;
  depositAmount: number;
}

export interface WhatsAppConfig {
  autoSendOnConfirm: boolean;
  customTemplate?: string;
  /** Public business contact loaded from the official WHATSAPP_CONFIG sheet setting. */
  phone?: string;
  instagramUrl?: string;
}

export interface WhatsAppLogItem {
  id: string;
  recipientPhone: string;
  recipientName: string;
  appointmentId?: string;
  serviceTitle?: string;
  dateTime?: string;
  status: 'sent' | 'simulated' | 'failed';
  timestamp: string;
  messageText: string;
  error?: string;
}

export interface ClientProfile {
  id: string;
  name: string;
  initials: string;
  phone: string;
  tier: 'VIP Club' | 'Frequente' | 'Atrasada' | '1ª Sessão';
  status: 'em_dia' | 'atrasada' | 'frequente' | 'nova' | 'vip';
  lastVisit: string;
  lastService: string;
  nextMaintenanceDays: number;
  daysRemainingOrOverdue: string;
  isOverdue: boolean;
  ltv: number;
  ltvFormatted: string;
  laminaType: string;
  oiliness: string;
  allergies: string;
  onycholysis: string;
  preferredShape: string;
  preferredColor: string;
  products: {
    preparer: string;
    baseGel: string;
    tensionPoint: string;
    topCoat: string;
  };
  privateNotes: string;
  photos?: {
    before?: string;
    after?: string;
  };
  isBlacklisted?: boolean;
  blacklistReason?: string;
}

export interface PixPendingVerification {
  id: string;
  clientName: string;
  clientInitials: string;
  serviceName: string;
  date: string;
  time: string;
  amount: number;
  paymentMode?: 'sinal_40' | 'pre_pagamento_100';
  sentAgoMinutes: number;
  expiresInMinutes: number;
  refCode: string;
  pagadorName: string;
  pagadorCpf: string;
  pagadorBank: string;
  favorecidoName: string;
  chavePix: string;
  e2eCode: string;
  transactionTime: string;
  bankMatchStatus: '100% OK' | 'Exato';
  receiptPdfName: string;
  warning?: string;
  status: 'comprovante_pronto' | 'aguardando_pix' | 'alerta_expiracao';
}

export interface PixHistoryItem {
  id: string;
  dateTime: string;
  appointmentDate: string;
  clientName: string;
  clientInitial: string;
  procedure: string;
  amount: number;
  amountFormatted: string;
  e2eDoc: string;
  status: 'Confirmado' | 'Estornado (>24h)' | 'Retido (No-Show)';
  statusType: 'success' | 'neutral' | 'error';
  paymentMode?: 'sinal_40' | 'pre_pagamento_100';
}

export interface TimeSlotConfig {
  id: string;
  time: string; // e.g. "09:00"
  status: 'disponivel' | 'bloqueado' | 'autoclave' | 'almoco';
  note?: string;
  active: boolean;
}

export interface DayScheduleConfig {
  dayKey: string; // e.g. "ter", "qua", "qui", "sex", "sab", "dom", "seg"
  dayLabel: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

export interface BlacklistEntry {
  id: string;
  phone: string; // formatted or digits
  clientName: string;
  reason: string;
  addedDate: string;
  active: boolean;
  requires100Percent: boolean;
}

export interface StudioAddressConfig {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  fullAddress: string;
  mapsUrl: string;
  wazeUrl: string;
}
