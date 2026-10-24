import React, { useState } from 'react';

interface FAQModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBookNow: () => void;
}

export const FAQModal: React.FC<FAQModalProps> = ({
  isOpen,
  onClose,
  onBookNow
}) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  if (!isOpen) return null;

  const faqs = [
    {
      q: 'Como funciona o sinal de 40% via Pix?',
      a: 'Para confirmar o horário, é necessário pagar um sinal de 40% do valor do procedimento. O sinal garante a vaga e é descontado do valor total no dia do atendimento.'
    },
    {
      q: 'Qual a durabilidade do alongamento em fibra e da blindagem?',
      a: 'O alongamento em fibra de vidro slim possui durabilidade contínua com manutenções periódicas a cada 20 a 25 dias. A blindagem diamante tem duração média de 25 dias com brilho espelhado e sem descamações.'
    },
    {
      q: 'Posso reagendar ou cancelar meu horário?',
      a: 'Mudanças de data exigem pelo menos 24 horas de antecedência, mantendo o sinal pago. Em caso de desistência ou não comparecimento, o sinal não é reembolsado, pois cobre o bloqueio da vaga e os preparativos.'
    },
    {
      q: 'Qual é o protocolo de biossegurança e autoclave?',
      a: 'Seguimos rigorosamente as normas da vigilância sanitária e de padrão hospitalar. Todos os alicates, espátulas e brocas passam por lavadora ultrassônica e esterilização em autoclave com indicador biológico.'
    },
    {
      q: 'O que está incluso no atendimento cortesia?',
      a: 'Durante todo o seu procedimento, oferecemos café expresso gourmet moído na hora, seleção de chás especiais, espumante gelado, água mineral e petiscos finos em ambiente privativo climatizado.'
    }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-[#49382E]/50 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] p-6 sm:p-8 rounded-3xl max-w-2xl w-full border border-[#E8D9B5] shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar modal"
          className="absolute top-4 right-4 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-[#F7EFEA] border border-[#E8D9B5] flex items-center justify-center text-[#786C63] hover:text-[#49382E] transition-colors cursor-pointer active:scale-95"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>

        <div className="flex items-center gap-2 mb-6">
          <span className="material-symbols-outlined text-[#D4AF37] text-[28px]">help</span>
          <div>
            <h3 className="font-syne text-xl sm:text-2xl text-[#49382E] font-bold">
              Dúvidas Frequentes &amp; Regras
            </h3>
            <span className="font-jakarta text-xs text-[#D4AF37] uppercase tracking-wider font-bold">
              Transparência &amp; Excelência no Atendimento
            </span>
          </div>
        </div>

        <div className="space-y-3 font-jakarta text-xs sm:text-sm">
          {faqs.map((faq, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-xl bg-[#FDFBF9] border border-[#E8D9B5] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                  className="w-full p-4 flex items-center justify-between text-left font-semibold text-[#49382E] hover:text-[#D4AF37] transition-colors cursor-pointer"
                >
                  <span>{faq.q}</span>
                  <span className="material-symbols-outlined text-[18px] text-[#D4AF37] shrink-0 ml-2">
                    {isOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 text-[#786C63] border-t border-[#E8D9B5]/60 leading-relaxed text-xs sm:text-sm">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-8 pt-4 border-t border-[#E8D9B5] flex flex-col sm:flex-row items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-full bg-[#F7EFEA] hover:bg-[#E8D3C7] text-[#49382E] font-jakarta text-xs font-semibold cursor-pointer border border-[#E8D9B5] transition-colors"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onBookNow();
            }}
            className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-[#D4AF37] text-[#3C2F00] font-jakarta text-xs font-bold hover:bg-[#E5C158] transition-all cursor-pointer shadow-md"
          >
            Ir para Agendamento
          </button>
        </div>
      </div>
    </div>
  );
};
