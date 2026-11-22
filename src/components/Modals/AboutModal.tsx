import React from 'react';
import { BRAND_ASSETS } from '../../data/mockData';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookNow: () => void;
}

const INTRO_SESSION_KEY = 'espaco_angelica_intro_seen';

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  onBookNow
}) => {
  const [showIntro, setShowIntro] = React.useState(false);

  React.useEffect(() => {
    try {
      if (window.sessionStorage.getItem(INTRO_SESSION_KEY) !== '1') {
        window.sessionStorage.setItem(INTRO_SESSION_KEY, '1');
        setShowIntro(true);
      }
    } catch {
      // If storage is unavailable, keep the introduction accessible through the About links.
    }
  }, []);

  const visible = isOpen || showIntro;
  const handleClose = () => {
    setShowIntro(false);
    onClose();
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-[#49382E]/60 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="angelica-about-title"
    >
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-xl w-full border border-[#E8D9B5] shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Fechar apresentação"
          className="absolute top-4 right-4 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] transition-colors cursor-pointer active:scale-95"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="flex flex-col items-center text-center mb-6 pt-2">
          <div className="p-2 rounded-2xl bg-[#0B0A0A] border border-[#E8D9B5] inline-flex shadow-sm mb-4">
            <img
              src={BRAND_ASSETS.logoGold}
              alt="Logo Angélica do Carmo"
              className="h-16 w-auto object-contain"
            />
          </div>
          <span className="font-jakarta text-[10px] text-[#D4AF37] uppercase tracking-[0.22em] font-bold mb-2">
            Conheça a profissional
          </span>
          <h2 id="angelica-about-title" className="font-syne text-2xl sm:text-3xl text-[#49382E] font-bold">
            Angélica do Carmo
          </h2>
          <p className="font-jakarta text-xs text-[#786C63] mt-1">
            Nail Designer
          </p>
        </div>

        <div className="space-y-4 font-jakarta text-sm text-[#786C63] leading-relaxed text-center sm:text-left">
          <p>
            Sou Angélica do Carmo, manicure e pedicure há mais de 12 anos e Nail Designer desde 2017, especialista em alongamentos de unhas na fibra com naturalidade.
          </p>
          <p>
            Meu propósito é unir beleza, delicadeza e qualidade, proporcionando momentos especiais de cuidado, autoestima e bem-estar. Cada atendimento é pensado com carinho para valorizar sua beleza e tornar sua experiência única.
          </p>
        </div>

        <div className="mt-6 text-center">
          <p className="font-syne text-base font-bold text-[#49382E]">Angélica do Carmo</p>
          <p className="font-jakarta text-sm text-[#D4AF37] mt-1">Felicidade é fazer as unhas. ✨</p>
        </div>

        <div className="mt-8 pt-5 border-t border-[#E8D9B5] flex flex-col sm:flex-row items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="w-full sm:w-auto px-5 py-3 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-jakarta text-xs font-semibold cursor-pointer border border-[#E8D9B5] transition-colors min-h-[44px]"
          >
            Conhecer o espaço
          </button>
          <button
            type="button"
            onClick={() => {
              handleClose();
              onBookNow();
            }}
            className="w-full sm:w-auto px-6 py-3 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md min-h-[44px]"
          >
            Agendar horário
          </button>
        </div>
      </div>
    </div>
  );
};
