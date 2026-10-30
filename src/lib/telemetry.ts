// Telemetria local (DK-003): estatísticas de frametime do telão e um diário curto de eventos.
// Nada sai da máquina; o "Diagnóstico" só junta isto num JSON que o operador salva à mão. Sem áudio.

export type Telemetry = {
  fps: number;
  p50: number; p95: number; p99: number; // ms por quadro
  drops: number;                         // quadros acima de 2× o alvo (33 ms a 60 Hz) no último segundo
  lost: boolean;                         // contexto WebGL perdido
};
export const NO_TELEMETRY: Telemetry = { fps: 0, p50: 0, p95: 0, p99: 0, drops: 0, lost: false };

/** p-ésimo percentil (0..1) de uma lista já ordenada; posto mais próximo (menor valor com ≥ p da amostra abaixo). */
export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Junta os dt (ms) de um intervalo e resume. `flush` devolve o resumo e zera. */
export class FrameStats {
  private dts: number[] = [];
  push(dt: number) {
    if (dt > 0 && dt < 5000) this.dts.push(dt); // aba escondida devolve gaps de segundos: não é frame
  }
  flush(elapsedMs: number, lost = false): Telemetry {
    const s = this.dts.slice().sort((a, b) => a - b);
    const out: Telemetry = {
      fps: elapsedMs > 0 ? Math.round((s.length * 1000) / elapsedMs) : 0,
      p50: +percentile(s, 0.5).toFixed(1),
      p95: +percentile(s, 0.95).toFixed(1),
      p99: +percentile(s, 0.99).toFixed(1),
      drops: s.filter((d) => d > 33).length,
      lost,
    };
    this.dts = [];
    return out;
  }
}

// ---------- diário ----------
export type Level = 'info' | 'warn' | 'error';
export type Entry = { t: string; level: Level; msg: string };
const MAX = 200;
const entries: Entry[] = [];

export function log(level: Level, msg: string) {
  const e = { t: new Date().toISOString(), level, msg: String(msg).slice(0, 500) };
  if (entries.length && entries[entries.length - 1].msg === e.msg && entries[entries.length - 1].level === level) return; // sem eco
  entries.push(e);
  if (entries.length > MAX) entries.shift();
}
export const logEntries = () => entries.slice();
export const clearLog = () => void (entries.length = 0);

/** Erros não tratados da janela viram linhas do diário em vez de sumirem. */
export function captureErrors(target: { addEventListener: Window['addEventListener'] } = window) {
  target.addEventListener('error', (e) => log('error', (e as ErrorEvent).message || 'erro'));
  target.addEventListener('unhandledrejection', (e) => log('error', 'promessa rejeitada: ' + String((e as PromiseRejectionEvent).reason).slice(0, 200)));
}
