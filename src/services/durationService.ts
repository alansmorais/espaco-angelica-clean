/**
 * Espaço Angélica do Carmo - Duration Calculation & Parsing Service
 * 
 * REGRA FUNDAMENTAL: A DURAÇÃO DE TODOS OS SERVIÇOS DEVE SER LIDA DA COLUNA F (Duração)
 * DA PLANILHA OFICIAL, NA ABA "Serviços" (e "Depilação" para depilação).
 * 
 * - Coluna A: ID do serviço.
 * - Coluna B: Nome do serviço.
 * - Coluna F: Duração oficial do serviço.
 * 
 * Não utilizar a coluna D (preço).
 * Não criar durações fixas no código.
 * Não duplicar as durações manualmente no frontend.
 * Não utilizar valores fictícios ou padrões de 30 minutos.
 * Se a duração estiver ausente ou inválida, bloquear o agendamento com mensagem clara.
 */

import type { Service } from '../types.ts';

export const OFFICIAL_DURATION_MISSING_ERROR =
  'A duração oficial do procedimento não está configurada na planilha oficial. Entre em contato com o atelier.';

export const ADDITIONAL_DURATION_MISSING_ERROR =
  'A duração oficial de um dos serviços adicionais não está configurada na planilha oficial. Entre em contato com o atelier.';

/**
 * Converte string de horário "HH:mm" em minutos desde o início do dia.
 */
export function timeToMinutes(value: unknown): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Converte minutos desde o início do dia em string formatada "HH:mm".
 */
export function minutesToTime(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return null;
  }
  const normalized = Math.floor(minutes) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0');
  const mm = String(normalized % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Converte a string de duração lida da Coluna F da planilha em minutos totais.
 * Retorna número inteiro de minutos se válido (> 0), ou null se inválido/ausente.
 * NUNCA retorna 30 ou qualquer valor arbitrário como fallback.
 */
export function parseDurationMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).toLowerCase().trim();
  if (!text) return null;

  // Reconhece formatos:
  // "1h 30min", "1h30m", "1h30", "1 hora e 30 minutos", "1 hora", "2 horas", "45 min", "45", "90"
  const hoursMatch = text.match(/(\d+)\s*h(?:oras?|ou?rs?)?/i);
  const minutesMatch = text.match(/(?:h\s*|\b)?(\d+)\s*(?:minutos?|min|m\b)/i) ||
    text.match(/h\s*(\d{1,2})\b/i);
  const pureMinutes = !hoursMatch && !minutesMatch ? text.match(/^(\d+)$/) : null;

  let totalMinutes = 0;
  if (hoursMatch) {
    totalMinutes += Number(hoursMatch[1]) * 60;
  }
  if (minutesMatch) {
    totalMinutes += Number(minutesMatch[1]);
  } else if (pureMinutes) {
    totalMinutes += Number(pureMinutes[1]);
  }

  return totalMinutes > 0 && Number.isFinite(totalMinutes) ? totalMinutes : null;
}

/**
 * Formata minutos em formato amigável como "1h 30min", "45 min", "2h", "1h".
 */
export function formatDurationMinutes(totalMinutes: number | null | undefined): string {
  if (!totalMinutes || totalMinutes <= 0 || !Number.isFinite(totalMinutes)) {
    return '';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}min`);
  return parts.join(' ') || `${totalMinutes} min`;
}

export interface ProcedureDurationResult {
  totalMinutes: number | null;
  formatted: string;
  isValid: boolean;
  error?: string;
  mainMinutes?: number | null;
  additionalMinutes?: number[];
}

/**
 * Calcula a duração total de um procedimento principal somado a quaisquer procedimentos adicionais.
 * Cada serviço deve ter sua duração extraída da Coluna F da planilha oficial.
 * Se qualquer um deles tiver duração inválida ou ausente, a operação é rejeitada.
 */
export function calculateProcedureDuration(
  mainService: Pick<Service, 'id' | 'title' | 'duration'> | null | undefined,
  additionalServices: Array<Pick<Service, 'id' | 'title' | 'duration'>> = []
): ProcedureDurationResult {
  if (!mainService) {
    return {
      totalMinutes: null,
      formatted: '',
      isValid: false,
      error: OFFICIAL_DURATION_MISSING_ERROR
    };
  }

  const mainMinutes = parseDurationMinutes(mainService.duration);
  if (!mainMinutes || mainMinutes <= 0) {
    return {
      totalMinutes: null,
      formatted: '',
      isValid: false,
      error: OFFICIAL_DURATION_MISSING_ERROR
    };
  }

  let total = mainMinutes;
  const additionalMinutes: number[] = [];

  for (const addService of additionalServices) {
    const addMin = parseDurationMinutes(addService.duration);
    if (!addMin || addMin <= 0) {
      return {
        totalMinutes: null,
        formatted: '',
        isValid: false,
        error: ADDITIONAL_DURATION_MISSING_ERROR
      };
    }
    additionalMinutes.push(addMin);
    total += addMin;
  }

  return {
    totalMinutes: total,
    formatted: formatDurationMinutes(total),
    isValid: true,
    mainMinutes,
    additionalMinutes
  };
}

/**
 * Calcula o horário de término previsto dado o horário de início e a duração em minutos.
 * Exemplo: calculateEndTime("10:00", 90) => "11:30"
 * Exemplo: calculateEndTime("10:00", 120) => "12:00"
 */
export function calculateEndTime(startTime: string, durationMinutes: number | null | undefined): string | null {
  const startMin = timeToMinutes(startTime);
  if (startMin === null || durationMinutes === null || durationMinutes === undefined || durationMinutes <= 0) {
    return null;
  }
  return minutesToTime(startMin + durationMinutes);
}

/**
 * Verifica se dois intervalos se sobrepõem.
 * [startA, startA + durationA) e [startB, startB + durationB)
 * Se startA === endB ou startB === endA (horários adjacentes), NÃO há sobreposição.
 */
export function intervalsOverlap(
  startA: number,
  durationA: number,
  startB: number,
  durationB: number
): boolean {
  if (durationA <= 0 || durationB <= 0) return false;
  const endA = startA + durationA;
  const endB = startB + durationB;
  return startA < endB && startB < endA;
}

/**
 * Verifica se um horário proposto [candidateStartTime, candidateStartTime + candidateDurationMinutes) conflita
 * com um horário ocupado existente.
 */
export function isSlotConflictingWithOccupied(
  candidateStartTime: string,
  candidateDurationMinutes: number,
  occupiedStartTime: string,
  occupiedDurationMinutes: number
): boolean {
  const candStart = timeToMinutes(candidateStartTime);
  const occStart = timeToMinutes(occupiedStartTime);
  if (candStart === null || occStart === null) return false;
  return intervalsOverlap(candStart, candidateDurationMinutes, occStart, occupiedDurationMinutes);
}
