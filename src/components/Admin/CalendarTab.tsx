import React, { useState } from 'react';
import { Appointment, TimeSlotConfig, Service } from '../../types';
import { sendAppointmentWhatsAppConfirmation } from '../../services/whatsappService';
import { formatBRL, areDatesEqual } from '../../services/notificationTemplates';
import { EditAppointmentModal } from '../Modals/EditAppointmentModal';

interface CalendarTabProps {
  onOpenBlockModal: (date?: string) => void;
  onOpenExtraEncaixeModal: () => void;
  onSelectClientForDossier: (clientName: string) => void;
  appointments?: Appointment[];
  timeSlots?: TimeSlotConfig[];
  services?: Service[];
  onUpdateAppointment?: (apt: Appointment) => Promise<void> | void;
  onDeleteAppointment?: (apt: Appointment) => Promise<void>;
}

export const CalendarTab: React.FC<CalendarTabProps> = ({
  onOpenBlockModal,
  onOpenExtraEncaixeModal,
  onSelectClientForDossier,
  appointments = [],
  timeSlots = [],
  services = [],
  onUpdateAppointment,
  onDeleteAppointment
}) => {
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'dia' | 'semana' | 'mes'>('mes');
  const [selectedDayLabel, setSelectedDayLabel] = useState<string>(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Find selected appointment if any
  const selectedAppointment = appointments.find(a => a.id === selectedSlotKey) || null;

  // Real counts derived from actual data
  const confirmedCount = appointments.filter(a => a.status === 'confirmado').length;
  const pendingCount = appointments.filter(a => a.status === 'pendente_pix').length;
  const completedCount = appointments.filter(a => a.status === 'concluido').length;

  const handleFinalizeAppointment = (apt: Appointment) => {
    if (onUpdateAppointment) {
      onUpdateAppointment({
        ...apt,
        status: 'concluido',
        depositStatus: 'liquidado'
      });
      showNotice(`Atendimento de ${apt.clientName} finalizado e marcado como concluído.`);
    }
  };

  const handleSaveEditedAppointment = async (updated: Appointment) => {
    if (onUpdateAppointment) {
      await onUpdateAppointment(updated);
      showNotice(`Agendamento de ${updated.clientName} atualizado com sucesso.`);
    }
  };

  const handleDeleteAppointment = async (apt: Appointment) => {
    const isBlock = apt.status === 'bloqueado';
    const confirmMsg = isBlock
      ? `Deseja remover o bloqueio da data ${apt.date}?`
      : `Deseja excluir permanentemente o agendamento de ${apt.clientName} em ${apt.date} às ${apt.time}?`;

    if (!onDeleteAppointment || !confirm(confirmMsg)) {
      return;
    }
    try {
      await onDeleteAppointment(apt);
      setSelectedSlotKey(null);
      showNotice(isBlock ? `Bloqueio da data ${apt.date} removido da planilha.` : `Agendamento de ${apt.clientName} excluído da planilha.`);
    } catch (err: any) {
      showNotice(err.message || 'Não foi possível excluir o agendamento.');
    }
  };

  const [isDispatchingWa, setIsDispatchingWa] = useState(false);

  const handleDispatchConfirmationWhatsApp = async (apt: Appointment) => {
    setIsDispatchingWa(true);
    try {
      const res = await sendAppointmentWhatsAppConfirmation(apt);
      if (onUpdateAppointment) {
        onUpdateAppointment({
          ...apt,
          whatsappStatus: res.status === 'sent' ? 'enviado' : res.status === 'simulated' ? 'simulado' : 'falha',
          whatsappSentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          whatsappLastMessage: res.previewText || res.message
        });
      }
      showNotice(res.message || `Confirmação de agendamento disparada via WhatsApp para ${apt.clientName}!`);
    } catch {
      showNotice('Erro ao disparar confirmação via WhatsApp.');
    } finally {
      setIsDispatchingWa(false);
    }
  };

  const handleSendReminderWhatsApp = (apt: Appointment) => {
    const phoneDigits = apt.clientPhone.replace(/\D/g, '');
    if (!phoneDigits) {
      alert('Número de telefone não informado para esta cliente.');
      return;
    }
    const msg = encodeURIComponent(
      `Olá, ${apt.clientName}! Passando para lembrar do seu atendimento no Espaço Angelica do Carmo agendado para ${apt.date} às ${apt.time} (${apt.serviceTitle}). Nos vemos em breve no Pontal da Cruz, São Sebastião!`
    );
    window.open(`https://wa.me/${phoneDigits}?text=${msg}`, '_blank');
  };

  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const formatDate = (date: Date) => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  const selectedDate = new Date(selectedDayLabel + 'T12:00:00');
  const daysHeader = Array.from({ length: 5 }, (_, i) => {
    const date = new Date(selectedDate);
    date.setDate(date.getDate() + i - 2);
    return { label: date.toLocaleDateString('pt-BR', { weekday: 'short' }), num: String(date.getDate()), full: formatDate(date) };
  });
  const monthStart = (visibleMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const monthCells = [...Array(monthStart).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)] as (number | null)[];
  const todayKey = formatDate(new Date());
  const dayAppointments = appointments
    .filter(a => a.status !== 'cancelado' && areDatesEqual(a.date, selectedDayLabel))
    .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));

  return (
    <div className="flex flex-col gap-6 text-[#49382E]">
      {/* Top Action Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-[#FFFFFF] p-4 lg:p-6 rounded-2xl border border-[#E8D9B5] shadow-xs relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 z-10">
          {/* Week Date Navigator */}
          <div className="flex items-center gap-2 bg-[#F7EFEA] px-4 py-1.5 rounded-full border border-[#E8D9B5]">
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">calendar_month</span>
            <span className="font-syne text-sm sm:text-base text-[#49382E] font-bold tracking-tight">
              Calendário de Atendimentos
            </span>
          </div>

          {/* View Segmented Pill */}
          <div className="flex items-center p-1 bg-[#FDFBF9] rounded-full border border-[#E8D9B5]">
            {(['dia', 'semana', 'mes'] as const).map(view => (
              <button
                key={view}
                type="button"
                onClick={() => setActiveView(view)}
                className={`px-3.5 py-1 rounded-full font-jakarta text-xs font-semibold capitalize transition-colors cursor-pointer ${
                  activeView === view
                    ? 'bg-[#D4AF37] text-[#3C2F00] font-bold shadow-xs'
                    : 'text-[#786C63] hover:text-[#49382E]'
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        {/* Quick Espaçor Actions */}
        <div className="flex flex-wrap items-center gap-2.5 z-10">
          <button
            type="button"
            onClick={() => onOpenBlockModal(selectedDayLabel)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] hover:bg-[#FDFBF9] transition-all font-jakarta text-xs font-semibold border border-[#E8D9B5] shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[17px] text-[#D4AF37]">block</span>
            <span>Bloquear Horário / Folga</span>
          </button>

          <button
            type="button"
            onClick={onOpenExtraEncaixeModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] hover:bg-[#FDFBF9] transition-all font-jakarta text-xs font-semibold border border-[#E8D9B5] shadow-xs cursor-pointer"
          >
            <span className="material-symbols-outlined text-[17px] text-[#D4AF37]">flash_on</span>
            <span>Encaixe Extraordinário</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="p-3.5 rounded-xl bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold flex items-center justify-between shadow-xs">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)}>
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Real Status Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Confirmados</span>
            <span className="text-xs text-[#49382E] font-bold">{confirmedCount} na grade</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-[#D4AF37]" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Aguardando Pix</span>
            <span className="text-xs text-[#49382E] font-bold">{pendingCount} pendentes</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-[#A39A90]" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Concluídos</span>
            <span className="text-xs text-[#49382E] font-bold">{completedCount} finalizados</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFFFF] rounded-xl border border-[#E8D9B5] shadow-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="flex flex-col font-jakarta">
            <span className="text-[10px] text-[#786C63] uppercase font-bold">Bloqueios</span>
            <span className="text-xs text-[#49382E] font-bold">
              {timeSlots.filter(s => s.status === 'bloqueado').length} horários
            </span>
          </div>
        </div>
      </div>

      {/* Main Workspace (8 cols grid + 4 cols Dossier) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Calendar Timetable Grid (8 cols) */}
        <div className="xl:col-span-8 flex flex-col bg-[#FFFFFF] rounded-2xl p-4 lg:p-6 border border-[#E8D9B5] shadow-xs overflow-hidden">
          {activeView === 'mes' && (
            <div className="mb-5 border border-[#E8D9B5] rounded-2xl p-3 sm:p-4">
              <div className="flex items-center justify-between mb-4">
                <button type="button" aria-label="Mês anterior" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} className="px-3 py-2 border rounded-lg">‹</button>
                <strong className="capitalize">{visibleMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</strong>
                <button type="button" aria-label="Próximo mês" onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} className="px-3 py-2 border rounded-lg">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-xs">
                {['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d => <strong key={d} className="py-2">{d}</strong>)}
                {monthCells.map((day, i) => {
                  const date = day ? formatDate(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day)) : '';
                  const isPastDay = Boolean(date && date < todayKey);
                  const items = day ? appointments.filter(a => a.status !== 'cancelado' && areDatesEqual(a.date, date)) : [];
                  const blocked = items.some(a => a.status === 'bloqueado');
                  return <button key={i} type="button" disabled={!day || isPastDay} onClick={() => { if (day && !isPastDay) { setSelectedDayLabel(date); setSelectedSlotKey(null); } }} className={`min-h-14 rounded-lg border flex flex-col items-center justify-center gap-1 ${!day ? 'border-transparent' : isPastDay ? 'bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed' : date === todayKey ? 'bg-emerald-50 border-emerald-400 font-bold' : date === selectedDayLabel ? 'bg-[#FBF2D5] border-[#D4AF37]' : 'border-[#E8D9B5] hover:bg-[#F7EFEA]'}`}>
                    {day || ''}{items.length > 0 && <span className={`text-[10px] rounded-full px-1.5 ${blocked ? 'bg-red-100 text-red-800' : 'bg-[#D4AF37] text-[#3C2F00]'}`}>{items.length}{blocked ? ' 🔒' : ''}</span>}
                  </button>;
                })}
              </div>
              <div className="mt-4 border-t pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <strong>Agendamentos de {selectedDate.toLocaleDateString('pt-BR')}</strong>
                  <button type="button" onClick={() => onOpenBlockModal(selectedDayLabel)} className="px-3 py-2 rounded-lg bg-[#D4AF37] text-xs font-bold">Bloquear esta data / horário</button>
                </div>
                {dayAppointments.length === 0 ? <p className="text-xs text-[#786C63]">Nenhum agendamento nesta data.</p> : dayAppointments.map(a => <button key={a.id} type="button" onClick={() => setSelectedSlotKey(a.id)} className="w-full text-left p-3 mb-1 rounded-lg border border-[#E8D9B5] hover:bg-[#FBF2D5] text-xs"><strong>{a.time} · {a.clientName}</strong> — {a.serviceTitle} ({a.status})</button>)}
              </div>
            </div>
          )}
          {/* Day Selector Buttons */}
          <div className="grid grid-cols-5 gap-2 pb-4 border-b border-[#E8D9B5] mb-4">
            {daysHeader.map(d => {
              const dayBlocked = appointments.some(
                a => a.status === 'bloqueado' && areDatesEqual(a.date, d.full)
              );
              return (
                <button
                  key={d.full}
                  type="button"
                  onClick={() => setSelectedDayLabel(d.full)}
                  className={`flex flex-col items-center p-2.5 rounded-xl transition-all cursor-pointer border relative ${
                    selectedDayLabel === d.full
                      ? dayBlocked
                        ? 'bg-red-50 border-red-400 text-red-900 shadow-xs'
                        : 'bg-[#FBF2D5] border-[#D4AF37] text-[#3C2F00] shadow-xs'
                      : dayBlocked
                      ? 'bg-red-50/60 text-red-700 border-red-200 hover:bg-red-50'
                      : 'bg-[#FDFBF9] text-[#786C63] border-[#E8D9B5] hover:bg-[#F7EFEA] hover:text-[#49382E]'
                  }`}
                >
                  {dayBlocked && (
                    <span className="absolute top-1 right-1 material-symbols-outlined text-[13px] text-red-500" title="Dia Bloqueado">
                      lock
                    </span>
                  )}
                  <span className="font-jakarta text-[10px] uppercase font-bold">{d.label}</span>
                  <span className="font-syne text-base font-bold">{d.num}</span>
                </button>
              );
            })}
          </div>

          {/* Active Block Banner if the selected day is blocked */}
          {(() => {
            const currentDayBlock = appointments.find(
              a => a.status === 'bloqueado' && areDatesEqual(a.date, selectedDayLabel)
            );
            if (!currentDayBlock) return null;
            return (
              <div className="p-3.5 mb-3 rounded-xl bg-red-50 border border-red-200 text-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-600 text-[20px] shrink-0">lock</span>
                  <div>
                    <span className="font-syne text-xs font-bold block">Esta data está BLOQUEADA para agendamentos</span>
                    <span className="font-jakarta text-[11px] text-red-700">
                      {currentDayBlock.notes || currentDayBlock.blockReason || 'Dia inteiro bloqueado pela administração'}
                    </span>
                  </div>
                </div>
                {onDeleteAppointment && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteAppointment(currentDayBlock)}
                    className="px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-700 text-white font-jakarta text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1 shrink-0"
                  >
                    <span className="material-symbols-outlined text-[14px]">lock_open</span>
                    <span>Desbloquear Data</span>
                  </button>
                )}
              </div>
            );
          })()}

          <div className="text-xs text-[#786C63] mb-3 font-jakarta flex items-center justify-between">
            <span>Visualizando grade de: <strong className="text-[#49382E]">{selectedDayLabel}</strong></span>
            <span className="text-[#D4AF37] font-semibold">Clique em um agendamento para ver detalhes</span>
          </div>

          {/* Schedule Slots Rows */}
          <div className="space-y-2.5 overflow-y-auto max-h-[650px] pr-1">
            {timeSlots.filter(s => s.active).map(slot => {
              const dayBlockApt = appointments.find(
                a => a.status === 'bloqueado' &&
                     (a.time === 'Dia Inteiro' || a.serviceDuration === 'Dia Inteiro') &&
                     areDatesEqual(a.date, selectedDayLabel)
              );
              const matchingApt = appointments.find(
                a => a.time === slot.time && areDatesEqual(a.date, selectedDayLabel)
              ) || dayBlockApt;
              const isBlocked = slot.status === 'bloqueado' || slot.status === 'autoclave' || slot.status === 'almoco' || (matchingApt?.status === 'bloqueado');
              const isSelected = matchingApt && selectedSlotKey === matchingApt.id;

              return (
                <div
                  key={slot.id}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isSelected
                      ? 'bg-[#FBF2D5] border-[#D4AF37] shadow-xs'
                      : matchingApt
                      ? matchingApt.status === 'bloqueado'
                        ? 'bg-red-50/70 border-red-200 hover:border-red-400 cursor-pointer shadow-xs'
                        : 'bg-[#FFFFFF] border-[#E8D9B5] hover:border-[#D4AF37] cursor-pointer shadow-xs'
                      : isBlocked
                      ? 'bg-red-50 border-red-200 opacity-80'
                      : 'bg-[#FDFBF9] border-[#E8D9B5]'
                  }`}
                  onClick={() => {
                    if (matchingApt) setSelectedSlotKey(matchingApt.id);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-14 py-1.5 rounded-lg bg-[#F7EFEA] border border-[#E8D9B5] text-center font-syne text-sm font-bold text-[#49382E] shrink-0">
                      {slot.time}
                    </div>

                    <div className="flex flex-col min-w-0">
                      {matchingApt ? (
                        matchingApt.status === 'bloqueado' ? (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="font-syne text-sm font-bold text-red-900 truncate">
                                {matchingApt.clientName || 'Bloqueio de Agenda'}
                              </span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 border border-red-300">
                                Bloqueado
                              </span>
                            </div>
                            <span className="font-jakarta text-xs text-red-700">
                              {matchingApt.notes || matchingApt.blockReason || 'Horário indisponível pela administração'}
                            </span>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="font-syne text-sm font-bold text-[#49382E] truncate">
                                {matchingApt.clientName}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  matchingApt.status === 'confirmado'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                                }`}
                              >
                                {matchingApt.status === 'confirmado' ? 'Confirmado' : 'Aguardando Pix'}
                              </span>
                            </div>
                            <span className="font-jakarta text-xs text-[#786C63]">
                              {matchingApt.serviceTitle} • {matchingApt.servicePrice}
                            </span>
                          </>
                        )
                      ) : isBlocked ? (
                        <div className="flex items-center gap-1.5 text-xs text-red-700 font-medium">
                          <span className="material-symbols-outlined text-[16px]">block</span>
                          <span>Bloqueado: {slot.note || 'Intervalo / Indisponível'}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-[#786C63]">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span>Horário Disponível para Atendimento</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {matchingApt && (
                    matchingApt.status === 'bloqueado' ? (
                      onDeleteAppointment && (
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              void handleDeleteAppointment(matchingApt);
                            }}
                            className="px-3 py-1 rounded-full bg-red-100 hover:bg-red-200 text-red-800 border border-red-300 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                            title="Desbloquear horário/data"
                          >
                            <span className="material-symbols-outlined text-[14px]">lock_open</span>
                            <span>Desbloquear</span>
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setEditingAppointment(matchingApt);
                          }}
                          className="px-3 py-1 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] text-xs font-semibold hover:border-[#D4AF37] hover:text-[#D4AF37] transition-colors inline-flex items-center gap-1 shadow-xs cursor-pointer"
                          title="Editar agendamento"
                        >
                          <span className="material-symbols-outlined text-[14px] text-[#D4AF37]">edit</span>
                          <span>Editar</span>
                        </button>

                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            handleSendReminderWhatsApp(matchingApt);
                          }}
                          className="px-3 py-1 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] text-xs font-semibold hover:border-[#D4AF37] hover:text-[#D4AF37] transition-colors inline-flex items-center gap-1 shadow-xs cursor-pointer"
                          title="Enviar lembrete pelo WhatsApp"
                        >
                          <span className="material-symbols-outlined text-[14px] text-[#D4AF37]">chat</span>
                          <span>Lembrete</span>
                        </button>

                        {matchingApt.status !== 'concluido' && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              handleFinalizeAppointment(matchingApt);
                            }}
                            className="px-3 py-1 rounded-full bg-[#D4AF37] text-[#3C2F00] text-xs font-bold hover:bg-[#E5C158] transition-colors shadow-xs cursor-pointer"
                          >
                            Concluir
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Dossier Right Panel (4 cols) */}
        <div className="xl:col-span-4 bg-[#FFFFFF] rounded-2xl p-5 border border-[#E8D9B5] shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5] mb-4">
            <span className="material-symbols-outlined text-[#D4AF37]">receipt_long</span>
            <h3 className="font-syne text-base text-[#49382E] font-bold">
              Ficha Técnica do Atendimento
            </h3>
          </div>

          {selectedAppointment ? (
            selectedAppointment.status === 'bloqueado' ? (
              <div className="space-y-4 font-jakarta text-xs">
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 space-y-1">
                  <span className="text-[10px] text-red-600 uppercase tracking-wider font-bold">
                    Bloqueio Administrativo
                  </span>
                  <div className="font-syne text-base text-red-900 font-bold">
                    {selectedAppointment.clientName || 'Bloqueio de Agenda'}
                  </div>
                  <div className="text-red-700">
                    Data: <strong>{selectedAppointment.date}</strong> • Horário: <strong>{selectedAppointment.time}</strong>
                  </div>
                  {selectedAppointment.blockReason && (
                    <div className="text-red-800 font-semibold mt-1">
                      Motivo: {selectedAppointment.blockReason}
                    </div>
                  )}
                </div>

                {selectedAppointment.notes && (
                  <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#E8D9B5] text-[#786C63]">
                    <strong className="text-[#49382E] block mb-0.5">Observações:</strong>
                    {selectedAppointment.notes}
                  </div>
                )}

                <div className="pt-3 border-t border-[#E8D9B5] flex flex-col gap-2">
                  {onDeleteAppointment && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteAppointment(selectedAppointment)}
                      className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <span className="material-symbols-outlined text-[16px]">lock_open</span>
                      <span>Desbloquear Data / Horário</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4 font-jakarta text-xs">
                <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
                  <span className="text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold">
                    Cliente
                  </span>
                  <div className="font-syne text-base text-[#49382E] font-bold">
                    {selectedAppointment.clientName}
                  </div>
                  <div className="text-[#786C63]">
                    WhatsApp: {selectedAppointment.clientPhone}
                  </div>
                  {selectedAppointment.clientInstagram && (
                    <div className="text-[#D4AF37] font-semibold">
                      Instagram: {selectedAppointment.clientInstagram}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-[#786C63]">
                    <span>Procedimento:</span>
                    <span className="text-[#49382E] font-semibold">{selectedAppointment.serviceTitle}</span>
                  </div>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Data &amp; Hora:</span>
                    <span className="text-[#49382E] font-semibold">
                      {selectedAppointment.date} às {selectedAppointment.time}
                    </span>
                  </div>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Valor do Serviço:</span>
                    <span className="text-[#49382E] font-semibold">{selectedAppointment.servicePrice}</span>
                  </div>
                  <div className="flex justify-between text-[#786C63]">
                    <span>
                      {selectedAppointment.paymentMode === 'pre_pagamento_100'
                        ? 'Pré-pagamento Pix (100%):'
                        : 'Sinal Pix (40%):'}
                    </span>
                    <span className="text-[#D4AF37] font-bold">
                      R$ {formatBRL(selectedAppointment.depositAmount)} ({selectedAppointment.depositStatus})
                    </span>
                  </div>
                </div>

                {selectedAppointment.nailCondition && (
                  <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#E8D9B5] text-[#786C63]">
                    <strong className="text-[#49382E] block mb-0.5">Condição da Lâmina:</strong>
                    {selectedAppointment.nailCondition}
                  </div>
                )}

                {selectedAppointment.notes && (
                  <div className="p-3 rounded-lg bg-[#FDFBF9] border border-[#E8D9B5] text-[#786C63]">
                    <strong className="text-[#49382E] block mb-0.5">Observações:</strong>
                    {selectedAppointment.notes}
                  </div>
                )}

                {/* WhatsApp Business Confirmation Status Badge */}
                <div className="p-3 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="material-symbols-outlined text-[#25D366] text-[18px]">
                      {selectedAppointment.whatsappStatus === 'enviado' ? 'verified' : 'chat'}
                    </span>
                    <div className="truncate">
                      <span className="font-bold text-[#49382E] block text-[11px]">
                        WhatsApp Business API
                      </span>
                      <span className="text-[10px] text-[#786C63]">
                        {selectedAppointment.whatsappStatus === 'enviado'
                          ? `Enviado às ${selectedAppointment.whatsappSentAt || ''}`
                          : selectedAppointment.whatsappStatus === 'simulado'
                          ? 'Simulado com Sucesso'
                          : selectedAppointment.whatsappStatus === 'falha'
                          ? 'Falha no envio anterior'
                          : 'Confirmação pendente'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isDispatchingWa}
                    onClick={() => handleDispatchConfirmationWhatsApp(selectedAppointment)}
                    className="px-2.5 py-1 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] text-[10px] font-bold transition-all shadow-xs shrink-0 cursor-pointer flex items-center gap-1 disabled:opacity-50"
                    title="Enviar mensagem oficial de confirmação com data, horário e endereço via WhatsApp"
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {isDispatchingWa ? 'sync' : 'send'}
                    </span>
                    <span>{isDispatchingWa ? 'Enviando...' : 'Disparar Confirmação'}</span>
                  </button>
                </div>

                <div className="pt-3 border-t border-[#E8D9B5] flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingAppointment(selectedAppointment)}
                    className="w-full py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                    <span>Editar Agendamento</span>
                  </button>
                  {onDeleteAppointment && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteAppointment(selectedAppointment)}
                      className="w-full py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-red-200"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                      <span>Excluir Agendamento</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleSendReminderWhatsApp(selectedAppointment)}
                    className="w-full py-2.5 rounded-xl bg-[#FFFFFF] hover:bg-[#FDFBF9] text-[#49382E] hover:text-[#D4AF37] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-[#E8D9B5] shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">chat</span>
                    <span>Abrir Conversa Manual (wa.me)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectClientForDossier(selectedAppointment.clientName)}
                    className="w-full py-2.5 rounded-xl bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] transition-all text-center cursor-pointer border border-[#E8D9B5] font-semibold"
                  >
                    Ver Perfil Completo na Gestão de Clientes
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="py-12 text-center text-xs text-[#786C63] space-y-2">
              <span className="material-symbols-outlined text-[36px] text-[#A39A90] block">
                touch_app
              </span>
              <p className="font-semibold text-[#49382E]">Nenhum agendamento selecionado.</p>
              <p className="text-[11px] text-[#786C63]">
                Selecione um horário com agendamento na grade ao lado para inspecionar os detalhes do procedimento.
              </p>
            </div>
          )}
        </div>
      </div>

      <EditAppointmentModal
        isOpen={Boolean(editingAppointment)}
        appointment={editingAppointment}
        onClose={() => setEditingAppointment(null)}
        onSave={handleSaveEditedAppointment}
        services={services}
      />
    </div>
  );
};
