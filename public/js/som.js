// Efeitos sonoros gerados com Web Audio (sem arquivos de áudio).
// Navegadores só liberam áudio depois de um gesto do usuário; por isso o contexto é retomado no primeiro clique/tecla.
let ctx = null;

function contexto() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx ??= new AudioCtx();
  return ctx;
}

function liberar() {
  const c = contexto();
  if (c?.state === 'suspended') c.resume().catch(() => {});
}
for (const tipo of ['pointerdown', 'keydown']) document.addEventListener(tipo, liberar, { passive: true });

function nota(c, freq, inicio, duracao, volume = 0.25) {
  const osc = c.createOscillator();
  const ganho = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  ganho.gain.setValueAtTime(0, inicio);
  ganho.gain.linearRampToValueAtTime(volume, inicio + 0.02);
  ganho.gain.exponentialRampToValueAtTime(0.001, inicio + duracao);
  osc.connect(ganho).connect(c.destination);
  osc.start(inicio);
  osc.stop(inicio + duracao + 0.05);
}

/** Campainha de novo pedido: duas notas ascendentes (ding-dong), repetidas uma vez para chamar a atenção. */
export function somNovoPedido() {
  try {
    const c = contexto();
    if (!c || c.state !== 'running') return; // ainda bloqueado: nenhum gesto do usuário na página
    const t = c.currentTime + 0.02;
    for (const deslocamento of [0, 0.7]) {
      nota(c, 880, t + deslocamento, 0.35);
      nota(c, 1318.5, t + deslocamento + 0.18, 0.5);
    }
  } catch { /* som é só um aviso extra: nunca deve quebrar a tela */ }
}
