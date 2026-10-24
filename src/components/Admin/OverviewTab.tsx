import React, { useState } from 'react';
import { Appointment } from '../../types';
import { formatBRL } from '../../services/notificationTemplates';
import { OverviewCalendar } from './OverviewCalendar';

interface OverviewTabProps {
  onOpenManualBooking: () => void;
  onNavigateToTab: (tab: any) => void;
  onSelectAppointmentForReview: (clientName: string) => void;
  todayAppointments: Appointment[];
  allAppointments: Appointment[];
  onSaveAppointment: (appointment: Appointment) => Promise<void> | void;
  onDeleteAppointment: (appointment: Appointment) => Promise<void> | void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  onOpenManualBooking,
  onNavigateToTab,
  onSelectAppointmentForReview,
  todayAppointments,
  allAppointments,
  onSaveAppointment,
  onDeleteAppointment
}) => {
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const startEditing = (apt: Appointment) => {
    setEditingAppointment(apt);
    setEditDate(normalizeAppointmentDate(apt.date));
    setEditTime(apt.time || '');
    setEditName(apt.clientName || '');
    setEditPhone(apt.clientPhone || '');
    setEditNotes(apt.notes || '');
  };

  const saveEditing = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingAppointment || !editDate || !editTime || !editName.trim()) return;
    setEditBusy(true);
    try {
      await onSaveAppointment({ ...editingAppointment, date: editDate, time: editTime, clientName: editName.trim(), clientPhone: editPhone.trim(), notes: editNotes.trim() });
      setEditingAppointment(null);
    } finally { setEditBusy(false); }
  };

  function normalizeAppointmentDate(value: string): string {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\\d{4}-\\d{2}-\\d{2})$/);
    if (iso) return iso[1];
    const br = raw.match(/^(\\d{2})[/.](\\d{2})[/.](\\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    const monthDayYear = raw.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})$/);
    if (monthDayYear) return `${monthDayYear[3]}-${monthDayYear[1].padStart(2,'0')}-${monthDayYear[2].padStart(2,'0')}`;
    return '';
  }
  // Real dynamic metrics calculated from actual appointments
  const confirmedAppointments = todayAppointments.filter(
    a => a.status === 'confirmado' || a.depositStatus === 'liquidado'
  );
  const pendingPixAppointments = todayAppointments.filter(
    a => a.status === 'pendente_pix' || a.depositStatus === 'pendente'
  );

  const totalLiquidatedRevenue = confirmedAppointments.reduce((acc, a) => {
    return acc + (a.depositAmount || 0);
  }, 0);

  const pendingPixSum = pendingPixAppointments.reduce((acc, a) => {
    return acc + (a.depositAmount || 0);
  }, 0);

  // Group appointments by procedure
  const procedureCounts: Record<string, number> = {};
  todayAppointments.forEach(a => {
    procedureCounts[a.serviceTitle] = (procedureCounts[a.serviceTitle] || 0) + 1;
  });
  const procedureEntries = Object.entries(procedureCounts);

  return (
    <div className="flex flex-col gap-8 text-[#49382E]">
      {/* Top Greeting Ribbon */}
      <div className="relative overflow-hidden rounded-2xl bg-[#FFFFFF] p-6 lg:p-8 shadow-xs border border-[#E8D9B5]">
        <div className="absolute -right-16 -top-16 w-80 h-80 rounded-full bg-[#D4AF37]/5 blur-3xl pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
                Painel Executivo • Manicure | Nail Designer
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37]" />
              <span className="font-jakarta text-[11px] text-[#786C63]">
                São Sebastião - SP • Pontal da Cruz
              </span>
            </div>
            <h1 className="font-syne text-3xl sm:text-4xl text-[#49382E] font-bold tracking-tight">
              Olá, Angélica
            </h1>
            <p className="font-jakarta text-xs sm:text-sm text-[#786C63] max-w-xl">
              {todayAppointments.length === 0
                ? 'Nenhum agendamento ativo na grade de hoje. Novos horários agendados pelo site aparecerão aqui.'
                : `${todayAppointments.length} agendamento(s) registrado(s) hoje. ${confirmedAppointments.length} confirmado(s) e ${pendingPixAppointments.length} aguardando validação de sinal Pix.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="px-4 py-2 rounded-full bg-[#F7EFEA] flex items-center gap-2 shadow-xs border border-[#E8D9B5]">
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D4AF37]" />
              </span>
              <span className="font-jakarta text-xs text-[#49382E] font-semibold">
                Atelier Privativo
              </span>
            </div>

            <button
              type="button"
              onClick={onOpenManualBooking}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs sm:text-[13px] font-bold tracking-wider shadow-[0_4px_16px_rgba(212,175,55,0.3)] hover:bg-[#E5C158] transition-all cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">add_circle</span>
              <span>Novo Agendamento Manual</span>
            </button>
          </div>
        </div>
      </div>

      <OverviewCalendar appointments={allAppointments} onOpenAgenda={() => onNavigateToTab('agenda-bloqueios')} />

      {/* 4 KPIs Cards (Calculated from Real Data) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* KPI 1: Faturamento Confirmado */}
        <div className="p-5 rounded-2xl bg-[#FFFFFF] flex flex-col justify-between shadow-xs border border-[#E8D9B5] transition-all hover:shadow-md min-w-0 box-border">
          <div className="flex items-start justify-between gap-2">
            <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#786C63] font-bold truncate">
              Receita Confirmada
            </span>
            <div className="w-9 h-9 rounded-full bg-[#F7EFEA] flex items-center justify-center text-[#D4AF37] border border-[#E8D9B5] shrink-0">
              <span className="material-symbols-outlined text-[20px]">diamond</span>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-1 min-w-0">
            <span className="font-syne text-2xl sm:text-3xl text-[#49382E] font-bold truncate">
              R$ {totalLiquidatedRevenue.toFixed(2).replace('.', ',')}
            </span>
            <div className="flex items-center gap-1.5 font-jakarta text-xs min-w-0">
              <span className="text-[#D4AF37] font-bold shrink-0">
                {confirmedAppointments.length}
              </span>
              <span className="text-[#786C63] truncate">atendimento(s) confirmado(s)</span>
            </div>
          </div>
        </div>

        {/* KPI 2: Atendimentos Hoje */}
        <div className="p-5 rounded-2xl bg-[#FFFFFF] flex flex-col justify-between shadow-xs border border-[#E8D9B5] transition-all hover:shadow-md min-w-0 box-border">
          <div className="flex items-start justify-between gap-2">
            <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#786C63] font-bold truncate">
              Atendimentos Registrados
            </span>
            <div className="w-9 h-9 rounded-full bg-[#F7EFEA] flex items-center justify-center text-[#D4AF37] border border-[#E8D9B5] shrink-0">
              <span className="material-symbols-outlined text-[20px]">spa</span>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-1 min-w-0">
            <span className="font-syne text-2xl sm:text-3xl text-[#49382E] font-bold truncate">
              {todayAppointments.length} {todayAppointments.length === 1 ? 'Sessão' : 'Sessões'}
            </span>
            <div className="flex items-center gap-1.5 font-jakarta text-xs min-w-0 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-[#D4AF37] shrink-0" />
              <span className="text-[#49382E] font-semibold shrink-0">
                {confirmedAppointments.length} confirmada(s)
              </span>
              <span className="text-[#786C63] shrink-0">•</span>
              <span className="text-[#D4AF37] font-semibold shrink-0">
                {pendingPixAppointments.length} pendente(s)
              </span>
            </div>
          </div>
        </div>

        {/* KPI 3: Sinais Pix Pendentes */}
        <div className="p-5 rounded-2xl bg-[#FFFFFF] flex flex-col justify-between shadow-xs border border-[#E8D9B5] transition-all hover:shadow-md min-w-0 box-border">
          <div className="flex items-start justify-between gap-2">
            <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#786C63] font-bold truncate">
              Sinais Pix Pendentes
            </span>
            <div className="w-9 h-9 rounded-full bg-[#F7EFEA] flex items-center justify-center text-[#D4AF37] border border-[#E8D9B5] shrink-0">
              <span className="material-symbols-outlined text-[20px]">mark_email_unread</span>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-1.5 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap min-w-0">
              <span className="font-syne text-2xl sm:text-3xl text-[#49382E] font-bold shrink-0">
                {pendingPixAppointments.length}
              </span>
              <span className="font-jakarta text-xs sm:text-sm text-[#49382E] font-semibold break-words">
                {pendingPixAppointments.length === 1 ? 'Comprovante' : 'Comprovantes'}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 font-jakarta text-xs min-w-0">
              <span className="text-[#D4AF37] font-bold truncate">
                R$ {pendingPixSum.toFixed(2).replace('.', ',')}
              </span>
              <span className="text-[#786C63] text-[11px] leading-tight break-words">
                aguardando conferência bancária
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Main Asymmetric Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Left Column (7 cols): Linha do Tempo Real */}
        <div className="xl:col-span-7 flex flex-col gap-8">
          <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#E8D9B5] gap-3">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">calendar_month</span>
                <div className="flex flex-col">
                  <h2 className="font-syne text-lg sm:text-xl text-[#49382E] font-bold">
                    Linha do Tempo de Atendimentos
                  </h2>
                  <span className="font-jakarta text-[11px] text-[#786C63]">
                    Agendamentos confirmados e solicitações registradas
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-[#F7EFEA] text-[#49382E] font-jakarta text-xs font-semibold border border-[#E8D9B5]">
                  {todayAppointments.length} Registro(s)
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateToTab('agenda-bloqueios')}
                  className="p-1.5 text-[#786C63] hover:text-[#D4AF37] transition-colors cursor-pointer"
                  title="Ver agenda completa"
                >
                  <span className="material-symbols-outlined text-[20px]">calendar_today</span>
                </button>
              </div>
            </div>

            {/* Timeline Items or True Empty State */}
            <div className="flex flex-col gap-3 mt-5">
              {todayAppointments.length === 0 ? (
                <div className="py-12 px-6 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] flex flex-col items-center justify-center text-center">
                  <div className="w-12 h-12 rounded-full bg-[#F7EFEA] flex items-center justify-center text-[#786C63] mb-3 border border-[#E8D9B5]">
                    <span className="material-symbols-outlined text-[24px]">event_available</span>
                  </div>
                  <h3 className="font-syne text-base font-bold text-[#49382E]">
                    Nenhum agendamento registrado
                  </h3>
                  <p className="font-jakarta text-xs text-[#786C63] max-w-sm mt-1">
                    Conforme clientes agendarem pelo site ou você inserir reservas manuais, elas serão exibidas em tempo real nesta linha do tempo.
                  </p>
                  <button
                    type="button"
                    onClick={onOpenManualBooking}
                    className="mt-4 px-4 py-2 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_circle</span>
                    <span>Criar Agendamento Manual</span>
                  </button>
                </div>
              ) : (
                todayAppointments.map(apt => (
                  <div
                    key={apt.id}
                    className="p-4 rounded-xl bg-[#FDFBF9] flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-[#E8D9B5] hover:border-[#D4AF37]/50 transition-all shadow-xs"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex flex-col items-center justify-center w-14 py-1.5 rounded-lg bg-[#F7EFEA] text-[#49382E] border border-[#E8D9B5]">
                        <span className="font-syne text-base font-bold leading-none">{apt.time}</span>
                        <span className="font-jakarta text-[10px] text-[#786C63]">{apt.date.split(',')[0]}</span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-syne text-base text-[#49382E] font-semibold truncate">
                            {apt.clientName}
                          </span>
                          {apt.isBlacklisted && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-jakarta text-[9px] font-bold border border-amber-300">
                              Pré-pagamento 100%
                            </span>
                          )}
                        </div>
                        <span className="font-jakarta text-xs text-[#786C63]">
                          {apt.serviceTitle} • {apt.serviceDuration}
                        </span>
                        <div className="flex items-center gap-2 mt-1 font-jakarta text-xs">
                          <span className="text-[#D4AF37] font-semibold">
                            {apt.paymentMode === 'pre_pagamento_100'
                              ? 'Pré-pagamento (100%)'
                              : 'Sinal (40%)'}
                            : R$ {formatBRL(apt.depositAmount)} ({apt.depositStatus === 'liquidado' ? 'Liquidado' : 'Pendente de conferência'})
                          </span>
                          {apt.recurrence && (
                            <span className="text-[#786C63] text-[10px]">
                              • Recorrente ({apt.recurrence.frequencyLabel})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-jakarta font-semibold flex items-center gap-1 ${
                          apt.status === 'confirmado'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                            : apt.status === 'pendente_pix'
                            ? 'bg-amber-50 text-amber-800 border border-amber-300'
                            : 'bg-[#F7EFEA] text-[#786C63] border border-[#E8D9B5]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {apt.status === 'confirmado' ? 'check_circle' : 'pending'}
                        </span>
                        {apt.status === 'confirmado' ? 'Confirmado' : 'Aguardando Pix'}
                      </span>
                      <button
                        type="button"
                        title="Editar agendamento"
                        onClick={() => startEditing(apt)}
                        className="w-8 h-8 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#9A7410] border border-[#E8D9B5] flex items-center justify-center cursor-pointer shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button
                        type="button"
                        title="Excluir agendamento"
                        onClick={() => {
                          if (window.confirm(`Tem certeza de que deseja excluir o agendamento de ${apt.clientName} em ${apt.date} às ${apt.time}? Esta ação não pode ser desfeita.`)) void onDeleteAppointment(apt);
                        }}
                        className="w-8 h-8 rounded-full bg-[#FFFFFF] text-[#B42318] hover:bg-red-50 border border-[#E8D9B5] flex items-center justify-center cursor-pointer shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                      <button
                        type="button"
                        title="Ver detalhes da cliente"
                        onClick={() => {
                          onNavigateToTab('gestao-clientes');
                          onSelectAppointmentForReview(apt.clientName);
                        }}
                        className="w-8 h-8 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] flex items-center justify-center cursor-pointer shadow-xs"
                      >
                        <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Procedimentos & Sinais Pendentes */}
        <div className="xl:col-span-5 flex flex-col gap-8">
          {/* Sinais Pix Pendentes de Conferência */}
          <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8D9B5] mb-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#D4AF37]">payments</span>
                <h3 className="font-syne text-base sm:text-lg text-[#49382E] font-bold">
                  Sinais Pix Aguardando Conferência
                </h3>
              </div>
              <span className="font-jakarta text-[11px] text-[#D4AF37] font-bold">
                {pendingPixAppointments.length} pendente(s)
              </span>
            </div>

            {pendingPixAppointments.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#786C63]">
                <span className="material-symbols-outlined text-[32px] text-[#E8D9B5] block mb-1">
                  done_all
                </span>
                Nenhum sinal Pix pendente de conferência manual no momento.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingPixAppointments.map(p => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] flex items-center justify-between gap-3 shadow-xs"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-syne text-xs sm:text-sm font-bold text-[#49382E] truncate">
                        {p.clientName}
                      </span>
                      <span className="font-jakarta text-[11px] text-[#786C63]">
                        {p.serviceTitle} • R$ {formatBRL(p.depositAmount)}
                      </span>
                      <span className="font-jakarta text-[10px] text-[#D4AF37] font-semibold">
                        Horário: {p.date} às {p.time}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigateToTab('confirmacao-sinais-pix')}
                      className="px-3 py-1.5 rounded-full bg-[#F7EFEA] hover:bg-[#D4AF37] hover:text-[#3C2F00] text-[#49382E] text-xs font-semibold shrink-0 cursor-pointer border border-[#E8D9B5]"
                    >
                      Conferir
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Procedimentos Agendados Hoje */}
          <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
            <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5] mb-4">
              <span className="material-symbols-outlined text-[#D4AF37]">palette</span>
              <h3 className="font-syne text-base sm:text-lg text-[#49382E] font-bold">
                Procedimentos na Grade
              </h3>
            </div>

            {procedureEntries.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#786C63]">
                Sem atendimentos registrados para estatística de procedimentos.
              </div>
            ) : (
              <div className="space-y-3">
                {procedureEntries.map(([title, count]) => (
                  <div key={title} className="space-y-1">
                    <div className="flex justify-between font-jakarta text-xs text-[#49382E]">
                      <span className="truncate pr-2">{title}</span>
                      <span className="font-bold text-[#D4AF37]">
                        {count} ({Math.round((count / todayAppointments.length) * 100)}%)
                      </span>
                    </div>
                    <div className="w-full bg-[#F7EFEA] h-1.5 rounded-full overflow-hidden border border-[#E8D9B5]">
                      <div
                        className="bg-[#D4AF37] h-full rounded-full"
                        style={{ width: `${Math.round((count / todayAppointments.length) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {editingAppointment && (
        <div className="fixed inset-0 z-[70] bg-[#49382E]/50 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={saveEditing} className="bg-white rounded-2xl border border-[#E8D9B5] shadow-2xl p-6 w-full max-w-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-syne text-xl font-bold text-[#49382E]">Editar agendamento</h3>
              <button type="button" onClick={() => setEditingAppointment(null)} className="w-9 h-9 rounded-full border border-[#E8D9B5]" aria-label="Fechar">×</button>
            </div>
            <p className="text-xs text-[#786C63]">ID do registo: {editingAppointment.id}. O serviço e os valores financeiros atuais serão preservados.</p>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#49382E]">Nome da cliente
              <input required value={editName} onChange={e => setEditName(e.target.value)} className="border border-[#E8D9B5] rounded-lg p-2.5" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#49382E]">Telefone
              <input value={editPhone} onChange={e => setEditPhone(e.target.value)} className="border border-[#E8D9B5] rounded-lg p-2.5" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#49382E]">Data
                <input type="date" required value={editDate} onChange={e => setEditDate(e.target.value)} className="border border-[#E8D9B5] rounded-lg p-2.5" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#49382E]">Hora
                <input type="time" required value={editTime} onChange={e => setEditTime(e.target.value)} className="border border-[#E8D9B5] rounded-lg p-2.5" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#49382E]">Observações
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} className="border border-[#E8D9B5] rounded-lg p-2.5" />
            </label>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">A pré-visualização permanece somente leitura. Guardar ou excluir não alterará a planilha enquanto a escrita não for autorizada.</div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditingAppointment(null)} className="rounded-full border border-[#E8D9B5] px-4 py-2 text-sm">Cancelar</button>
              <button disabled={editBusy} type="submit" className="rounded-full bg-[#D4AF37] text-[#3C2F00] px-5 py-2 text-sm font-bold disabled:opacity-50">{editBusy ? 'A guardar…' : 'Guardar alterações'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
