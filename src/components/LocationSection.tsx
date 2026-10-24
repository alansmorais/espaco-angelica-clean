import React from 'react';
import { BRAND_ASSETS } from '../data/mockData';
import { StudioAddressConfig } from '../types';

interface LocationSectionProps {
  studioAddress: StudioAddressConfig;
}

export const LocationSection: React.FC<LocationSectionProps> = ({ studioAddress }) => {
  const address = String(studioAddress.fullAddress || '').trim();
  const hasMaps = Boolean(String(studioAddress.mapsUrl || '').trim());
  const hasWaze = Boolean(String(studioAddress.wazeUrl || '').trim());
  const locality = [studioAddress.neighborhood, studioAddress.city, studioAddress.state]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="relative w-full px-4 sm:px-8 lg:px-12 py-16 bg-[#FBF7F2] border-t border-[#E8D9B5]" id="localizacao-section">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-6 space-y-4">
          <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
            Localização
          </span>
          <h2 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold leading-tight">
            {locality || 'Como chegar ao espaço'}
          </h2>
          <p className="font-jakarta text-sm text-[#786C63] leading-relaxed">
            Consulte o endereço oficial do espaço e abra a rota no aplicativo de navegação disponível.
          </p>

          <div className="space-y-2.5 pt-2 font-jakarta text-xs sm:text-sm text-[#786C63]">
            <div className="flex items-start gap-2.5 text-[#49382E]">
              <span className="material-symbols-outlined text-[#D4AF37] text-[20px] shrink-0 mt-0.5">pin_drop</span>
              <span className="font-medium text-[#49382E]">{address || 'O endereço oficial ainda não está configurado.'}</span>
            </div>
          </div>

          {(hasMaps || hasWaze) && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 pt-4">
              {hasMaps && (
                <a href={studioAddress.mapsUrl} target="_blank" rel="noopener noreferrer"
                  className="w-full sm:w-auto px-6 py-3 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-xs font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs border border-[#E8D9B5] min-h-[44px] active:scale-95">
                  <span className="material-symbols-outlined text-[18px]">navigation</span>
                  <span>Abrir no Google Maps</span>
                </a>
              )}
              {hasWaze && (
                <a href={studioAddress.wazeUrl} target="_blank" rel="noopener noreferrer"
                  className="w-full sm:w-auto px-6 py-3 rounded-full bg-[#FFFFFF] hover:bg-[#F7EFEA] text-[#49382E] border border-[#E8D9B5] font-jakarta text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs min-h-[44px] active:scale-95">
                  <span className="material-symbols-outlined text-[18px] text-[#D4AF37]">directions_car</span>
                  <span>Traçar rota no Waze</span>
                </a>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-6">
          <div className="w-full min-h-64 sm:min-h-80 rounded-2xl overflow-hidden shadow-xl relative border border-[#E8D9B5] bg-gradient-to-br from-[#211410] via-[#49382E] to-[#7A6547] flex items-center justify-center p-8">
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }} />
            <div className="relative text-center text-white max-w-sm">
              <img src={BRAND_ASSETS.logoRoundEmblem} alt="Logo do Espaço Angélica do Carmo" className="w-28 h-28 object-contain mx-auto mb-4 rounded-full border border-[#E8D9B5] bg-[#0B0A0A] p-2" />
              <p className="font-syne text-xl font-bold">Espaço Angélica do Carmo</p>
              <p className="font-jakarta text-sm text-[#F7E7B1] mt-2">{address || 'Localização oficial ainda não disponível'}</p>
              <p className="font-jakarta text-xs text-white/70 mt-3">Endereço e rotas são carregados das configurações oficiais.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
