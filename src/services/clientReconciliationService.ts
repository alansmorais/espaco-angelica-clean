import type { ClientProfile, Appointment } from '../types.ts';
import { expandRecurringAppointments } from './recurrenceService.ts';

export const OFFICIAL_CLIENT_FULL_NAMES: Record<string, string> = {
  kristine: 'Kristine Sorensen',
  josefina: 'Josefina Calderón'
};

export function normalizeClientPhoneKey(value: string): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.substring(2);
  }
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    digits = digits.substring(1);
  }
  return digits;
}

export function resolveClientFullName(rawName: string, context: string = 'geral'): string {
  const trimmed = String(rawName || '').trim();
  const lower = trimmed.toLowerCase();
  let resolved = trimmed;
  if (lower === 'kristine') resolved = 'Kristine Sorensen';
  else if (lower === 'josefina') resolved = 'Josefina Calderón';

  if (lower.includes('kristine') || lower.includes('josefina')) {
    console.log('[DIAGNOSTICO_PAINEL:RESOLVE_NOME]', {
      nomeEntradaOriginal: rawName,
      nomeFinalResolvido: resolved,
      contexto: context
    });
  }
  return resolved;
}

export function mergeClients(
  remote: ClientProfile[]
): ClientProfile[] {
  const list: ClientProfile[] = [];

  // Only profiles returned by the official spreadsheet/backend are accepted.
  // Never inject fabricated client names, phone numbers, or contact details.
  for (const raw of (remote || [])) {
    if (!raw) continue;
    const resolvedName = resolveClientFullName(raw.name);
    if (!resolvedName) continue;

    // Remove registros fantasmas com primeiro nome isolado ("Kristine" ou "Josefina") sem sobrenome
    const isSingleKristine = resolvedName.toLowerCase() === 'kristine';
    const isSingleJosefina = resolvedName.toLowerCase() === 'josefina';
    if (isSingleKristine || isSingleJosefina) continue;

    const phoneKey = normalizeClientPhoneKey(raw.phone);
    const lowerName = resolvedName.toLowerCase();

    if (lowerName.includes('kristine') || lowerName.includes('josefina')) {
      console.log('[DIAGNOSTICO_PAINEL:CLIENTE_PROCESSADO]', {
        id: raw.id,
        nomeOriginal: raw.name,
        nomeResolvido: resolvedName,
        telefone: raw.phone,
        origem: raw.id?.startsWith('client-') ? 'Dados recebidos do backend oficial' : 'Planilha Oficial Google Sheets (Perfis de Clientes / getClients)'
      });
    }

    // Identifica se já existe cliente correspondente por telefone ou nome completo
    const existingIndex = list.findIndex(c => {
      const cPhone = normalizeClientPhoneKey(c.phone);
      const cName = c.name.toLowerCase();
      if (
        phoneKey &&
        cPhone &&
        (phoneKey === cPhone ||
          (phoneKey.length >= 8 && cPhone.length >= 8 && phoneKey.slice(-8) === cPhone.slice(-8)))
      ) {
        return true;
      }
      if (lowerName === cName) return true;
      return false;
    });

    const normalizedProfile: ClientProfile = {
      ...raw,
      name: resolvedName,
      initials: resolvedName
        .split(/\s+/)
        .map(p => p.charAt(0))
        .slice(0, 2)
        .join('')
        .toUpperCase()
    };

    if (existingIndex >= 0) {
      // Mescla os dados mantendo o nome mais completo e preservando campos já preenchidos
      const current = list[existingIndex];
      const bestName = resolvedName.length > current.name.length ? resolvedName : current.name;
      list[existingIndex] = {
        ...current,
        ...normalizedProfile,
        name: bestName,
        initials: bestName
          .split(/\s+/)
          .map(p => p.charAt(0))
          .slice(0, 2)
          .join('')
          .toUpperCase(),
        phone: normalizedProfile.phone || current.phone,
        email: normalizedProfile.email || current.email,
        birthDate: normalizedProfile.birthDate || current.birthDate,
        lastVisit: normalizedProfile.lastVisit || current.lastVisit,
        lastService: normalizedProfile.lastService || current.lastService,
        privateNotes: normalizedProfile.privateNotes || current.privateNotes
      };
    } else {
      list.push(normalizedProfile);
    }
  }

  return list;
}

export function mergeAndExpandAppointments(remote: Appointment[]): Appointment[] {
  if (!Array.isArray(remote) || remote.length === 0) return [];
  const map = new Map<string, Appointment>();

  for (const raw of remote) {
    if (!raw || !raw.id) continue;
    const resolvedName = resolveClientFullName(raw.clientName, 'agendamentos_planilha');
    const apt: Appointment = {
      ...raw,
      clientName: resolvedName,
      clientInitials: resolvedName
        ? resolvedName
            .split(/\s+/)
            .map(p => p.charAt(0))
            .slice(0, 2)
            .join('')
            .toUpperCase()
        : raw.clientInitials
    };

    if (resolvedName.toLowerCase().includes('kristine') || resolvedName.toLowerCase().includes('josefina')) {
      console.log('[DIAGNOSTICO_PAINEL:AGENDAMENTO_RECEBIDO_PLANILHA]', {
        id: raw.id,
        nomePlanilhaOriginal: raw.clientName,
        nomeFinal: resolvedName,
        telefone: raw.clientPhone,
        data: raw.date,
        horario: raw.time,
        servico: raw.serviceTitle,
        origem: raw.id?.startsWith('apt-sheet-') || raw.id?.startsWith('apt-1') ? 'Planilha Oficial Google Sheets (Aba Agendamentos)' : 'Memória / Outra Origem'
      });
    }

    if (map.has(apt.id)) {
      const existing = map.get(apt.id)!;
      if (apt.clientName.length > existing.clientName.length) {
        map.set(apt.id, apt);
      }
    } else {
      map.set(apt.id, apt);
    }
  }

  // Deduplicação secundária: se existem dois agendamentos no mesmo horário/dia/serviço
  // onde um possui nome incompleto ("Kristine") e outro nome completo ("Kristine Sorensen")
  const uniqueList: Appointment[] = [];
  for (const apt of map.values()) {
    const isDuplicate = uniqueList.some((existing, idx) => {
      const sameDate = String(existing.date).trim() === String(apt.date).trim();
      const sameTime = String(existing.time).trim() === String(apt.time).trim();
      const sameService =
        String(existing.serviceTitle).trim().toLowerCase() ===
        String(apt.serviceTitle).trim().toLowerCase();
      const phoneA = normalizeClientPhoneKey(existing.clientPhone || '');
      const phoneB = normalizeClientPhoneKey(apt.clientPhone || '');
      const samePhone =
        phoneA && phoneB && (phoneA === phoneB || phoneA.slice(-8) === phoneB.slice(-8));

      const nameA = existing.clientName.toLowerCase();
      const nameB = apt.clientName.toLowerCase();
      const sameIdentity =
        nameA === nameB ||
        (nameA.includes('kristine') && nameB.includes('kristine')) ||
        (nameA.includes('josefina') && nameB.includes('josefina'));

      if (sameDate && sameTime && (samePhone || sameIdentity)) {
        if (
          apt.clientName.length > existing.clientName.length ||
          (apt.id.startsWith('apt-1') && !existing.id.startsWith('apt-1'))
        ) {
          uniqueList[idx] = apt;
        }
        return true;
      }
      return false;
    });

    if (!isDuplicate) {
      uniqueList.push(apt);
    }
  }

  return expandRecurringAppointments(uniqueList);
}
