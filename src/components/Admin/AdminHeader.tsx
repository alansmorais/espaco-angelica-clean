import React from 'react';
import { BRAND_ASSETS } from '../../data/mockData';

interface AdminHeaderProps {
  onOpenManualBooking: () => void;
  onOpenMobileSidebar: () => void;
  onSwitchToPublic: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const AdminHeader: React.FC<AdminHeaderProps> = ({
  onOpenManualBooking,
  onOpenMobileSidebar,
  onSwitchToPublic,
  searchQuery,
  onSearchChange
}) => {
  return (
    <header className="fixed top-0 left-0 xl:left-72 right-0 h-20 bg-[#FFFFFF]/90 backdrop-blur-xl z-40 border-b border-[#E8D9B5] shadow-[0_1px_8px_rgba(73,56,46,0.06)]">
      <div className="w-full h-full px-4 sm:px-8 flex items-center justify-between gap-4">
        {/* Left: Mobile Menu Trigger + Logo */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="xl:hidden w-10 h-10 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] flex items-center justify-center text-[#49382E] hover:text-[#D4AF37] transition-colors shadow-xs"
          >
            <span className="material-symbols-outlined text-[22px]">menu</span>
          </button>

          <div className="flex items-center gap-3">
            <div className="p-1 rounded-lg bg-[#0B0A0A] border border-[#E8D9B5] inline-flex shadow-xs">
              <img
                alt="Logo Espaço Angelica do Carmo"
                className="h-6 w-auto object-contain"
                src={BRAND_ASSETS.logoGold}
              />
            </div>
            <span className="font-syne text-base sm:text-lg text-[#49382E] tracking-tight hidden sm:inline-block font-semibold">
              Espaço Angelica do Carmo
            </span>
          </div>
        </div>

        {/* Center: Search input */}
        <div className="hidden md:flex items-center flex-1 max-w-xs lg:max-w-md mx-4">
          <div className="relative w-full">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#786C63] text-[18px]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Buscar cliente, serviço, data..."
              className="w-full bg-[#FDFBF9] text-[#49382E] placeholder-[#786C63] font-jakarta text-xs rounded-full pl-10 pr-4 py-2 border border-[#E8D9B5] focus:outline-none focus:border-[#D4AF37]"
            />
          </div>
        </div>

        {/* Right Action buttons */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* New Manual Booking Button */}
          <button
            type="button"
            onClick={onOpenManualBooking}
            className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs sm:text-[13px] font-bold tracking-wider shadow-[0_4px_16px_rgba(212,175,55,0.3)] hover:bg-[#E5C158] transition-all cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span className="hidden sm:inline">Novo Agendamento Manual</span>
            <span className="sm:hidden">Agendar</span>
          </button>

          {/* Quick Client View Toggle */}
          <button
            type="button"
            onClick={onSwitchToPublic}
            title="Ver site como cliente"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#D4AF37] hover:bg-[#F7EFEA] transition-colors cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-[20px]">storefront</span>
          </button>

          {/* Notifications */}
          <button
            type="button"
            title="Notificações do ateliê"
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#D4AF37] hover:bg-[#F7EFEA] transition-colors cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-[20px]">notifications</span>
          </button>

          {/* User Avatar */}
          <div className="w-8 h-8 rounded-full bg-[#D4AF37] text-[#3C2F00] flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
            <span>A</span>
          </div>
        </div>
      </div>
    </header>
  );
};
