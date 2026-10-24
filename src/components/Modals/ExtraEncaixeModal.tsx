import React, { useState } from 'react';

interface ExtraEncaixeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmEncaixe: (name: string, procedure: string, dateTime: string, feeApplied: boolean) => void;
}

export const ExtraEncaixeModal: React.FC<ExtraEncaixeModalProps> = ({
  isOpen,
  onClose,
  onConfirmEncaixe
}) => {
  const [clientName, setClientName] = useState('');
  const [procedure, setProcedure] = useState('Alongamento Fibra Slim Express');
  const [dateTime, setDateTime] = useState('Quinta, 14 Nov • 20:15');
  const [applyFee, setApplyFee] = useState(true);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      alert('Por favor informe o nome da cliente.');
      return;
    }
    onConfirmEncaixe(clientName.trim(), procedure, dateTime, applyFee);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-[#E8D9B5] shadow-2xl relative flex flex-col gap-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">flash_on</span>
            <h3 className="font-syne text-lg text-[#49382E] font-bold">Abertura de Encaixe Extraordinário</h3>
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
          Permite criar um atendimento fora dos horários habituais do ateliê ou sobrepor um intervalo com taxa de urgência opcional.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-jakarta text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase text-[#786C63] font-bold">Nome da Cliente *</label>
            <input
              type="text"
              required
              placeholder="Ex: Nome da cliente"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              className="bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Procedimento</label>
              <select
                value={procedure}
                onChange={e => setProcedure(e.target.value)}
                className="bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
              >
                <option value="Alongamento Fibra Slim Express">Alongamento Fibra Slim Express</option>
                <option value="Reparo de Unha Quebrada (Unitário)">Reparo de Unha Quebrada (Unitário)</option>
                <option value="Manutenção Emergencial">Manutenção Emergencial</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase text-[#786C63] font-bold">Horário Proposto</label>
              <input
                type="text"
                value={dateTime}
                onChange={e => setDateTime(e.target.value)}
                className="bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
              />
            </div>
          </div>

          {/* Surcharge Option */}
          <div className="p-3.5 bg-[#FDFBF9] rounded-xl flex items-center justify-between border border-[#E8D9B5]">
            <div className="flex flex-col">
              <span className="font-jakarta text-xs text-[#49382E] font-bold">
                Aplicar Taxa de Urgência Noturna (+20%)
              </span>
              <span className="font-jakarta text-[11px] text-[#786C63]">
                Valor adicional de R$ 45,00 somado ao serviço
              </span>
            </div>
            <input
              type="checkbox"
              checked={applyFee}
              onChange={e => setApplyFee(e.target.checked)}
              className="w-5 h-5 accent-[#D4AF37] cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E8D9B5]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-bold hover:bg-[#E5C158] shadow-md cursor-pointer transition-all"
            >
              Liberar &amp; Gerar Link Pix
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
