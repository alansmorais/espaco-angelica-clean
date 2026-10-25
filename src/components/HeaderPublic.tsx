import React, { useState } from 'react';
import { BRAND_ASSETS } from '../data/mockData';

interface HeaderPublicProps {
  onOpenBooking: () => void;
  onOpenAdmin: () => void;
  onOpenAbout: () => void;
  onOpenFAQ: () => void;
  onOpenServices: () => void;
  studioWhatsApp?: string;
  studioCityLabel?: string;
}

export const HeaderPublic: React.FC<HeaderPublicProps> = ({
  onOpenBooking,
  onOpenAdmin,
  onOpenAbout,
  onOpenFAQ,
  onOpenServices,
  studioWhatsApp = '',
  studioCityLabel = ''
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const whatsappUrl = studioWhatsApp.replace(/\D/g, '') ? `https://wa.me/${studioWhatsApp.replace(/\D/g, '')}` : '';

  const handleNavClick = (action: () => void) => {
    action();
    setMobileMenuOpen(false);
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 w-full z-50 bg-[#FFFFFF]/90 backdrop-blur-xl border-b border-[#E8D9B5] shadow-[0_4px_20px_rgba(73,56,46,0.06)]">
        <div className="max-w-7xl mx-auto h-16 sm:h-20 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand Lockup */}
          <div
            className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial cursor-pointer select-none"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setMobileMenuOpen(false);
            }}
          >
            <div className="p-1 sm:p-1.5 rounded-xl bg-[#0B0A0A] border border-[#E8D9B5] shadow-sm flex items-center justify-center shrink-0">
              <img
                alt="Espaço Angelica do Carmo Logo"
                className="h-6 sm:h-8 w-auto object-contain drop-shadow"
                src={BRAND_ASSETS.logoGold}
              />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-syne text-[13px] sm:text-[18px] text-[#49382E] tracking-tight uppercase font-bold truncate">
                Angelica do Carmo
              </span>
              <span className="font-jakarta text-[9px] sm:text-[10px] uppercase tracking-wider text-[#D4AF37] font-semibold truncate hidden sm:inline">
                Manicure | Nail Designer
              </span>
            </div>
          </div>

          {/* Desktop Navigation (xl+) */}
          <nav className="hidden xl:flex items-center gap-1 bg-[#F7EFEA] px-3 py-1.5 rounded-full border border-[#E8D9B5] shadow-xs">
            <button
              onClick={onOpenServices}
              className="px-3 py-1.5 rounded-full font-jakarta text-[13px] text-[#786C63] hover:text-[#49382E] hover:bg-[#FFFFFF] transition-all cursor-pointer"
            >
              Catálogo de Serviços
            </button>
            <button
              onClick={onOpenBooking}
              className="px-3 py-1.5 rounded-full font-jakarta text-[13px] bg-[#FFFFFF] text-[#49382E] font-bold shadow-xs border border-[#E8D9B5] transition-all cursor-pointer"
            >
              Agendamento Online
            </button>
            <button
              onClick={onOpenAbout}
              className="px-3 py-1.5 rounded-full font-jakarta text-[13px] text-[#786C63] hover:text-[#49382E] hover:bg-[#FFFFFF] transition-all cursor-pointer"
            >
              Sobre Angélica
            </button>
            <button
              onClick={() => {
                const el = document.getElementById('localizacao-section');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="px-3 py-1.5 rounded-full font-jakarta text-[13px] text-[#786C63] hover:text-[#49382E] hover:bg-[#FFFFFF] transition-all cursor-pointer"
            >
              Localização
            </button>
            <button
              onClick={onOpenFAQ}
              className="px-3 py-1.5 rounded-full font-jakarta text-[13px] text-[#786C63] hover:text-[#49382E] hover:bg-[#FFFFFF] transition-all cursor-pointer"
            >
              Dúvidas
            </button>
          </nav>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Contact is shown only when loaded from official settings. */}
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden lg:flex items-center gap-2 bg-[#FFFFFF] hover:bg-[#F7EFEA] px-3 py-1.5 rounded-full border border-[#E8D9B5] transition-all text-left shadow-xs min-h-[40px]"
                title="Falar no WhatsApp com o Espaço"
              >
                <span className="material-symbols-outlined text-[#D4AF37] text-[17px]">chat</span>
                <div className="flex flex-col">
                  <span className="font-jakarta text-[11px] text-[#49382E] font-bold leading-tight">WhatsApp do Espaço</span>
                  <span className="font-jakarta text-[9px] text-[#786C63] leading-tight">{studioCityLabel}</span>
                </div>
              </a>
            )}

            {/* Primary "Agendar Horário" button - visible from sm+ screens to preserve header space on 320px/360px */}
            <button
              type="button"
              onClick={onOpenBooking}
              className="hidden sm:inline-flex items-center justify-center px-4 sm:px-5 py-2 sm:py-2.5 rounded-full bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-xs sm:text-[13px] font-bold shadow-[0_4px_16px_rgba(212,175,55,0.25)] transition-all cursor-pointer active:scale-95 shrink-0 min-h-[40px]"
            >
              <span className="material-symbols-outlined text-[17px] mr-1">calendar_month</span>
              <span>Agendar Horário</span>
            </button>

            {/* Mobile Hamburger / Navigation Menu Button - 44x44px ergonomic touch target */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(prev => !prev)}
              aria-label={mobileMenuOpen ? 'Fechar menu de navegação' : 'Abrir menu de navegação'}
              aria-expanded={mobileMenuOpen}
              className="xl:hidden w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] flex items-center justify-center hover:bg-[#F7EFEA] transition-colors cursor-pointer shrink-0 shadow-xs active:scale-95"
            >
              <span className="material-symbols-outlined text-[24px]">
                {mobileMenuOpen ? 'close' : 'menu'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer / Dropdown */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 xl:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-[#49382E]/40 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Menu Card */}
          <div className="fixed top-16 sm:top-20 left-0 right-0 bg-[#FFFFFF] border-b border-[#E8D9B5] p-4 sm:p-5 shadow-2xl max-h-[calc(100vh-4rem)] sm:max-h-[85vh] overflow-y-auto overscroll-contain space-y-3 sm:space-y-4 animate-fadeIn">
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => handleNavClick(onOpenBooking)}
                className="w-full min-h-[48px] flex items-center justify-between p-3.5 rounded-xl bg-[#FBF2D5] border border-[#E8D9B5] text-[#3C2F00] font-jakarta text-sm font-bold cursor-pointer text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">calendar_month</span>
                  <span>Agendamento Online</span>
                </div>
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>

              <button
                onClick={() => handleNavClick(onOpenServices)}
                className="w-full min-h-[48px] flex items-center justify-between p-3.5 rounded-xl bg-[#FDFBF9] hover:bg-[#F7EFEA] border border-[#E8D9B5]/60 text-[#49382E] font-jakarta text-sm cursor-pointer text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">palette</span>
                  <span>Catálogo de Procedimentos</span>
                </div>
                <span className="material-symbols-outlined text-[18px] text-[#786C63]">chevron_right</span>
              </button>


              <button
                onClick={() => handleNavClick(onOpenAbout)}
                className="w-full min-h-[48px] flex items-center justify-between p-3.5 rounded-xl bg-[#FDFBF9] hover:bg-[#F7EFEA] border border-[#E8D9B5]/60 text-[#49382E] font-jakarta text-sm cursor-pointer text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">person</span>
                  <span>Sobre Angélica do Carmo</span>
                </div>
                <span className="material-symbols-outlined text-[18px] text-[#786C63]">chevron_right</span>
              </button>

              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  const el = document.getElementById('localizacao-section');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="w-full min-h-[48px] flex items-center justify-between p-3.5 rounded-xl bg-[#FDFBF9] hover:bg-[#F7EFEA] border border-[#E8D9B5]/60 text-[#49382E] font-jakarta text-sm cursor-pointer text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">location_on</span>
                  <span>Localização (Pontal da Cruz)</span>
                </div>
                <span className="material-symbols-outlined text-[18px] text-[#786C63]">chevron_right</span>
              </button>

              <button
                onClick={() => handleNavClick(onOpenFAQ)}
                className="w-full min-h-[48px] flex items-center justify-between p-3.5 rounded-xl bg-[#FDFBF9] hover:bg-[#F7EFEA] border border-[#E8D9B5]/60 text-[#49382E] font-jakarta text-sm cursor-pointer text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">help</span>
                  <span>Dúvidas &amp; Biossegurança</span>
                </div>
                <span className="material-symbols-outlined text-[18px] text-[#786C63]">chevron_right</span>
              </button>
            </div>

            {whatsappUrl && (
              <div className="pt-2 border-t border-[#E8D9B5]">
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3.5 rounded-xl bg-[#F7EFEA] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] min-h-[48px] active:scale-[0.99] transition-transform">
                  <span className="material-symbols-outlined text-[#D4AF37] text-[20px] shrink-0">chat</span>
                  <div className="text-xs">
                    <span className="font-bold text-[#49382E] block">WhatsApp do Espaço</span>
                    <span className="text-[#786C63]">{studioCityLabel}</span>
                  </div>
                </a>
              </div>
            )}

            {/* Admin Entry in Mobile Navigation Menu */}
            <div className="pt-2 border-t border-[#E8D9B5]">
              <button
                type="button"
                onClick={() => handleNavClick(onOpenAdmin)}
                className="w-full min-h-[44px] flex items-center gap-2.5 p-3 rounded-xl bg-[#FDFBF9] hover:bg-[#F7EFEA] border border-[#E8D9B5] text-[#786C63] hover:text-[#49382E] text-xs font-semibold cursor-pointer transition-colors"
              >
                <span className="material-symbols-outlined text-[#D4AF37] text-[18px] shrink-0">lock</span>
                <span>Acesso Administrativo (Painel do Espaço)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
