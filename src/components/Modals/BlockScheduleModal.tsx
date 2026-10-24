import React, { useState, useEffect } from 'react';

export interface BlockScheduleData {
  reason: string;
  date: string;
  endDate?: string;
  timeSpan: string;
  notes?: string;
}

interface BlockScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmBlock: (data: BlockScheduleData) => Promise<{ success: boolean; error?: string }> | void;
  initialDate?: string;
}

export const BlockScheduleModal: React.FC<BlockScheduleModalProps> = ({
  isOpen,
  onClose,
  onConfirmBlock,
  initialDate
}) => {
  const [reason, setReason] = useState('Folga / Descanso');
  const [date, setDate] = useState(() => { const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const p = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${p.year}-${p.month}-${p.day}`; });
  const [endDate, setEndDate] = useState(date);
  const [isAllDay, setIsAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('19:30');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (initialDate) {
      setDate(initialDate);
      setEndDate(initialDate);
    }
  }, [initialDate, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setSubmitError(null);
      setIsSubmitting(false);
      if (reason === 'Folga / Descanso') {
        setIsAllDay(true);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date.trim()) {
      setSubmitError('Por favor, informe a data para bloqueio.');
      return;
    }
    if (!date.trim() || !endDate.trim() || endDate < date) {
      setSubmitError('A data final deve ser igual ou posterior à data inicial.');
      return;
    }
    if (!isAllDay) {
      const toMinutes = (value: string) => { const match = /^(\d{2}):(\d{2})$/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : NaN; };
      const start = toMinutes(startTime);
      const end = toMinutes(endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1439 || end <= start) {
        setSubmitError('Informe um intervalo válido: o horário final deve ser posterior ao inicial.');
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const timeSpan = isAllDay ? 'Dia Inteiro' : `${startTime} às ${endTime}`;

    try {
      const result = await onConfirmBlock({
        reason,
        date: date.trim(),
        endDate: endDate.trim(),
        timeSpan,
        notes: notes.trim() || undefined
      });

      if (!result || result.success) {
        onClose();
      } else {
        setSubmitError(result.error || 'Falha ao salvar bloqueio no servidor.');
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Erro de comunicação ao salvar bloqueio.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-[#E8D9B5] shadow-2xl relative flex flex-col gap-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">block</span>
            <h3 className="font-syne text-lg text-[#49382E] font-bold">Bloquear Grade ou Horário</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <p className="font-jakarta text-xs text-[#786C63]">
          Bloqueios impedem novas reservas na área pública de agendamento online e marcam seu calendário visualmente.
        </p>

        {submitError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-red-600 text-[18px]">error</span>
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-jakarta text-xs">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase text-[#786C63] font-bold">Motivo do Bloqueio</label>
            <div className="grid grid-cols-3 gap-2">
              {['Folga / Descanso', 'Férias', 'Feriado', 'Esterilização Autoclave', 'Almoço Privativo'].map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setReason(opt);
                    if (opt === 'Folga / Descanso') setIsAllDay(true);
                  }}
                  className={`py-2 px-2.5 rounded-xl font-bold text-[11px] transition-all cursor-pointer text-center border ${
                    reason === opt
                      ? 'bg-[#FBF2D5] text-[#3C2F00] border-[#D4AF37]'
                      : 'bg-[#FDFBF9] text-[#786C63] border-[#E8D9B5] hover:bg-[#F7EFEA]'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Data inicial *</label>
              <input type="date" value={date}
                onChange={e => { setDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }}
                required className="bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] font-semibold" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Data final *</label>
              <input type="date" min={date} value={endDate} onChange={e => setEndDate(e.target.value)}
                required className="bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] font-semibold" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Tipo de Bloqueio</label>
              <button
                type="button"
                onClick={() => setIsAllDay(prev => !prev)}
                className={`py-2.5 px-3 rounded-xl border text-center font-bold text-xs transition-all cursor-pointer ${
                  isAllDay
                    ? 'bg-[#FBF2D5] text-[#3C2F00] border-[#D4AF37]'
                    : 'bg-[#FDFBF9] text-[#786C63] border-[#E8D9B5]'
                }`}
              >
                {isAllDay ? '✓ Dia Inteiro' : 'Horário Específico'}
              </button>
            </div>

          {!isAllDay && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Horário de Início e Fim</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  step={1800}
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-1/2 bg-[#FDFBF9] text-[#49382E] px-2 py-2.5 rounded-xl text-center border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
                />
                <span className="text-[#786C63]">às</span>
                <input
                  type="time"
                  step={1800}
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-1/2 bg-[#FDFBF9] text-[#49382E] px-2 py-2.5 rounded-xl text-center border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-[#786C63] font-bold">Observações Internas</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Opcional: motivo ou detalhes do bloqueio"
              className="bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E8D9B5]">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-bold hover:bg-[#E5C158] shadow-md cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                  <span>Salvando Bloqueio...</span>
                </>
              ) : (
                <span>Confirmar Bloqueio</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
