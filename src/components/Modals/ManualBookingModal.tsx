import React, { useState } from 'react';
import { Appointment, Service, BlacklistEntry, PaymentConfig, RecurrenceConfig } from '../../types';
import { sendAppointmentWhatsAppConfirmation } from '../../services/whatsappService';
import { calculateDeposit40, calculateFullPrepayment, formatBRL } from '../../services/notificationTemplates';
import { submitManualBooking } from '../../services/emailNotificationService';

interface ManualBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveAppointment: (apt: Appointment) => void;
  services?: Service[];
  blacklist?: BlacklistEntry[];
  adminSessionToken?: string;
  paymentConfig?: PaymentConfig;
}

export const ManualBookingModal: React.FC<ManualBookingModalProps> = ({
  isOpen,
  onClose,
  onSaveAppointment,
  services = [],
  blacklist = [],
  adminSessionToken,
  paymentConfig = { pixKey: '', pixBeneficiary: '', depositAmount: 40 }
}) => {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
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
  const [recurrenceFreq, setRecurrenceFreq] = useState(21);
  const [totalSessions, setTotalSessions] = useState(3);
  const [notes, setNotes] = useState('');
  const [sendWhatsAppAuto, setSendWhatsAppAuto] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [persistedAppointmentId, setPersistedAppointmentId] = useState<string | null>(null);

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
  const totalPrice = serv.price + additionalServices.reduce((sum, service) => sum + service.price, 0);
  const standardDeposit = calculateDeposit40(totalPrice, paymentConfig.depositAmount);
  const fullPrepayment = calculateFullPrepayment(totalPrice);

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

    if (!date.trim() || !time.trim()) {
      setSubmitError('Por favor, informe a data e o horário do atendimento.');
      return;
    }
    if (appointmentLocation === 'home' && homeAddress.trim().length < 8) {
      setSubmitError('Informe o endereço completo para atendimento em domicílio.');
      return;
    }

    setIsSubmitting(true);

    // Reuse appointmentId across retries to prevent duplicate Google Sheets records
    const appointmentId = persistedAppointmentId || `apt-${Date.now()}`;
    if (!persistedAppointmentId) {
      setPersistedAppointmentId(appointmentId);
    }

    const recurrenceConfig: RecurrenceConfig | undefined = isRecurring
      ? {
          frequencyDays: recurrenceFreq,
          frequencyLabel: `A cada ${recurrenceFreq} dias`,
          totalSessions,
          seriesId: `series-${Date.now()}`,
          currentSession: 1
        }
      : undefined;

    const depositAmount = effectivePaymentMode === 'pre_pagamento_100' ? fullPrepayment : standardDeposit;

    const newApt: Appointment = {
      id: appointmentId,
      clientName: trimmedName,
      clientPhone: trimmedPhone,
      clientEmail: clientEmail.trim() || undefined,
      serviceId: serv.id,
      additionalServiceIds,
      customRequest: customRequest.trim() || undefined,
      appointmentLocation,
      homeAddress: appointmentLocation === 'home' ? homeAddress.trim() : undefined,
      serviceTitle: [serv.title, ...additionalServices.map(service => service.title)].join(' + '),
      servicePrice: `R$ ${formatBRL(totalPrice)}`,
      serviceDuration: (() => { const minutes = [serv, ...additionalServices].reduce((sum, service) => { const match = String(service.duration || '').match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|m))?/i); return sum + (match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : 30); }, 0); return `${Math.floor(minutes / 60) > 0 ? `${Math.floor(minutes / 60)} h ` : ''}${minutes % 60 > 0 ? `${minutes % 60} min` : ''}`.trim() || '30 min'; })(),
      date: date.trim(),
      time: time.trim(),
      status: depositStatus === 'liquidado' ? 'confirmado' : 'pendente_pix',
      depositAmount,
      depositStatus,
      paymentMode: effectivePaymentMode,
      requiresFullPrepayment: isInadimplente,
      isBlacklisted: isInadimplente,
      recurrence: recurrenceConfig,
      notes: notes.trim() || undefined,
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

      // Disparar WhatsApp se habilitado
      if (sendWhatsAppAuto && trimmedPhone) {
        try {
          const waRes = await sendAppointmentWhatsAppConfirmation(newApt);
          newApt.whatsappStatus = waRes.status === 'sent' ? 'enviado' : waRes.status === 'simulated' ? 'simulado' : 'falha';
          newApt.whatsappSentAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          newApt.whatsappLastMessage = waRes.previewText || waRes.message;
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
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Nome Completo da Cliente *</label>
            <input
              type="text"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              placeholder="Ex: Amanda Rezende"
              disabled={isSubmitting}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37] text-base sm:text-sm min-h-[44px] disabled:opacity-60"
            />
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
          <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#49382E] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[#D4AF37] text-[16px]">update</span>
                Agendamento Recorrente
              </span>
              <input
                type="checkbox"
                checked={isRecurring}
                onChange={e => setIsRecurring(e.target.checked)}
                className="w-4 h-4 rounded text-[#D4AF37] focus:ring-[#D4AF37]"
              />
            </div>
            {isRecurring && (
              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div>
                  <label className="text-[#786C63] block mb-0.5 font-medium">Intervalo</label>
                  <select
                    value={recurrenceFreq}
                    onChange={e => setRecurrenceFreq(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5]"
                  >
                    <option value={15}>A cada 15 dias</option>
                    <option value={21}>A cada 21 dias (Recomendado)</option>
                    <option value={30}>A cada 30 dias</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#786C63] block mb-0.5 font-medium">Qtd. Sessões</label>
                  <select
                    value={totalSessions}
                    onChange={e => setTotalSessions(Number(e.target.value))}
                    className="w-full p-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5]"
                  >
                    <option value={2}>2 sessões</option>
                    <option value={3}>3 sessões</option>
                    <option value={4}>4 sessões</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Forma de Pagamento */}
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">Modalidade Pix</label>
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
