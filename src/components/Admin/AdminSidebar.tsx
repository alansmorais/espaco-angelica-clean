import React, { useState } from 'react';
import { BRAND_ASSETS } from '../../data/mockData';

export type AdminTab =
  | 'visao-geral'
  | 'agenda-bloqueios'
  | 'confirmacao-sinais-pix'
  | 'gestao-clientes'
  | 'financeiro-servicos'
  | 'configuracoes';

interface AdminSidebarProps {
  activeTab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
  onSwitchToPublic: () => void;
  pendingPixCount?: number;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  activeTab,
  onSelectTab,
  onSwitchToPublic,
  pendingPixCount = 0,
  isOpenMobile,
  onCloseMobile
}) => {
  const [studioOpen, setStudioOpen] = useState(true);

  const navItems: { id: AdminTab; label: string; icon: string; badge?: string; badgeColor?: string }[] = [
    { id: 'visao-geral', label: 'Visão Geral', icon: 'grid_view' },
    { id: 'agenda-bloqueios', label: 'Agenda & Bloqueios', icon: 'calendar_today' },
    {
      id: 'confirmacao-sinais-pix',
      label: 'Confirmação Sinais Pix',
      icon: 'payments',
      badge: pendingPixCount > 0 ? `${pendingPixCount} Pendente${pendingPixCount > 1 ? 's' : ''}` : undefined,
      badgeColor: 'bg-[#93000a] text-[#ffdad6]'
    },
    {
      id: 'gestao-clientes',
      label: 'Gestão de Clientes',
      icon: 'group'
    },
    { id: 'financeiro-servicos', label: 'Financeiro & Serviços', icon: 'diamond' },
    { id: 'configuracoes', label: 'Configurações Ateliê', icon: 'tune' }
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm xl:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-full w-72 bg-[#FFFFFF]/95 backdrop-blur-2xl z-50 flex flex-col justify-between border-r border-[#E8D9B5] shadow-[0_12px_32px_-4px_rgba(212,175,55,0.06)] transition-transform duration-300 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full xl:translate-x-0'
        }`}
      >
        <div className="flex flex-col">
          {/* Header Brand */}
          <div className="h-20 flex items-center justify-between px-6 border-b border-[#E8D9B5]">
            <div className="flex items-center gap-3">
              <div className="p-1 rounded-lg bg-[#0B0A0A] border border-[#E8D9B5] inline-flex shadow-xs">
                <img
                  alt="Angelica do Carmo Logo"
                  className="h-7 w-auto object-contain"
                  src={BRAND_ASSETS.logoGold}
                />
              </div>
              <div className="flex flex-col">
                <span className="font-syne text-[17px] text-[#49382E] tracking-tight leading-none font-semibold">
                  Angelica do Carmo
                </span>
                <span className="font-jakarta text-[10px] uppercase tracking-widest text-[#D4AF37] font-bold mt-1">
                  Espaço Angie
                </span>
              </div>
            </div>

            <button
              onClick={onCloseMobile}
              className="xl:hidden w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E]"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Studio Live Status Widget */}
          <div className="px-4 py-3">
            <div className="p-3 rounded-2xl bg-[#FDFBF9] flex items-center justify-between border border-[#E8D9B5] shadow-xs">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5">
                  {studioOpen && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4AF37] opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                      studioOpen ? 'bg-[#D4AF37]' : 'bg-[#786C63]'
                    }`}
                  />
                </span>
                <div className="flex flex-col">
                  <span className="font-jakarta text-[10px] uppercase text-[#786C63] leading-none font-bold">
                    Status
                  </span>
                  <span className="font-jakarta text-xs text-[#49382E] mt-1 font-semibold">
                    {studioOpen ? 'Ateliê Aberto' : 'Ateliê Fechado'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStudioOpen(!studioOpen)}
                title="Alterar status de funcionamento"
                className="h-7 w-7 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#D4AF37] hover:bg-[#F7EFEA] transition-colors cursor-pointer shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px]">more_vert</span>
              </button>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex flex-col gap-1.5 px-4 mt-2">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    onCloseMobile();
                  }}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-jakarta text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#FBF2D5] text-[#3C2F00] font-bold shadow-xs border border-[#E8D9B5]'
                      : 'text-[#786C63] hover:bg-[#F7EFEA] hover:text-[#49382E]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`material-symbols-outlined text-[20px] ${isActive ? 'text-[#D4AF37]' : 'text-[#786C63]'}`}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>

                  {item.badge && (
                    <span
                      className={`px-2 py-0.5 rounded-full font-jakarta text-[10px] font-bold ${
                        item.badgeColor || 'bg-[#BA1A1A] text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Profile & Client Switcher */}
        <div className="p-4 flex flex-col gap-3 border-t border-[#E8D9B5]">
          {/* Switch to Client View */}
          <button
            type="button"
            onClick={onSwitchToPublic}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#FFFFFF] hover:bg-[#F7EFEA] text-[#49382E] font-jakarta text-xs font-semibold border border-[#E8D9B5] transition-all cursor-pointer shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">visibility</span>
            <span>Ver como Cliente</span>
          </button>

          {/* Master Artist Profile card */}
          <div className="p-3 rounded-2xl bg-[#FDFBF9] flex items-center gap-3 border border-[#E8D9B5] shadow-xs">
            <div className="w-9 h-9 rounded-full bg-[#D4AF37] flex items-center justify-center text-[#3C2F00] font-syne text-sm font-bold shadow-xs">
              A
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-jakarta text-xs text-[#49382E] truncate font-semibold">
                Angelica do Carmo
              </span>
              <span className="font-jakarta text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold">
                Master Artist
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
