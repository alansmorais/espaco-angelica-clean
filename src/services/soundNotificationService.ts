/**
 * Serviço de alerta sonoro discreto para o Painel Administrativo.
 * Utiliza a Web Audio API nativa sem necessidade de arquivos de áudio externos,
 * respeitando as políticas de autoplay do navegador e permissões do usuário.
 */

let sharedAudioContext: AudioContext | null = null;
let hasUserInteracted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!sharedAudioContext) {
      sharedAudioContext = new AudioContextClass();
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/**
 * Registra interação do usuário para permitir reprodução de áudio.
 */
export function registerUserInteraction(): void {
  hasUserInteracted = true;
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

/**
 * Toca um sinal sonoro discreto e suave (acorde duplo refinado).
 * Retorna true se tocou com sucesso, false caso bloqueado pelo navegador.
 */
export function playDiscreteAdminNotificationSound(): boolean {
  try {
    const ctx = getAudioContext();
    if (!ctx) return false;

    // Se o contexto estiver suspenso por falta de interação do usuário, não forçar para não gerar erro
    if (ctx.state === 'suspended') {
      if (!hasUserInteracted) return false;
      ctx.resume().catch(() => {});
      if (ctx.state === 'suspended') return false;
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Timbre elegante: onda senoidal com transição harmônica suave (D5 587.33Hz -> A5 880Hz)
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    // Envelope de volume suave e discreto (ataque 40ms, decaimento suave 500ms)
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.5);
    return true;
  } catch {
    return false;
  }
}
