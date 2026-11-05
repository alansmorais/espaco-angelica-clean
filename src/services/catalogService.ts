import type { Service } from '../types.ts';

export function getServiceDisplayTitle(service: Service): string {
  if (!service) return '';
  const lowerTitle = (service.title || '').toLowerCase();
  if (
    service.id === 'blindagem-homens-incolor' ||
    lowerTitle.includes('blindagem masculino incolor') ||
    lowerTitle.includes('blindagem masculina incolor')
  ) {
    return 'Blindagem';
  }
  return service.title;
}

export function isServiceInCategory(service: Service, categoryId: string): boolean {
  if (categoryId === 'all') return true;

  const cat = (service.category || '').toLowerCase().trim();
  const id = (service.id || '').toLowerCase().trim();
  const title = (service.title || '').toLowerCase().trim();

  const isDepilacao =
    cat === 'depilacao' ||
    id.startsWith('depilacao') ||
    title.includes('depilação') ||
    title.includes('depilacao');

  if (categoryId === 'depilacao') {
    return isDepilacao;
  }

  // Strictly exclude depilation from all other non-depilation categories
  if (isDepilacao) {
    return false;
  }

  if (categoryId === 'manicure') {
    // Requirements: Remove "Mãos e dedos" and "Esmaltação em gel" from Manicure
    if (id.includes('maos-e-dedos') || title.includes('mãos e dedos') || title.includes('maos e dedos')) {
      return false;
    }
    if (title.includes('esmaltação em gel') || title.includes('esmaltacao em gel') || cat === 'esmaltacao') {
      return false;
    }
    return (
      cat === 'manicure' ||
      id.includes('manicure') ||
      title.includes('manicure') ||
      title.includes('mão') ||
      title.includes('mao')
    );
  }

  if (categoryId === 'pedicure') {
    // Requirements: Remove "Pés e dedos" from Pedicure (remains only under Depilação)
    if (id.includes('pes-e-dedos') || title.includes('pés e dedos') || title.includes('pes e dedos')) {
      return false;
    }
    return (
      cat === 'pedicure' ||
      id.includes('pedicure') ||
      title.includes('pedicure') ||
      title.includes('pé') ||
      title.includes('pe')
    );
  }

  if (categoryId === 'gel') {
    // Requirements: Consolidate to "Procedimentos em gel".
    // Ensure "Manutenção de crescimento" and "Esmaltação em gel" are under "Procedimentos em gel".
    return (
      cat === 'gel' ||
      cat === 'unha-em-gel' ||
      cat === 'procedimentos-em-gel' ||
      cat === 'manutencao' ||
      cat === 'esmaltacao' ||
      cat === 'banho-gel' ||
      cat === 'blindagem' ||
      id === 'manutencao-fibra-vidro' ||
      id === 'esmaltacao-gel-premium' ||
      id === 'serv-1793851523054' ||
      id === 'banho-em-gel' ||
      id === 'blindagem-homens-incolor' ||
      id === 'aplicacao-por-unha' ||
      title.includes('gel') ||
      title.includes('manutenção de crescimento') ||
      title.includes('manutencao de crescimento') ||
      title.includes('blindagem')
    );
  }

  if (categoryId === 'alongamento') {
    return (
      cat === 'alongamento' ||
      id.includes('alongamento') ||
      title.includes('alongamento') ||
      title.includes('fibra')
    );
  }

  if (categoryId === 'nailart') {
    return (
      cat === 'nailart' ||
      cat === 'nail-art' ||
      id.includes('nailart') ||
      title.includes('nail art') ||
      title.includes('arte')
    );
  }

  if (categoryId === 'spa') {
    return (
      cat === 'spa' ||
      id.includes('spa') ||
      title.includes('spa') ||
      title.includes('massagem')
    );
  }

  return cat === categoryId;
}
