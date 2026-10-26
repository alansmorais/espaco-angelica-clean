import React, { useState, useEffect } from 'react';
import { TimeSlotConfig, DayScheduleConfig, BlacklistEntry, StudioAddressConfig, WhatsAppConfig, PaymentConfig } from '../../types';
import { checkWhatsAppStatus, testWhatsAppMessage, fetchWhatsAppLogs, WhatsAppStatus } from '../../services/whatsappService';
import {
  DEFAULT_APPS_SCRIPT_WEBHOOK_URL,
  getNotificationWebhookUrl,
  setNotificationWebhookUrl,
  getNotificationWebhookToken,
  setNotificationWebhookToken,
  testNotificationWebhook
} from '../../services/emailNotificationService';
import {
  AUTHORIZED_SENDER_EMAIL,
  TARGET_NOTIFICATION_EMAIL,
  sendDirectGmailFromBrowser
} from '../../services/gmailService';
import { CODE_GS_TEMPLATE } from '../../data/codeGsTemplate';
import { fetchRemoteAppSettings, saveRemoteAppSetting } from '../../services/emailNotificationService';

interface SettingsTabProps {
  readOnlyPreview?: boolean;
  timeSlots?: TimeSlotConfig[];
  onUpdateTimeSlots?: (slots: TimeSlotConfig[]) => void;
  daySchedules?: DayScheduleConfig[];
  onUpdateDaySchedules?: (schedules: DayScheduleConfig[]) => void;
  blacklist?: BlacklistEntry[];
  onUpdateBlacklist?: (entries: BlacklistEntry[]) => void;
  studioAddress?: StudioAddressConfig;
  onUpdateStudioAddress?: (addr: StudioAddressConfig) => Promise<boolean> | void;
  whatsappConfig?: WhatsAppConfig;
  onUpdateWhatsappConfig?: (config: WhatsAppConfig) => Promise<boolean> | void;
  adminSessionToken?: string;
  onUpdatePaymentConfig?: (config: PaymentConfig) => Promise<boolean> | void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  readOnlyPreview = false,
  timeSlots: propTimeSlots,
  onUpdateTimeSlots,
  daySchedules: propDaySchedules,
  onUpdateDaySchedules,
  blacklist: propBlacklist,
  onUpdateBlacklist,
  studioAddress: propStudioAddress,
  onUpdateStudioAddress,
  whatsappConfig: propWhatsappConfig,
  onUpdateWhatsappConfig,
  adminSessionToken = '',
  onUpdatePaymentConfig
}) => {
  const previewNotice = 'Ação desativada na pré-visualização somente leitura.';

  // Local fallbacks if not wired in App
  // Default editable schedule: every day, 07:00–20:00. Saved official settings still take precedence.
  const [internalSlots, setInternalSlots] = useState<TimeSlotConfig[]>(Array.from({ length: 26 }, (_, index) => {
    const minutes = 7 * 60 + index * 30;
    const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return { id: `default-${time}`, time, status: 'disponivel' as const, active: true };
  }));
  const [internalDays, setInternalDays] = useState<DayScheduleConfig[]>([
    { dayKey: 'seg', dayLabel: 'Segunda-feira', isOpen: true, openTime: '07:00', closeTime: '20:00' },
    { dayKey: 'ter', dayLabel: 'Terça-feira', isOpen: true, openTime: '07:00', closeTime: '20:00' },
    { dayKey: 'qua', dayLabel: 'Quarta-feira', isOpen: true, openTime: '07:00', closeTime: '20:00' },
    { dayKey: 'qui', dayLabel: 'Quinta-feira', isOpen: true, openTime: '07:00', closeTime: '20:00' },
    { dayKey: 'sex', dayLabel: 'Sexta-feira', isOpen: true, openTime: '07:00', closeTime: '20:00' },
    { dayKey: 'sab', dayLabel: 'Sábado', isOpen: true, openTime: '07:00', closeTime: '20:00' },
    { dayKey: 'dom', dayLabel: 'Domingo', isOpen: true, openTime: '07:00', closeTime: '20:00' }
  ]);

  const [internalBlacklist, setInternalBlacklist] = useState<BlacklistEntry[]>([]);

  const [internalAddress, setInternalAddress] = useState<StudioAddressConfig>({ street: '', number: '', neighborhood: '', city: '', state: '', fullAddress: '', mapsUrl: '', wazeUrl: '' });

  const slots = propTimeSlots || internalSlots;
  const days = propDaySchedules || internalDays;
  const blacklist = propBlacklist || internalBlacklist;
  const address = propStudioAddress || internalAddress;

  const updateSlots = (newSlots: TimeSlotConfig[]) => {
    if (onUpdateTimeSlots) onUpdateTimeSlots(newSlots);
    else setInternalSlots(newSlots);
  };

  const updateDays = (newDays: DayScheduleConfig[]) => {
    if (onUpdateDaySchedules) onUpdateDaySchedules(newDays);
    else setInternalDays(newDays);
  };

  const updateBlacklist = (newBl: BlacklistEntry[]) => {
    if (onUpdateBlacklist) onUpdateBlacklist(newBl);
    else setInternalBlacklist(newBl);
  };

  // State for Pix & Settings
  const [pixKey, setPixKey] = useState('');
  const [pixBeneficiary, setPixBeneficiary] = useState('');
  const [depositAmount, setDepositAmount] = useState('40');
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);

  // Time Slot Management UI State
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newSlotNote, setNewSlotNote] = useState('');
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [editingSlotTime, setEditingSlotTime] = useState('');
  const [editingSlotNote, setEditingSlotNote] = useState('');

  // Blacklist Management UI State
  const [newBlPhone, setNewBlPhone] = useState('');
  const [newBlName, setNewBlName] = useState('');
  const [newBlReason, setNewBlReason] = useState('Faltou sem avisar (No-show)');
  const [showAddBlModal, setShowAddBlModal] = useState(false);

  // Address edit state
  const [addressText, setAddressText] = useState(address.fullAddress);

  // WhatsApp Business API State
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [waConfig, setWaConfig] = useState<WhatsAppConfig>(() => propWhatsappConfig || { autoSendOnConfirm: false });
  const [waTemplate, setWaTemplate] = useState<string>(() => {
    return waConfig.customTemplate || `✨ *Solicitação de agendamento • Espaço Angélica do Carmo* ✨

Olá, Angélica! 💅✨ Gostaria de solicitar um horário no seu espaço privativo.

📋 *Detalhes do atendimento:*
• *Procedimento:* {servico}
• *Data desejada:* {data}
• *Horário desejado:* {horario}
• *Valor informado:* {valor}
• *Sinal de 40%:* {sinal}

📍 *Endereço do atendimento:* {endereco}

Estou ciente de que:
• Devo chegar com 5 a 10 minutos de antecedência.
• Para alterar a data, preciso avisar com pelo menos 24 horas de antecedência.
• Em caso de desistência ou não comparecimento, o sinal pago não é reembolsável.

Por favor, confirme a disponibilidade e as instruções para o pagamento do sinal. Obrigada! 💕`;
  });
  const [waLogs, setWaLogs] = useState<any[]>([]);
  const [testPhone, setTestPhone] = useState<string>('');
  const [testClientName, setTestClientName] = useState<string>('');
  const [isTestingWa, setIsTestingWa] = useState<boolean>(false);
  const [testWaFeedback, setTestWaFeedback] = useState<{ message: string; success: boolean; fallbackUrl?: string } | null>(null);
  const [showWaPreview, setShowWaPreview] = useState<boolean>(false);

  // Webhook de Notificações por E-mail (Google Apps Script / Sheets)
  const [webhookUrlInput, setWebhookUrlInput] = useState<string>(() => getNotificationWebhookUrl() || DEFAULT_APPS_SCRIPT_WEBHOOK_URL);
  const [webhookTokenInput, setWebhookTokenInput] = useState<string>(() => getNotificationWebhookToken() || '');
  const [isTestingWebhook, setIsTestingWebhook] = useState<boolean>(false);
  const [webhookFeedback, setWebhookFeedback] = useState<{ message: string; success: boolean } | null>(null);
  const [showScriptDetails, setShowScriptDetails] = useState<boolean>(false);

  // Email is sent by Apps Script MailApp; no Firebase Auth or browser OAuth session.
  const [isTestingDirectGmail, setIsTestingDirectGmail] = useState<boolean>(false);
  const [gmailOAuthFeedback, setGmailOAuthFeedback] = useState<{ message: string; success: boolean } | null>(null);

  const handleTestDirectGmail = async () => {
    if (readOnlyPreview) { notify(previewNotice); return; }
    setIsTestingDirectGmail(true);
    setGmailOAuthFeedback(null);
    try {
      const res = await sendDirectGmailFromBrowser({
        clientName: 'Teste de integração',
        clientPhone: '',
        clientEmail: TARGET_NOTIFICATION_EMAIL,
        serviceTitle: 'Teste de envio pelo Apps Script',
        date: 'Teste',
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        depositAmount: 0,
        status: 'teste_sistema',
        appointmentId: `test-${Date.now()}`,
        notes: `Teste de envio solicitado no painel. Remetente esperado: ${AUTHORIZED_SENDER_EMAIL}.`
      });
      setGmailOAuthFeedback({ success: res.success, message: res.message });
    } catch (err: any) {
      setGmailOAuthFeedback({ success: false, message: err.message || 'Falha no teste de e-mail via Apps Script.' });
    } finally {
      setIsTestingDirectGmail(false);
    }
  };

  useEffect(() => {
    setAddressText(address.fullAddress || '');
  }, [address.fullAddress]);

  useEffect(() => {
    if (!adminSessionToken) return;
    let active = true;
    void fetchRemoteAppSettings(adminSessionToken).then(result => {
      if (!active || !result.success || !result.settings) return;
      const payment = result.settings.PAYMENT_CONFIG as Record<string, unknown> | undefined;
      if (payment) {
        setPixKey(String(payment.pixKey || ''));
        setPixBeneficiary(String(payment.pixBeneficiary || ''));
        setDepositAmount(String(payment.depositAmount ?? '40'));
      }
    });
    return () => { active = false; };
  }, [adminSessionToken]);

  useEffect(() => {
    if (!propWhatsappConfig) return;
    setWaConfig(propWhatsappConfig);
    if (propWhatsappConfig.customTemplate) setWaTemplate(propWhatsappConfig.customTemplate);
  }, [propWhatsappConfig]);

  const handleSaveStudioAddress = async () => {
    if (readOnlyPreview) { notify(previewNotice); return; }
    const nextAddress = { ...address, fullAddress: addressText.trim() };
    if (!nextAddress.fullAddress) {
      notify('Informe o endereço oficial antes de salvar.');
      return;
    }
    if (onUpdateStudioAddress) {
      const saved = await onUpdateStudioAddress(nextAddress);
      if (saved === false) return;
    }
    setInternalAddress(nextAddress);
    notify('Endereço salvo na planilha oficial.');
  };

  const handleSavePixSettings = async () => {
    if (readOnlyPreview) { notify(previewNotice); return; }
    const nextConfig: PaymentConfig = {
      pixKey: pixKey.trim(),
      pixBeneficiary: pixBeneficiary.trim(),
      depositAmount: Number(depositAmount || 40),
    };
    if (onUpdatePaymentConfig) {
      const saved = await onUpdatePaymentConfig(nextConfig);
      if (saved === false) return;
    } else {
      const result = await saveRemoteAppSetting('PAYMENT_CONFIG', nextConfig, adminSessionToken);
      if (!result.success) {
        notify('Não foi possível salvar as regras de Pix na planilha oficial: ' + (result.error || ''));
        return;
      }
    }
    notify('Regras de Pix salvas na planilha oficial.');
  };

  const handleSaveWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    setNotificationWebhookUrl(webhookUrlInput);
    if (!readOnlyPreview) setNotificationWebhookToken(webhookTokenInput);
    notify('Parâmetros do Webhook e Chave de Autorização salvos!');
  };

  const handleTestWebhook = async () => {
    if (readOnlyPreview) { notify(previewNotice); return; }
    if (!webhookUrlInput.trim()) {
      setWebhookFeedback({ message: 'Informe a URL do Webhook antes de testar.', success: false });
      return;
    }
    setIsTestingWebhook(true);
    setWebhookFeedback(null);
    try {
      const res = await testNotificationWebhook(webhookUrlInput.trim(), webhookTokenInput.trim());
      setWebhookFeedback({ message: res.message, success: res.success });
    } catch (err: any) {
      setWebhookFeedback({ message: err.message || 'Erro ao conectar ao Webhook.', success: false });
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const handleSaveWaConfig = async () => {
    if (readOnlyPreview) { notify(previewNotice); return; }
    const rawInstagram = String(waConfig.instagramUrl || '').trim();
    const instagramUrl = rawInstagram
      ? (/^https?:\/\//i.test(rawInstagram)
          ? rawInstagram
          : `https://www.instagram.com/${rawInstagram.replace(/^@+/, '').replace(/^instagram\.com\//i, '').replace(/^www\.instagram\.com\//i, '').replace(/\/+$/, '')}/`)
      : '';
    if (instagramUrl && !/^https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]+\/?$/i.test(instagramUrl)) {
      notify('Informe um @usuário válido ou um link do Instagram, por exemplo @angelicadocarmo_nails.');
      return;
    }
    const updated: WhatsAppConfig = { ...waConfig, instagramUrl, customTemplate: waTemplate };
    if (onUpdateWhatsappConfig) {
      const saved = await onUpdateWhatsappConfig(updated);
      if (saved === false) return;
    }
    setWaConfig(updated);
    notify('Configurações do WhatsApp salvas na planilha oficial.');
  };

  const handleTestWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone.trim()) {
      alert('Informe um número de telefone para teste.');
      return;
    }
    setIsTestingWa(true);
    setTestWaFeedback(null);
    try {
      const res = await testWhatsAppMessage(testPhone, testClientName);
      setTestWaFeedback({
        message: res.message || (res.success ? 'Mensagem disparada com sucesso!' : 'Falha no disparo'),
        success: res.success,
        fallbackUrl: res.fallbackUrl
      });
      fetchWhatsAppLogs().then(setWaLogs);
      checkWhatsAppStatus().then(setWaStatus);
    } catch (err: any) {
      setTestWaFeedback({
        message: err.message || 'Erro ao conectar à API.',
        success: false
      });
    } finally {
      setIsTestingWa(false);
    }
  };

  const notify = (msg: string) => {
    setSavedSuccess(msg);
    setTimeout(() => setSavedSuccess(null), 4000);
  };

  // Handle Slot Actions
  const handleAddSlot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSlotTime.trim()) return;

    const newSlot: TimeSlotConfig = {
      id: `slot-${Date.now()}`,
      time: newSlotTime.trim(),
      status: 'disponivel',
      note: newSlotNote.trim() || undefined,
      active: true
    };

    const sorted = [...slots, newSlot].sort((a, b) => a.time.localeCompare(b.time));
    updateSlots(sorted);
    setNewSlotTime('');
    setNewSlotNote('');
    notify(`Novo horário ${newSlot.time} adicionado à grade!`);
  };

  const handleToggleBlockSlot = (slotId: string) => {
    const updated = slots.map(s => {
      if (s.id === slotId) {
        const isCurrentlyBlocked = s.status === 'bloqueado' || s.status === 'autoclave' || s.status === 'almoco';
        return {
          ...s,
          status: isCurrentlyBlocked ? ('disponivel' as const) : ('bloqueado' as const),
          note: isCurrentlyBlocked ? undefined : 'Bloqueado no painel'
        };
      }
      return s;
    });
    updateSlots(updated);
    notify('Status de bloqueio do horário atualizado!');
  };

  const handleDeleteSlot = (slotId: string, time: string) => {
    if (confirm(`Deseja realmente remover o horário das ${time} da grade de atendimento?`)) {
      const updated = slots.filter(s => s.id !== slotId);
      updateSlots(updated);
      notify(`Horário das ${time} excluído.`);
    }
  };

  const handleStartEditSlot = (s: TimeSlotConfig) => {
    setEditingSlotId(s.id);
    setEditingSlotTime(s.time);
    setEditingSlotNote(s.note || '');
  };

  const handleSaveEditSlot = (slotId: string) => {
    const updated = slots.map(s => {
      if (s.id === slotId) {
        return {
          ...s,
          time: editingSlotTime.trim() || s.time,
          note: editingSlotNote.trim() || undefined
        };
      }
      return s;
    }).sort((a, b) => a.time.localeCompare(b.time));
    updateSlots(updated);
    setEditingSlotId(null);
    notify('Horário alterado com sucesso!');
  };

  // Handle Blacklist Actions
  const handleAddBlacklist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlPhone.trim()) return;

    const entry: BlacklistEntry = {
      id: `bl-${Date.now()}`,
      phone: newBlPhone.trim(),
      clientName: newBlName.trim() || 'Cliente Não Identificado',
      reason: newBlReason.trim(),
      addedDate: new Date().toLocaleDateString('pt-BR'),
      active: true,
      requires100Percent: true
    };

    updateBlacklist([entry, ...blacklist]);
    setShowAddBlModal(false);
    setNewBlPhone('');
    setNewBlName('');
    notify(`Número ${entry.phone} cadastrado na lista de pré-pagamento obrigatório!`);
  };

  const handleToggleBlacklist = (id: string) => {
    const updated = blacklist.map(b => b.id === id ? { ...b, active: !b.active } : b);
    updateBlacklist(updated);
    notify('Status de restrição atualizado!');
  };

  const handleDeleteBlacklist = (id: string, name: string) => {
    if (confirm(`Remover restrição de ${name}?`)) {
      updateBlacklist(blacklist.filter(b => b.id !== id));
      notify(`Restrição de ${name} removida.`);
    }
  };

  // Handle Day Schedule Toggle
  const handleToggleDay = (dayKey: string) => {
    const updated = days.map(d => {
      if (d.dayKey !== dayKey) return d;
      const opening = !d.isOpen;
      // Default opening hours: every day, 07:00–20:00; the owner can close any weekday.
      return {
        ...d,
        isOpen: opening,
        openTime: opening ? (d.openTime || '07:00') : d.openTime,
        closeTime: opening ? (d.closeTime || '20:00') : d.closeTime
      };
    });
    updateDays(updated);
    notify('Dia de expediente atualizado. Horário padrão ao abrir: 07:00 às 20:00; ajuste se necessário.');
  };
  return (
    <div className="flex flex-col gap-6 max-w-5xl text-[#49382E]">
      {readOnlyPreview && (
        <div role="status" className="mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Pré-visualização somente leitura. Nenhuma alteração em serviços, agenda, pagamentos, clientes, WhatsApp ou e-mail será executada.
        </div>
      )}
      {readOnlyPreview && (
        <div role="status" className="mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Pré-visualização somente leitura: alterações de serviços, agenda, pagamentos, clientes, e-mail e WhatsApp estão desativadas até a validação final do Apps Script.
        </div>
      )}
      <div>
        <div className="flex items-center gap-1.5 text-[#D4AF37] mb-1">
          <span className="material-symbols-outlined text-[18px]">tune</span>
          <span className="font-jakarta text-[11px] uppercase tracking-widest font-bold">
            Diretrizes &amp; Parâmetros Operacionais
          </span>
        </div>
        <h1 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold tracking-tight">
          Configurações do Espaço &amp; Grade de Atendimento
        </h1>
        <p className="font-jakarta text-xs sm:text-sm text-[#786C63]">
          Gerencie horários de atendimento, bloqueios preventivos de agenda, números com exigência de pré-pagamento via Pix e endereço do estúdio.
        </p>
      </div>

      {savedSuccess && (
        <div className="p-3.5 rounded-xl bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">check_circle</span>
            <span>{savedSuccess}</span>
          </div>
          <button onClick={() => setSavedSuccess(null)} className="cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Box 1: HORÁRIOS DE ATENDIMENTO (Adicionar, Editar, Deletar, Bloquear) */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37]">schedule</span>
            <div>
              <h3 className="font-syne text-lg text-[#49382E] font-bold">
                Grade de Horários de Atendimento
              </h3>
              <span className="font-jakarta text-xs text-[#786C63]">
                Adicione, edite, exclua ou bloqueie horários. As clientes só verão os horários ativos e desbloqueados.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-[#FBF2D5] text-[#3C2F00] font-jakarta text-[11px] font-bold border border-[#E8D9B5]">
              {slots.filter(s => s.status === 'disponivel').length} Disponíveis / {slots.length} Total
            </span>
          </div>
        </div>

        {/* Quick Add Slot Form */}
        <form onSubmit={handleAddSlot} className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full sm:w-36">
            <label className="block text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold mb-1">
              Novo Horário
            </label>
            <input
              type="time"
              required
              value={newSlotTime}
              onChange={e => setNewSlotTime(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] text-xs font-bold focus:border-[#D4AF37] outline-none"
            />
          </div>

          <div className="flex-1 w-full">
            <label className="block text-[10px] text-[#786C63] uppercase tracking-wider font-bold mb-1">
              Nota / Observação do Horário (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Turno matutino, Vaga extra, etc."
              value={newSlotNote}
              onChange={e => setNewSlotNote(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] text-xs focus:border-[#D4AF37] outline-none"
            />
          </div>

          <button
            type="submit"
            className="w-full sm:w-auto mt-auto px-5 py-2.5 rounded-xl bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs shrink-0"
          >
            <span className="material-symbols-outlined text-[18px]">add_circle</span>
            <span>Adicionar Horário</span>
          </button>
        </form>

        {/* Time Slots Grid with Edit, Delete, and Block Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {slots.map(slot => {
            const isBlocked = slot.status === 'bloqueado' || slot.status === 'autoclave' || slot.status === 'almoco';
            const isEditing = editingSlotId === slot.id;

            return (
              <div
                key={slot.id}
                className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-2.5 shadow-xs ${
                  isBlocked
                    ? 'bg-red-50/60 border-red-200'
                    : 'bg-[#FFFFFF] border-[#E8D9B5] hover:border-[#D4AF37]'
                }`}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={editingSlotTime}
                        onChange={e => setEditingSlotTime(e.target.value)}
                        className="px-2 py-1 rounded bg-[#FFFFFF] text-[#49382E] border border-[#D4AF37] text-xs font-bold"
                      />
                      <input
                        type="text"
                        placeholder="Nota"
                        value={editingSlotNote}
                        onChange={e => setEditingSlotNote(e.target.value)}
                        className="flex-1 px-2 py-1 rounded bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => handleSaveEditSlot(slot.id)}
                        className="px-3 py-1 rounded-full bg-[#D4AF37] text-[#3C2F00] text-xs font-bold cursor-pointer"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingSlotId(null)}
                        className="px-2 py-1 text-xs text-[#786C63] cursor-pointer"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">
                          schedule
                        </span>
                        <span className="font-syne text-lg font-bold text-[#49382E] tracking-wide">
                          {slot.time}
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-jakarta font-bold uppercase tracking-wider ${
                          isBlocked
                            ? 'bg-red-100 text-red-800 border border-red-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                      >
                        {isBlocked ? 'Bloqueado' : 'Disponível'}
                      </span>
                    </div>

                    {slot.note && (
                      <span className="text-[11px] text-[#786C63] italic">
                        {slot.note}
                      </span>
                    )}

                    <div className="pt-2 border-t border-[#E8D9B5] flex items-center justify-between gap-1">
                      {/* Block/Unblock Button */}
                      <button
                        type="button"
                        onClick={() => handleToggleBlockSlot(slot.id)}
                        className={`px-3 py-1 rounded-full text-[11px] font-jakarta font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          isBlocked
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-300'
                            : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-300'
                        }`}
                        title={isBlocked ? 'Desbloquear para agendamento' : 'Bloquear horário'}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {isBlocked ? 'lock_open' : 'lock'}
                        </span>
                        <span>{isBlocked ? 'Desbloquear' : 'Bloquear'}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditSlot(slot)}
                          className="w-7 h-7 rounded-lg bg-[#F7EFEA] text-[#786C63] hover:text-[#D4AF37] flex items-center justify-center cursor-pointer border border-[#E8D9B5]"
                          title="Editar horário"
                        >
                          <span className="material-symbols-outlined text-[15px]">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSlot(slot.id, slot.time)}
                          className="w-7 h-7 rounded-lg bg-[#F7EFEA] text-[#786C63] hover:text-red-600 flex items-center justify-center cursor-pointer border border-[#E8D9B5]"
                          title="Excluir horário"
                        >
                          <span className="material-symbols-outlined text-[15px]">delete</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Days of Week Operating Hours */}
        <div className="pt-4 border-t border-[#E8D9B5]">
          <span className="font-syne text-sm text-[#D4AF37] font-bold block mb-3">
            Dias de Abertura do Espaço:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {days.map(d => (
              <div
                key={d.dayKey}
                className={`p-3 rounded-xl border text-center transition-all ${
                  d.isOpen
                    ? 'bg-[#FFFFFF] border-[#D4AF37] text-[#49382E] shadow-xs'
                    : 'bg-[#F7EFEA]/50 border-[#E8D9B5] text-[#A39A90]'
                }`}
              >
                <span className="block font-bold text-xs">{d.dayLabel}</span>
                <button
                  type="button"
                  aria-pressed={d.isOpen}
                  onClick={() => handleToggleDay(d.dayKey)}
                  className={`text-[10px] uppercase font-bold mt-1 block w-full rounded-md py-1 ${d.isOpen ? 'text-[#D4AF37]' : 'text-[#A39A90]'}`}
                >
                  {d.isOpen ? 'Aberto' : 'Fechado'} · alterar
                </button>
                {d.isOpen && (
                  <div className="mt-2 space-y-2 text-left" onClick={event => event.stopPropagation()}>
                    <label className="block text-[10px] font-semibold text-[#786C63]">
                      Abre
                      <input
                        type="time"
                        aria-label={`Abertura ${d.dayLabel}`}
                        value={d.openTime || '07:00'}
                        onChange={event => updateDays(days.map(day => day.dayKey === d.dayKey ? { ...day, openTime: event.target.value } : day))}
                        className="mt-1 w-full min-w-0 rounded-md border border-[#E8D9B5] bg-white px-2 py-2 text-xs text-[#49382E]"
                      />
                    </label>
                    <label className="block text-[10px] font-semibold text-[#786C63]">
                      Fecha
                      <input
                        type="time"
                        aria-label={`Encerramento ${d.dayLabel}`}
                        value={d.closeTime || '20:00'}
                        onChange={event => updateDays(days.map(day => day.dayKey === d.dayKey ? { ...day, closeTime: event.target.value } : day))}
                        className="mt-1 w-full min-w-0 rounded-md border border-[#E8D9B5] bg-white px-2 py-2 text-xs text-[#49382E]"
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Box 2: BLOQUEIO DE INADIMPLENTES & EXIGÊNCIA DE PRÉ-PAGAMENTO */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37]">no_accounts</span>
            <div>
              <h3 className="font-syne text-lg text-[#49382E] font-bold">
                Controle de Inadimplência &amp; Trava de Pré-Pagamento
              </h3>
              <span className="font-jakarta text-xs text-[#786C63]">
                Números cadastrados terão a agenda travada, exigindo 100% de Pré-pagamento via Pix para confirmação.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddBlModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-jakarta text-xs font-bold transition-all cursor-pointer self-start sm:self-auto shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">person_add_disabled</span>
            <span>+ Adicionar Inadimplente</span>
          </button>
        </div>

        {/* Warning Banner */}
        <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] flex items-start gap-3 text-xs text-[#786C63]">
          <span className="material-symbols-outlined text-[#D4AF37] text-[20px] shrink-0 mt-0.5">verified_user</span>
          <p>
            <strong>Como funciona:</strong> Ao tentar agendar pelo site com qualquer um dos números abaixo, o sistema detecta a inadimplência e emite um alerta formal. O agendamento só é aceito mediante <strong>Pré-pagamento Integral (100% via Pix)</strong>, protegendo o Espaçor contra no-shows recorrentes.
          </p>
        </div>

        {/* Blacklist Table */}
        <div className="divide-y divide-[#E8D9B5]">
          {blacklist.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#786C63]">
              <span className="material-symbols-outlined text-[28px] text-[#A39A90] block mb-1">
                verified_user
              </span>
              Nenhum número cadastrado na lista de inadimplência.
              <p className="text-[11px] text-[#786C63] mt-0.5">
                Utilize o botão acima para adicionar contatos caso haja ocorrência de no-show sem aviso.
              </p>
            </div>
          ) : (
            blacklist.map(entry => (
              <div key={entry.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-red-600 text-[18px]">phone_disabled</span>
                    <span className="font-syne text-sm font-bold text-[#49382E]">{entry.clientName}</span>
                    <span className="font-jakarta text-xs text-[#D4AF37] font-semibold">({entry.phone})</span>
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold border border-red-300">
                      100% Pix Obrigatório
                    </span>
                  </div>
                  <p className="font-jakarta text-xs text-[#786C63]">
                    Motivo: {entry.reason} • Cadastrado em {entry.addedDate}
                  </p>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleToggleBlacklist(entry.id)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                      entry.active
                        ? 'bg-red-100 text-red-800 border border-red-300 hover:bg-red-200'
                        : 'bg-[#F7EFEA] text-[#786C63] border border-[#E8D9B5]'
                    }`}
                  >
                    {entry.active ? 'Restrição Ativa' : 'Pausado'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteBlacklist(entry.id, entry.clientName)}
                    className="w-7 h-7 rounded-lg bg-[#F7EFEA] text-[#786C63] hover:text-red-600 flex items-center justify-center cursor-pointer border border-[#E8D9B5]"
                    title="Remover da lista"
                  >
                    <span className="material-symbols-outlined text-[15px]">delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Box 3: ENDEREÇO OFICIAL & LOCALIZAÇÃO */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5]">
          <span className="material-symbols-outlined text-[#D4AF37]">pin_drop</span>
          <h3 className="font-syne text-lg text-[#49382E] font-bold">
            Endereço Oficial do Espaçor
          </h3>
        </div>

        <div className="space-y-3 font-jakarta text-xs">
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Endereço Completo (exibido na página de agendamento, rodapé e comprovantes)
            </label>
            <input
              type="text"
              value={addressText}
              onChange={e => {
                setAddressText(e.target.value);
                if (onUpdateStudioAddress) {
                  onUpdateStudioAddress({
                    ...address,
                    fullAddress: e.target.value
                  });
                }
              }}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] font-medium outline-none"
            />
          </div>

          <div className="flex justify-end pt-1">
            <button type="button" onClick={() => { void handleSaveStudioAddress(); }} className="px-5 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer">
              Salvar endereço na planilha
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href={address.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] hover:border-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">map</span>
              <span>Testar Rota Google Maps</span>
            </a>
            <a
              href={address.wazeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-full bg-[#FFFFFF] text-[#49382E] hover:text-[#D4AF37] border border-[#E8D9B5] hover:border-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">directions_car</span>
              <span>Testar Rota Waze</span>
            </a>
          </div>
        </div>
      </div>

      {/* Box 4: CHAVE PIX & PARÂMETROS DE PRÉ-PAGAMENTO */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#E8D9B5]">
          <span className="material-symbols-outlined text-[#D4AF37]">payments</span>
          <h3 className="font-syne text-lg text-[#49382E] font-bold">
            Chave Pix Oficial &amp; Regras de Sinal
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-jakarta text-xs">
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Chave Pix Oficial (Telefone ou CNPJ)
            </label>
            <input
              type="text"
              value={pixKey}
              onChange={e => setPixKey(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Nome do Favorecido / Razão Social
            </label>
            <input
              type="text"
              value={pixBeneficiary}
              onChange={e => setPixBeneficiary(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>
          <div>
            <label className="block text-[#49382E] font-semibold mb-1">
              Percentual do Sinal de Reserva Padrão (%)
            </label>
            <input
              type="number"
              value={depositAmount}
              onChange={e => setDepositAmount(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] focus:border-[#D4AF37] outline-none"
            />
          </div>
          <div className="flex items-center text-xs text-[#786C63]">
            O pré-pagamento integral é de 100% do preço oficial, sem desconto.
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-[#E8D9B5]">
          <button
            type="button"
            onClick={() => { void handleSavePixSettings(); }}
            className="px-6 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md"
          >
            Salvar Regras de Pix
          </button>
        </div>
      </div>

      {/* Box 6: INTEGRAÇÃO WHATSAPP BUSINESS API (META CLOUD API) */}
      <div className="p-6 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#25D366] text-[26px]">chat</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-syne text-lg text-[#49382E] font-bold">
                  Integração WhatsApp Business API
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-jakarta font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                  {waStatus?.isConfigured ? 'Meta Cloud API Configurada' : 'Configuração pendente'}
                </span>
              </div>
              <span className="font-jakarta text-xs text-[#786C63]">
                Envio automático de mensagens de confirmação para o WhatsApp cadastrado da cliente no momento da aprovação do agendamento.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                checkWhatsAppStatus().then(setWaStatus);
                fetchWhatsAppLogs().then(setWaLogs);
                notify('Status da API do WhatsApp atualizado!');
              }}
              className="px-3 py-1.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] text-xs font-semibold border border-[#E8D9B5] flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">refresh</span>
              <span>Verificar Conexão</span>
            </button>
          </div>
        </div>

        {/* Public studio contact values are official settings, not hardcoded site defaults. */}
        <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-4">
          <div>
            <h4 className="font-syne text-sm font-bold text-[#49382E]">Contato público do Espaço</h4>
            <p className="font-jakarta text-xs text-[#786C63] mt-1">Estes dados alimentam os links de contato do site. Deixe em branco até confirmar os valores oficiais.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block font-jakarta text-xs text-[#49382E] font-semibold">
              WhatsApp público (com código do país)
              <input
                type="tel"
                inputMode="tel"
                value={waConfig.phone || ''}
                onChange={e => setWaConfig(prev => ({ ...prev, phone: e.target.value }))}
                disabled={readOnlyPreview}
                placeholder="Ex.: 5511999999999"
                className="mt-1 w-full p-3 rounded-xl bg-white text-[#49382E] border border-[#E8D9B5] text-sm focus:border-[#D4AF37] outline-none disabled:opacity-60"
              />
            </label>
            <label className="block font-jakarta text-xs text-[#49382E] font-semibold">
              Instagram do Espaço (@usuário ou link completo)
              <input
                type="url"
                inputMode="url"
                value={waConfig.instagramUrl || ''}
                onChange={e => setWaConfig(prev => ({ ...prev, instagramUrl: e.target.value }))}
                disabled={readOnlyPreview}
                placeholder="@angelicadocarmo_nails ou https://www.instagram.com/..."
                className="mt-1 w-full p-3 rounded-xl bg-white text-[#49382E] border border-[#E8D9B5] text-sm focus:border-[#D4AF37] outline-none disabled:opacity-60"
              />
            </label>
          </div>
        </div>

        {/* API Credentials & Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] text-[#786C63] uppercase font-bold tracking-wider block">
              Provedor &amp; Versão
            </span>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-syne text-sm text-[#49382E] font-bold">
                Meta Cloud API ({waStatus?.apiVersion || 'Versão não informada'})
              </span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              API oficial do WhatsApp com envio direto por servidores da Meta Graph.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] text-[#786C63] uppercase font-bold tracking-wider block">
              Identificador (Phone Number ID)
            </span>
            <div className="font-jakarta text-xs font-bold text-[#49382E] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">badge</span>
              <span>{waStatus?.phoneNumberIdConfigured ? 'ID configurado no Apps Script' : 'Configurar nas Propriedades do Script'}</span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              Propriedade do Apps Script: <code className="text-[#D4AF37] font-mono">WHATSAPP_PHONE_NUMBER_ID</code>
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] text-[#786C63] uppercase font-bold tracking-wider block">
              Token de Acesso Permanente
            </span>
            <div className="font-jakarta text-xs font-bold text-[#49382E] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">key</span>
              <span>{waStatus?.tokenConfigured ? 'Token Meta configurado no Apps Script' : 'Configurar nas Propriedades do Script'}</span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              Propriedade do Apps Script: <code className="text-[#D4AF37] font-mono">WHATSAPP_API_TOKEN</code>
            </p>
          </div>
        </div>

        {/* Automation Switch & Options */}
        <div className="p-4 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[#D4AF37]/20 border border-[#D4AF37]/40 flex items-center justify-center shrink-0 text-[#3C2F00]">
              <span className="material-symbols-outlined text-[20px]">bolt</span>
            </div>
            <div>
              <h4 className="font-syne text-sm font-bold text-[#49382E]">
                Disparo Automático de Confirmação
              </h4>
              <p className="font-jakarta text-xs text-[#786C63]">
                Quando ativado, ao clicar em "Aprovar Sinal" no painel Pix ou criar um agendamento confirmado, o sistema envia a confirmação instantaneamente para o WhatsApp cadastrado da cliente.
              </p>
            </div>
          </div>

          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={waConfig.autoSendOnConfirm}
              onChange={e => setWaConfig(prev => ({ ...prev, autoSendOnConfirm: e.target.checked }))}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-[#E8D9B5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#25D366]"></div>
          </label>
        </div>

        {/* Message Template Editor */}
        <div className="space-y-3 font-jakarta text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <label className="block text-[#49382E] font-bold text-sm">
                Texto da Mensagem de Confirmação Automática
              </label>
              <span className="text-[#786C63] text-xs">
                Personalize a mensagem enviada à cliente. Use as variáveis dinâmicas abaixo:
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowWaPreview(!showWaPreview)}
                className="px-3 py-1 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] font-semibold hover:border-[#D4AF37] cursor-pointer transition-colors flex items-center gap-1 shadow-xs"
              >
                <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">
                  {showWaPreview ? 'edit' : 'visibility'}
                </span>
                <span>{showWaPreview ? 'Editar Texto' : 'Ver Prévia Realista'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setWaTemplate(`✨ *Confirmação de Agendamento • Espaço Angélica do Carmo* ✨\n\nOlá, *{cliente}*! Seu horário no nosso Espaçor privativo foi *CONFIRMADO* com sucesso na grade. 💅✨\n\n📋 *Detalhes do seu atendimento:*\n• *Procedimento:* {servico}\n• *Data:* {data}\n• *Horário:* às {horario}\n• *Valor:* {valor}\n• *Sinal:* {sinal}\n\n📍 *Endereço:* {endereco}\n\nℹ️ *Orientações importantes:*\n• Pedimos a gentileza de chegar com 5 a 10 minutos de antecedência.\n• Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago.\n• Em caso de desistência ou não comparecimento, o sinal não é reembolsado.\n\nQualquer dúvida, pode responder a esta mensagem. Mal podemos esperar para cuidar de você! 💕`);
                  notify('Modelo padrão restaurado!');
                }}
                className="px-3 py-1 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#786C63] hover:text-[#49382E] font-semibold cursor-pointer transition-colors"
              >
                Restaurar Padrão
              </button>
            </div>
          </div>

          {/* Tags Chips */}
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5]">
            <span className="text-[10px] text-[#786C63] uppercase font-bold mr-1">Inserir:</span>
            {[
              { tag: '{cliente}', label: 'Nome da Cliente' },
              { tag: '{servico}', label: 'Procedimento' },
              { tag: '{data}', label: 'Data' },
              { tag: '{horario}', label: 'Horário' },
              { tag: '{valor}', label: 'Valor' },
              { tag: '{sinal}', label: 'Sinal Pix' },
              { tag: '{endereco}', label: 'Endereço Espaçor' }
            ].map(item => (
              <button
                key={item.tag}
                type="button"
                onClick={() => setWaTemplate(prev => prev + ` ${item.tag} `)}
                className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] hover:bg-[#F7EFEA] text-[#49382E] border border-[#E8D9B5] font-mono text-[11px] font-semibold hover:border-[#D4AF37] cursor-pointer transition-all shadow-xs"
                title={`Inserir ${item.label}`}
              >
                {item.tag}
              </button>
            ))}
          </div>

          {showWaPreview ? (
            /* Realistic WhatsApp Chat Bubble Preview */
            <div className="p-4 rounded-2xl bg-[#EFEAE2] border border-[#E8D9B5] flex justify-center">
              <div className="max-w-md w-full bg-[#FFFFFF] rounded-2xl p-4 shadow-sm relative border-l-4 border-[#25D366]">
                <div className="flex items-center gap-2 mb-2 pb-2 border-gray-100">
                  <div className="w-7 h-7 rounded-full bg-[#25D366] text-white flex items-center justify-center font-bold text-xs">
                    A
                  </div>
                  <div>
                    <span className="font-bold text-xs text-gray-900 block">Espaço Angélica do Carmo</span>
                    <span className="text-[10px] text-gray-500">Conta Comercial Oficial</span>
                  </div>
                </div>
                <div className="whitespace-pre-line text-xs text-gray-800 leading-relaxed font-sans">
                  {waTemplate
                    .replace(/{cliente}/g, '[Nome da cliente]')
                    .replace(/{servico}/g, '[Procedimento oficial]')
                    .replace(/{data}/g, '[Data do agendamento]')
                    .replace(/{horario}/g, '[Horário]')
                    .replace(/{valor}/g, '[Valor oficial]')
                    .replace(/{sinal}/g, '[Sinal configurado]')
                    .replace(/{endereco}/g, address.fullAddress || '[Endereço oficial não configurado]')}
                </div>
                <div className="mt-2 text-right flex items-center justify-end gap-1 text-[10px] text-gray-400">
                  <span>14:31</span>
                  <span className="material-symbols-outlined text-[14px] text-[#34B7F1]">done_all</span>
                </div>
              </div>
            </div>
          ) : (
            <textarea
              rows={9}
              value={waTemplate}
              onChange={e => setWaTemplate(e.target.value)}
              className="w-full p-4 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] text-xs font-mono focus:border-[#D4AF37] outline-none leading-relaxed"
            />
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveWaConfig}
              className="px-5 py-2 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-xs"
            >
              Salvar Template &amp; Preferências
            </button>
          </div>
        </div>

        {/* Live Test Dispatcher */}
        <div className="p-5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#D4AF37]">send</span>
            <div>
              <h4 className="font-syne text-sm font-bold text-[#49382E]">
                Testar Envio Automático Imediato
              </h4>
              <p className="font-jakarta text-xs text-[#786C63]">
                Envie uma mensagem de teste em tempo real para qualquer número para verificar a entrega da API.
              </p>
            </div>
          </div>

          <form onSubmit={handleTestWhatsApp} className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div>
              <label className="block text-[11px] font-semibold text-[#49382E] mb-1">
                Nome para Teste
              </label>
              <input
                type="text"
                value={testClientName}
                onChange={e => setTestClientName(e.target.value)}
                placeholder="Ex: Amanda Silva"
                className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E8D9B5] text-xs text-[#49382E] focus:border-[#D4AF37] outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#49382E] mb-1">
                Telefone com DDD *
              </label>
              <input
                type="tel"
                required
                value={testPhone}
                onChange={e => setTestPhone(e.target.value)}
                placeholder="Ex: 12974062241"
                className="w-full px-3 py-2 rounded-lg bg-[#FFFFFF] border border-[#E8D9B5] text-xs font-bold text-[#49382E] focus:border-[#D4AF37] outline-none"
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={isTestingWa}
                className="w-full py-2 px-4 rounded-lg bg-[#25D366] hover:bg-[#20BA5A] text-white font-jakarta text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {isTestingWa ? 'sync' : 'outgoing_mail'}
                </span>
                <span>{isTestingWa ? 'Disparando...' : 'Enviar Teste Agora'}</span>
              </button>
            </div>
          </form>

          {testWaFeedback && (
            <div
              className={`p-3 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                testWaFeedback.success
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-900 border border-amber-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">
                  {testWaFeedback.success ? 'check_circle' : 'info'}
                </span>
                <span>{testWaFeedback.message}</span>
              </div>
              {testWaFeedback.fallbackUrl && (
                <a
                  href={testWaFeedback.fallbackUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 rounded-full bg-white text-[#25D366] font-bold text-[11px] border border-[#25D366] hover:bg-emerald-50 transition-colors inline-flex items-center gap-1 self-start sm:self-auto"
                >
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  <span>Abrir no WhatsApp Web</span>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Real-time Dispatch Logs Table */}
        <div className="space-y-3 font-jakarta text-xs">
          <div className="flex items-center justify-between pb-1 border-b border-[#E8D9B5]">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">history</span>
              <h4 className="font-syne text-sm font-bold text-[#49382E]">
                Histórico Recente de Disparos Automáticos ({waLogs.length})
              </h4>
            </div>
            <button
              type="button"
              onClick={() => fetchWhatsAppLogs().then(setWaLogs)}
              className="text-[11px] text-[#786C63] hover:text-[#D4AF37] font-semibold flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              <span>Atualizar Histórico</span>
            </button>
          </div>

          {waLogs.length === 0 ? (
            <div className="p-6 text-center text-[#786C63] bg-[#FDFBF9] rounded-xl border border-[#E8D9B5]">
              Nenhuma mensagem disparada recentemente. Ao confirmar agendamentos ou testar o envio, o registro aparecerá aqui.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#E8D9B5]">
              <table className="w-full text-left font-jakarta text-xs">
                <thead className="bg-[#F7EFEA] text-[#786C63] uppercase text-[10px] font-bold">
                  <tr>
                    <th className="p-3">Data / Hora</th>
                    <th className="p-3">Destinatário</th>
                    <th className="p-3">WhatsApp</th>
                    <th className="p-3">Procedimento</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E8D9B5] bg-[#FFFFFF]">
                  {waLogs.slice(0, 10).map((log: any) => (
                    <tr key={log.id} className="hover:bg-[#FDFBF9] transition-colors">
                      <td className="p-3 text-[#786C63] whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • {new Date(log.timestamp).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="p-3 font-bold text-[#49382E] whitespace-nowrap">
                        {log.recipientName}
                      </td>
                      <td className="p-3 font-mono text-[#D4AF37] font-semibold whitespace-nowrap">
                        {log.recipientPhone}
                      </td>
                      <td className="p-3 text-[#786C63]">
                        {log.serviceTitle || 'Confirmação de Horário'}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            log.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : log.status === 'simulated'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : 'bg-red-100 text-red-800 border border-red-300'
                          }`}
                        >
                          {log.status === 'sent' ? 'Enviado Meta' : log.status === 'simulated' ? 'Simulado (OK)' : 'Falha'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* E-mail & Google Apps Script Webhook Notification Card */}
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-2xl border border-[#E8D9B5] shadow-md space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E8D9B5]">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#FBF2D5] text-[#D4AF37] flex items-center justify-center border border-[#E8D9B5]">
              <span className="material-symbols-outlined text-[24px]">mark_email_read</span>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-syne text-lg sm:text-xl text-[#49382E] font-bold">
                  Notificações por E-mail
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                  {AUTHORIZED_SENDER_EMAIL} &rarr; {TARGET_NOTIFICATION_EMAIL}
                </span>
              </div>
              <p className="font-jakarta text-xs text-[#786C63]">
                Envio automático de novos pré-agendamentos da cliente para a Angélica sem depender de acesso à conta da Angélica.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowScriptDetails(!showScriptDetails)}
            className="px-3.5 py-2 rounded-xl bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-jakarta text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
          >
            <span className="material-symbols-outlined text-[16px]">code</span>
            <span>{showScriptDetails ? 'Ocultar Script' : 'Ver Código Apps Script (20 linhas)'}</span>
          </button>
        </div>

        {/* Resumo de Configuração e Permissões */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-jakarta text-xs">
          <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] uppercase font-bold text-[#786C63] tracking-wider block">Remetente Autorizado</span>
            <div className="font-bold text-[#49382E] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-600 text-[18px]">verified</span>
              <span>{AUTHORIZED_SENDER_EMAIL}</span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              Conta autorizada pela Gmail API. Não requer senha nem autorização da Angélica.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
            <span className="text-[10px] uppercase font-bold text-[#786C63] tracking-wider block">Destinatária dos Alertas</span>
            <div className="font-bold text-[#49382E] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[#D4AF37] text-[18px]">inbox</span>
              <span>{TARGET_NOTIFICATION_EMAIL}</span>
            </div>
            <p className="text-[11px] text-[#786C63]">
              Recebe os dados do pré-agendamento, dados da cliente e instruções de validação do Pix.
            </p>
          </div>
        </div>

        {/* A persistência oficial é feita diretamente pelo Google Apps Script e Google Sheets. */}
        {/* MÓDULO 2: Envio Autônomo 24/7 via Webhook Apps Script na conta do Remetente */}
        <div className="p-5 rounded-2xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-4 font-jakarta text-xs">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#D4AF37] text-[20px]">cloud_sync</span>
                <h4 className="font-syne text-sm font-bold text-[#49382E]">
                  Opção 2: Envio Autônomo Direto (Google Apps Script Webhook)
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FBF2D5] text-[#3C2F00] border border-[#E8D9B5]">
                  Requer Script sem Senha ou Token Local
                </span>
              </div>
              <p className="text-[#786C63] mt-1 leading-relaxed">
                Executa na nuvem da Google diretamente sob a sua conta <strong>{AUTHORIZED_SENDER_EMAIL}</strong>.
                Funciona 24 horas por dia, 7 dias por semana, <strong>mesmo quando o painel administrativo estiver fechado</strong>, sem expor tokens no frontend.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveWebhook} className="space-y-3">
            <div>
              <label className="block text-[#49382E] font-semibold mb-1">
                URL do Webhook do Google Apps Script (implantado na conta {AUTHORIZED_SENDER_EMAIL})
              </label>
              <input
                type="url"
                placeholder={DEFAULT_APPS_SCRIPT_WEBHOOK_URL}
                value={webhookUrlInput}
                onChange={e => setWebhookUrlInput(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-xs min-h-[44px]"
              />
              <p className="text-[11px] text-[#786C63] mt-1">
                Endpoint oficial padrão pré-configurado.
              </p>
            </div>

            <div>
              <label className="block text-[#49382E] font-semibold mb-1">
                Chave / Token de Autorização do Webhook (Opcional)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Ex: seu-token-secreto (se exigido pelo script)"
                  value={webhookTokenInput}
                  onChange={e => setWebhookTokenInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-[#FFFFFF] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37] text-xs min-h-[44px]"
                />
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#E5C158] text-[#3C2F00] font-jakarta text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 whitespace-nowrap min-h-[44px]"
                >
                  Salvar Parâmetros
                </button>
              </div>
              <p className="text-[11px] text-[#786C63] mt-1">
                Se o script do Apps Script contiver verificação de token, digite-o aqui. Ele fica salvo apenas no navegador local do painel administrativo.
              </p>
            </div>
          </form>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              disabled={isTestingWebhook}
              onClick={handleTestWebhook}
              className="px-4 py-2.5 rounded-xl bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-jakarta text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-[44px]"
            >
              <span className="material-symbols-outlined text-[18px]">
                {isTestingWebhook ? 'sync' : 'send_and_archive'}
              </span>
              <span>{isTestingWebhook ? 'Enviando Teste...' : 'Testar Conexão com o Webhook'}</span>
            </button>

            {webhookFeedback && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 flex-1 ${
                  webhookFeedback.success
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-50 text-amber-900 border border-amber-200'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {webhookFeedback.success ? 'check_circle' : 'info'}
                </span>
                <span>{webhookFeedback.message}</span>
              </div>
            )}
          </div>

          {showScriptDetails && (
            <div className="mt-4 p-5 rounded-xl bg-[#2A231F] text-[#FDFBF9] border border-[#49382E] space-y-4 font-mono text-[11px] leading-relaxed">
              <div className="flex items-center justify-between text-xs text-[#E8D9B5] font-sans pb-2 border-b border-[#49382E]">
                <span className="font-bold">Diagnóstico &amp; Código do Google Apps Script</span>
                <span>script.google.com</span>
              </div>

              <div className="p-3.5 rounded-lg bg-[#382F2A] border border-[#52443C] font-sans text-xs space-y-2 text-[#E8D9B5]">
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <span className="material-symbols-outlined text-[18px]">info</span>
                  <span>Diagnóstico do Endpoint Publicado:</span>
                </div>
                <p>
                  O teste no endpoint retornou: <code className="text-amber-300 font-mono">{"{\"status\":\"error\",\"message\":\"Não autorizado.\"}"}</code>.
                  Isso indica que dentro da função <code className="text-amber-300 font-mono">doPost(e)</code> há uma linha verificando uma chave ou token de autorização.
                </p>
                <p className="font-bold text-white pt-1">O que verificar no editor do Apps Script:</p>
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-[#C4B5A5]">
                  <li>Abra o script em <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-[#D4AF37] underline">script.google.com</a>.</li>
                  <li>Localize a verificação que retorna <em>"Não autorizado."</em>:
                    <ul className="list-disc list-inside ml-4 mt-0.5 text-stone-300">
                      <li>Se desejar manter o token, preencha o valor no campo <strong>Chave / Token de Autorização</strong> acima.</li>
                      <li>Para simplificar, remova essa checagem e use o código modelo aberto abaixo.</li>
                    </ul>
                  </li>
                  <li><strong>Atenção Obrigatória ao Salvar no Apps Script:</strong> Após qualquer edição no código, clique em <strong>Implantar &gt; Gerenciar implantações &gt; Editar (ícone de lápis) &gt; Versão: Nova versão &gt; Implantar</strong>. <em>(Apenas salvar no editor não atualiza o endpoint em execução!)</em></li>
                </ol>
              </div>

              <pre className="overflow-x-auto p-3 bg-[#1E1916] rounded-lg text-emerald-300">
                {CODE_GS_TEMPLATE}
              </pre>
            </div>
          )}
        </div>

        {/* MÓDULO 3: Envio de e-mail via Google Apps Script MailApp */}
        <div className="p-5 rounded-2xl bg-[#FFFFFF] border border-[#E8D9B5] space-y-4 font-jakarta text-xs">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-emerald-600 text-[22px]">forward_to_inbox</span>
            <div className="flex-1">
              <h4 className="font-syne text-sm font-bold text-[#49382E]">Envio de e-mail via Google Apps Script</h4>
              <p className="text-[#786C63] mt-1 leading-relaxed">
                O Apps Script envia confirmações usando a conta autorizada <strong>{AUTHORIZED_SENDER_EMAIL}</strong>.
                Não é necessário Firebase Auth nem manter uma sessão Gmail aberta no navegador.
              </p>
              <p className="text-[#786C63] mt-1">Destino do teste: <strong>{TARGET_NOTIFICATION_EMAIL}</strong>.</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              disabled={isTestingDirectGmail}
              onClick={handleTestDirectGmail}
              className="px-4 py-2.5 rounded-xl bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-jakarta text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 min-h-[44px]"
            >
              <span className="material-symbols-outlined text-[18px]">{isTestingDirectGmail ? 'sync' : 'forward_to_inbox'}</span>
              <span>{isTestingDirectGmail ? 'Enviando teste...' : 'Testar envio de e-mail'}</span>
            </button>
            {gmailOAuthFeedback && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 flex-1 ${gmailOAuthFeedback.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                <span className="material-symbols-outlined text-[18px]">{gmailOAuthFeedback.success ? 'check_circle' : 'error'}</span>
                <span>{gmailOAuthFeedback.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Admin Password Security Card */}
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-2xl border border-[#E8D9B5] shadow-md space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#FBF2D5] text-[#D4AF37] flex items-center justify-center border border-[#E8D9B5]">
            <span className="material-symbols-outlined text-[24px]">lock_reset</span>
          </div>
          <div>
            <h3 className="font-syne text-lg sm:text-xl text-[#49382E] font-bold">
              Segurança &amp; Senha do Painel Administrativo
            </h3>
            <p className="font-jakarta text-xs text-[#786C63]">
              A senha administrativa é validada diretamente pelo Google Apps Script
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-2 text-xs text-[#786C63] leading-relaxed max-w-xl">
          <p className="font-semibold text-[#49382E]">
            Autenticação segura pelo Google Apps Script:
          </p>
          <p>
            O acesso ao painel é validado pelo Apps Script. Configure <code className="text-[#49382E] font-mono bg-stone-100 px-1.5 py-0.5 rounded">ADMIN_PASSWORD</code> em Google Apps Script → Configurações do projeto → Propriedades do script.
          </p>
          <p>
            A senha não é incluída no código público nem no armazenamento do navegador. As credenciais opcionais do WhatsApp também devem ser guardadas nas Propriedades do Script, nunca no frontend.
          </p>
        </div>
      </div>

      {/* Add Inadimplente Modal */}
      {showAddBlModal && (
        <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] p-6 rounded-3xl max-w-md w-full border border-[#E8D9B5] shadow-2xl relative">
            <button
              type="button"
              onClick={() => setShowAddBlModal(false)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-red-600 text-[24px]">person_add_disabled</span>
              <h3 className="font-syne text-lg text-[#49382E] font-bold">Bloquear Número Inadimplente</h3>
            </div>

            <form onSubmit={handleAddBlacklist} className="space-y-3 font-jakarta text-xs">
              <div>
                <label className="block text-[#49382E] mb-1 font-semibold">Nome da Cliente</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Patrícia G. Mendes"
                  value={newBlName}
                  onChange={e => setNewBlName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-[#49382E] mb-1 font-semibold">Número de WhatsApp / Telefone *</label>
                <input
                  type="tel"
                  required
                  placeholder="Ex: (12) 99111-2233"
                  value={newBlPhone}
                  onChange={e => setNewBlPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] font-bold outline-none focus:border-[#D4AF37]"
                />
              </div>

              <div>
                <label className="block text-[#49382E] mb-1 font-semibold">Motivo do Bloqueio</label>
                <select
                  value={newBlReason}
                  onChange={e => setNewBlReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#FDFBF9] text-[#49382E] border border-[#E8D9B5] outline-none focus:border-[#D4AF37]"
                >
                  <option value="Faltou sem avisar (No-show com perda de grade)">Faltou sem avisar (No-show com perda de grade)</option>
                  <option value="Cancelamento em cima da hora recorrente">Cancelamento em cima da hora recorrente</option>
                  <option value="Histórico de pendência financeira">Histórico de pendência financeira</option>
                  <option value="Atraso superior a 30 minutos recorrente">Atraso superior a 30 minutos recorrente</option>
                </select>
              </div>

              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-800">
                Ao cadastrar este número, o sistema exigirá <strong>100% de Pré-pagamento via Pix</strong> no ato do agendamento para liberar a vaga.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8D9B5]">
                <button
                  type="button"
                  onClick={() => setShowAddBlModal(false)}
                  className="px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-semibold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white font-bold transition-all shadow-xs cursor-pointer"
                >
                  Cadastrar Bloqueio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
