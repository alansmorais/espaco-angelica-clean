import React, { useEffect, useState } from 'react';
import { fetchPublicGalleryPhotos, PublicGalleryPhoto } from '../services/emailNotificationService';

export const GallerySection: React.FC = () => {
  const [photos, setPhotos] = useState<PublicGalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicGalleryPhotos().then(result => {
      if (!active) return;
      if (result.success) {
        setPhotos(result.photos);
        setError(null);
      } else {
        setPhotos([]);
        setError(result.error || 'A galeria oficial está indisponível.');
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <section className="relative w-full px-4 sm:px-8 lg:px-12 py-16 bg-[#F7EFEA]/50 border-t border-[#E8D9B5]" id="galeria-nailart">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
              Portfólio de Alta Joalheria
            </span>
            <h2 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold mt-1">
              Galeria de Criações Recentes
            </h2>
          </div>

          <a
            href="https://instagram.com/angelicadocarmo_nails"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[#D4AF37] font-jakarta text-xs sm:text-sm font-semibold hover:underline"
          >
            <span>Ver mais no Instagram @angelicadocarmo_nails</span>
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
          </a>
        </div>

        {loading ? (
          <p className="text-sm text-[#786C63] py-8 text-center">Carregando fotos oficiais do Google Drive…</p>
        ) : photos.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            {photos.map(photo => (
              <div key={photo.id} className="group relative rounded-2xl overflow-hidden aspect-[4/5] bg-[#FFFFFF] shadow-md border border-[#E8D9B5] hover:border-[#D4AF37]/60 transition-all hover:shadow-xl">
                <img
                  src={photo.thumbnailUrl || photo.url}
                  alt={photo.title || 'Criação do portfólio'}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#49382E]/90 via-[#49382E]/20 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 sm:p-4">
                  <span className="text-[#FFE088] font-syne text-sm sm:text-base font-bold leading-tight">{photo.title}</span>
                  <span className="text-[#FDFBF9] font-jakarta text-[10px] sm:text-[11px] mt-0.5">{photo.subtitle}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#D8C4B6] bg-white/70 px-6 py-10 text-center">
            <span className="material-symbols-outlined text-4xl text-[#B5A293]">photo_library</span>
            <p className="mt-2 text-sm font-semibold text-[#49382E]">Nenhuma foto oficial disponível</p>
            <p className="mt-1 text-xs text-[#786C63]">{error || 'Adicione fotos reais à pasta oficial do Google Drive para que apareçam aqui.'}</p>
          </div>
        )}
      </div>
    </section>
  );
};
