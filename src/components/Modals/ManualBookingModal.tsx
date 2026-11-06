import React, { useState, useMemo } from 'react';
import { Appointment, Service, BlacklistEntry, PaymentConfig, RecurrenceConfig, ClientProfile, DayScheduleConfig } from '../../types';
import { sendAppointmentWhatsAppConfirmation } from '../../services/whatsappService';
import { calculateDeposit40, calculateFullPrepayment, formatBRL } from '../../services/notificationTemplates';
import { fetchPublicAvailability, submitManualBooking } from '../../services/emailNotificationService';
import { calculateRecurrenceDates, validateRecurringOccurrences } from '../../services/recurrenceService';
import {
  parseDurationMinutes,
  calculateProcedureDuration,
  calculateEndTime,
  OFFICIAL_DURATION_MISSING_ERROR
} from '../../services/durationService';

interface ManualBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAppointment: (apt: Appointment) => void;
  services?: Service[];
  blacklist?: BlacklistEntry[];
  adminSessionToken?: string;
  paymentConfig?: PaymentConfig;
  clients?: ClientProfile[];
  appointments?: Appointment[];
  blockedDates?: string[];
  daySchedules?: DayScheduleConfig[];
}

export const ManualBookingModal: React.FC<ManualBookingModalProps> = ({
  isOpen,
  onClose,
  onSaveAppointment,
  services = [],
  blacklist = [],
  adminSessionToken,
  paymentConfig = { pixKey: '', pixBeneficiary: '', depositAmount: 40 },
  clients = [],
  appointments = [],
  blockedDates = [],
  daySchedules = []
}) => {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientBirthDate, setClientBirthDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'debito' | 'credito' | 'pix' | 'permuta' | 'pacote_mensal' | 'outro'>('pix');
  const [selectedServiceId, setSelectedServiceId] = useState(services[0]?.id || '');
  const [additionalServiceIds, setAdditionalServiceIds] = useState<string[]>([]);
  const [showAdditionalServices, setShowAdditionalServices] = useState(false);
  const [customRequest, setCustomRequest] = useState('');
  const [appointmentLocation, setAppointmentLocation] = useState<'salon' | 'home'>('salon');
  const [homeAddress, setHomeAddress] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  const [time, setTime] = useState('14:30');
  const [paymentMode, setPaymentMode] = useState<'sinal_40' | 'pre_pagamento_100'>('sinal_40');
  const [depositStatus, setDepositStatus] = useState<'liquidado' | 'pendente'>('liquidado');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [totalSessions, setTotalSessions] = useState(4);
  const [notes, setNotes] = useState('');
  const [sendWhatsAppAuto, setSendWhatsAppAuto] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [persistedAppointmentId, setPersistedAppointmentId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isNameFocused, setIsNameFocused] = useState(false);

  const trimmedInput = clientName.trim();
  const searchDigits = trimmedInput.replace(/\D/g, '');
  const searchLower = trimmedInput.toLowerCase();
  const matchingClients = searchLower.length >= 1
    ? (clients || []).filter(c => {
        const nameMatch = c.name.toLowerCase().includes(searchLower);
        const phoneMatch = searchDigits.length >= 2 && c.phone.replace(/\D/g, '').includes(searchDigits);
        return nameMatch || phoneMatch;
      })
    : [];

  const handleSelectClient = (c: ClientProfile) => {
    setClientName(c.name);
    setClientPhone(c.phone);
    if (c.email) setClientEmail(c.email);
    if (c.birthDate) setClientBirthDate(c.birthDate);
    setShowSuggestions(false);
  };

  if (!isOpen) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  };

  // Check if client phone is in blacklist
  const normalized = clientPhone.replace(/\D/g, '');
  const matchedBlacklist = blacklist.find(b => {
    if (!b.active) return false;
    const bDigits = b.phone.replace(/\D/g, '');
    return bDigits.length >= 8 && (normalized.includes(bDigits) || bDigits.includes(normalized));
  });

  const isInadimplente = Boolean(matchedBlacklist);
  const effectivePaymentMode = isInadimplente ? 'pre_pagamento_100' : paymentMode;

  const serv = services.find(s => s.id === selectedServiceId) || services[0];
  if (!serv) return null;
  const additionalServices = services.filter(service => additionalServiceIds.includes(service.id) && service.id !== serv.id);
  const procedureDuration = calculateProcedureDuration(serv, additionalServices);
  const totalPrice = serv.price + additionalServices.reduce((sum, service) => sum + service.price, 0);
  const standardDeposit = calculateDeposit40(totalPrice, paymentConfig.depositAmount);
  const fullPrepayment = calculateFullPrepayment(totalPrice);

  const recurrenceValidation = useMemo(() => {
    if (!isRecurring) return null;
    const durationMinutes = procedureDuration?.totalMinutes || 45;

    return validateRecurringOccurrences({
      baseDate: date.trim(),
      time: time.trim(),
      durationMinutes,
      frequencyOrType: recurrenceInterval,
      totalSessions,
      daySchedules,
      blockedDates: currentBlockedDates,
      appointments: currentAppointments,
      options: {
        clientName: clientName.trim(),
        serviceTitle: serv?.title
      }
    });
  }, [isRecurring, date, time, procedureDuration, recurrenceInterval, totalSessions, daySchedules, blockedDates, appointments, clientName, serv]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // GitHub Pages uses the official Google Apps Script backend. Do not block
    // manual bookings by hostname; submitManualBooking must confirm persisted=true.
    setSubmitError(null);

    const trimmedName = clientName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setSubmitError('Por favor, informe o nome completo da cliente (mínimo de 2 caracteres).');
      return;
    }

    const trimmedPhone = clientPhone.trim();
    const phoneDigits = trimmedPhone.replace(/\D/g, '');
    if (!trimmedPhone || phoneDigits.length < 8) {
      setSubmitError('Por favor, informe o WhatsApp da cliente com DDD.');
      return;
    }

    if (!clientBirthDate.trim()) {
      setSubmitError('A data de nascimento da cliente é obrigatória.');
      return;
    }

    if (!date.trim() || !time.trim()) {
      setSubmitError('Por favor, informe a data e o horário do atendimento.');
      return;
    }
    if (appointmentLocation === 'home' && homeAddress.trim().length < 8) {
      setSubmitError('Informe o endereço completo para atendimento em domicílio.');
      return;
    }

    if (!procedureDuration.isValid || !procedureDuration.totalMinutes) {
      setSubmitError(procedureDuration.error || OFFICIAL_DURATION_MISSING_ERROR);
      return;
    }

    // Atualiza a disponibilidade usando a mesma consulta em tempo real do agendamento público.
    // Se a consulta falhar, mantém os dados já carregados no painel, sem inventar disponibilidade.
    let currentAppointments = appointments;
    let currentBlockedDates = blockedDates;
    try {
      const freshAvailability = await fetchPublicAvailability();
      if (freshAvailability.success) {
        if (Array.isArray(freshAvailability.appointments)) {
          currentAppointments = freshAvailability.appointments;
        }
        if (Array.isArray(freshAvailability.blockedDates)) {
          currentBlockedDates = freshAvailability.blockedDates;
        }
      }
    } catch (error) {
      console.warn('[ManualBooking] Não foi possível atualizar a disponibilidade; usando dados já carregados.', error);
    }

    // Validação estrita de conflitos em toda a série recorrente
    if (isRecurring && recurrenceValidation && !recurrenceValidation.valid) {
      setSubmitError(recurrenceValidation.error || 'Conflito detectado na série recorrente. Por favor, escolha outro dia ou horário.');
      return;
    }

    // Check overlap with existing appointments or blocked dates
    const timeToMinutes = (val: string): number | null => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(val || '').trim());
      if (!match) return null;
      const h = Number(match[1]), m = Number(match[2]);
      return h <= 23 && m <= 59 ? h * 60 + m : null;
    };
    const reqStart = timeToMinutes(time.trim());
    const reqDuration = procedureDuration.totalMinutes;
    const reqEnd = reqStart !== null ? reqStart + reqDuration : null;

    if (reqStart !== null && reqEnd !== null) {
      const targetDateKey = date.trim();
      const isDateBlk = (currentBlockedDates || []).some(bd => bd === targetDateKey);
      if (isDateBlk) {
        setSubmitError('Esta data está bloqueada para atendimentos. Escolha outro dia.');
        return;
      }

      if (currentAppointments && currentAppointments.length > 0) {
        const conflict = currentAppointments.find(a => {
          if (a.status === 'cancelado' || a.status === 'teste_sistema') return false;
          if (String(a.date || '').trim() !== targetDateKey) return false;
          const raw = String(a.time || '').trim();
          if (a.status === 'bloqueado') {
            if (['dia inteiro', 'dia todo', 'all day'].includes(raw.toLowerCase())) return true;
            const interval = /^(\d{1,2}:\d{2})\s*(?:às|as|-)\s*(\d{1,2}:\d{2})$/i.exec(raw);
            if (interval) {
              const bs = timeToMinutes(interval[1]), be = timeToMinutes(interval[2]);
              return bs !== null && be !== null && reqStart < be && reqEnd > bs;
            }
            return false;
          }
          const oStart = timeToMinutes(raw);
          if (oStart === null) return false;
          const oDur = parseDurationMinutes(a.serviceDuration);
          if (!oDur || oDur <= 0) return false;
          const oEnd = oStart + oDur;
          return reqStart < oEnd && reqEnd > oStart;
        });

        if (conflict) {
          setSubmitError('Este horário acabou de ser reservado ou se sobrepõe a outro agendamento. Por favor, escolha outro horário.');
          return;
        }
      }
    }

    setIsSubmitting(true);

    // Reuse appointmentId across retries to prevent duplicate Google Sheets records
    const appointmentId = persistedAppointmentId || `apt-${Date.now()}`;
    if (!persistedAppointmentId) {
      setPersistedAppointmentId(appointmentId);
    }

    const finalServiceTitle = [serv.title, ...additionalServices.map(service => service.title)].join(' + ');
    const seriesId = `series-${Date.now()}`;
    const freqDays = recurrenceInterval === 'weekly' ? 7 : recurrenceInterval === 'biweekly' ? 14 : 30;
    const freqLabel = recurrenceInterval === 'weekly'
      ? 'Semanal (a cada semana)'
      : recurrenceInterval === 'biweekly'
      ? 'Semanal (a cada 2 semanas / quinzenal)'
      : 'Mensal (mesmo dia do mês)';

    const recurrenceUpcomingDates = isRecurring
      ? calculateRecurrenceDates(date.trim(), recurrenceInterval, totalSessions, {
          clientName: trimmedName,
          serviceTitle: finalServiceTitle
        })
      : undefined;

    const recurrenceConfig: RecurrenceConfig | undefined = isRecurring
      ? {
          frequencyDays: freqDays,
          frequencyLabel: freqLabel,
          recurrenceType: recurrenceInterval,
          totalSessions,
          seriesId,
          currentSession: 1,
          upcomingDates: recurrenceUpcomingDates
        }
      : undefined;

    const depositAmount = effectivePaymentMode === 'pre_pagamento_100' ? fullPrepayment : standardDeposit;

    const newApt: Appointment = {
      id: appointmentId,
      clientName: trimmedName,
      clientPhone: trimmedPhone,
      clientEmail: clientEmail.trim() || undefined,
      clientBirthDate,
      paymentMethod,
      serviceId: serv.id,
      additionalServiceIds,
      customRequest: customRequest.trim() || undefined,
      appointmentLocation,
      homeAddress: appointmentLocation === 'home' ? homeAddress.trim() : undefined,
      serviceTitle: [serv.title, ...additionalServices.map(service => service.title)].join(' + '),
      servicePrice: `R$ ${formatBRL(totalPrice)}`,
      serviceDuration: procedureDuration.formatted,
      date: date.trim(),
      time: time.trim(),
      status: depositStatus === 'liquidado' ? 'confirmado' : 'pendente_pix',
      depositAmount,
      depositStatus,
      paymentMode: effectivePaymentMode,
      requiresFullPrepayment: isInadimplente,
      isBlacklisted: isInadimplente,
      recurrence: recurrenceConfig,
      notes: isRecurring
        ? `[Série Recorrente: ${seriesId} - Sessão 1/${totalSessions}] ${notes.trim()}`.trim()
        : (notes.trim() || undefined),
      clientInitials: trimmedName
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    };

    try {
      const token =
        (adminSessionToken || '').trim() ||
        (typeof window !== 'undefined' ? sessionStorage.getItem('angelica_admin_session') || '' : '');

      const dispatchResult = await submitManualBooking(newApt, token);

      if (!dispatchResult.success || dispatchResult.persisted !== true) {
        setIsSubmitting(false);
        setSubmitError(
          dispatchResult.message ||
            'Falha ao persistir agendamento no Google Sheets. O servidor não confirmou a gravação.'
        );
        return;
      }

      // Persistir sessões futuras na planilha oficial para garantir bloqueio em cascata
      if (isRecurring && recurrenceUpcomingDates && recurrenceUpcomingDates.length > 0) {
        for (let i = 0; i < recurrenceUpcomingDates.length; i++) {
          const subDate = recurrenceUpcomingDates[i];
          const sessionNum = i + 2;
          const subId = `${appointmentId}-rec-${sessionNum}`;
          const subApt: Appointment = {
            ...newApt,
            id: subId,
            date: subDate,
            time: newApt.time,
            notes: `[Série Recorrente: ${seriesId} - Sessão ${sessionNum}/${totalSessions}] ${notes.trim()}`.trim(),
            recurrence: {
              frequencyDays: freqDays,
              frequencyLabel: freqLabel,
              recurrenceType: recurrenceInterval,
              totalSessions,
              seriesId,
              currentSession: sessionNum
            }
          };
          void submitManualBooking(subApt, token).catch(e => console.warn('Falha ao persistir sessão futura:', e));
        }
      }

      // Disparar WhatsApp se habilitado
      if (sendWhatsAppAuto && trimmedPhone) {
        try {
          const confirmationTemplate = [
            'Olá, {cliente}! 💕',
            '',
            'Seu agendamento está confirmado!',
            '',
            '📅 Data: {data}',
            '⏰ Horário: {horario}',
            '💅 Procedimento: {servico}',
            '',
            'Até breve! ✨',
            '',
            'Angélica do Carmo',
            'Felicidade é fazer as unhas. 💖'
          ].join('\n');
          const waRes = await sendAppointmentWhatsAppConfirmation(newApt, confirmationTemplate);
          newApt.whatsappStatus = waRes.status === 'sent' ? 'enviado' : waRes.status === 'simulated' ? 'simulado' : 'falha';
          newApt.whatsappSentAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          newApt.whatsappLastMessage = waRes.previewText || waRes.message;
          if (waRes.status !== 'sent' && waRes.fallbackUrl && typeof window !== 'undefined') {
            window.open(waRes.fallbackUrl, '_blank');
          }
        } catch {}
      }

      // Limpar formulário e estado do modal após sucesso
      setClientName('');
      setClientPhone('');
      setClientEmail('');
      setNotes('');
      setPersistedAppointmentId(null);
      setSubmitError(null);
      setIsSubmitting(false);

      // Notificar salvamento confirmado pelo servidor e fechar modal
      onSaveAppointment(newApt);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setSubmitError(
        err?.message ||
          'Falha de comunicação ao conectar ao servidor. Os dados foram mantidos intactos no formulário para nova tentativa.'
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-[#E8D9B5] shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-[#E8D9B5] mb-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">add_circle</span>
            <h3 className="font-syne text-lg sm:text-xl text-[#49382E] font-bold">
              Novo Agendamento Manual
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {submitError && (
          <div className="p-3.5 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2.5 shadow-xs">
            <span className="material-symbols-outlined text-[20px] text-red-600 shrink-0 mt-0.5">error</span>
            <div>
              <strong className="block font-semibold">Falha na Gravação da Reserva</strong>
              <span>{submitError}</span>
            </div>
          </div>
        )}

        {isInadimplente && (
          <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-red-600">warning</span>
            <span>
              <strong>Alerta de Inadimplência:</strong> Número cadastrado na lista de restrição. Exigido 100% de Pré-pagamento via Pix.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 font-jakarta text-xs">
          <div className="relative">
            <label className="block text-[#49382E] font-semibold mb-1">Nome Completo da Cliente *</label>
            <input
              type="text"
              value={clientName}
              onChange={e => {
                setClientName(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => {
                setIsNameFocused(true);
                setShowSuggestions(true);
              }}
              onBlur={() => {
                setTimeout(() => {
                  setShowSuggestions(false);
                  setIsNameFocused(false);
                }, 200);
              }}
              placeholder="Ex: Amanda Rezende (ou digite uma letra como 'K')"
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
            />
            {showSuggestions && isNameFocused && matchingClients.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-48 overflow-y-auto rounded-xl bg-white border border-[#E8D9B5] shadow-lg divide-y divide-[#E8D9B5]/40">
                {matchingClients.map(c => (
                  <button
                    key={c.id || c.phone}
                    type="button"
                    onMouseDown={() => handleSelectClient(c)}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-[#FDFBF9] transition-colors flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <span className="font-semibold text-xs text-[#49382E] block">{c.name}</span>
                      <span className="text-[11px] text-[#786C63]">{c.phone}</span>
                    </div>
                    {c.tier && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F7EFEA] text-[#D4AF37] font-bold border border-[#E8D9B5]/60">
                        {c.tier}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">WhatsApp com DDD *</label>
              <input
                type="tel"
                value={clientPhone}
                onChange={e => setClientPhone(e.target.value)}
                placeholder="(12) 98888-7777"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">E-mail da Cliente (Opcional)</label>
              <input
                type="email"
                value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                placeholder="cliente@exemplo.com"
                disabled={isSubmitting}
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Data de nascimento da cliente *</label>
            <input required type="date" value={clientBirthDate} max={new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })} onChange={e => setClientBirthDate(e.target.value)} disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] min-h-[44px]" />
          </div>
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Procedimento</label>
            <select
              value={selectedServiceId}
              onChange={e => { setSelectedServiceId(e.target.value); setAdditionalServiceIds([]); setShowAdditionalServices(false); }}
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
            >
              {services.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.priceFormatted})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 rounded-xl border border-[#E8D9B5] p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-[#49382E] font-semibold">Serviços adicionais</label>
              <button type="button" onClick={() => setShowAdditionalServices(true)} disabled={isSubmitting}
                className="rounded-full border border-[#D4AF37] px-3 py-2 font-bold text-[#49382E] hover:bg-[#F7EFEA] disabled:opacity-50">
                {additionalServiceIds.length ? `Revisar (${additionalServiceIds.length})` : 'Ver opções'}
              </button>
            </div>
            <p className="text-[#786C63]">Selecione outros procedimentos para realizar no mesmo atendimento. Os preços cadastrados permanecem inalterados.</p>
            {additionalServiceIds.length > 0 && <div className="space-y-1">{additionalServices.map(service => <div key={service.id} className="flex justify-between gap-2"><span>{service.title}</span><span>{service.priceFormatted}</span></div>)}</div>}
            {showAdditionalServices && <div className="fixed inset-0 z-[70] bg-[#49382E]/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div role="dialog" aria-modal="true" aria-label="Serviços adicionais" className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-white border border-[#E8D9B5] p-5 shadow-2xl">
                <div className="flex items-center justify-between gap-3 mb-3"><h4 className="font-bold text-sm text-[#49382E]">Adicionar serviços ao agendamento</h4><button type="button" onClick={() => setShowAdditionalServices(false)} className="rounded-full px-3 py-2 border border-[#E8D9B5]">Fechar</button></div>
                <p className="text-xs text-[#786C63] mb-3">Os valores exibidos são os já cadastrados. Complementos sem preço cadastrado podem ser descritos no pedido personalizado, sem alterar o total automaticamente.</p>
                {services.filter(service => service.active !== false && service.id !== serv.id).map(service => (
                  <label key={service.id} className="flex items-start gap-2 py-3 border-b border-[#E8D9B5] text-xs">
                    <input type="checkbox" checked={additionalServiceIds.includes(service.id)}
                      onChange={event => setAdditionalServiceIds(current => event.target.checked ? Array.from(new Set([...current, service.id])) : current.filter(id => id !== service.id))} />
                    <span className="flex-1"><span className="block font-semibold">{service.title}</span><span className="block text-[#786C63]">{service.description}</span></span><span className="font-semibold whitespace-nowrap">{service.priceFormatted}</span>
                  </label>
                ))}
                {services.filter(service => service.active !== false && service.id !== serv.id).length === 0 && <p className="text-xs text-[#786C63] py-3">Não há outros serviços ativos cadastrados.</p>}
                <button type="button" onClick={() => setShowAdditionalServices(false)} className="mt-4 w-full rounded-full bg-[#D4AF37] px-4 py-3 font-bold text-[#49382E]">Confirmar seleção</button>
              </div>
            </div>}
            <label className="block font-semibold pt-2">Pedido personalizado (preço sujeito à confirmação)
              <textarea value={customRequest} onChange={event => setCustomRequest(event.target.value)} rows={2}
                className="mt-1 w-full rounded-lg border border-[#E8D9B5] bg-[#FDFBF9] p-2" />
            </label>
            <label className="block font-semibold pt-2">Local do atendimento</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2"><input type="radio" name="manualLocation" checked={appointmentLocation === 'salon'} onChange={() => setAppointmentLocation('salon')} /> Espaço</label>
              <label className="flex items-center gap-2"><input type="radio" name="manualLocation" checked={appointmentLocation === 'home'} onChange={() => setAppointmentLocation('home')} /> Domicílio</label>
            </div>
            {appointmentLocation === 'home' && <label className="block font-semibold">Endereço completo *
              <textarea required value={homeAddress} onChange={event => setHomeAddress(event.target.value)} rows={2}
                className="mt-1 w-full rounded-lg border border-[#E8D9B5] bg-[#FDFBF9] p-2" />
            </label>}
            <div className="font-bold text-sm">Total dos serviços: R$ {formatBRL(totalPrice)}</div>
            <div className="text-xs text-[#786C63] mt-0.5">
              Duração oficial total: <strong className="text-[#49382E]">{procedureDuration.formatted || 'Não configurada'}</strong>
              {time && procedureDuration.totalMinutes ? ` (término previsto às ${calculateEndTime(time, procedureDuration.totalMinutes)})` : ''}
            </div>
            {!procedureDuration.isValid && (
              <div className="text-xs text-rose-600 font-semibold mt-1">
                ⚠️ {procedureDuration.error || OFFICIAL_DURATION_MISSING_ERROR}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">Data</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                min={new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
              />
            </div>
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">Horário</label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                placeholder="Ex: 14:30"
                className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px]"
              />
            </div>
          </div>

          {/* Agendamento Recorrente */}
          <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#49382E] flex items-center gap-1.5 text-sm">
                <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">update</span>
                Agendamento Recorrente (Painel da Angélica)
              </span>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="w-4 h-4 rounded text-[#D4AF37] focus:ring-[#D4AF37] cursor-pointer"
              />
            </div>
            {isRecurring && (
              <div className="space-y-3 pt-1 text-[12px]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[#786C63] block mb-1 font-medium">Intervalo de Recorrência</label>
                    <select
                      value={recurrenceInterval}
                      onChange={e => setRecurrenceInterval(e.target.value as 'weekly' | 'biweekly' | 'monthly')}
                      className="w-full p-2.5 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] font-medium"
                    >
                      <option value="weekly">Semanal (a cada semana)</option>
                      <option value="biweekly">Semanal (a cada 2 semanas / quinzenal)</option>
                      <option value="monthly">Mensal (mesmo dia do mês)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[#786C63] block mb-1 font-medium">Qtd. Total de Sessões</label>
                    <select
                      value={totalSessions}
                      onChange={e => setTotalSessions(Number(e.target.value))}
                      className="w-full p-2.5 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] font-medium"
                    >
                      <option value={2}>2 sessões</option>
                      <option value={3}>3 sessões</option>
                      <option value={4}>4 sessões (Recomendado)</option>
                      <option value={6}>6 sessões</option>
                      <option value={8}>8 sessões</option>
                      <option value={12}>12 sessões</option>
                    </select>
                  </div>
                </div>

                {/* Visualização Completa de Próximas Datas com Checagem de Conflitos */}
                {recurrenceValidation && (
                  <div className="p-3 rounded-xl bg-white border border-[#E8D9B5] space-y-2">
                    <span className="text-[#49382E] font-semibold block text-[11px] uppercase tracking-wider">
                      Cronograma Completo das Sessões ({recurrenceValidation.allDates.length} datas)
                    </span>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {recurrenceValidation.allDates.map((d, idx) => {
                        const sessionNum = idx + 1;
                        const conflict = recurrenceValidation.conflicts.find(c => c.session === sessionNum);
                        return (
                          <div
                            key={d + '-' + sessionNum}
                            className={`flex items-center justify-between p-2 rounded-lg text-[11px] border ${
                              conflict
                                ? 'bg-rose-50/80 border-rose-200 text-rose-800'
                                : 'bg-[#FAF8F5] border-[#E8D9B5]/60 text-[#49382E]'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-[#D4AF37]">Sessão {sessionNum}:</span>
                              <span>{d} às {time}</span>
                            </div>
                            {conflict ? (
                              <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                Conflito
                              </span>
                            ) : (
                              <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                                <span className="material-symbols-outlined text-[12px]">check</span>
                                Horário Livre
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {recurrenceValidation.conflicts.length > 0 && (
                      <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-800 text-[11px] leading-relaxed">
                        <strong className="block mb-0.5">Aviso de Conflito para a Angélica:</strong>
                        {recurrenceValidation.conflicts.map(c => (
                          <div key={c.session} className="text-[10px]">
                            • Sessão {c.session} ({c.date}): {c.reason}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Forma de Pagamento */}
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Forma de pagamento</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as typeof paymentMethod)} className="mb-2 w-full p-3 rounded-xl bg-white border border-[#E8D9B5] text-[#49382E]">
              <option value="debito">Cartão de débito</option><option value="credito">Cartão de crédito</option><option value="pix">Pix</option><option value="permuta">Permuta</option><option value="pacote_mensal">Pacote mensal</option><option value="outro">Outro</option>
            </select>
            <label className="block text-[#49382E] font-semibold mb-1">Condição do Pix (quando aplicável)</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isInadimplente}
                onClick={() => setPaymentMode('sinal_40')}
                className={`py-2 px-2.5 rounded-xl font-bold cursor-pointer transition-all border ${
                  effectivePaymentMode === 'sinal_40'
                    ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37] shadow-xs'
                    : isInadimplente
                    ? 'bg-[#F7EFEA] text-[#A39A90] border-[#E8D9B5] cursor-not-allowed'
                    : 'bg-[#FFFFFF] text-[#49382E] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                Sinal 40% (R$ {formatBRL(standardDeposit)})
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('pre_pagamento_100')}
                className={`py-2 px-2.5 rounded-xl font-bold cursor-pointer transition-all border ${
                  effectivePaymentMode === 'pre_pagamento_100'
                    ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37] shadow-xs'
                    : 'bg-[#FFFFFF] text-[#49382E] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                100% Pré-pago ({serv.priceFormatted})
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Status da Liquidação</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDepositStatus('liquidado')}
                className={`py-2 px-3 rounded-xl font-bold cursor-pointer transition-all border ${
                  depositStatus === 'liquidado'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-[#FFFFFF] text-[#786C63] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                Já Liquidado / Confirmado
              </button>
              <button
                type="button"
                onClick={() => setDepositStatus('pendente')}
                className={`py-2 px-3 rounded-xl font-bold cursor-pointer transition-all border ${
                  depositStatus === 'pendente'
                    ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37] shadow-xs'
                    : 'bg-[#FFFFFF] text-[#786C63] border-[#E8D9B5] hover:bg-[#FDFBF9]'
                }`}
              >
                Aguardando Comprovante Pix
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Observações / Ficha</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ex: Formato almond, sensibilidade leve"
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>

          {/* WhatsApp Confirmation Toggle */}
          <div className="p-3.5 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#25D366] text-[20px]">chat</span>
              <div>
                <span className="font-bold text-[#49382E] block text-xs">
                  Disparar Confirmação Automática via WhatsApp
                </span>
                <span className="text-[11px] text-[#786C63]">
                  Envia comprovante, endereço e orientações para {clientPhone.trim() || 'o telefone da cliente'}.
                </span>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={sendWhatsAppAuto}
                onChange={e => setSendWhatsAppAuto(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-[#E8D9B5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#25D366]"></div>
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E8D9B5]">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-6 py-2.5 rounded-full font-bold shadow-md transition-all flex items-center gap-2 ${
                isSubmitting
                  ? 'bg-[#E8D9B5] text-[#786C63] cursor-not-allowed'
                  : 'bg-[#D4AF37] text-[#3C2F00] hover:bg-[#E5C158] cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                  <span>Gravando no Google Sheets...</span>
                </>
              ) : (
                <span>Inserir na Grade</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
