import React from 'react';

interface HeroSectionProps {
  onStartBooking: () => void;
  onViewServices: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onStartBooking,
  onViewServices
}) => {
  return (
    <section className="relative w-full px-4 sm:px-8 lg:px-12 pt-6 sm:pt-10 pb-10 sm:pb-16 overflow-hidden bg-gradient-to-b from-[#FBF7F2] via-[#FDFBF9] to-[#F7EFEA]/40">
      {/* Ambient Glows */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] sm:w-[780px] h-[360px] sm:h-[480px] rounded-full bg-[#D4AF37]/10 blur-[100px] sm:blur-[130px] -z-10" />
      <div className="pointer-events-none absolute top-[400px] -left-48 w-[400px] sm:w-[520px] h-[400px] sm:h-[520px] rounded-full bg-[#E8D3C7]/40 blur-[100px] sm:blur-[140px] -z-10" />

      <div className="max-w-5xl mx-auto flex flex-col items-center text-center pt-4">
        {/* Overline Tag */}
        <div className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] shadow-xs mb-4 sm:mb-5 max-w-[95%]">
          <span className="material-symbols-outlined text-[14px] sm:text-[16px] text-[#D4AF37] shrink-0">stars</span>
          <span className="font-jakarta text-[10px] sm:text-xs uppercase tracking-wider text-[#49382E] font-bold">
            Espaço de Alta Estética &amp; Escultura Manual
          </span>
          <span className="material-symbols-outlined text-[14px] sm:text-[16px] text-[#D4AF37] shrink-0 hidden sm:inline">auto_awesome</span>
        </div>

        {/* Main Headline */}
        <h1 className="font-syne text-[22px] sm:text-4xl md:text-5xl lg:text-[52px] text-[#49382E] max-w-4xl tracking-tight leading-[1.25] sm:leading-[1.15] font-bold">
          Elegância em cada detalhe,{' '}
          <span className="text-[#D4AF37]">
            exclusividade para suas mãos.
          </span>
        </h1>

        {/* Subtitle */}
        <p className="font-jakarta text-xs sm:text-base md:text-lg text-[#786C63] max-w-2xl mt-3 sm:mt-5 leading-relaxed">
          Alongamento em fibra de vidro slim, blindagem de diamante e nail arts autorais desenvolvidas em um refúgio privativo de relaxamento, requinte e pontualidade em São Sebastião - SP.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4 mt-6 sm:mt-8 w-full max-w-md sm:max-w-none">
          <button
            type="button"
            onClick={onStartBooking}
            className="w-full sm:w-auto px-6 sm:px-8 py-3.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-sm font-bold hover:bg-[#E5C158] transition-all duration-300 shadow-[0_12px_32px_-4px_rgba(212,175,55,0.35)] flex items-center justify-center gap-2 group cursor-pointer active:scale-95 min-h-[48px]"
          >
            <span>Iniciar Agendamento</span>
            <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">
              calendar_month
            </span>
          </button>
          <button
            type="button"
            onClick={onViewServices}
            className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-3.5 rounded-full bg-[#FFFFFF] text-[#49382E] font-jakarta text-sm font-semibold hover:bg-[#F7EFEA] transition-all duration-300 border border-[#E8D9B5] shadow-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95 min-h-[48px]"
          >
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">palette</span>
            <span>Ver Procedimentos &amp; Valores</span>
          </button>
        </div>

        {/* Trust Badges Strip */}
        <div className="w-full grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mt-8 sm:mt-12 pt-6 sm:pt-8 border-t border-[#E8D9B5] text-left">
          <div className="flex items-center gap-2 p-2 sm:p-3 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px] sm:text-[20px] shrink-0">timer</span>
            <span className="font-jakarta text-[10px] sm:text-xs text-[#49382E] font-semibold tracking-wide leading-tight">
              Atendimento 1 a 1 Exclusivo
            </span>
          </div>
          <div className="flex items-center gap-2 p-2 sm:p-3 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px] sm:text-[20px] shrink-0">sanitizer</span>
            <span className="font-jakarta text-[10px] sm:text-xs text-[#49382E] font-semibold tracking-wide leading-tight">
              Biossegurança (Autoclave)
            </span>
          </div>
          <div className="flex items-center gap-2 p-2 sm:p-3 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px] sm:text-[20px] shrink-0">health_and_safety</span>
            <span className="font-jakarta text-[10px] sm:text-xs text-[#49382E] font-semibold tracking-wide leading-tight">
              Géis Hipoalergênicos Vòlia
            </span>
          </div>
          <div className="flex items-center gap-2 p-2 sm:p-3 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs">
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px] sm:text-[20px] shrink-0">local_bar</span>
            <span className="font-jakarta text-[10px] sm:text-xs text-[#49382E] font-semibold tracking-wide leading-tight">
              Café Gourmet &amp; Espumante
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
