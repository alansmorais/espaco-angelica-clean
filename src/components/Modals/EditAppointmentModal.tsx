import React, { useState, useEffect } from 'react';
import { Appointment, Service, SlotStatus } from '../../types';

interface EditAppointmentModalProps {
  isOpen: boolean;
  appointment: Appointment | null;
  onClose: () => void;
  onSave: (updated: Appointment) => Promise<void>;
  services?: Service[];
}

export const EditAppointmentModal: React.FC<EditAppointmentModalProps> = ({
  isOpen,
  appointment,
  onClose,
  onSave,
  services = []
}) => {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [serviceTitle, setServiceTitle] = useState('');
  const [additionalServiceIds, setAdditionalServiceIds] = useState<string[]>([]);
  const [customRequest, setCustomRequest] = useState('');
  const [appointmentLocation, setAppointmentLocation] = useState<'salon' | 'home'>('salon');
  const [homeAddress, setHomeAddress] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [status, setStatus] = useState<SlotStatus>('pendente_pix');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (appointment && isOpen) {
      setClientName(appointment.clientName || '');
      setClientPhone(appointment.clientPhone || '');
      setClientEmail(appointment.clientEmail || '');
      setServiceTitle(appointment.serviceTitle || '');
      setAdditionalServiceIds(appointment.additionalServiceIds || []);
      setCustomRequest(appointment.customRequest || '');
      setAppointmentLocation(appointment.appointmentLocation || 'salon');
      setHomeAddress(appointment.homeAddress || '');
      setDate(appointment.date || '');
      setTime(appointment.time || '');
      setStatus(appointment.status || 'pendente_pix');
      setNotes(appointment.notes || '');
      setSubmitError(null);
      setIsSubmitting(false);
    }
  }, [appointment, isOpen]);

  if (!isOpen || !appointment) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      setSubmitError('O nome da cliente é obrigatório.');
      return;
    }
    if (!clientPhone.trim()) {
      setSubmitError('O telefone/WhatsApp é obrigatório.');
      return;
    }
    if (!date.trim()) {
      setSubmitError('A data do agendamento é obrigatória.');
      return;
    }
    if (!time.trim()) {
      setSubmitError('O horário do agendamento é obrigatório.');
      return;
    }
    if (appointmentLocation === 'home' && homeAddress.trim().length < 8) {
      setSubmitError('Informe o endereço completo para atendimento em domicílio.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    // Encontra preço/id correspondente se o serviço foi selecionado do catálogo
    const matchedService = services.find(s => s.id === appointment.serviceId) || services.find(s => s.title.toLowerCase() === serviceTitle.toLowerCase());
    const additionalServices = services.filter(service => additionalServiceIds.includes(service.id) && service.id !== matchedService?.id);
    const combinedPrice = matchedService ? matchedService.price + additionalServices.reduce((sum, service) => sum + service.price, 0) : undefined;

    const updatedApt: Appointment = {
      ...appointment,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientEmail: clientEmail.trim() || undefined,
      serviceTitle: [matchedService?.title || serviceTitle.trim(), ...additionalServices.map(service => service.title)].join(' + '),
      ...(matchedService && {
        serviceId: matchedService.id,
        servicePrice: combinedPrice === undefined ? matchedService.priceFormatted : `R$ ${combinedPrice.toFixed(2).replace('.', ',')}`,
        serviceDuration: matchedService.duration
      }),
      additionalServiceIds,
      customRequest: customRequest.trim() || undefined,
      appointmentLocation,
      homeAddress: appointmentLocation === 'home' ? homeAddress.trim() : undefined,
      date: date.trim(),
      time: time.trim(),
      status,
      notes: notes.trim() || undefined
    };

    try {
      await onSave(updatedApt);
      onClose();
    } catch (err: any) {
      setSubmitError(err?.message || 'Erro ao persistir alterações na planilha oficial.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#FAF8F5] border border-[#E8D9B5] rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 text-[#49382E] relative max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 text-[#786C63] hover:text-[#49382E] p-1.5 rounded-full hover:bg-[#F3ECE4] transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-xl">close</span>
        </button>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[#D4AF37]">
            <span className="material-symbols-outlined text-[20px]">edit_calendar</span>
            <span className="font-jakarta text-[11px] uppercase tracking-wider font-bold">
              Gestão da Reserva
            </span>
          </div>
          <h2 className="font-syne text-xl sm:text-2xl font-bold text-[#49382E]">
            Editar Agendamento
          </h2>
          <p className="font-jakarta text-xs text-[#786C63]">
            Altere os dados da cliente ou do procedimento. As mudanças serão persistidas na planilha oficial.
          </p>
        </div>

        {submitError && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-jakarta text-xs flex items-start gap-2 shadow-xs">
            <span className="material-symbols-outlined text-[18px] text-red-600 shrink-0">error</span>
            <div className="flex-1">
              <strong>Erro ao salvar:</strong> {submitError}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 font-jakarta text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[#49382E] font-bold mb-1">Nome da Cliente *</label>
              <input
                type="text"
                required
                value={clientName}
                onChange={e => setClientName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37]"
                placeholder="Nome completo"
              />
            </div>

            <div>
              <label className="block text-[#49382E] font-bold mb-1">WhatsApp / Telefone *</label>
              <input
                type="text"
                required
                value={clientPhone}
                onChange={e => setClientPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37]"
                placeholder="(12) 99999-9999"
              />
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-bold mb-1">E-mail da Cliente</label>
            <input
              type="email"
              value={clientEmail}
              onChange={e => setClientEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37]"
              placeholder="cliente@exemplo.com (opcional)"
            />
          </div>

          <div>
            <label className="block text-[#49382E] font-bold mb-1">Procedimento *</label>
            <div className="space-y-1.5">
              <select
                value={serviceTitle}
                onChange={e => setServiceTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37] font-semibold"
              >
                {services.map(s => (
                  <option key={s.id} value={s.title}>
                    {s.title} ({s.priceFormatted})
                  </option>
                ))}
                {!services.some(s => s.title === serviceTitle) && (
                  <option value={serviceTitle}>{serviceTitle}</option>
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[#49382E] font-bold mb-1">Data *</label>
              <input
                type="text"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37]"
                placeholder="Ex: Qua, 13 Nov ou 13/11/2024"
              />
            </div>

            <div>
              <label className="block text-[#49382E] font-bold mb-1">Horário *</label>
              <input
                type="text"
                required
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37]"
                placeholder="Ex: 09:00 ou 14:30"
              />
            </div>
          </div>

          <div>
            <label className="block text-[#49382E] font-bold mb-1">Status do Agendamento</label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as SlotStatus)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37] font-semibold"
            >
              <option value="pendente_pix">Pendente Pix (Aguardando comprovante)</option>
              <option value="confirmado">Confirmado (Sinal ou Total Liquidado)</option>
              <option value="concluido">Concluído (Atendimento realizado)</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>

          <div className="rounded-xl border border-[#E8D9B5] p-3 space-y-3">
            <label className="block text-[#49382E] font-bold mb-1">Serviços adicionais</label>
            {services.filter(service => service.id !== appointment?.serviceId).map(service => (
              <label key={service.id} className="flex items-center gap-2">
                <input type="checkbox" checked={additionalServiceIds.includes(service.id)}
                  onChange={e => setAdditionalServiceIds(current => e.target.checked ? [...current, service.id] : current.filter(id => id !== service.id))} />
                <span className="flex-1">{service.title}</span><span>{service.priceFormatted}</span>
              </label>
            ))}
            <label className="block text-[#49382E] font-bold">Pedido personalizado (preço sujeito à confirmação)
              <textarea value={customRequest} onChange={e => setCustomRequest(e.target.value)} rows={2}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white border border-[#E8D9B5]" />
            </label>
            <label className="block text-[#49382E] font-bold">Local do atendimento</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2"><input type="radio" name="editLocation" checked={appointmentLocation === 'salon'} onChange={() => setAppointmentLocation('salon')} /> Salão</label>
              <label className="flex items-center gap-2"><input type="radio" name="editLocation" checked={appointmentLocation === 'home'} onChange={() => setAppointmentLocation('home')} /> Domicílio</label>
            </div>
            {appointmentLocation === 'home' && <label className="block text-[#49382E] font-bold">Endereço completo *
              <textarea required value={homeAddress} onChange={e => setHomeAddress(e.target.value)} rows={2}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white border border-[#E8D9B5]" />
            </label>}
          </div>

          <div>
            <label className="block text-[#49382E] font-bold mb-1">Observações Internas</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] outline-none focus:border-[#D4AF37]"
              placeholder="Anotações para a Angélica sobre este atendimento..."
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl border border-[#E8D9B5] hover:bg-[#F3ECE4] text-[#49382E] font-bold transition-all cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                  <span>Salvando na Planilha...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">check</span>
                  <span>Salvar Alterações</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
