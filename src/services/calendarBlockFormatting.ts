import { Appointment } from '../types';

export function isAllDayCalendarBlock(apt: Pick<Appointment, 'status' | 'time'>): boolean {
  if (apt.status !== 'bloqueado') return false;
  const time = String(apt.time || '').trim().toLowerCase();
  return !time || time === 'dia inteiro' || time === '00:00';
}

export function isPartialCalendarBlock(apt: Pick<Appointment, 'status' | 'time'>): boolean {
  return apt.status === 'bloqueado' && !isAllDayCalendarBlock(apt);
}

export function isUnclassifiedCalendarBlock(apt: Pick<Appointment, 'status' | 'notes' | 'blockReason'>): boolean {
  if (apt.status !== 'bloqueado') return false;
  const raw = `${apt.notes || ''} ${apt.blockReason || ''}`;
  return /UNCLASSIFIED_CALENDAR_EVENT|TITLE_MUST_CONTAIN_KNOWN_CLIENT|CLIENT_NAME_NOT_CONFIRMED|AMBIGUOUS_|não classificado|sem identificação inequívoca/i.test(raw);
}

export function formatCalendarBlockBadge(apt: Pick<Appointment, 'status' | 'time' | 'notes' | 'blockReason'>): string {
  if (isAllDayCalendarBlock(apt)) return 'Dia inteiro bloqueado';
  if (isUnclassifiedCalendarBlock(apt)) return 'Não classificado · Revisão';
  return 'Bloqueio do Google Agenda';
}

export function formatCalendarBlockExplanation(apt: Pick<Appointment, 'status' | 'time' | 'notes' | 'blockReason'>): string {
  const raw = String(apt.notes || apt.blockReason || '').trim();
  if (!raw) {
    return isAllDayCalendarBlock(apt)
      ? 'Dia inteiro bloqueado para novos agendamentos.'
      : 'Horário indisponível no Google Agenda.';
  }
  if (/UNCLASSIFIED_CALENDAR_EVENT|TITLE_MUST_CONTAIN_KNOWN_CLIENT|CLIENT_NAME_NOT_CONFIRMED|AMBIGUOUS_/i.test(raw)) {
    return 'Evento do Google Agenda mantido como bloqueio porque o título e a descrição não identificam de forma segura uma cliente e um procedimento oficial. Atualize o evento no Google Agenda com nome da cliente e procedimento para classificar automaticamente.';
  }
  if (/ALL_DAY_OR_MISSING_START/i.test(raw)) {
    return 'Bloqueio de dia inteiro importado do Google Agenda.';
  }
  if (/PROTECTED_OR_TEST_EVENT|NON_STANDARD_EVENT_TYPE/i.test(raw)) {
    return 'Evento pessoal ou bloqueio protegido importado do Google Agenda.';
  }
  return raw;
}
