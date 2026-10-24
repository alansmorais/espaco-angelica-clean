import React from 'react';

interface FooterPublicProps {
  onOpenAbout: () => void;
  onOpenFAQ: () => void;
  onOpenAdmin: () => void;
  studioWhatsApp?: string;
  instagramUrl?: string;
}

export const FooterPublic: React.FC<FooterPublicProps> = ({
  onOpenAbout,
  onOpenFAQ,
  onOpenAdmin,
  studioWhatsApp = '',
  instagramUrl = ''
}) => {
  const whatsappDigits = studioWhatsApp.replace(/\D/g, '');
  const whatsappUrl = whatsappDigits ? `https://wa.me/${whatsappDigits}` : '';
  return (
    <footer className="w-full bg-[#F7EFEA] mt-16 border-t border-[#E8D9B5] shadow-xs text-[#49382E]">
      <div className="w-full px-4 sm:px-8 lg:px-12 py-12 sm:py-16 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10">
          {/* Col 1 */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="font-syne text-lg text-[#49382E] font-bold">
                Espaço Angelica do Carmo
              </span>
            </div>
            <p className="font-jakarta text-xs sm:text-sm text-[#786C63] leading-relaxed">
              Escultura, biossegurança rigorosa e cuidado personalizado para as suas mãos. Atendimento exclusivo com hora marcada em São Sebastião - SP.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">verified</span>
              <span className="font-jakarta text-xs text-[#49382E] font-semibold">
                Certificação Internacional Nail Design
              </span>
            </div>
          </div>

          {/* Col 2 */}
          <div className="space-y-4">
            <h4 className="font-syne text-base text-[#49382E] font-bold">
              Studio &amp; Horários
            </h4>
            <ul className="space-y-2.5 font-jakarta text-xs sm:text-sm text-[#786C63]">
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined text-[#D4AF37] text-[18px] mt-0.5 shrink-0">
                  location_on
                </span>
                <span className="text-[#49382E]">Rua Vereador José Luiz Soares, 92 - Pontal da Cruz, São Sebastião - SP</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#D4AF37] text-[18px] shrink-0">
                  schedule
                </span>
                <span className="text-[#49382E]">Terça a Sábado: 09:00 às 19:30</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#786C63] text-[18px] shrink-0">
                  block
                </span>
                <span>Domingos e Segundas: Fechado</span>
              </li>
            </ul>
          </div>

          {/* Col 3 */}
          <div className="space-y-4">
            <h4 className="font-syne text-base text-[#49382E] font-bold">
              Política de Reserva
            </h4>
            <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] space-y-2 shadow-xs">
              <div className="flex items-center gap-2 text-[#D4AF37]">
                <span className="material-symbols-outlined text-[18px]">payments</span>
                <span className="font-jakarta text-xs font-bold text-[#49382E]">Sinal Via Pix (40%)</span>
              </div>
              <p className="font-jakarta text-xs text-[#786C63] leading-relaxed">
                O sinal de 40% garante a vaga e é descontado do total no dia. Não é reembolsado em caso de desistência ou não comparecimento. Mudanças de data exigem pelo menos 24h de antecedência.
              </p>
            </div>
          </div>

          {/* Col 4 */}
          <div className="space-y-4">
            <h4 className="font-syne text-base text-[#49382E] font-bold">
              Conexão &amp; Social
            </h4>
            <div className="flex flex-col gap-2.5 font-jakarta text-xs sm:text-sm text-[#786C63]">
              {instagramUrl && (
                <a
                  href={instagramUrl || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:text-[#D4AF37] text-[#49382E] transition-colors min-h-[44px] py-1"
                >
                  <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">camera</span>
                  <span>@angelicadocarmo_nails</span>
                </a>
              )}
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 hover:text-[#D4AF37] text-[#49382E] transition-colors min-h-[44px] py-1"
                >
                  <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">call</span>
                  <span>WhatsApp do Ateliê</span>
                </a>
              )}
            </div>
            <p className="font-jakarta text-xs text-[#786C63] leading-relaxed pt-1">
              Boutique de estética manual privativa com esterilização cirúrgica em autoclave hospitalar.
            </p>
          </div>
        </div>

        {/* Separated Administration Entry in Website Footer */}
        <div className="mt-10 pt-6 border-t border-[#E8D9B5] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[#786C63] text-xs">
            <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">security</span>
            <span>Gestão Operacional Interna:</span>
          </div>
          <button
            type="button"
            onClick={onOpenAdmin}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FFFFFF] hover:bg-[#FDFBF9] border border-[#E8D9B5] hover:border-[#D4AF37] text-[#49382E] hover:text-[#D4AF37] font-jakarta text-xs font-semibold transition-all cursor-pointer shadow-xs min-h-[44px] active:scale-95"
          >
            <span className="material-symbols-outlined text-[17px] text-[#D4AF37]">admin_panel_settings</span>
            <span>Acesso ao Painel do Ateliê (Admin)</span>
          </button>
        </div>

        {/* Bottom copyright bar */}
        <div className="mt-8 pt-6 border-t border-[#E8D9B5] flex flex-col md:flex-row items-center justify-between gap-4 text-[#786C63] font-jakarta text-xs">
          <p>© 2024 Espaço Angelica do Carmo • São Sebastião SP. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            <button type="button" onClick={onOpenAbout} className="hover:text-[#D4AF37] transition-colors cursor-pointer min-h-[36px] flex items-center">
              Sobre o Atelier
            </button>
            <button type="button" onClick={onOpenFAQ} className="hover:text-[#D4AF37] transition-colors cursor-pointer min-h-[36px] flex items-center">
              Biossegurança &amp; Autoclave
            </button>
            <button type="button" onClick={onOpenFAQ} className="hover:text-[#D4AF37] transition-colors cursor-pointer min-h-[36px] flex items-center">
              Dúvidas Frequentes
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
};
