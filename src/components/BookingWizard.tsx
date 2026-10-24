import React, { useState } from 'react';
import { Service, Appointment, TimeSlotConfig, BlacklistEntry, StudioAddressConfig, PaymentConfig, RecurrenceConfig, DayScheduleConfig } from '../types';
import {
  buildOfficialWhatsAppUrl,
  calculateDeposit40,
  calculateFullPrepayment,
  calculateRemainingBalance,
  formatBRL,
  areDatesEqual
} from '../services/notificationTemplates';
import { triggerNewPreBookingEmailNotification } from '../services/emailNotificationService';

interface BookingWizardProps {
  selectedService: Service;
  onBookingConfirmed: (newApt: Appointment) => void;
  timeSlots?: TimeSlotConfig[];
  blacklist?: BlacklistEntry[];
  studioAddress?: StudioAddressConfig;
  paymentConfig?: PaymentConfig;
  services?: Service[];
  onSelectService?: (service: Service) => void;
  appointments?: Appointment[];
  blockedDates?: string[];
  daySchedules?: DayScheduleConfig[];
}

export const BookingWizard: React.FC<BookingWizardProps> = ({
  selectedService,
  onBookingConfirmed,
  timeSlots = [],
  blacklist = [],
  studioAddress = { street: '', number: '', neighborhood: '', city: '', state: '', fullAddress: '', mapsUrl: '', wazeUrl: '' },
  paymentConfig = { pixKey: '', pixBeneficiary: '', depositAmount: 40 },
  services = [],
  onSelectService,
  appointments = [],
  blockedDates = [],
  daySchedules
}) => {
  // Booking dates must follow the studio's timezone, not the customer's device timezone.
  // This avoids showing yesterday/tomorrow when the customer is outside Brazil.
  const getStudioToday = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const part = (type: string) => parts.find(item => item.type === type)?.value || '';
    return new Date(Number(part('year')), Number(part('month')) - 1, Number(part('day')));
  };
  const today = getStudioToday();
  const toDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const [selectedDate, setSelectedDate] = useState<string>(() => toDateKey(getStudioToday()));
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const studioToday = getStudioToday();
    return new Date(studioToday.getFullYear(), studioToday.getMonth(), 1);
  });
  const [selectedTime, setSelectedTime] = useState<string>('11:30');
  const [additionalServiceIds, setAdditionalServiceIds] = useState<string[]>([]);
  const [showAdditionalServices, setShowAdditionalServices] = useState(false);
  const [customRequest, setCustomRequest] = useState<string>('');
  const [appointmentLocation, setAppointmentLocation] = useState<'salon' | 'home'>('salon');
  const [homeAddress, setHomeAddress] = useState<string>('');
  const [clientName, setClientName] = useState<string>('');
  const [clientPhone, setClientPhone] = useState<string>('');
  const [clientEmail, setClientEmail] = useState<string>('');
  const [clientInstagram, setClientInstagram] = useState<string>('');
  const [nailCondition, setNailCondition] = useState<string>('Unhas naturais sem nenhum produto');
  const [clientNotes, setClientNotes] = useState<string>('');
  const [copiedPix, setCopiedPix] = useState<boolean>(false);
  const [pixCopyError, setPixCopyError] = useState<boolean>(false);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  const [bookingWhatsAppModal, setBookingWhatsAppModal] = useState<boolean>(false);
  const [confirmedAppointment, setConfirmedAppointment] = useState<Appointment | null>(null);
  const [isSubmittingBooking, setIsSubmittingBooking] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [persistedAppointmentId, setPersistedAppointmentId] = useState<string | null>(null);

  // Requirement 5: Agendamento Recorrente
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [recurrenceFreqDays, setRecurrenceFreqDays] = useState<number>(21);
  const [recurrenceTotalSessions, setRecurrenceTotalSessions] = useState<number>(3);

  // Requirement 7: Opção de Pré-pagamento via Pix (Sinal de 40% ou 100%)
  const [paymentMode, setPaymentMode] = useState<'sinal_40' | 'pre_pagamento_100'>('sinal_40');

  // Requirement 6: Checagem de Inadimplência
  const normalizedPhone = clientPhone.replace(/\D/g, '');
  const matchedBlacklist = blacklist.find(b => {
    if (!b.active) return false;
    const bDigits = b.phone.replace(/\D/g, '');
    return bDigits.length >= 8 && (normalizedPhone.includes(bDigits) || bDigits.includes(normalizedPhone));
  });

  const isInadimplente = Boolean(matchedBlacklist);
  const effectivePaymentMode = isInadimplente ? 'pre_pagamento_100' : paymentMode;

  const isAllDayBlock = (value: string) => ['dia inteiro', 'dia todo', 'all day'].includes(String(value || '').trim().toLowerCase());
  const isDateBlocked = (dateStr: string): boolean => {
    if (blockedDates.some(bd => areDatesEqual(bd, dateStr))) return true;
    if (daySchedules && daySchedules.length > 0) {
      const date = new Date(`${dateStr}T12:00:00`);
      const keys = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
      const dayConfig = daySchedules.find(day => day.dayKey === keys[date.getDay()]);
      if (dayConfig && !dayConfig.isOpen) return true;
    }
    return appointments.some(a => a.status === 'bloqueado' && areDatesEqual(a.date, dateStr) && isAllDayBlock(a.time));
  };
  const timeToMinutes = (value: string): number | null => {
    const match = /^(\\d{1,2}):(\\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const hours = Number(match[1]), minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
  };
  const durationMinutes = (value: string): number => {
    const text = String(value || '').toLowerCase();
    const hours = text.match(/(\\d+)\\s*h/);
    const minutes = text.match(/(\\d+)\\s*(?:min|m\\b)/);
    const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
    return total > 0 ? total : 30;
  };
  const isSlotUnavailable = (slotTime: string): boolean => {
    const start = timeToMinutes(slotTime);
    if (start === null) return true;
    const end = start + durationMinutes(selectedService.duration);
    if (daySchedules && daySchedules.length > 0) {
      const date = new Date(`${selectedDate}T12:00:00`);
      const keys = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
      const dayConfig = daySchedules.find(day => day.dayKey === keys[date.getDay()]);
      if (dayConfig) {
        if (!dayConfig.isOpen) return true;
        const opening = timeToMinutes(dayConfig.openTime);
        const closing = timeToMinutes(dayConfig.closeTime);
        if (opening === null || closing === null || start < opening || end > closing) return true;
      }
    }
    return appointments.some(a => {
      if (!areDatesEqual(a.date, selectedDate) || ['cancelado', 'teste_sistema'].includes(a.status)) return false;
      const raw = String(a.time || '').trim();
      if (a.status === 'bloqueado') {
        if (isAllDayBlock(raw)) return true;
        const interval = /^(\\d{1,2}:\\d{2})\\s*(?:às|as|-)\\s*(\\d{1,2}:\\d{2})$/i.exec(raw);
        if (interval) {
          const blockStart = timeToMinutes(interval[1]), blockEnd = timeToMinutes(interval[2]);
          return blockStart !== null && blockEnd !== null && start < blockEnd && blockStart < end;
        }
      }
      const occupiedStart = timeToMinutes(raw);
      if (occupiedStart === null) return false;
      const occupiedEnd = occupiedStart + durationMinutes(a.serviceDuration || '30 min');
      return start < occupiedEnd && occupiedStart < end;
    });
  };

  const dateLabel = (date: Date) => date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const monthLabel = visibleMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const monthOffset = (visibleMonth.getFullYear() - today.getFullYear()) * 12 + visibleMonth.getMonth() - today.getMonth();
  const monthStartOffset = (visibleMonth.getDay() + 6) % 7;
  const daysInVisibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const calendarCells: Array<number | null> = [
    ...Array.from({ length: monthStartOffset }, () => null),
    ...Array.from({ length: daysInVisibleMonth }, (_, index) => index + 1)
  ];
  const isPastDate = (date: Date) => toDateKey(date) < toDateKey(today);
  const isDateUnavailable = (date: Date) => {
    const key = toDateKey(date);
    const sameDayAppointments = appointments.filter(a => areDatesEqual(a.date, key) && !['cancelado', 'teste_sistema'].includes(a.status));
    return isDateBlocked(key) || (sameDayAppointments.length > 0 && sameDayAppointments.every(a => a.status === 'bloqueado' && isAllDayBlock(a.time)));
  };

  // Price calculations (40% deposit or 100% full prepayment of selected procedure's official price)
  const additionalServices = services.filter(service => additionalServiceIds.includes(service.id) && service.id !== selectedService.id);
  const servicePrice = selectedService.price + additionalServices.reduce((sum, service) => sum + service.price, 0);
  const fullPrepayment = calculateFullPrepayment(servicePrice);
  const standardDeposit = calculateDeposit40(servicePrice, paymentConfig.depositAmount);
  const standardBalance = calculateRemainingBalance(servicePrice, standardDeposit);

  const depositValue = effectivePaymentMode === 'pre_pagamento_100'
    ? fullPrepayment
    : standardDeposit;

  const balanceRemaining = effectivePaymentMode === 'pre_pagamento_100'
    ? 0
    : calculateRemainingBalance(servicePrice, depositValue);

  // Recurrence calculated preview dates
  const calculateUpcomingDates = () => {
    const list: string[] = [];
    const baseDay = 14;
    for (let i = 1; i < recurrenceTotalSessions; i++) {
      const addedDays = i * recurrenceFreqDays;
      const futureDateNum = baseDay + addedDays;
      if (futureDateNum <= 30) {
        list.push(`${futureDateNum} de Novembro às ${selectedTime}`);
      } else {
        const decDay = futureDateNum - 30;
        list.push(`${decDay} de Dezembro às ${selectedTime}`);
      }
    }
    return list;
  };

  const handleCopyPix = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText('+5512974062241');
        setCopiedPix(true);
        setPixCopyError(false);
        setTimeout(() => setCopiedPix(false), 3000);
        return;
      }
    } catch {
      // Fallback to execCommand below
    }

    try {
      const textArea = document.createElement('textarea');
      textArea.value = '+5512974062241';
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        setCopiedPix(true);
        setPixCopyError(false);
        setTimeout(() => setCopiedPix(false), 3000);
        return;
      }
    } catch {
      // Error handled below
    }

    setPixCopyError(true);
    setCopiedPix(false);
    setTimeout(() => setPixCopyError(false), 4000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReceiptFileName(file.name);
    }
  };

  const handleConfirmBooking = async () => {
    if (typeof window !== 'undefined' && window.location.hostname.endsWith('github.io')) {
      window.alert('Este é um ambiente de pré-visualização. Os agendamentos ainda não estão ativados.');
      return;
    }
    if (isSubmittingBooking) return;

    if (isDateBlocked(selectedDate)) {
      setSubmissionError(
        'A data selecionada está temporariamente bloqueada para novos agendamentos pela administração. Por favor, escolha outra data.'
      );
      return;
    }

    if (!clientName.trim()) {
      alert('Por favor informe seu nome completo para o agendamento.');
      return;
    }
    if (!clientPhone.trim()) {
      alert('Por favor informe seu telefone WhatsApp para contato.');
      return;
    }
    if (appointmentLocation === 'home' && homeAddress.trim().length < 8) {
      setSubmissionError('Informe o endereço completo para atendimento em domicílio.');
      return;
    }

    setIsSubmittingBooking(true);
    setSubmissionError(null);

    const finalName = clientName.trim();
    const finalPhone = clientPhone.trim();

    const recurrenceConfig: RecurrenceConfig | undefined = isRecurring
      ? {
          frequencyDays: recurrenceFreqDays,
          frequencyLabel:
            recurrenceFreqDays === 15
              ? 'Quinzenal (15 dias)'
              : recurrenceFreqDays === 21
              ? 'A cada 21 dias (Recomendado Fibra)'
              : 'Mensal (30 dias)',
          totalSessions: recurrenceTotalSessions,
          seriesId: `series-${Date.now()}`,
          currentSession: 1,
          upcomingDates: calculateUpcomingDates()
        }
      : undefined;

    // Reutiliza o mesmo ID em tentativas de reenvio para evitar duplicatas
    const appointmentId = persistedAppointmentId || `apt-${Date.now()}`;
    if (!persistedAppointmentId) {
      setPersistedAppointmentId(appointmentId);
    }

    const newAppointment: Appointment = {
      id: appointmentId,
      clientName: finalName,
      clientPhone: finalPhone,
      clientEmail: clientEmail.trim() || undefined,
      clientInstagram: clientInstagram || undefined,
      nailCondition,
      notes: clientNotes || undefined,
      serviceId: selectedService.id,
      additionalServiceIds,
      customRequest: customRequest.trim() || undefined,
      appointmentLocation,
      homeAddress: appointmentLocation === 'home' ? homeAddress.trim() : undefined,
      serviceTitle: [selectedService.title, ...additionalServices.map(service => service.title)].join(' + '),
      servicePrice: `R$ ${formatBRL(servicePrice)}`,
      serviceDuration: selectedService.duration,
      date: selectedDate,
      time: selectedTime,
      status: 'pendente_pix',
      depositAmount: depositValue,
      depositStatus: 'pendente',
      paymentMode: effectivePaymentMode,
      requiresFullPrepayment: isInadimplente,
      isBlacklisted: isInadimplente,
      recurrence: recurrenceConfig,
      receiptFileName: receiptFileName || undefined,
      clientInitials: finalName
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    };

    try {
      const dispatchResult = await triggerNewPreBookingEmailNotification(newAppointment);

      if (dispatchResult.success && dispatchResult.persisted === true) {
        onBookingConfirmed(newAppointment);
        setConfirmedAppointment(newAppointment);
        setSubmissionError(null);
        setBookingWhatsAppModal(true);
      } else {
        setSubmissionError(
          dispatchResult.message || 'Não foi possível confirmar e persistir a reserva na planilha oficial do ateliê. Por favor, tente novamente.'
        );
      }
    } catch (err: any) {
      setSubmissionError(
        err?.message || 'Falha de comunicação ao conectar com o servidor do ateliê. Verifique sua conexão e tente novamente.'
      );
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  return (
    <section className="relative w-full px-4 sm:px-8 lg:px-12 py-16 bg-[#FBF7F2]" id="wizard-agendamento">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
            Reserva em 4 Etapas • Haute Protocol
          </span>
          <h2 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold mt-1">
            Agendamento &amp; Escolha de Horário
          </h2>
          <p className="font-jakarta text-sm text-[#786C63] mt-2 leading-relaxed">
            Selecione seu horário, defina a recorrência de manutenção e envie sua solicitação para atendimento privativo no Pontal da Cruz, São Sebastião - SP.
          </p>
        </div>

        {/* 4-Step Progress Ribbon - Compact & Responsive on Mobile */}
        <div className="mb-8 sm:mb-10 p-3 sm:p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3 p-1.5 rounded-xl bg-[#FDFBF9] sm:bg-transparent border sm:border-0 border-[#E8D9B5]/40">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#D4AF37] text-[#3C2F00] flex items-center justify-center font-bold font-jakarta text-xs shadow-xs shrink-0">
                1
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] sm:text-[10px] font-jakarta text-[#D4AF37] uppercase tracking-wider font-bold">
                  Procedimento
                </span>
                <span className="text-[11px] sm:text-sm font-jakarta text-[#49382E] truncate font-semibold">
                  {selectedService.title}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 p-1.5 rounded-xl bg-[#FDFBF9] sm:bg-transparent border sm:border-0 border-[#E8D9B5]/40">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#F7EFEA] text-[#49382E] flex items-center justify-center font-bold font-jakarta text-xs shrink-0 border border-[#E8D9B5]">
                2
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] sm:text-[10px] font-jakarta text-[#786C63] uppercase tracking-wider font-bold">
                  Data &amp; Hora
                </span>
                <span className="text-[11px] sm:text-sm font-jakarta text-[#49382E] truncate font-semibold">
                  {selectedDate} • {selectedTime}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 p-1.5 rounded-xl bg-[#FDFBF9] sm:bg-transparent border sm:border-0 border-[#E8D9B5]/40">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#F7EFEA] text-[#786C63] flex items-center justify-center font-bold font-jakarta text-xs shrink-0 border border-[#E8D9B5]">
                3
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] sm:text-[10px] font-jakarta text-[#786C63] uppercase tracking-wider font-bold">
                  Recorrência
                </span>
                <span className="text-[11px] sm:text-sm font-jakarta text-[#49382E] truncate font-semibold">
                  {isRecurring ? `${recurrenceFreqDays} em ${recurrenceFreqDays} dias` : 'Sessão Única'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 p-1.5 rounded-xl bg-[#FDFBF9] sm:bg-transparent border sm:border-0 border-[#E8D9B5]/40">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#F7EFEA] text-[#786C63] flex items-center justify-center font-bold font-jakarta text-xs shrink-0 border border-[#E8D9B5]">
                4
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] sm:text-[10px] font-jakarta text-[#786C63] uppercase tracking-wider font-bold">
                  {effectivePaymentMode === 'pre_pagamento_100' ? 'Pix (100%)' : 'Sinal (40%)'}
                </span>
                <span className="text-[11px] sm:text-sm font-jakarta text-[#D4AF37] truncate font-semibold">
                  R$ {formatBRL(depositValue)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Blacklist Delinquent Warning Banner */}
        {isInadimplente && (
          <div className="mb-8 p-4 sm:p-5 rounded-2xl bg-amber-50 border border-amber-300 shadow-md flex items-start gap-4">
            <span className="material-symbols-outlined text-amber-700 text-[28px] shrink-0 mt-0.5">
              gpp_maybe
            </span>
            <div className="flex-1 font-jakarta text-xs leading-relaxed">
              <h4 className="font-syne text-sm sm:text-base font-bold text-amber-900">
                Protocolo Especial de Agendamento Ativado
              </h4>
              <p className="text-amber-800 mt-1">
                Identificamos uma restrição cadastral prévia para o número <strong>{clientPhone}</strong> ({matchedBlacklist?.reason || 'No-show / Pendência'}).
              </p>
              <p className="text-amber-950 mt-1.5 font-semibold">
                Para confirmação deste horário na grade, é exigido o <strong>Pré-pagamento Integral (100% via Pix: R$ {formatBRL(servicePrice)})</strong>.
              </p>
            </div>
          </div>
        )}

        {/* Main 2-Col Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Flow (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Panel 1: Data e Horário */}
            <div className="p-5 sm:p-7 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-md space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#E8D9B5]">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#D4AF37]">calendar_today</span>
                  <h3 className="font-syne text-lg text-[#49382E] font-semibold">
                    1. Escolha a Data
                  </h3>
                </div>
                <span className="font-jakarta text-[11px] text-[#786C63]">
                  Atendimento Terça a Sábado
                </span>
              </div>

              {/* Dynamic calendar: today through four months ahead */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <button type="button" aria-label="Mês anterior" disabled={monthOffset <= 0}
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))}
                    className="rounded-lg border border-[#E8D9B5] px-3 py-2 disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
                  <h4 className="font-syne font-semibold capitalize text-[#49382E]">{monthLabel}</h4>
                  <button type="button" aria-label="Próximo mês" disabled={monthOffset >= 4}
                    onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))}
                    className="rounded-lg border border-[#E8D9B5] px-3 py-2 disabled:opacity-30 disabled:cursor-not-allowed">›</button>
                </div>
                <div className="grid grid-cols-7 gap-1.5 text-center">
                  {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(day => (
                    <span key={day} className="py-1 text-[10px] font-semibold text-[#786C63]">{day}</span>
                  ))}
                  {calendarCells.map((day, index) => {
                    if (day === null) return <span key={`blank-${index}`} />;
                    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
                    const key = toDateKey(date);
                    const past = isPastDate(date);
                    const unavailable = isDateUnavailable(date);
                    const selected = selectedDate === key;
                    const disabled = past || unavailable;
                    return (
                      <button key={key} type="button" disabled={disabled}
                        aria-label={dateLabel(date)} aria-pressed={selected}
                        onClick={() => setSelectedDate(key)}
                        className={`min-h-10 rounded-lg border text-xs font-semibold transition-colors ${disabled ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : selected ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37]' : 'bg-[#FDFBF9] text-[#49382E] border-[#E8D9B5] hover:border-[#D4AF37]'}`}>
                        {day}
                      </button>
                    );
                  })}
                </div>
                <p className="font-jakarta text-[11px] text-[#786C63]">Selecione uma data disponível. A agenda mostra o mês atual e até quatro meses à frente.</p>
              </div>

              {/* Time Slots Section */}
              <div className="pt-3 border-t border-[#E8D9B5] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-jakarta text-xs text-[#786C63] font-medium">
                    Horários Disponíveis para {selectedDate}:
                  </span>
                  <span className="font-jakarta text-[10px] text-[#D4AF37] font-semibold">
                    {isDateBlocked(selectedDate)
                      ? '0 horários abertos (Data Bloqueada)'
                      : `${timeSlots.filter(s => s.status === 'disponivel' && s.active).length} horários abertos`}
                  </span>
                </div>

                {isDateBlocked(selectedDate) ? (
                  <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-center space-y-1">
                    <div className="flex items-center justify-center gap-1.5 text-red-700 font-syne text-xs sm:text-sm font-bold">
                      <span className="material-symbols-outlined text-[18px]">event_busy</span>
                      <span>Esta data está temporariamente bloqueada para atendimentos</span>
                    </div>
                    <p className="font-jakarta text-[11px] text-red-600">
                      Por favor, selecione outra data disponível no calendário acima para prosseguir com seu agendamento.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-2.5">
                    {timeSlots.filter(s => s.active).map(slot => {
                      const isBlocked = slot.status === 'bloqueado' || slot.status === 'autoclave' || slot.status === 'almoco' || isSlotUnavailable(slot.time);
                      const isSelected = selectedTime === slot.time && !isBlocked;

                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={isBlocked}
                          onClick={() => setSelectedTime(slot.time)}
                          className={`p-2 sm:p-2.5 rounded-xl border text-center transition-all min-h-[48px] flex flex-col items-center justify-center active:scale-95 ${
                            isBlocked
                              ? 'bg-[#F7EFEA] border-rose-200 text-[#786C63]/50 cursor-not-allowed'
                              : isSelected
                              ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37] font-bold shadow-xs cursor-pointer'
                              : 'bg-[#FDFBF9] border-[#E8D9B5] text-[#49382E] hover:border-[#D4AF37]/50 cursor-pointer'
                          }`}
                          title={slot.note || (isBlocked ? 'Horário Bloqueado' : 'Horário Disponível')}
                        >
                          <span className="font-syne text-sm font-bold block">{slot.time}</span>
                          <span className="text-[10px] block font-jakarta truncate max-w-full px-1">
                            {isBlocked ? (slot.note?.slice(0, 10) || 'Bloqueado') : 'Disponível'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Panel 2: Agendamento Recorrente */}
            <div className="p-5 sm:p-7 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-md space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">
                    event_repeat
                  </span>
                  <div>
                    <h3 className="font-syne text-lg text-[#49382E] font-semibold">
                      Agendamento Recorrente
                    </h3>
                    <p className="font-jakarta text-xs text-[#786C63]">
                      Garanta antecipadamente seus horários de manutenção preventiva de fibra/gel
                    </p>
                  </div>
                </div>

                {/* Toggle Switch */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={e => setIsRecurring(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-[#E8D9B5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#D4AF37]"></div>
                </label>
              </div>

              {isRecurring && (
                <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-4 font-jakarta text-xs animate-fadeIn">
                  <div>
                    <label className="block text-[11px] text-[#49382E] uppercase tracking-wider font-bold mb-2">
                      Intervalo entre Sessões:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { days: 15, label: 'Quinzenal (15 dias)', note: 'Esmaltação & Spa' },
                        { days: 21, label: 'A cada 21 dias', note: 'Ideal Fibra Slim' },
                        { days: 30, label: 'Mensal (30 dias)', note: 'Blindagem Diamante' }
                      ].map(freq => (
                        <button
                          key={freq.days}
                          type="button"
                          onClick={() => setRecurrenceFreqDays(freq.days)}
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            recurrenceFreqDays === freq.days
                              ? 'bg-[#FFFFFF] border-[#D4AF37] text-[#49382E] font-bold shadow-xs ring-1 ring-[#D4AF37]'
                              : 'bg-[#F7EFEA] border-[#E8D9B5] text-[#786C63] hover:border-[#D4AF37]/40'
                          }`}
                        >
                          <span className="block text-[#49382E] font-semibold">{freq.label}</span>
                          <span className="text-[10px] text-[#786C63] block">{freq.note}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] text-[#49382E] uppercase tracking-wider font-bold mb-2">
                      Quantidade de Manutenções no Ciclo:
                    </label>
                    <div className="flex gap-2">
                      {[2, 3, 4, 6].map(num => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setRecurrenceTotalSessions(num)}
                          className={`flex-1 py-2 rounded-lg border text-center font-bold cursor-pointer transition-all ${
                            recurrenceTotalSessions === num
                              ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37]'
                              : 'bg-[#F7EFEA] border-[#E8D9B5] text-[#49382E] hover:border-[#D4AF37]/40'
                          }`}
                        >
                          {num} Sessões
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Calculated Upcoming Dates Preview */}
                  <div className="p-3 rounded-lg bg-[#F7EFEA] border border-[#E8D9B5] space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-[#49382E] font-bold block">
                      Previsão de Datas do seu Ciclo:
                    </span>
                    <ul className="space-y-1 text-[#786C63] text-[11px]">
                      <li className="text-[#49382E] font-semibold">
                        • 1ª Sessão: {selectedDate} às {selectedTime} (Agendamento Imediato)
                      </li>
                      {calculateUpcomingDates().map((dt, i) => (
                        <li key={i}>• {i + 2}ª Sessão prevista: {dt}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Panel 3: Dados da Cliente */}
            <div className="p-5 sm:p-7 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-md space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5]">
                <span className="material-symbols-outlined text-[#D4AF37]">person</span>
                <h3 className="font-syne text-lg text-[#49382E] font-semibold">
                  3. Dados Pessoais &amp; Anamnese
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-jakarta text-xs">
                <div>
                  <label className="block text-[#49382E] font-medium mb-1 text-xs">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Vanessa Lima"
                    value={clientName}
                    onChange={e => setClientName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-[#49382E] font-medium mb-1 text-xs">WhatsApp com DDD *</label>
                  <input
                    type="tel"
                    required
                    placeholder="Ex: (12) 99123-4567"
                    value={clientPhone}
                    onChange={e => setClientPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-[#49382E] font-medium mb-1 text-xs">E-mail (para confirmação via Gmail)</label>
                  <input
                    type="email"
                    placeholder="seu.email@exemplo.com"
                    value={clientEmail}
                    onChange={e => setClientEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-[#49382E] font-medium mb-1 text-xs">Instagram (opcional)</label>
                  <input
                    type="text"
                    placeholder="@seu.perfil"
                    value={clientInstagram}
                    onChange={e => setClientInstagram(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
                  />
                </div>

                <div>
                  <label className="block text-[#49382E] font-medium mb-1 text-xs">Condição Atual das Unhas</label>
                  <select
                    value={nailCondition}
                    onChange={e => setNailCondition(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
                  >
                    <option value="Unhas naturais sem nenhum produto">Unhas naturais sem produto</option>
                    <option value="Alongamento de outro profissional (requer remoção)">Alongamento de outro espaço</option>
                    <option value="Unhas roídas ou muito curtas">Unhas roídas ou muito curtas</option>
                    <option value="Unhas com gel / blindagem atual">Unhas com gel / blindagem atual</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[#49382E] font-medium mb-1 text-xs">Observações ou Preferências de Nail Art</label>
                  <textarea
                    rows={2}
                    placeholder="Alguma alergia a esmaltes, formato preferido (Almond, Bailarina, Quadrada) ou referência de foto..."
                    value={clientNotes}
                    onChange={e => setClientNotes(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[70px]"
                  />
                </div>
              </div>
            </div>

            {/* Panel 4: Escolha de Pagamento Pix (Sinal vs Pré-pagamento Total) */}
            <div className="p-5 sm:p-7 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-md relative overflow-hidden">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[26px]">
                    payments
                  </span>
                  <div>
                    <h3 className="font-syne text-lg sm:text-xl text-[#49382E] font-semibold">
                      Opções de Pré-pagamento via Pix
                    </h3>
                    <p className="font-jakarta text-xs text-[#786C63]">
                      Escolha como deseja garantir sua vaga no Espaço privativo
                    </p>
                  </div>
                </div>

                <span className="px-3 py-1 rounded-full bg-[#FBF2D5] text-[#3C2F00] font-jakarta text-xs font-bold shrink-0 border border-[#E8D9B5]">
                  Pix Banco Central
                </span>
              </div>

              {/* Payment Mode Selector Tabs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5 font-jakarta text-xs">
                {/* Option A: Sinal Padrão (40%) */}
                <button
                  type="button"
                  disabled={isInadimplente}
                  onClick={() => setPaymentMode('sinal_40')}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    effectivePaymentMode === 'sinal_40'
                      ? 'bg-[#FDFBF9] border-[#D4AF37] shadow-xs ring-1 ring-[#D4AF37]'
                      : isInadimplente
                      ? 'bg-[#F7EFEA] border-[#E8D9B5]/40 opacity-30 cursor-not-allowed'
                      : 'bg-[#FFFFFF] border-[#E8D9B5] hover:border-[#D4AF37]/40 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-syne text-sm font-bold text-[#49382E]">Sinal (40%)</span>
                    <span className="font-bold text-[#D4AF37] text-base">R$ {formatBRL(standardDeposit)}</span>
                  </div>
                  <p className="text-[#786C63] leading-relaxed">
                    Garante a vaga e é descontado do valor total no dia do atendimento. Saldo restante: <strong>R$ {formatBRL(standardBalance)}</strong>.
                  </p>
                  {isInadimplente && (
                    <span className="text-[10px] text-red-500 font-bold block mt-1">
                      Indisponível para números com restrição
                    </span>
                  )}
                </button>

                {/* Option B: Pré-pagamento Total 100% Pix */}
                <button
                  type="button"
                  onClick={() => setPaymentMode('pre_pagamento_100')}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    effectivePaymentMode === 'pre_pagamento_100'
                      ? 'bg-[#FDFBF9] border-[#D4AF37] shadow-xs ring-1 ring-[#D4AF37]'
                      : 'bg-[#FFFFFF] border-[#E8D9B5] hover:border-[#D4AF37]/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-syne text-sm font-bold text-[#49382E]">Pré-pagamento Total (100%)</span>
                    <span className="font-bold text-[#D4AF37] text-base">
                      R$ {formatBRL(fullPrepayment)}
                    </span>
                  </div>
                  <p className="text-[#786C63] leading-relaxed">
                    Procedimento quitado com prioridade VIP. Chegue ao Espaço sem preocupações financeiras adicionais ao final.
                  </p>
                </button>
              </div>

              {/* Pix Details Box */}
              <div className="p-4 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-[#FFFFFF] flex items-center justify-center text-[#D4AF37] border border-[#E8D9B5] shrink-0 shadow-xs">
                      <span className="material-symbols-outlined text-[26px] sm:text-[30px]">qr_code_2</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <span className="block font-jakarta text-[11px] text-[#786C63]">
                        Chave Pix Oficial (Telefone Celular)
                      </span>
                      <span className="font-mono text-[#49382E] font-bold text-base sm:text-lg select-all tracking-wider break-all">
                        +5512974062241
                      </span>
                      <span className="block font-jakarta text-[11px] text-[#786C63]">
                        (12) 97406-2241
                      </span>
                      <span className="block font-jakarta text-xs text-[#D4AF37] font-semibold truncate">
                        Favorecido: Angelica do Carmo E. Silva ME
                      </span>
                      <span className="block font-jakarta text-[11px] text-[#786C63] mt-0.5">
                        Valor a Transferir: <strong className="text-[#49382E] text-sm">R$ {formatBRL(depositValue)}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={handleCopyPix}
                      className={`w-full sm:w-auto px-5 py-2.5 sm:py-3 rounded-full font-jakarta text-xs sm:text-[13px] font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs min-h-[46px] active:scale-95 ${
                        copiedPix
                          ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400'
                          : pixCopyError
                          ? 'bg-rose-600 text-white shadow-md ring-2 ring-rose-400'
                          : 'bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {copiedPix ? 'check_circle' : pixCopyError ? 'error' : 'content_copy'}
                      </span>
                      <span>
                        {copiedPix
                          ? 'Chave Copiada com Sucesso!'
                          : pixCopyError
                          ? 'Erro ao copiar - Selecione acima'
                          : 'Copiar Chave Pix'}
                      </span>
                    </button>

                    <label className={`w-full sm:w-auto px-4 py-2.5 sm:py-3 rounded-full border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer min-h-[46px] active:scale-95 ${
                      receiptFileName
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-[#FFFFFF] text-[#49382E] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                    }`}>
                      <span className="material-symbols-outlined text-[18px] text-[#D4AF37]">
                        {receiptFileName ? 'check_circle' : 'attach_file'}
                      </span>
                      <span className="truncate max-w-[150px]">
                        {receiptFileName ? receiptFileName : 'Selecionar Comprovante'}
                      </span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-[#FFFFFF] border border-[#E8D9B5] text-[11px] text-[#786C63] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[16px] shrink-0">info</span>
                  <span>
                    O pagamento é conferido manualmente pela profissional no extrato bancário. Ao abrir o WhatsApp, você também pode compartilhar a imagem do comprovante.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Summary Sticky Card (5 cols) */}
          <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-28">
            <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xl relative overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-[#E8D9B5]">
                <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
                  Resumo da Solicitação
                </span>
                <span className="font-jakarta text-[11px] text-[#786C63]">
                  Pontal da Cruz, SP
                </span>
              </div>

              {/* Selected Service Card */}
              <div className="py-4 border-b border-[#E8D9B5] space-y-2.5">
                <div className="flex items-center gap-3.5">
                  <img
                    src={selectedService.imageUrl}
                    alt={selectedService.title}
                    className="w-16 h-16 rounded-xl object-cover border border-[#E8D9B5] shadow-xs shrink-0"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-syne text-base font-bold text-[#49382E] truncate">
                      {selectedService.title}
                    </span>
                    <span className="font-jakarta text-xs text-[#786C63]">
                      Duração estimada: {selectedService.duration}
                    </span>
                    <span className="font-jakarta text-xs text-[#49382E] font-bold mt-0.5">
                      {selectedService.priceFormatted}
                    </span>
                  </div>
                </div>

                {services.length > 1 && onSelectService && (
                  <div className="pt-1">
                    <label className="text-[10px] text-[#786C63] block mb-1">Trocar procedimento:</label>
                    <select
                      value={selectedService.id}
                      onChange={e => {
                        const match = services.find(s => s.id === e.target.value);
                        if (match) { onSelectService(match); setAdditionalServiceIds([]); setShowAdditionalServices(false); }
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-[#FDFBF9] text-base sm:text-xs text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] min-h-[44px]"
                    >
                      {services.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.title} ({s.priceFormatted})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="py-4 border-b border-[#E8D9B5] space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-syne font-semibold text-sm text-[#49382E]">Serviços adicionais</h4>
                  <button type="button" onClick={() => setShowAdditionalServices(true)} className="rounded-full border border-[#D4AF37] px-3 py-2 text-xs font-bold text-[#49382E]">
                    {additionalServiceIds.length ? `Revisar (${additionalServiceIds.length})` : 'Ver opções'}
                  </button>
                </div>
                <p className="text-[10px] text-[#786C63]">Complementos relevantes para o procedimento principal. Preços atuais mantidos.</p>
                {additionalServices.map(service => <div key={service.id} className="flex justify-between gap-2 text-xs"><span>{service.title}</span><span className="font-semibold">{service.priceFormatted}</span></div>)}
                {showAdditionalServices && <div className="fixed inset-0 z-[70] bg-[#49382E]/50 backdrop-blur-sm flex items-center justify-center p-4">
                  <div role="dialog" aria-modal="true" aria-label="Serviços adicionais" className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-white border border-[#E8D9B5] p-5 shadow-2xl">
                    <div className="flex items-center justify-between gap-3 mb-3"><h4 className="font-bold text-sm text-[#49382E]">Complementos para {selectedService.title}</h4><button type="button" onClick={() => setShowAdditionalServices(false)} className="rounded-full border border-[#E8D9B5] px-3 py-2">Fechar</button></div>
                    <p className="text-xs text-[#786C63] mb-3">Os valores são os já cadastrados. Pedidos personalizados sem preço cadastrado não alteram o total automaticamente.</p>
                    {services.filter(service => service.id !== selectedService.id && service.category === 'nailart' && ['alongamento', 'blindagem'].includes(selectedService.category)).map(service => <label key={service.id} className="flex items-start gap-2 py-3 border-b border-[#E8D9B5] text-xs"><input type="checkbox" checked={additionalServiceIds.includes(service.id)} onChange={event => setAdditionalServiceIds(current => event.target.checked ? Array.from(new Set([...current, service.id])) : current.filter(id => id !== service.id))} className="accent-[#D4AF37]" /><span className="flex-1"><span className="block font-semibold">{service.title}</span><span className="block text-[#786C63]">{service.description}</span></span><span className="font-semibold whitespace-nowrap">{service.priceFormatted}</span></label>)}
                    {!(['alongamento', 'blindagem'].includes(selectedService.category)) && <p className="text-xs text-[#786C63] py-3">Não há complementos cadastrados para este procedimento. Registre pedidos especiais abaixo, sem alterar o preço automaticamente.</p>}
                    <button type="button" onClick={() => setShowAdditionalServices(false)} className="mt-4 w-full rounded-full bg-[#D4AF37] px-4 py-3 font-bold text-[#49382E]">Confirmar seleção</button>
                  </div>
                </div>}
                <label className="block text-xs font-semibold text-[#49382E]">Pedido personalizado (opcional)
                  <textarea value={customRequest} onChange={event => setCustomRequest(event.target.value)}
                    placeholder="Ex.: decoração especial de unhas (preço sujeito à confirmação)"
                    rows={2} className="mt-1 w-full rounded-lg border border-[#E8D9B5] bg-[#FDFBF9] p-2 text-xs" />
                </label>
                <p className="text-[10px] text-[#786C63]">Pedidos personalizados sem preço cadastrado precisam de confirmação e não alteram o total automaticamente.</p>
                <h4 className="font-syne font-semibold text-sm text-[#49382E] pt-1">Local do atendimento</h4>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-2"><input type="radio" name="appointmentLocation" checked={appointmentLocation === 'salon'} onChange={() => setAppointmentLocation('salon')} /> No Espaço</label>
                  <label className="flex items-center gap-2"><input type="radio" name="appointmentLocation" checked={appointmentLocation === 'home'} onChange={() => setAppointmentLocation('home')} /> Em domicílio</label>
                </div>
                {appointmentLocation === 'home' && (
                  <label className="block text-xs font-semibold text-[#49382E]">Endereço completo *
                    <textarea required value={homeAddress} onChange={event => setHomeAddress(event.target.value)}
                      placeholder="Rua, número, bairro, cidade e referência" rows={2}
                      className="mt-1 w-full rounded-lg border border-[#E8D9B5] bg-[#FDFBF9] p-2 text-xs" />
                  </label>
                )}
              </div>

              {/* Booking Specifications */}
              <div className="py-4 space-y-2.5 font-jakarta text-xs">
                <div className="flex justify-between text-[#786C63]">
                  <span>Data Selecionada:</span>
                  <span className="text-[#49382E] font-medium">{selectedDate}</span>
                </div>

                <div className="flex justify-between text-[#786C63]">
                  <span>Horário Selecionado:</span>
                  <span className="text-[#49382E] font-medium">{selectedTime}</span>
                </div>

                {isRecurring && (
                  <div className="p-2.5 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] space-y-1">
                    <div className="flex items-center justify-between text-[#49382E] font-bold">
                      <span>Agendamento Recorrente:</span>
                      <span>{recurrenceTotalSessions} sessões</span>
                    </div>
                    <span className="text-[#786C63] text-[11px] block">
                      Intervalo: a cada {recurrenceFreqDays} dias
                    </span>
                  </div>
                )}

                {/* Price Breakdown */}
                <div className="pt-2 border-t border-[#E8D9B5] space-y-2 text-xs">
                  <div className="flex justify-between text-[#786C63]">
                    <span>Total do procedimento</span>
                    <span className="text-[#49382E] font-semibold">R$ {formatBRL(servicePrice)}</span>
                  </div>

                  {effectivePaymentMode === 'pre_pagamento_100' ? (
                    <>
                      <div className="flex justify-between text-[#786C63]">
                        <span>Sinal (40%)</span>
                        <span className="text-[#49382E] font-medium">R$ {formatBRL(standardDeposit)}</span>
                      </div>
                      <div className="flex justify-between text-[#D4AF37] font-bold">
                        <span>Valor via Pix Antecipado (100%)</span>
                        <span>R$ {formatBRL(depositValue)}</span>
                      </div>
                      <div className="pt-2 flex justify-between font-syne text-sm sm:text-base text-[#49382E] font-bold border-t border-[#E8D9B5]">
                        <span>Saldo restante a pagar no atendimento</span>
                        <span className="text-emerald-700">R$ 0,00</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-[#D4AF37]">
                        <span className="font-semibold">Sinal (40%)</span>
                        <span className="font-bold">R$ {formatBRL(depositValue)}</span>
                      </div>
                      <div className="pt-2 flex justify-between font-syne text-sm sm:text-base text-[#49382E] font-bold border-t border-[#E8D9B5]">
                        <span>Saldo restante a pagar no atendimento</span>
                        <span className="text-[#D4AF37]">R$ {formatBRL(balanceRemaining)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Appointment Policy Displayed Before Submission */}
                <div className="mt-4 p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-2 text-[11px] text-[#786C63] leading-relaxed">
                  <div className="flex items-center gap-1.5 text-[#49382E] font-syne font-bold text-xs uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[#D4AF37] text-[16px]">policy</span>
                    <span>POLÍTICA DE AGENDAMENTO</span>
                  </div>
                  <ul className="space-y-1.5 list-disc pl-4">
                    <li>
                      Para confirmar o horário, é necessário pagar um sinal de 40% do valor do procedimento.
                    </li>
                    <li>
                      O sinal garante a vaga e é descontado do valor total no dia do atendimento.
                    </li>
                    <li>
                      Em caso de desistência ou não comparecimento, o sinal não é reembolsado, pois cobre o bloqueio da vaga e os preparativos.
                    </li>
                    <li>
                      Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago.
                    </li>
                  </ul>
                </div>
              </div>

              {/* CTA Final Booking */}
              <div className="mt-4 space-y-2">
                {submissionError && (
                  <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs text-left space-y-2.5 shadow-sm">
                    <div className="flex items-center gap-1.5 font-bold text-rose-800">
                      <span className="material-symbols-outlined text-[18px]">error</span>
                      <span>Não foi possível registrar seu agendamento</span>
                    </div>
                    <p className="leading-relaxed text-[11px] text-rose-800">
                      {submissionError}
                    </p>
                    <button
                      type="button"
                      disabled={isSubmittingBooking}
                      onClick={handleConfirmBooking}
                      className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-jakarta text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[16px]">refresh</span>
                      <span>{isSubmittingBooking ? 'Tentando novamente...' : 'Tentar Novamente'}</span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={isSubmittingBooking}
                  onClick={handleConfirmBooking}
                  className={`w-full py-3.5 sm:py-4 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-sm sm:text-base font-bold transition-all duration-300 shadow-[0_12px_32px_-4px_rgba(212,175,55,0.35)] flex items-center justify-center gap-2 min-h-[50px] ${
                    isSubmittingBooking ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer active:scale-98'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">check_circle</span>
                  <span>{isSubmittingBooking ? 'Registrando agendamento...' : 'Confirmar & Salvar Agendamento'}</span>
                </button>
                <p className="text-center font-jakarta text-[11px] text-[#786C63] leading-tight">
                  O agendamento será salvo automaticamente no sistema e encaminhado para validação do Pix pela Angélica.
                </p>
              </div>
            </div>

            {/* Atelier Address Card */}
            <div className="p-4 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] flex items-start gap-3 shadow-xs">
              <span className="material-symbols-outlined text-[#D4AF37] text-[22px] shrink-0 mt-0.5">
                location_on
              </span>
              <div className="font-jakarta text-[11px] text-[#786C63] leading-snug">
                <span className="text-[#49382E] font-bold block mb-0.5">Espaço Angelica do Carmo</span>
                <span>{studioAddress.fullAddress}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Booking Success Modal */}
      {bookingWhatsAppModal && (
        <div className="fixed inset-0 z-50 bg-[#49382E]/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-md w-full border border-[#E8D9B5] shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center border border-emerald-300">
              <span className="material-symbols-outlined text-[36px]">check_circle</span>
            </div>

            <div>
              <h3 className="font-syne text-2xl text-[#49382E] font-bold">Pré-Agendamento Registrado!</h3>
              <p className="font-jakarta text-xs sm:text-sm text-[#786C63] mt-1.5 leading-relaxed">
                Sua solicitação para <strong>{selectedDate} às {selectedTime}</strong> ({selectedService.title}) foi salva no sistema.
              </p>
            </div>

            <div className="py-2.5 px-3.5 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] text-xs text-[#49382E] text-left space-y-1">
              <div className="font-bold flex items-center justify-between">
                <span>Status: Pendente de Conferência</span>
                <span className="text-[#D4AF37]">
                  {(confirmedAppointment?.paymentMode || effectivePaymentMode) === 'pre_pagamento_100'
                    ? 'Pré-pagamento (100%)'
                    : 'Sinal (40%)'}
                  : R$ {formatBRL(depositValue)}
                </span>
              </div>
              <div className="text-[11px] text-[#786C63] flex items-center justify-between">
                <span>Total: R$ {formatBRL(servicePrice)}</span>
                <span>Saldo no dia: R$ {formatBRL(balanceRemaining)}</span>
              </div>
              <div className="text-[11px] text-[#786C63] pt-0.5">
                Chave PIX: <strong>12974062241</strong> • Titular: <strong>Angelica do Carmo Costa Santos</strong>
              </div>
            </div>

            <p className="font-jakarta text-[11px] text-[#786C63] text-left leading-relaxed">
              Obrigada, <strong>{clientName}</strong>! Seu horário está reservado mediante{' '}
              {(confirmedAppointment?.paymentMode || effectivePaymentMode) === 'pre_pagamento_100'
                ? 'o pré-pagamento integral'
                : 'o sinal de 40%'}
              . Envie seu comprovante para que possamos confirmar seu atendimento.
            </p>

            {/* Optional WhatsApp Button or Safe Test Indicator */}
            {Boolean(
              confirmedAppointment?.status === 'teste_sistema' ||
              (confirmedAppointment?.id && confirmedAppointment.id.startsWith('test-')) ||
              (confirmedAppointment?.clientName && confirmedAppointment.clientName.toLowerCase().includes('teste_sistema')) ||
              (clientName && clientName.toLowerCase().includes('teste_sistema'))
            ) ? (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-amber-800">
                  <span className="material-symbols-outlined text-[18px]">security</span>
                  <span>Modo Teste de Sistema Ativo</span>
                </div>
                <p className="text-[11px] text-amber-700 font-normal">
                  Disparo de WhatsApp para cliente e notificações para a titular estão desativados neste teste seguro.
                </p>
              </div>
            ) : (
              <div className="pt-2 space-y-2">
                <a
                  href={buildOfficialWhatsAppUrl({
                    clientName: confirmedAppointment?.clientName || clientName,
                    serviceTitle: confirmedAppointment?.serviceTitle || selectedService.title,
                    servicePrice: confirmedAppointment?.servicePrice || selectedService.priceFormatted,
                    date: confirmedAppointment?.date || selectedDate,
                    time: confirmedAppointment?.time || selectedTime,
                    depositAmount: confirmedAppointment?.depositAmount || depositValue,
                    remainingBalance: balanceRemaining,
                    paymentMode: confirmedAppointment?.paymentMode || effectivePaymentMode,
                    pixKey: paymentConfig.pixKey,
                    pixBeneficiary: paymentConfig.pixBeneficiary,
                    depositPercent: paymentConfig.depositAmount
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 px-4 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-jakarta text-xs sm:text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-95 min-h-[46px]"
                >
                  <span className="material-symbols-outlined text-[20px]">chat</span>
                  <span>Enviar mensagem pelo WhatsApp</span>
                </a>

                <p className="text-[10px] text-[#786C63] text-center leading-tight">
                  Abre o WhatsApp com a mensagem oficial e política do Espaço pronta para você revisar e enviar.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setBookingWhatsAppModal(false);
                setIsSubmittingBooking(false);
              }}
              className="w-full py-2.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D9B5] text-[#49382E] font-jakarta text-xs font-semibold transition-all cursor-pointer border border-[#E8D9B5]"
            >
              Continuar Navegando no Site
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
