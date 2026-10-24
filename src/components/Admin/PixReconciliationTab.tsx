import React, { useState } from 'react';
import { Appointment } from '../../types';
import { sendAppointmentWhatsAppConfirmation } from '../../services/whatsappService';
import { sendGmailConfirmation } from '../../services/gmailService';
import { formatBRL } from '../../services/notificationTemplates';

interface PixReconciliationTabProps {
  appointments?: Appointment[];
  onUpdateAppointment?: (apt: Appointment) => void;
  onDeleteAppointment?: (apt: Appointment) => Promise<void>;
}

export const PixReconciliationTab: React.FC<PixReconciliationTabProps> = ({
  appointments = [],
  onUpdateAppointment,
  onDeleteAppointment
}) => {
  const [showPolicy, setShowPolicy] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; isError?: boolean } | null>(null);
  const [isSendingWa, setIsSendingWa] = useState(false);
  const [isSendingGmail, setIsSendingGmail] = useState(false);

  const showToast = (text: string, isError = false) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Derive pending list directly from actual appointments
  const pendingList = appointments.filter(
    a => a.status === 'pendente_pix' || a.depositStatus === 'pendente'
  );
  const liquidatedList = appointments.filter(
    a => a.depositStatus === 'liquidado' || a.status === 'confirmado'
  );

  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(
    pendingList.length > 0 ? pendingList[0].id : null
  );

  const selectedItem = pendingList.find(p => p.id === selectedAppointmentId) || pendingList[0] || null;

  const totalPendingAmount = pendingList.reduce((acc, a) => acc + (a.depositAmount || 0), 0);
  const totalLiquidatedAmount = liquidatedList.reduce((acc, a) => acc + (a.depositAmount || 0), 0);

  const handleApprove = async (apt: Appointment) => {
    setIsSendingWa(true);
    let waSent = false;
    let waSentAt = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    let waMessage = '';

    try {
      const waRes = await sendAppointmentWhatsAppConfirmation(apt);
      waSent = waRes.status === 'sent';
      waMessage = waRes.previewText || waRes.message;
    } catch {
      waSent = false;
    } finally {
      setIsSendingWa(false);
    }

    if (onUpdateAppointment) {
      onUpdateAppointment({
        ...apt,
        status: 'confirmado',
        depositStatus: 'liquidado',
        whatsappStatus: waSent ? 'enviado' : 'falha',
        whatsappSentAt: waSentAt,
        whatsappLastMessage: waMessage
      });
    }

    showToast(`Pagamento de R$ ${formatBRL(apt.depositAmount)} APROVADO! Confirmação de agendamento enviada automaticamente via WhatsApp para ${apt.clientName} (${apt.clientPhone})!`);
  };

  const handleResendWhatsApp = async (apt: Appointment) => {
    setIsSendingWa(true);
    try {
      const waRes = await sendAppointmentWhatsAppConfirmation(apt);
      if (onUpdateAppointment) {
        onUpdateAppointment({
          ...apt,
          whatsappStatus: waRes.status === 'sent' ? 'enviado' : waRes.status === 'simulated' ? 'simulado' : 'falha',
          whatsappSentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          whatsappLastMessage: waRes.previewText || waRes.message
        });
      }
      showToast(waRes.message || `Confirmação WhatsApp reenviada para ${apt.clientName}!`);
    } catch {
      showToast('Falha ao reenviar WhatsApp.', true);
    } finally {
      setIsSendingWa(false);
    }
  };

  const handleSendGmailEmail = async (apt: Appointment) => {
    let email = apt.clientEmail;
    if (!email) {
      email = prompt('Informe o e-mail da cliente para o envio da confirmação via Gmail:') || '';
      if (!email || !email.includes('@')) return;
    }

    setIsSendingGmail(true);
    try {
      const result = await sendGmailConfirmation(
        '',
        email,
        apt.clientName,
        apt.serviceTitle,
        apt.date,
        apt.time,
        apt.servicePrice,
        apt.depositAmount,
        apt.notes
      );
      if (!result.success) throw new Error(result.message || 'O Apps Script não confirmou o envio do e-mail.');

      if (onUpdateAppointment) {
        onUpdateAppointment({
          ...apt,
          clientEmail: email,
          gmailStatus: 'enviado',
          gmailSentAt: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        });
      }

      showToast(`E-mail de confirmação enviado com sucesso via Gmail para ${email}!`);
    } catch (err: any) {
      showToast(err.message || 'Erro ao enviar e-mail via Gmail.', true);
    } finally {
      setIsSendingGmail(false);
    }
  };

  const handleReject = async (apt: Appointment) => {
    if (confirm(`Deseja recusar a solicitação de ${apt.clientName} e liberar o horário na grade?`)) {
      if (onDeleteAppointment) {
        try {
          await onDeleteAppointment(apt);
          showToast(`Solicitação de ${apt.clientName} excluída da planilha.`, true);
        } catch (err: any) {
          showToast(err.message || 'Não foi possível excluir o agendamento.', true);
        }
      } else if (onUpdateAppointment) {
        onUpdateAppointment({
          ...apt,
          status: 'cancelado',
          depositStatus: 'recusado'
        });
        showToast(`Solicitação de ${apt.clientName} cancelada e vaga liberada.`, true);
      }
    }
  };

  const handleRequestNewReceipt = (apt: Appointment) => {
    const phoneDigits = apt.clientPhone.replace(/\D/g, '');
    const msg = encodeURIComponent(
      `Olá, ${apt.clientName}! Aqui é a Angélica do Carmo do atelier. Identificamos sua solicitação de agendamento para ${apt.date} às ${apt.time}, mas precisamos da confirmação do comprovante da chave Pix +5512974062241 para liberar sua vaga. Você poderia nos enviar o comprovante por aqui? Obrigada!`
    );
    window.open(`https://wa.me/${phoneDigits || '5512974062241'}?text=${msg}`, '_blank');
    showToast(`WhatsApp aberto para solicitar comprovante de ${apt.clientName}.`);
  };

  return (
    <div className="flex flex-col gap-6 text-[#49382E]">
      {/* Toast Feedback */}
      {toastMessage && (
        <div
          className={`p-4 rounded-xl font-jakarta text-xs font-bold flex items-center justify-between shadow-xs transition-all ${
            toastMessage.isError
              ? 'bg-red-100 text-red-800 border border-red-300'
              : 'bg-[#D4AF37] text-[#3C2F00]'
          }`}
        >
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="cursor-pointer">
            <span className="material-symbols-outlined text-[18px]">
              {toastMessage.isError ? 'close' : 'check'}
            </span>
          </button>
        </div>
      )}

      {/* Top Bar Context & Real Key Metrics */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 text-[#D4AF37] mb-1">
            <span className="material-symbols-outlined text-[18px]">verified_user</span>
            <span className="font-jakarta text-[11px] uppercase tracking-widest font-bold">
              Conferência Manual de Sinais Pix
            </span>
          </div>
          <h1 className="font-syne text-2xl sm:text-3xl md:text-4xl text-[#49382E] font-bold tracking-tight">
            Conciliação de Sinais Pix
          </h1>
          <p className="font-jakarta text-xs sm:text-sm text-[#786C63] mt-1">
            Conferência manual de pagamentos de sinais Pix (Chave +5512974062241) para confirmação de agendamentos na grade.
          </p>
        </div>

        {/* Real Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col justify-between">
            <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold">
              Sinais Pendentes
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-syne text-xl text-[#D4AF37] font-bold">
                {pendingList.length}
              </span>
              <span className="font-jakarta text-[10px] text-[#786C63]">
                (R$ {formatBRL(totalPendingAmount)})
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col justify-between">
            <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold">
              Sinais Confirmados
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-syne text-xl text-[#49382E] font-bold">
                {liquidatedList.length}
              </span>
              <span className="font-jakarta text-[10px] text-emerald-600 font-semibold">
                (R$ {formatBRL(totalLiquidatedAmount)})
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col justify-between col-span-2 sm:col-span-1">
            <span className="font-jakarta text-[10px] uppercase text-[#786C63] font-bold">
              Chave Pix Ativa
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-mono text-sm text-[#D4AF37] font-bold">
                +5512974062241
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Manual Check Notice */}
      <div className="p-4 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#FBF2D5] border border-[#E8D9B5] flex items-center justify-center shrink-0 text-[#D4AF37]">
            <span className="material-symbols-outlined text-[20px]">account_balance</span>
          </div>
          <div className="flex flex-col">
            <span className="font-jakarta text-xs text-[#49382E] font-bold">
              Regra de Conciliação Segura: Conferência Obrigatória no App do Banco
            </span>
            <span className="font-jakarta text-xs text-[#786C63]">
              Abra o aplicativo bancário da conta Angelica do Carmo ME, verifique se o valor correspondente foi compensado no extrato antes de clicar em Aprovar.
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowPolicy(!showPolicy)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] transition-colors font-jakarta text-xs font-semibold shrink-0 cursor-pointer border border-[#E8D9B5]"
        >
          <span className="material-symbols-outlined text-[16px] text-[#D4AF37]">info</span>
          <span>{showPolicy ? 'Ocultar Diretrizes' : 'Ver Diretrizes'}</span>
        </button>
      </div>

      {/* Policy Drawer Details */}
      {showPolicy && (
        <div className="p-5 rounded-2xl bg-[#FDFBF9] border border-[#E8D9B5] shadow-xs grid grid-cols-1 md:grid-cols-3 gap-4 font-jakarta text-xs">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[#D4AF37] font-bold">
              <span className="material-symbols-outlined text-[16px]">timer</span>
              <span>Janela de Reserva (Sinal 40%)</span>
            </div>
            <p className="text-[#786C63] leading-relaxed">
              Para confirmar o horário, é necessário pagar um sinal de 40% do valor do procedimento (descontado do valor total no dia do atendimento). Sem comprovante, a vaga pode ser liberada.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[#D4AF37] font-bold">
              <span className="material-symbols-outlined text-[16px]">event_repeat</span>
              <span>Cancelamento &amp; Reagendamento</span>
            </div>
            <p className="text-[#786C63] leading-relaxed">
              Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago. Em caso de desistência ou não comparecimento, o sinal não é reembolsado.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[#D4AF37] font-bold">
              <span className="material-symbols-outlined text-[16px]">block</span>
              <span>Inadimplentes e No-Show</span>
            </div>
            <p className="text-[#786C63] leading-relaxed">
              Clientes com histórico de faltas sem aviso prévio são direcionadas ao protocolo de pré-pagamento 100% via Pix.
            </p>
          </div>
        </div>
      )}

      {/* Main Workspace: Pending List & Inspection */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Pending Items List (5 cols) */}
        <div className="xl:col-span-5 bg-[#FFFFFF] rounded-2xl p-5 border border-[#E8D9B5] shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E8D9B5]">
            <h3 className="font-syne text-base text-[#49382E] font-bold">
              Solicitações Aguardando Conferência
            </h3>
            <span className="font-jakarta text-xs text-[#D4AF37] font-bold">
              {pendingList.length} registro(s)
            </span>
          </div>

          <div className="space-y-2.5 max-h-[550px] overflow-y-auto pr-1">
            {pendingList.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#786C63]">
                <span className="material-symbols-outlined text-[36px] text-[#A39A90] block mb-2">
                  check_circle
                </span>
                <strong className="text-[#49382E] block mb-1">Nenhum sinal Pix pendente de conferência no momento.</strong>
                <p className="text-[11px] text-[#786C63]">
                  Novos comprovantes enviados pelos clientes aparecerão aqui para verificação manual.
                </p>
              </div>
            ) : (
              pendingList.map(item => {
                const isSelected = selectedItem?.id === item.id;
                const modeLabel =
                  item.paymentMode === 'pre_pagamento_100'
                    ? 'Pré-pagamento (100%)'
                    : 'Sinal (40%)';
                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedAppointmentId(item.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-[#FBF2D5] border-[#D4AF37] shadow-xs'
                        : 'bg-[#FDFBF9] border-[#E8D9B5] hover:border-[#D4AF37]'
                    }`}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-syne text-sm font-bold text-[#49382E] truncate">
                        {item.clientName}
                      </span>
                      <span className="font-jakarta text-xs text-[#786C63]">
                        {item.serviceTitle} • {item.date} às {item.time}
                      </span>
                      <span className="font-jakarta text-[11px] text-[#D4AF37] font-bold mt-0.5">
                        {modeLabel}: R$ {formatBRL(item.depositAmount)}
                      </span>
                    </div>

                    <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-jakarta text-[10px] font-bold shrink-0">
                      Pendente
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Item Inspection Panel (7 cols) */}
        <div className="xl:col-span-7 bg-[#FFFFFF] rounded-2xl p-6 border border-[#E8D9B5] shadow-xs">
          {selectedItem ? (
            <div className="space-y-5 font-jakarta text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#E8D9B5]">
                <div>
                  <span className="text-[10px] text-[#D4AF37] uppercase tracking-wider font-bold block">
                    Conferência de Sinal Pix
                  </span>
                  <h3 className="font-syne text-lg text-[#49382E] font-bold mt-0.5">
                    {selectedItem.clientName}
                  </h3>
                  <span className="text-[#786C63]">
                    WhatsApp: {selectedItem.clientPhone}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleRequestNewReceipt(selectedItem)}
                    className="px-3.5 py-1.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] border border-[#E8D9B5] transition-colors font-semibold shadow-xs cursor-pointer"
                  >
                    Abrir WhatsApp
                  </button>
                </div>
              </div>

              {/* Transaction Specs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
                  <span className="text-[10px] text-[#786C63] uppercase font-bold block">
                    Procedimento Solicitado ({selectedItem.servicePrice})
                  </span>
                  <span className="font-syne text-sm text-[#49382E] font-bold block">
                    {selectedItem.serviceTitle}
                  </span>
                  <span className="text-[#786C63]">
                    {selectedItem.date} às {selectedItem.time}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] space-y-1">
                  <span className="text-[10px] text-[#786C63] uppercase font-bold block">
                    Valor a Conferir na Conta (
                    {selectedItem.paymentMode === 'pre_pagamento_100'
                      ? 'Pré-pagamento 100%'
                      : 'Sinal 40%'}
                    )
                  </span>
                  <span className="font-syne text-xl text-[#D4AF37] font-bold block">
                    R$ {formatBRL(selectedItem.depositAmount)}
                  </span>
                  <span className="text-[#786C63]">
                    Chave Celular: +5512974062241
                  </span>
                </div>
              </div>

              {selectedItem.receiptFileName && (
                <div className="p-3 rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] flex items-center gap-2 text-[#49382E]">
                  <span className="material-symbols-outlined text-[18px] text-[#D4AF37]">attach_file</span>
                  <span>Arquivo anexado pelo cliente: <strong>{selectedItem.receiptFileName}</strong></span>
                </div>
              )}

              {/* Gmail Confirmation Card */}
              <div className="p-3.5 rounded-xl bg-[#FFFFFF] border border-[#E8D9B5] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#EA4335] text-[20px]">mail</span>
                  <div>
                    <span className="font-bold text-[#49382E] block">
                      Confirmação por E-mail (Google Gmail)
                    </span>
                    <span className="text-[11px] text-[#786C63]">
                      {selectedItem.clientEmail
                        ? `E-mail: ${selectedItem.clientEmail} ${selectedItem.gmailStatus === 'enviado' ? '(✓ Enviado via Gmail)' : ''}`
                        : 'Nenhum e-mail cadastrado (será solicitado ao enviar)'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isSendingGmail}
                  onClick={() => handleSendGmailEmail(selectedItem)}
                  className="px-4 py-2 rounded-full bg-[#EA4335] hover:bg-[#D93825] text-white text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer flex items-center gap-1.5 active:scale-95 min-h-[38px]"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {isSendingGmail ? 'sync' : 'send'}
                  </span>
                  <span>{isSendingGmail ? 'Enviando Gmail...' : 'Enviar E-mail via Gmail'}</span>
                </button>
              </div>

              {/* WhatsApp Business API Automation Notice */}
              <div className="p-3.5 rounded-xl bg-[#F7EFEA] border border-[#E8D9B5] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#25D366] text-[20px]">mark_chat_read</span>
                  <div>
                    <span className="font-bold text-[#49382E] block">
                      Confirmação Automática WhatsApp Business
                    </span>
                    <span className="text-[11px] text-[#786C63]">
                      {selectedItem.whatsappStatus === 'enviado'
                        ? `✓ Mensagem oficial entregue para ${selectedItem.clientPhone} às ${selectedItem.whatsappSentAt || ''}`
                        : `O sistema enviará a confirmação com endereço e horário para ${selectedItem.clientPhone} no momento da aprovação.`}
                    </span>
                  </div>
                </div>

                {selectedItem.whatsappStatus === 'enviado' && (
                  <button
                    type="button"
                    disabled={isSendingWa}
                    onClick={() => handleResendWhatsApp(selectedItem)}
                    className="px-3 py-1.5 rounded-full bg-[#FFFFFF] border border-[#E8D9B5] text-[#49382E] hover:border-[#D4AF37] text-[11px] font-bold transition-all shadow-xs shrink-0 cursor-pointer flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px] text-[#D4AF37]">replay</span>
                    <span>Reenviar WhatsApp</span>
                  </button>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-[#E8D9B5] flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  disabled={isSendingWa}
                  onClick={() => handleApprove(selectedItem)}
                  className="w-full sm:flex-1 py-3 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {isSendingWa ? 'sync' : 'check_circle'}
                  </span>
                  <span>{isSendingWa ? 'Aprovando & Enviando WhatsApp...' : 'Aprovar Sinal & Disparar Confirmação WhatsApp'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleReject(selectedItem)}
                  className="w-full sm:w-auto px-5 py-3 rounded-full bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-all text-xs font-semibold cursor-pointer"
                >
                  Recusar / Liberar Vaga
                </button>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center text-xs text-[#786C63] space-y-2">
              <span className="material-symbols-outlined text-[36px] text-[#A39A90] block">
                check_box
              </span>
              <p className="font-semibold text-[#49382E]">Nenhuma solicitação pendente selecionada.</p>
              <p className="text-[11px] text-[#786C63]">
                Selecione uma solicitação da lista para analisar o valor e confirmar ou liberar a vaga na grade.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
