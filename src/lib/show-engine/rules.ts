// Mapa de automação (DK-033/034/035): troca de estado musical → comandos, com fonte 'automation' no dispatcher.
// Puro. As regras agem só na ENTRADA de um estado (e no evento de drop), nunca a cada quadro.
// O que já existe e não se repete aqui: o dispatcher descarta automação durante o override manual (8 s) e não
// deixa a automação trocar cena/banco/vídeo com o roteiro tocando.
import type { AutomationMode, ShowCommand } from '../commands.ts';
import { DEFAULT_AUTOMATION, type AutomationConfig, type SceneRef } from './config.ts';
import type { MusicState, StateName } from './state.ts';

export { DEFAULT_AUTOMATION, type AutomationConfig };
export type Step = { cmd: ShowCommand; quantize: 'beat' | 'bar' };
/** Comandos que mudam o que está no telão (cena/banco/vídeo): ASSIST nunca manda. */
const SCENE_LIKE = new Set(['SCENE_RECALL', 'SCENE_TAKE', 'SCENE_PREVIEW', 'BANK_STEP', 'BANK_SET', 'VIDEO_SET']);

export type PlanCtx = {
  mode: AutomationMode;
  scriptOnly: boolean; // modo "só roteiro" (react false): automação desligada
};

const recall = (s: SceneRef, fade: number, quantize: Step['quantize']): Step[] =>
  s ? [{ cmd: { type: 'SCENE_RECALL', index: s.index, bank: s.bank, fade }, quantize }] : [];

/** O que fazer agora. `prev` = estado anterior (para detectar a entrada). */
export function plan(prev: StateName, cur: MusicState, cfg: AutomationConfig, ctx: PlanCtx): Step[] {
  if (ctx.mode === 'MANUAL' || ctx.scriptOnly) return [];
  const on = cfg.enabled, steps: Step[] = [];
  const ramp = (lim: Record<string, number>, beats: number) =>
    Object.entries(lim).map(([key, to]): Step => ({ cmd: { type: 'PARAM_RAMP', key, to, beats }, quantize: 'bar' }));

  if (cur.dropEvent && on.drop) steps.push({ cmd: { type: 'MACRO', id: 'DROP' }, quantize: 'beat' }, ...recall(cfg.dropScene, 0, 'beat'));
  else if (cur.state !== prev) {
    if (cur.state === 'BREAKDOWN' && on.breakdown) steps.push(...ramp(cfg.limits.BREAKDOWN, 4));
    if (cur.state === 'BUILD_UP' && on.buildUp) steps.push(...ramp(cfg.limits.BUILD_UP, 16));
    if (cur.state === 'GROOVE' && on.groove) steps.push(...recall(cfg.grooveScene, 4, 'bar'));
  }
  return ctx.mode === 'ASSIST' ? steps.filter((s) => !SCENE_LIKE.has(s.cmd.type)) : steps;
}

/**
 * Espera até o próximo beat/compasso, em ms. Só com o BPM travado e, se o Rust mandar `stability`, com o relógio
 * confiável (≥ 0,5); senão na hora (fallback suave: as rampas já são graduais). `beat` = contagem de beats do motor.
 */
export function quantizeDelay(q: 'beat' | 'bar', f: { locked: boolean; bpm: number; beat: number; beatPhase: number; stability?: number }): number {
  if (!f.locked || !(f.bpm > 0) || (f.stability !== undefined && f.stability < 0.5)) return 0;
  const beatMs = 60000 / f.bpm, toBeat = (1 - f.beatPhase) * beatMs;
  if (q === 'beat') return toBeat;
  const left = (4 - ((((f.beat + 1) % 4) + 4) % 4)) % 4; // beats inteiros depois do próximo, até o compasso
  return toBeat + left * beatMs;
}
