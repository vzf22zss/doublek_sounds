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
  // indicadores do Rust (DK-031), opcionais: sem eles o motor calcula no TS como antes
  energy?: number;
  contrast?: number;   // energia dos últimos 4 compassos ÷ 4 anteriores
  stability?: number;  // 0..1, confiança no relógio do beat
  kickRate?: number;   // kicks por compasso nos últimos 8 beats
};
export type StateName = 'UNKNOWN' | 'BREAKDOWN' | 'BUILD_UP' | 'GROOVE' | 'DROP';
export type MusicState = {
  state: StateName; confidence: number; dropEvent: boolean; since: number; barMs: number;
  /** Guarda P8 ligada: grave tocando, grade travada e quase nenhum kick aceito — a grade deve estar defasada. */
  staleGrid: boolean;
};

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
  staleBars?: number;        // guarda P8: compassos com grave + trava + kickRate < 0,5 até desconfiar da grade
};

const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function createMusicState(o: StateOpts = {}) {
  const now = o.now ?? (() => performance.now());
  const silence = o.silence ?? 0.01, holdBars = o.minHoldBars ?? 2, confirmBars = o.confirmBars ?? 1;
  const breakBars = o.minBreakBars ?? 2, dropBars = o.dropBars ?? 8, fbBar = (o.fallbackBarSec ?? 2) * 1000;
  const buildIn = o.buildIn ?? 1.2, buildOut = o.buildOut ?? 1.05, staleBars = o.staleBars ?? 2;

  let t0 = -1, state: StateName = 'UNKNOWN', since = 0;
  let low = 0, lowSince = 0, quietSince = -1;
  let dropPending = -1, dropAt = -Infinity;
  let bars: number[] = [], acc = 0, n = 0, barStart = 0;
  let building = false, ratio = 1;
  let cand: StateName = 'UNKNOWN', candSince = 0;
  let noKickSince = -1;

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
    if (f.contrast !== undefined && Number.isFinite(f.contrast)) {
      // contraste do Rust (DK-031): já é 4 compassos ÷ 4 anteriores, suavizado lá
      ratio = f.contrast;
      building = building ? ratio >= buildOut : ratio >= buildIn;
    } else {
      if (bars.length >= 8) {
        const a = avg(bars.slice(-4)), b = avg(bars.slice(-8, -4));
        ratio = b > 1e-6 ? a / b : 1;
      } else ratio = 1;
      building = building ? ratio > buildOut : ratio >= buildIn && bars[bars.length - 1] >= bars[bars.length - 4];
    }

    // grave: volta depois de um breakdown de verdade = drop pendente, que confirma depois de `confirmBars`
    if (l !== low) {
      if (l === 1 && t - lowSince >= breakBars * bar) dropPending = t;
      if (l === 0) dropPending = -1;
      low = l; lowSince = t;
    }
    // guarda P8 (DETECCAO.md §4.9): grave tocando com a grade travada e sem kick aceito = grade defasada
    // (faixa nova depois de pausa). Não confia no estado nem confirma drop até os kicks voltarem.
    const kickless = l === 1 && f.locked && f.kickRate !== undefined && f.kickRate < 0.5;
    if (kickless) { if (noKickSince < 0) noKickSince = t; } else noKickSince = -1;
    const staleGrid = kickless && t - noKickSince >= staleBars * bar;
    if (staleGrid) dropPending = -1;
    let dropEvent = false;
    if (dropPending >= 0 && !kickless && t - dropPending >= confirmBars * bar) { dropEvent = true; dropAt = t; dropPending = -1; }

    if (f.rms < silence) { if (quietSince < 0) quietSince = t; } else quietSince = -1;
    const silent = quietSince >= 0 && t - quietSince >= 1000;

    // candidato
    let c: StateName = state;
    if (silent || staleGrid || t - t0 < bar || (!f.bpm && !f.locked)) c = 'UNKNOWN';
    else if (dropPending >= 0) c = state;                       // grave voltou, ainda sem confirmar: não muda nada
    else if (low === 1) c = t - dropAt < dropBars * bar ? 'DROP' : t - lowSince >= bar ? 'GROOVE' : state;
    else c = building ? 'BUILD_UP' : 'BREAKDOWN';

    // histerese: o estado atual precisa ter durado `holdBars` e o novo se manter `confirmBars` (o drop entra na hora)
    if (dropEvent) { state = 'DROP'; since = t; cand = 'DROP'; }
    else if (staleGrid && state !== 'UNKNOWN') { state = 'UNKNOWN'; since = t; cand = 'UNKNOWN'; } // segurança: na hora, sem histerese
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
    return { state, confidence: +clamp01(confidence).toFixed(2), dropEvent, since, barMs: bar, staleGrid };
  }

  function reset() {
    t0 = -1; state = 'UNKNOWN'; bars = []; acc = 0; n = 0; building = false; dropPending = -1; dropAt = -Infinity; quietSince = -1; noKickSince = -1;
  }
  return { update, reset };
}
