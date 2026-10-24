import React from 'react';
import { BRAND_ASSETS } from '../../data/mockData';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookNow: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  onBookNow
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-2xl w-full border border-[#E8D9B5] shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar modal"
          className="absolute top-4 right-4 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] transition-colors cursor-pointer active:scale-95"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-1.5 rounded-xl bg-[#0B0A0A] border border-[#E8D9B5] inline-flex shadow-xs">
            <img
              src={BRAND_ASSETS.logoGold}
              alt="Logo Angelica do Carmo"
              className="h-9 w-auto object-contain"
            />
          </div>
          <div>
            <h3 className="font-syne text-xl sm:text-2xl text-[#49382E] font-bold">
              Angélica do Carmo
            </h3>
            <span className="font-jakarta text-xs text-[#D4AF37] uppercase tracking-wider font-bold">
              Master Nail Artist &amp; Educadora
            </span>
          </div>
        </div>

        <div className="space-y-4 font-jakarta text-xs sm:text-sm text-[#786C63] leading-relaxed">
          <p>
            Com mais de 8 anos de dedicação exclusiva à alta estética das mãos, Angélica do Carmo especializou-se na técnica europeia de curvatura C anatômica em fibra de vidro slim e na cutilagem combinada russa com brocas diamantadas.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5]">
              <span className="font-syne text-sm text-[#D4AF37] font-bold block mb-1">
                Esterilização em Autoclave
              </span>
              <p className="text-xs text-[#786C63]">
                Todos os instrumentais são embalados em papel grau cirúrgico e abertos estritamente na presença de cada cliente.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5]">
              <span className="font-syne text-sm text-[#D4AF37] font-bold block mb-1">
                Géis Livres de Tolueno &amp; DBP
              </span>
              <p className="text-xs text-[#786C63]">
                Utilizamos exclusivamente matérias-primas dermatologicamente testadas (Vòlia e Cuccio) de alta biocompatibilidade.
              </p>
            </div>
          </div>

          <p>
            O espaço no Pontal da Cruz, em São Sebastião - SP, foi idealizado como uma verdadeira galeria intimista: apenas um atendimento por vez, climatização impecável, serviço de café gourmet e espumante cortesia.
          </p>
        </div>

        <div className="mt-8 pt-4 border-t border-[#E8D9B5] flex flex-col sm:flex-row items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-jakarta text-xs font-semibold cursor-pointer border border-[#E8D9B5] transition-colors"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onBookNow();
            }}
            className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md"
          >
            Agendar com a Angélica
          </button>
        </div>
      </div>
    </div>
  );
};
