import React, { useState } from 'react';
import { Service } from '../types';

interface ServiceCatalogProps {
  services?: Service[];
  onSelectService: (service: Service) => void;
  selectedServiceId?: string;
}

export const ServiceCatalog: React.FC<ServiceCatalogProps> = ({
  services = [],
  onSelectService,
  selectedServiceId
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [previewPhoto, setPreviewPhoto] = useState<{ title: string; url: string } | null>(null);

  // Normalize category keys so accents/case/spacing in official data do not
  // prevent the matching category tab from showing its services.
  const normalizeCategory = (value: unknown): string =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '');

  // Only display active services on public catalog
  const activeServices = services.filter(s => s.active !== false);

  const filteredServices = activeCategory === 'all'
    ? activeServices
    : activeServices.filter(s => normalizeCategory(s.category) === normalizeCategory(activeCategory));

  return (
    <section className="relative w-full px-4 sm:px-8 lg:px-12 py-12 sm:py-16 bg-[#FBF7F2]" id="catalogo-vitrine">
      <div className="max-w-6xl mx-auto">
        {/* Header & Filter */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 sm:mb-12">
          <div>
            <div className="flex items-center gap-1.5 text-[#D4AF37] mb-1">
              <span className="font-jakarta text-[11px] uppercase tracking-widest font-bold">
                Menu de Experiências &amp; Fotografia Real
              </span>
            </div>
            <h2 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold">
              Vitrine de Procedimentos
            </h2>
            <p className="font-jakarta text-xs sm:text-sm text-[#786C63] max-w-xl mt-2 leading-relaxed">
              Fotos reais dos procedimentos executados no Espaçor. Selecione o serviço ideal para a saúde e beleza das suas mãos. Todas as sessões incluem cutilagem combinada e acabamento autoral de alta precisão.
            </p>
          </div>

          {/* Dynamic Filter Chips - Smooth horizontal scroll on mobile, wrap on tablet/desktop */}
          <div className="flex flex-nowrap md:flex-wrap items-center gap-1.5 bg-[#FFFFFF] p-1.5 rounded-full border border-[#E8D9B5] self-stretch md:self-auto overflow-x-auto max-w-full shadow-xs scrollbar-none snap-x touch-pan-x">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={`px-4 py-2 rounded-full font-jakarta text-[11px] sm:text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[44px] flex items-center shrink-0 snap-start active:scale-95 ${
                activeCategory === 'all'
                  ? 'bg-[#D4AF37] text-[#3C2F00] shadow-xs font-bold'
                  : 'text-[#786C63] hover:text-[#49382E]'
              }`}
            >
              Todos ({activeServices.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('alongamento')}
              className={`px-4 py-2 rounded-full font-jakarta text-[11px] sm:text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[44px] flex items-center shrink-0 snap-start active:scale-95 ${
                activeCategory === 'alongamento'
                  ? 'bg-[#D4AF37] text-[#3C2F00] shadow-xs font-bold'
                  : 'text-[#786C63] hover:text-[#49382E]'
              }`}
            >
              Alongamento
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('blindagem')}
              className={`px-4 py-2 rounded-full font-jakarta text-[11px] sm:text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[44px] flex items-center shrink-0 snap-start active:scale-95 ${
                activeCategory === 'blindagem'
                  ? 'bg-[#D4AF37] text-[#3C2F00] shadow-xs font-bold'
                  : 'text-[#786C63] hover:text-[#49382E]'
              }`}
            >
              Blindagem &amp; Gel
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('nailart')}
              className={`px-4 py-2 rounded-full font-jakarta text-[11px] sm:text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[44px] flex items-center shrink-0 snap-start active:scale-95 ${
                activeCategory === 'nailart'
                  ? 'bg-[#D4AF37] text-[#3C2F00] shadow-xs font-bold'
                  : 'text-[#786C63] hover:text-[#49382E]'
              }`}
            >
              Nail Art Autoral
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('depilacao')}
              className={`px-4 py-2 rounded-full font-jakarta text-[11px] sm:text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[44px] flex items-center shrink-0 snap-start active:scale-95 ${
                activeCategory === 'depilacao'
                  ? 'bg-[#D4AF37] text-[#3C2F00] shadow-xs font-bold'
                  : 'text-[#786C63] hover:text-[#49382E]'
              }`}
            >
              Depilação
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory('spa')}
              className={`px-4 py-2 rounded-full font-jakarta text-[11px] sm:text-[12px] font-semibold transition-all cursor-pointer whitespace-nowrap min-h-[44px] flex items-center shrink-0 snap-start active:scale-95 ${
                activeCategory === 'spa'
                  ? 'bg-[#D4AF37] text-[#3C2F00] shadow-xs font-bold'
                  : 'text-[#786C63] hover:text-[#49382E]'
              }`}
            >
              Spa &amp; Cuidados
            </button>
          </div>
        </div>

        {/* Empty State */}
        {filteredServices.length === 0 && (
          <div className="p-8 sm:p-12 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] text-center max-w-lg mx-auto shadow-sm">
            <span className="material-symbols-outlined text-[#D4AF37] text-[40px] mb-2 block">
              palette
            </span>
            <h3 className="font-syne text-lg text-[#49382E] font-bold mb-1">
              Nenhum procedimento ativo nesta categoria
            </h3>
            <p className="font-jakarta text-xs text-[#786C63] leading-relaxed mb-4">
              Os procedimentos desta categoria estão temporariamente em revisão técnica no Espaço ou desativados pela administração.
            </p>
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className="px-4 py-2 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-xs font-bold transition-all cursor-pointer"
            >
              Ver Todos os Procedimentos Disponíveis
            </button>
          </div>
        )}

        {/* Service Cards Grid */}
        {filteredServices.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredServices.map(service => {
              const isSelected = selectedServiceId === service.id;

              return (
                <div
                  key={service.id}
                  className={`group relative rounded-2xl bg-[#FFFFFF] transition-all duration-300 flex flex-col justify-between overflow-hidden shadow-md hover:shadow-xl border ${
                    isSelected
                      ? 'border-[#D4AF37] ring-2 ring-[#D4AF37]/40 bg-[#FDFBF8]'
                      : 'border-[#E8D9B5] hover:border-[#D4AF37]/50'
                  }`}
                >
                  {/* Image & Badges */}
                  <div
                    className="relative h-52 sm:h-56 w-full overflow-hidden bg-[#F7EFEA] cursor-pointer"
                    onClick={() => { if (service.imageUrl) setPreviewPhoto({ title: service.title, url: service.imageUrl }); }}
                    title="Clique para ampliar a foto do serviço"
                  >
                    {service.imageUrl ? (
                      <img
                        src={service.imageUrl}
                        alt={service.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[#A89A8C]">
                        <span className="material-symbols-outlined text-4xl">image</span>
                        <span className="text-xs">Foto ainda não cadastrada</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

                    {/* Zoom indicator */}
                    <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center text-[#49382E] group-hover:text-[#D4AF37] opacity-0 group-hover:opacity-100 transition-opacity shadow-xs">
                      <span className="material-symbols-outlined text-[18px]">zoom_in</span>
                    </div>

                    {service.badge && (
                      <span
                        className={`absolute top-3 left-3 px-3 py-1 rounded-full font-jakarta text-[11px] font-bold shadow-xs ${
                          service.badgeType === 'primary'
                            ? 'bg-[#D4AF37] text-[#3C2F00]'
                            : service.badgeType === 'secondary'
                            ? 'bg-[#E8D3C7] text-[#49382E]'
                            : 'bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5]'
                        }`}
                      >
                        {service.badge}
                      </span>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <h3 className="font-syne text-lg sm:text-xl text-[#49382E] font-bold group-hover:text-[#D4AF37] transition-colors leading-snug">
                          {service.title}
                        </h3>
                      </div>

                      <p className="font-jakarta text-xs sm:text-[13px] text-[#786C63] leading-relaxed mb-4">
                        {service.description}
                      </p>

                      {/* Specs Tags */}
                      {service.specs && service.specs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                          {service.specs.map((spec, idx) => (
                            <span
                              key={idx}
                              className="px-2.5 py-1 rounded-lg bg-[#F7EFEA] border border-[#E8D9B5] text-[#49382E] font-jakarta text-[10px] sm:text-[11px] flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[12px] text-[#D4AF37]">
                                check
                              </span>
                              {spec}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Price, Note & Select Button */}
                    <div className="pt-4 border-t border-[#E8D9B5] flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-jakarta uppercase tracking-wider text-[#786C63] block font-semibold">
                            Investimento
                          </span>
                          <span className="font-syne text-xl text-[#49382E] font-bold">
                            {service.priceFormatted}
                          </span>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] font-jakarta uppercase tracking-wider text-[#786C63] block font-semibold">
                            Duração
                          </span>
                          <span className="font-jakarta text-xs text-[#49382E] font-medium flex items-center justify-end gap-1">
                            <span className="material-symbols-outlined text-[14px] text-[#D4AF37]">
                              schedule
                            </span>
                            {service.duration}
                          </span>
                        </div>
                      </div>

                      {service.note && (
                        <div className="text-[11px] font-jakarta text-[#786C63] italic">
                          * {service.note}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => onSelectService(service)}
                        className={`w-full py-3 rounded-full font-jakarta text-xs sm:text-[13px] font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs min-h-[46px] active:scale-[0.98] ${
                          isSelected
                            ? 'bg-[#D4AF37] text-[#3C2F00] shadow-md ring-2 ring-[#D4AF37]/50'
                            : 'bg-[#F7EFEA] hover:bg-[#D4AF37] text-[#49382E] hover:text-[#3C2F00] border border-[#E8D9B5]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {isSelected ? 'check_circle' : 'calendar_add_on'}
                        </span>
                        <span>{isSelected ? 'Procedimento Selecionado' : 'Selecionar & Agendar'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Expanded Photo Lightbox Modal */}
      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 bg-[#49382E]/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="relative max-w-3xl w-full rounded-2xl overflow-hidden bg-[#FFFFFF] border border-[#E8D9B5] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="relative aspect-video w-full bg-[#2A231F] flex items-center justify-center">
              <img
                src={previewPhoto.url}
                alt={previewPhoto.title}
                className="w-full h-full object-contain"
              />
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/60 hover:bg-black text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-4 flex items-center justify-between bg-[#F7EFEA] border-t border-[#E8D9B5]">
              <div>
                <span className="font-jakarta text-[10px] uppercase text-[#D4AF37] tracking-widest font-bold">
                  Foto em Alta Definição do Procedimento
                </span>
                <h4 className="font-syne text-base text-[#49382E] font-bold">{previewPhoto.title}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] font-jakarta text-xs font-semibold cursor-pointer shadow-xs"
              >
                Fechar Foto
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
