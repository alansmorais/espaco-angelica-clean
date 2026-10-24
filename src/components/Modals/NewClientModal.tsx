import React, { useState } from 'react';
import { ClientProfile } from '../../types';

interface NewClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveClient: (client: ClientProfile) => void;
}

export const NewClientModal: React.FC<NewClientModalProps> = ({
  isOpen,
  onClose,
  onSaveClient
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tier, setTier] = useState<'VIP Club' | 'Frequente' | 'Atrasada' | '1ª Sessão'>('1ª Sessão');
  const [preferredShape, setPreferredShape] = useState('');
  const [laminaType, setLaminaType] = useState('');
  const [oiliness, setOiliness] = useState('');
  const [allergies, setAllergies] = useState('');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!phone.trim() || phone.replace(/\D/g, '').length < 8) {
      window.alert('Informe o telefone/WhatsApp real da cliente para salvar o perfil.');
      return;
    }

    const initials = name
      .split(' ')
      .map(n => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const newClient: ClientProfile = {
      id: `client-${Date.now()}`,
      name: name.trim(),
      initials,
      phone: phone.trim(),
      tier,
      status: 'nova',
      lastVisit: '',
      lastService: '',
      nextMaintenanceDays: 0,
      daysRemainingOrOverdue: '',
      isOverdue: false,
      ltv: 0,
      ltvFormatted: 'R$ 0,00',
      laminaType,
      oiliness,
      allergies,
      onycholysis: '',
      preferredShape,
      preferredColor: '',
      products: {
        preparer: '',
        baseGel: '',
        tensionPoint: '',
        topCoat: ''
      },
      privateNotes: notes,
    };

    onSaveClient(newClient);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-lg w-full border border-[#E8D9B5] shadow-2xl relative flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37] text-[24px]">person_add</span>
            <h3 className="font-syne text-lg text-[#49382E] font-bold">Cadastrar Nova Cliente &amp; Anamnese</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 font-jakarta text-xs">
          <div>
            <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Nome Completo *</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Priscila Guimarães"
              className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">WhatsApp</label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(12) 98765-4321"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Perfil / Categoria</label>
              <select
                value={tier}
                onChange={e => setTier(e.target.value as any)}
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              >
                <option value="1ª Sessão">1ª Sessão</option>
                <option value="Frequente">Frequente</option>
                <option value="VIP Club">VIP Club</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Formato Preferido</label>
              <input
                type="text"
                value={preferredShape}
                onChange={e => setPreferredShape(e.target.value)}
                placeholder="Ex: Almond Fina"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Tipo de Lâmina</label>
              <input
                type="text"
                value={laminaType}
                onChange={e => setLaminaType(e.target.value)}
                placeholder="Ex: Levemente côncava / frágil"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Oleosidade Cutânea</label>
              <select
                value={oiliness}
                onChange={e => setOiliness(e.target.value)}
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              >
                <option value="Baixa">Baixa</option>
                <option value="Média">Média</option>
                <option value="Alta (Requer Primer Ácido)">Alta (Requer Primer Ácido)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Alergias Relatadas</label>
              <input
                type="text"
                value={allergies}
                onChange={e => setAllergies(e.target.value)}
                placeholder="Ex: Nenhuma alergia relatada"
                className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2.5 rounded-xl border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-base sm:text-xs min-h-[44px]"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-[#786C63] font-bold block mb-1">Observações Técnicas Privadas</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Sensibilidade a calor de cabine LED, preferências de acabamento..."
              className="w-full bg-[#FDFBF9] text-[#49382E] px-3.5 py-2 rounded-xl border border-[#E8D9B5] outline-none resize-none focus:border-[#D4AF37]"
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
              Salvar Ficha Técnica
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
