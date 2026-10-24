import React, { useMemo, useState } from 'react';
import { Appointment } from '../../types';

interface OverviewCalendarProps {
  appointments: Appointment[];
  onOpenAgenda: () => void;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTH_NUMBER: Record<string, number> = {
  jan: 0, janeiro: 0, fev: 1, fevereiro: 1, mar: 2, março: 2, abr: 3, abril: 3,
  mai: 4, maio: 4, jun: 5, junho: 5, jul: 6, julho: 6, ago: 7, agosto: 7,
  set: 8, setembro: 8, out: 9, outubro: 9, nov: 10, novembro: 10, dez: 11, dezembro: 11
};

function parseAppointmentDate(value: string, fallbackYear: number): Date | null {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const slash = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (slash) return new Date(Number(slash[3] || fallbackYear), Number(slash[2]) - 1, Number(slash[1]));
  const named = text.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)/);
  if (named) {
    const month = MONTH_NUMBER[named[2].toLocaleLowerCase('pt-BR').replace('.', '')];
    if (month !== undefined) return new Date(fallbackYear, month, Number(named[1]));
  }
  return null;
}

export const OverviewCalendar: React.FC<OverviewCalendarProps> = ({ appointments, onOpenAgenda }) => {
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const base = new Date();
  const displayedMonth = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
  const year = displayedMonth.getFullYear();
  const month = displayedMonth.getMonth();

  const datedAppointments = useMemo(() => appointments
    .filter(a => a.status !== 'cancelado' && a.status !== 'bloqueado')
    .map(a => ({ appointment: a, date: parseAppointmentDate(a.date, year) }))
    .filter((item): item is { appointment: Appointment; date: Date } => Boolean(item.date)), [appointments, year]);

  const byDay = new Map<number, Appointment[]>();
  datedAppointments.forEach(({ appointment, date }) => {
    if (date.getFullYear() !== year || date.getMonth() !== month) return;
    const list = byDay.get(date.getDate()) || [];
    list.push(appointment);
    byDay.set(date.getDate(), list);
  });

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const selectedAppointments = selectedDate ? (byDay.get(Number(selectedDate.split('-')[2])) || []) : [];

  return (
    <section className="rounded-2xl bg-white border border-[#E8D9B5] p-4 sm:p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-syne text-xl font-bold text-[#49382E]">Calendário de agendamentos</h2>
          <p className="font-jakarta text-xs text-[#786C63]">Visão mensal dos agendamentos carregados no painel.</p>
        </div>
        <button type="button" onClick={onOpenAgenda} className="rounded-full px-4 py-2 bg-[#D4AF37] text-[#3C2F00] text-xs font-bold hover:bg-[#E5C158]">
          Abrir agenda completa
        </button>
      </div>
      <div className="flex items-center justify-between mb-3">
        <button type="button" aria-label="Mês anterior" onClick={() => { setMonthOffset(v => v - 1); setSelectedDate(null); }} className="rounded-full border border-[#E8D9B5] px-3 py-1.5 text-[#49382E]">‹</button>
        <h3 className="font-jakarta font-bold text-sm capitalize text-[#49382E]">{MONTHS[month]} {year}</h3>
        <button type="button" aria-label="Próximo mês" onClick={() => { setMonthOffset(v => v + 1); setSelectedDate(null); }} className="rounded-full border border-[#E8D9B5] px-3 py-1.5 text-[#49382E]">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map(day => <div key={day} className="py-2 text-center text-[10px] sm:text-xs font-bold text-[#786C63]">{day}</div>)}
        {cells.map((day, index) => {
          const key = day ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : `empty-${index}`;
          const count = day ? (byDay.get(day)?.length || 0) : 0;
          const selected = selectedDate === key;
          return <button key={key} type="button" disabled={!day} onClick={() => day && setSelectedDate(key)} className={`min-h-12 sm:min-h-14 rounded-lg border text-sm flex flex-col items-center justify-center gap-1 ${!day ? 'border-transparent' : selected ? 'border-[#D4AF37] bg-[#FBF2D5]' : 'border-[#F0E6D7] hover:bg-[#FBF7F2]'} ${count ? 'font-bold text-[#49382E]' : 'text-[#786C63]'}`}>
            {day || ''}
            {count > 0 && <span className="rounded-full bg-[#D4AF37] text-[#3C2F00] min-w-4 px-1 text-[9px] leading-4">{count}</span>}
          </button>;
        })}
      </div>
      <div className="mt-4 border-t border-[#F0E6D7] pt-3">
        <h4 className="font-jakarta text-sm font-bold text-[#49382E] mb-2">{selectedDate ? `Agendamentos de ${selectedDate.split('-').reverse().join('/')}` : 'Selecione um dia para ver os agendamentos'}</h4>
        {selectedDate && selectedAppointments.length === 0 && <p className="text-xs text-[#786C63]">Nenhum agendamento registrado nesta data.</p>}
        {selectedAppointments.map(apt => <button key={apt.id} type="button" onClick={onOpenAgenda} className="w-full flex items-center justify-between gap-3 text-left rounded-xl p-3 mb-2 bg-[#FBF7F2] border border-[#E8D9B5] hover:bg-[#FBF2D5]">
          <span className="min-w-0"><span className="block font-jakarta text-xs font-bold text-[#49382E] truncate">{apt.clientName} · {apt.serviceTitle}</span><span className="block font-jakarta text-[11px] text-[#786C63]">{apt.time} · {apt.status}</span></span>
          <span className="text-xs font-bold text-[#9A7410]">Ver agenda →</span>
        </button>)}
      </div>
    </section>
  );
};
