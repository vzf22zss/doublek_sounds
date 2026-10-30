// Efeitos com duração do roteiro (DK-143): o que está "em andamento" (estrobos/flash/blackout/só logo por N beats e
// rampas de knob), com o valor de antes guardado para desfazer. Puro: recebe o visual atual e devolve o que escrever.
// O roteiro chama `step` a cada quadro; PÂNICO/RESET chamam `clear`, que desfaz os efeitos e abandona as rampas.
// O strobe vai a 1 aqui; o teto do safeFlash continua sendo aplicado no renderer (DK-006).

export type FxKind = 'strobe' | 'flash' | 'blackout' | 'logoOnly';
export const FX_KINDS: readonly FxKind[] = ['strobe', 'flash', 'blackout', 'logoOnly'];
export type Values = Record<string, number | boolean>;
type Burst = { fx: FxKind; end: number; undo: Values };
type Ramp = { key: string; from: number; to: number; start: number; beats: number };
export type Running = { bursts: Burst[]; ramps: Ramp[] };

export const EMPTY: Running = { bursts: [], ramps: [] };

/** O que cada efeito liga. Flash = 1 beat de strobe 1/1. */
export function burstValues(fx: FxKind, div = 1): Values {
  if (fx === 'strobe') return { strobe: 1, strobeDiv: div };
  if (fx === 'flash') return { strobe: 1, strobeDiv: 1 };
  return { [fx]: true };
}
/** Duração real: flash é sempre 1 beat. */
export const burstBeats = (fx: FxKind, beats: number) => (fx === 'flash' ? 1 : Math.max(0, beats));

/**
 * Começa um efeito no beat `at`. Um efeito do mesmo tipo que ainda corria termina antes (seu "antes" é o que
 * volta no fim, não o valor intermediário). Devolve o novo estado e o que escrever no visual.
 */
export function startBurst(run: Running, vs: Values, fx: FxKind, at: number, beats: number, div = 1): { run: Running; set: Values } {
  const set = burstValues(fx, div);
  const same = run.bursts.find((b) => Object.keys(burstValues(b.fx)).some((k) => k in set)); // strobe × flash mexem nas mesmas chaves
  const undo = same ? same.undo : Object.fromEntries(Object.keys(set).map((k) => [k, vs[k]]));
  const bursts = run.bursts.filter((b) => b !== same).concat({ fx, end: at + burstBeats(fx, beats), undo });
  return { run: { ...run, bursts }, set };
}

/** Começa uma rampa de `key` até `to` em `beats` beats, a partir do valor atual. Substitui outra rampa da mesma chave. */
export function startRamp(run: Running, vs: Values, key: string, to: number, at: number, beats: number): Running {
  const from = typeof vs[key] === 'number' ? (vs[key] as number) : to;
  return { ...run, ramps: run.ramps.filter((r) => r.key !== key).concat({ key, from, to, start: at, beats: Math.max(0, beats) }) };
}

export const rampValue = (r: Ramp, beat: number) => (r.beats <= 0 || beat >= r.start + r.beats ? r.to : r.from + (r.to - r.from) * Math.max(0, (beat - r.start) / r.beats));

/** Avança até `beat`: efeitos vencidos desfazem; rampas escrevem o valor do beat (e saem ao chegar). */
export function step(run: Running, beat: number): { run: Running; set: Values } {
  const set: Values = {};
  const bursts = run.bursts.filter((b) => (beat >= b.end ? (Object.assign(set, b.undo), false) : true));
  const ramps = run.ramps.filter((r) => { set[r.key] = rampValue(r, beat); return beat < r.start + r.beats; });
  return { run: { bursts, ramps }, set };
}

/** Cancela tudo: desfaz os efeitos (volta ao valor de antes) e abandona as rampas onde estão. */
export function clear(run: Running): { run: Running; set: Values } {
  const set: Values = {};
  for (const b of [...run.bursts].reverse()) Object.assign(set, b.undo);
  return { run: EMPTY, set };
}

export const busy = (run: Running) => run.bursts.length + run.ramps.length > 0;
