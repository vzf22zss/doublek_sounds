// Mapa de automação (DK-033/034): troca de estado musical → comandos, com fonte 'automation' no dispatcher.
// Puro. As regras agem só na ENTRADA de um estado (e no evento de drop), nunca a cada quadro.
// O que já existe e não se repete aqui: o dispatcher descarta automação durante o override manual (8 s) e não
// deixa a automação trocar cena/banco/vídeo com o roteiro tocando.
import type { AutomationMode, ShowCommand } from '../commands.ts';
import type { MusicState, StateName } from './state.ts';

export type RuleId = 'breakdown' | 'buildUp' | 'drop' | 'groove';
export const RULES: Record<RuleId, string> = { breakdown: 'Breakdown acalma', buildUp: 'Build-up sobe', drop: 'Drop: macro', groove: 'Groove: cena do mapa' };

export type RulesConfig = {
  enabled: Record<RuleId, boolean>;
  /** AUTO: pads (0–7, banco aberto) que o drop e o groove chamam, em rodízio. Vazio = não troca cena. */
  dropScenes: number[];
  grooveScenes: number[];
};
export const DEFAULT_RULES: RulesConfig = {
  enabled: { breakdown: true, buildUp: true, drop: true, groove: true },
  dropScenes: [],
  grooveScenes: [],
};

/** Teto de intensidade por estado: nenhuma regra leva um ajuste acima disto. */
export const LIMITS: Record<'BREAKDOWN' | 'BUILD_UP', Record<string, number>> = {
  BREAKDOWN: { trail: 0.3, fxRings: 0.3, bgPulse: 0.05, chroma: 4 },
  BUILD_UP: { trail: 0.75, fxRings: 0.8, bgPulse: 0.25, chroma: 10 },
};

export type Step = { cmd: ShowCommand; quantize: 'beat' | 'bar' };
/** Comandos que mudam o que está no telão (cena/banco/vídeo): ASSIST nunca manda. */
const SCENE_LIKE = new Set(['SCENE_RECALL', 'SCENE_TAKE', 'SCENE_PREVIEW', 'BANK_STEP', 'BANK_SET', 'VIDEO_SET']);

export type PlanCtx = {
  mode: AutomationMode;
  scriptOnly: boolean; // modo "só roteiro" (react false): automação desligada
  turn: number;        // contador para o rodízio de cenas
};

/** O que fazer agora. `prev` = estado anterior (para detectar a entrada). */
export function plan(prev: StateName, cur: MusicState, cfg: RulesConfig, ctx: PlanCtx): Step[] {
  if (ctx.mode === 'MANUAL' || ctx.scriptOnly) return [];
  const on = cfg.enabled, steps: Step[] = [];
  const ramp = (lim: Record<string, number>, beats: number) =>
    Object.entries(lim).map(([key, to]): Step => ({ cmd: { type: 'PARAM_RAMP', key, to, beats }, quantize: 'bar' }));
  const pick = (list: number[]) => (list.length ? list[ctx.turn % list.length] : -1);

  if (cur.dropEvent && on.drop) {
    steps.push({ cmd: { type: 'MACRO', id: 'DROP' }, quantize: 'beat' });
    const s = pick(cfg.dropScenes);
    if (s >= 0) steps.push({ cmd: { type: 'SCENE_RECALL', index: s, fade: 0 }, quantize: 'beat' });
  } else if (cur.state !== prev) {
    if (cur.state === 'BREAKDOWN' && on.breakdown) steps.push(...ramp(LIMITS.BREAKDOWN, 4));
    if (cur.state === 'BUILD_UP' && on.buildUp) steps.push(...ramp(LIMITS.BUILD_UP, 16));
    if (cur.state === 'GROOVE' && on.groove) {
      const s = pick(cfg.grooveScenes);
      if (s >= 0) steps.push({ cmd: { type: 'SCENE_RECALL', index: s, fade: 4 }, quantize: 'bar' });
    }
  }
  return ctx.mode === 'ASSIST' ? steps.filter((s) => !SCENE_LIKE.has(s.cmd.type)) : steps;
}

/**
 * Espera até o próximo beat/compasso, em ms. Só com o BPM travado; sem ele, na hora (fallback suave: as rampas já
 * são graduais). `beat` = contagem de beats do motor, `phase` = 0..1 dentro do beat.
 */
export function quantizeDelay(q: 'beat' | 'bar', f: { locked: boolean; bpm: number; beat: number; beatPhase: number }): number {
  if (!f.locked || !(f.bpm > 0)) return 0;
  const beatMs = 60000 / f.bpm, toBeat = (1 - f.beatPhase) * beatMs;
  if (q === 'beat') return toBeat;
  const left = (4 - ((((f.beat + 1) % 4) + 4) % 4)) % 4; // beats inteiros depois do próximo, até o compasso
  return toBeat + left * beatMs;
}
