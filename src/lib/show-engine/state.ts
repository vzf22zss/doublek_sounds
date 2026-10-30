// Estado musical estimado (DK-032): BREAKDOWN / BUILD_UP / GROOVE / DROP, ou UNKNOWN com confiança baixa.
// Puro, sem Svelte: recebe um quadro de análise por vez e um relógio injetável. BREAKDOWN/DROP vêm do detector de
// grave que já existe no Rust (`Frame.low`, com histerese); BUILD_UP é contraste de energia entre janelas de
// compassos; GROOVE é grave presente e estável. São estimativas por sinal: podem errar dependendo do estilo.
// O drop é sempre DETECTADO depois de acontecer (confirmação de ~1 compasso), nunca antecipado.

/** O que o motor precisa de cada quadro (subconjunto de `Frame`; o DK-031 em Rust pode trocar a fonte). */
export type Features = {
  rms: number;
  bands: readonly [number, number, number, number, number]; // sub, bass, mid, click, air
  kick: number;
  low: number;      // 1 = grave tocando, 0 = sem grave (histerese no Rust)
  locked: boolean;
  bpm: number;
  beat: number;
  flux: number;
};
export type StateName = 'UNKNOWN' | 'BREAKDOWN' | 'BUILD_UP' | 'GROOVE' | 'DROP';
export type MusicState = { state: StateName; confidence: number; dropEvent: boolean; since: number; barMs: number };

export type StateOpts = {
  now?: () => number;        // ms; testes injetam um relógio virtual
  silence?: number;          // RMS abaixo disso por 1 s = silêncio (UNKNOWN)
  minHoldBars?: number;      // permanência mínima num estado antes de trocar
  confirmBars?: number;      // quanto tempo um estado novo precisa se manter para valer (e o drop para confirmar)
  minBreakBars?: number;     // breakdown mais curto que isto não gera drop na volta do grave (sem cascata)
  dropBars?: number;         // quanto tempo o estado fica em DROP antes de virar GROOVE
  fallbackBarSec?: number;   // "compasso" sem BPM travado
  buildIn?: number;          // contraste de energia (4 compassos ÷ 4 anteriores) para entrar em BUILD_UP
  buildOut?: number;         // ... e para sair (histerese)
};

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function createMusicState(o: StateOpts = {}) {
  const now = o.now ?? (() => performance.now());
  const silence = o.silence ?? 0.01, holdBars = o.minHoldBars ?? 2, confirmBars = o.confirmBars ?? 1;
  const breakBars = o.minBreakBars ?? 2, dropBars = o.dropBars ?? 8, fbBar = (o.fallbackBarSec ?? 2) * 1000;
  const buildIn = o.buildIn ?? 1.2, buildOut = o.buildOut ?? 1.05;

  let t0 = -1, state: StateName = 'UNKNOWN', since = 0;
  let low = 0, lowSince = 0, quietSince = -1;
  let dropPending = -1, dropAt = -Infinity;
  let bars: number[] = [], acc = 0, n = 0, barStart = 0;
  let building = false, ratio = 1;
  let cand: StateName = 'UNKNOWN', candSince = 0;

  function update(f: Features): MusicState {
    const t = now();
    const l = f.low > 0.5 ? 1 : 0;
    if (t0 < 0) { t0 = t; barStart = t; lowSince = t; low = l; since = t; candSince = t; }
    const bar = f.locked && f.bpm > 0 ? 240000 / f.bpm : fbBar;

    // energia média por compasso (rms + médios + agudos: o que sobe numa virada, mesmo sem grave)
    acc += (f.rms + f.bands[2] + f.bands[4]) / 3;
    n++;
    if (t - barStart >= bar) {
      bars.push(acc / n);
      if (bars.length > 16) bars.shift();
      acc = 0; n = 0; barStart = t;
    }
    if (bars.length >= 8) {
      const a = avg(bars.slice(-4)), b = avg(bars.slice(-8, -4));
      ratio = b > 1e-6 ? a / b : 1;
    } else ratio = 1;
    building = building ? ratio > buildOut : ratio >= buildIn && bars[bars.length - 1] >= bars[bars.length - 4];

    // grave: volta depois de um breakdown de verdade = drop pendente, que confirma depois de `confirmBars`
    if (l !== low) {
      if (l === 1 && t - lowSince >= breakBars * bar) dropPending = t;
      if (l === 0) dropPending = -1;
      low = l; lowSince = t;
    }
    let dropEvent = false;
    if (dropPending >= 0 && t - dropPending >= confirmBars * bar) { dropEvent = true; dropAt = t; dropPending = -1; }

    if (f.rms < silence) { if (quietSince < 0) quietSince = t; } else quietSince = -1;
    const silent = quietSince >= 0 && t - quietSince >= 1000;

    // candidato
    let c: StateName = state;
    if (silent || t - t0 < bar || (!f.bpm && !f.locked)) c = 'UNKNOWN';
    else if (dropPending >= 0) c = state;                       // grave voltou, ainda sem confirmar: não muda nada
    else if (low === 1) c = t - dropAt < dropBars * bar ? 'DROP' : t - lowSince >= bar ? 'GROOVE' : state;
    else c = building ? 'BUILD_UP' : 'BREAKDOWN';

    // histerese: o estado atual precisa ter durado `holdBars` e o novo se manter `confirmBars` (o drop entra na hora)
    if (dropEvent) { state = 'DROP'; since = t; cand = 'DROP'; }
    else if (c !== state) {
      if (c !== cand) { cand = c; candSince = t; }
      if ((state === 'UNKNOWN' || t - since >= holdBars * bar) && t - candSince >= confirmBars * bar) { state = c; since = t; }
    } else cand = c;

    const lk = f.locked ? 0.2 : 0;
    const confidence =
      state === 'UNKNOWN' ? 0.2 :
      state === 'DROP' ? 0.8 + lk :
      state === 'GROOVE' ? 0.6 + lk + 0.2 * clamp01((t - lowSince) / (8 * bar)) :
      state === 'BREAKDOWN' ? 0.5 + lk + 0.3 * clamp01((t - lowSince) / (8 * bar)) :
      0.1 + lk + 0.7 * clamp01((ratio - 1) / 0.5);
    return { state, confidence: +clamp01(confidence).toFixed(2), dropEvent, since, barMs: bar };
  }

  function reset() {
    t0 = -1; state = 'UNKNOWN'; bars = []; acc = 0; n = 0; building = false; dropPending = -1; dropAt = -Infinity; quietSince = -1;
  }
  return { update, reset };
}
