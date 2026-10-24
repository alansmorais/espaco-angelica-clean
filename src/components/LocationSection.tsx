import React from 'react';
import { BRAND_ASSETS, STUDIO_ADDRESS } from '../data/mockData';

export const LocationSection: React.FC = () => {
  return (
    <section className="relative w-full px-4 sm:px-8 lg:px-12 py-16 bg-[#FBF7F2] border-t border-[#E8D9B5]" id="localizacao-section">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-6 space-y-4">
          <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
            Localização Nobre &amp; Privativa
          </span>
          <h2 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold leading-tight">
            Pontal da Cruz, São Sebastião - SP
          </h2>
          <p className="font-jakarta text-sm text-[#786C63] leading-relaxed">
            Projetado para ser um refúgio exclusivo e acolhedor no litoral norte. Ambiente climatizado com vista relaxante, esterilização cirúrgica, poltrona ergonômica de alto conforto e total privacidade para seu momento de autocuidado.
          </p>

          <div className="space-y-2.5 pt-2 font-jakarta text-xs sm:text-sm text-[#786C63]">
            <div className="flex items-start gap-2.5 text-[#49382E]">
              <span className="material-symbols-outlined text-[#D4AF37] text-[20px] shrink-0 mt-0.5">pin_drop</span>
              <span className="font-medium text-[#49382E]">{STUDIO_ADDRESS.fullAddress}</span>
            </div>
            <div className="flex items-center gap-2.5 text-[#49382E]">
              <span className="material-symbols-outlined text-[#D4AF37] text-[20px] shrink-0">local_parking</span>
              <span>Fácil estacionamento no local e acesso privativo</span>
            </div>
            <div className="flex items-center gap-2.5 text-[#49382E]">
              <span className="material-symbols-outlined text-[#D4AF37] text-[20px] shrink-0">wifi</span>
              <span>Wi-Fi de alta velocidade, café gourmet e espumante cortesia</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 pt-4">
            <a
              href={STUDIO_ADDRESS.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-6 py-3 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-xs font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs border border-[#E8D9B5] min-h-[44px] active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px]">navigation</span>
              <span>Abrir no Google Maps</span>
            </a>
            <a
              href={STUDIO_ADDRESS.wazeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-6 py-3 rounded-full bg-[#FFFFFF] hover:bg-[#F7EFEA] text-[#49382E] border border-[#E8D9B5] font-jakarta text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs min-h-[44px] active:scale-95"
            >
              <span className="material-symbols-outlined text-[18px] text-[#D4AF37]">directions_car</span>
              <span>Traçar rota no Waze</span>
            </a>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="w-full h-64 sm:h-80 rounded-2xl overflow-hidden shadow-xl relative border border-[#E8D9B5] group">
            <img
              src={BRAND_ASSETS.mapTexture}
              alt="Localização do Atelier Espaço Angelica do Carmo no Pontal da Cruz em São Sebastião SP"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
            
            <div className="absolute bottom-4 left-4 p-3 rounded-xl bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E8D9B5] flex items-center gap-2.5 shadow-lg">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4AF37] opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#D4AF37]" />
              </span>
              <div className="flex flex-col">
                <span className="font-jakarta text-xs text-[#49382E] font-bold">
                  Espaço Privativo Angelica do Carmo
                </span>
                <span className="font-jakarta text-[11px] text-[#D4AF37] font-semibold">
                  Pontal da Cruz • São Sebastião - SP
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
