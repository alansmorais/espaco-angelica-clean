import React, { useState } from 'react';
import { ClientProfile } from '../../types';

interface ClientsTabProps {
  onOpenNewClientModal: () => void;
  onBookNextForClient: (client: ClientProfile) => void;
  clients?: ClientProfile[];
  onUpdateClient?: (client: ClientProfile) => void;
}

export const ClientsTab: React.FC<ClientsTabProps> = ({
  onOpenNewClientModal,
  onBookNextForClient,
  clients = [],
  onUpdateClient
}) => {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    clients.length > 0 ? clients[0].id : null
  );
  const [activeFilter, setActiveFilter] = useState<'all' | 'frequentes' | 'novas' | 'atraso' | 'vip'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const selectedClient = clients.find(c => c.id === selectedClientId) || clients[0] || null;

  const filteredClients = clients.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.lastService && c.lastService.toLowerCase().includes(searchTerm.toLowerCase()));

    if (!matchesSearch) return false;

    if (activeFilter === 'frequentes') return c.status === 'frequente';
    if (activeFilter === 'novas') return c.status === 'nova';
    if (activeFilter === 'atraso') return c.status === 'atrasada' || c.isOverdue;
    if (activeFilter === 'vip') return c.status === 'vip' || c.tier === 'VIP Club';
    return true;
  });

  const handleSendClientReminder = (client: ClientProfile) => {
    const phoneDigits = client.phone.replace(/\D/g, '');
    if (!phoneDigits) {
      alert('Telefone não informado para esta cliente.');
      return;
    }
    const msg = encodeURIComponent(
      `Olá, ${client.name}! Aqui é a Angélica do Carmo do Espaço Angelica do Carmo (São Sebastião). Passando para conferir a saúde do seu alongamento e saber se deseja garantir seu horário de manutenção periódica nesta semana. Quando você tem preferência?`
    );
    window.open(`https://wa.me/${phoneDigits}?text=${msg}`, '_blank');
  };

  const overdueClients = clients.filter(c => c.isOverdue || c.status === 'atrasada');
  const vipClients = clients.filter(c => c.tier === 'VIP Club' || c.status === 'vip');

  return (
    <div className="flex flex-col gap-6 text-[#49382E]">
      {/* Top Meta & Real Quick KPI Ribbon */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-[#D4AF37]" />
            <span className="font-jakarta text-[11px] uppercase tracking-widest text-[#D4AF37] font-bold">
              Ateliê CRM • Fichas &amp; Anamnese
            </span>
          </div>
          <h1 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold tracking-tight mt-1">
            Gestão de Clientes &amp; Fichas Técnicas
          </h1>
          <p className="font-jakarta text-xs sm:text-sm text-[#786C63]">
            Histórico clínico de lâminas, preferências de formato, biométricas e ciclo de manutenção das clientes.
          </p>
        </div>

        {/* Real Metrics Ribbon */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-[#FBF2D5] border border-[#E8D9B5] flex items-center justify-center text-[#D4AF37]">
              <span className="material-symbols-outlined text-[18px]">group</span>
            </span>
            <div className="flex flex-col">
              <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold leading-none">
                Cadastradas
              </span>
              <span className="font-syne text-base text-[#49382E] font-bold mt-1">
                {clients.length}
              </span>
            </div>
          </div>

          <div className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
              <span className="material-symbols-outlined text-[18px]">notification_important</span>
            </span>
            <div className="flex flex-col">
              <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold leading-none">
                Retorno Pendente
              </span>
              <span className="font-syne text-base text-red-700 font-bold mt-1">
                {overdueClients.length}
              </span>
            </div>
          </div>

          <div className="px-3.5 py-2 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-[#FBF2D5] border border-[#E8D9B5] flex items-center justify-center text-[#D4AF37]">
              <span className="material-symbols-outlined text-[18px]">verified</span>
            </span>
            <div className="flex flex-col">
              <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold leading-none">
                Fidelidade VIP
              </span>
              <span className="font-syne text-base text-[#D4AF37] font-bold mt-1">
                {vipClients.length}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenNewClientModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md"
          >
            <span className="material-symbols-outlined text-[18px]">person_add</span>
            <span>+ Cadastrar Cliente</span>
          </button>
        </div>
      </div>

      {/* Main CRM Workspace (5 cols client list + 7 cols dossier) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Client List & Search (5 cols) */}
        <div className="xl:col-span-5 flex flex-col bg-[#FFFFFF] rounded-2xl p-4 sm:p-5 border border-[#E8D9B5] shadow-xs space-y-4">
          {/* Search bar */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#786C63] text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Buscar por nome, telefone ou serviço..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-[#FDFBF9] text-[#49382E] pl-9 pr-4 py-2 rounded-xl text-xs font-jakarta border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
            />
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap font-jakarta text-[11px]">
            {[
              { id: 'all', label: 'Todas' },
              { id: 'frequentes', label: 'Frequentes' },
              { id: 'novas', label: 'Novas' },
              { id: 'atraso', label: 'Em Atraso' },
              { id: 'vip', label: 'VIP' }
            ].map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFilter(f.id as any)}
                className={`px-3 py-1 rounded-full font-semibold transition-colors cursor-pointer border ${
                  activeFilter === f.id
                    ? 'bg-[#D4AF37] text-[#3C2F00] border-[#D4AF37]'
                    : 'bg-[#FDFBF9] text-[#786C63] border-[#E8D9B5] hover:bg-[#F7EFEA]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Client List */}
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {clients.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#786C63]">
                <span className="material-symbols-outlined text-[32px] text-[#A39A90] block mb-2">
                  group_off
                </span>
                <strong className="text-[#49382E] block mb-1">Nenhuma cliente cadastrada no sistema.</strong>
                <p className="text-[11px] text-[#786C63] mt-1">
                  Cadastre clientes manualmente ou aguarde os agendamentos realizados pelo site.
                </p>
                <button
                  type="button"
                  onClick={onOpenNewClientModal}
                  className="mt-3 px-4 py-1.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-bold transition-all text-xs shadow-xs"
                >
                  Cadastrar Primeira Cliente
                </button>
              </div>
            ) : filteredClients.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#786C63]">
                Nenhuma cliente encontrada com os filtros atuais.
              </div>
            ) : (
              filteredClients.map(client => {
                const isSelected = selectedClient?.id === client.id;
                return (
                  <div
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-[#FBF2D5] border-[#D4AF37] shadow-xs'
                        : 'bg-[#FDFBF9] border-[#E8D9B5] hover:border-[#D4AF37]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-[#FBF2D5] border border-[#E8D9B5] text-[#D4AF37] flex items-center justify-center font-syne text-xs font-bold shrink-0">
                        {client.initials}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-syne text-sm font-bold text-[#49382E] truncate">
                          {client.name}
                        </span>
                        <span className="font-jakarta text-[11px] text-[#786C63]">
                          {client.phone}
                        </span>
                        <span className="font-jakarta text-[10px] text-[#D4AF37] font-semibold truncate mt-0.5">
                          {client.lastService || 'Novo cadastro'}
                        </span>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-jakarta shrink-0 ${
                        client.tier === 'VIP Club'
                          ? 'bg-[#FBF2D5] text-[#3C2F00] border border-[#E8D9B5]'
                          : client.isOverdue
                          ? 'bg-red-100 text-red-800 border border-red-300'
                          : 'bg-[#F7EFEA] text-[#786C63] border border-[#E8D9B5]'
                      }`}
                    >
                      {client.tier}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Detailed Client Dossier (7 cols) */}
        <div className="xl:col-span-7 bg-[#FFFFFF] rounded-2xl p-5 sm:p-6 border border-[#E8D9B5] shadow-xs">
          {selectedClient ? (
            <div className="space-y-6 font-jakarta text-xs">
              {/* Dossier Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E8D9B5]">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#D4AF37] text-[#3C2F00] flex items-center justify-center font-syne text-base font-bold shadow-xs">
                    {selectedClient.initials}
                  </div>
                  <div>
                    <h3 className="font-syne text-lg text-[#49382E] font-bold">
                      {selectedClient.name}
                    </h3>
                    <span className="text-[#786C63]">
                      WhatsApp: {selectedClient.phone}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSendClientReminder(selectedClient)}
                    className="px-3.5 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-bold border border-[#E8D9B5] transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">chat</span>
                    <span>Contatar no WhatsApp</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onBookNextForClient(selectedClient)}
                    className="px-3.5 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md"
                  >
                    Agendar Horário
                  </button>
                </div>
              </div>

              {/* Bio & Nail Specifications */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-2">
                  <span className="text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold block">
                    Análise da Lâmina Ungueal
                  </span>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Tipo de Lâmina:</span>
                    <span className="text-[#49382E] font-semibold">{selectedClient.laminaType}</span>
                  </div>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Oleosidade:</span>
                    <span className="text-[#49382E] font-semibold">{selectedClient.oiliness}</span>
                  </div>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Alergias Relatadas:</span>
                    <span className="text-[#49382E] font-semibold">{selectedClient.allergies}</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-2">
                  <span className="text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold block">
                    Preferências Artísticas
                  </span>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Formato Favorito:</span>
                    <span className="text-[#49382E] font-semibold">{selectedClient.preferredShape}</span>
                  </div>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Paleta / Estilo:</span>
                    <span className="text-[#49382E] font-semibold">{selectedClient.preferredColor}</span>
                  </div>
                  <div className="flex justify-between text-[#786C63]">
                    <span>Último Atendimento:</span>
                    <span className="text-[#49382E] font-semibold">{selectedClient.lastVisit}</span>
                  </div>
                </div>
              </div>

              {/* Private Notes */}
              <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
                <span className="text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold block">
                  Notas Confidenciais da Manicure
                </span>
                <p className="text-[#786C63] leading-relaxed">
                  {selectedClient.privateNotes || 'Nenhuma observação clínica adicional registrada.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-xs text-[#786C63] space-y-2">
              <span className="material-symbols-outlined text-[36px] text-[#A39A90] block">
                person_search
              </span>
              <p className="font-semibold text-[#49382E]">Nenhuma cliente selecionada.</p>
              <p className="text-[11px] text-[#786C63]">
                Selecione uma cliente na lista para visualizar sua ficha técnica ou clique em "+ Cadastrar Cliente".
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
