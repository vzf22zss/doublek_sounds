// Mapa de automação editável (DK-035): regras ligadas, tetos por estado e cena do drop/groove. Fica em
// `doublek.automation`, fora das cenas e do Show Pack (por enquanto). Validação no padrão do store: o que vier
// errado cai no padrão, nunca quebra.
import { isObj, load, save } from '../store.ts';
import { MAX_BANKS } from '../banks.ts';

export type RuleId = 'breakdown' | 'buildUp' | 'drop' | 'groove';
export const RULE_IDS: readonly RuleId[] = ['breakdown', 'buildUp', 'drop', 'groove'];
export const RULE_NAMES: Record<RuleId, string> = { breakdown: 'Breakdown acalma', buildUp: 'Build-up sobe', drop: 'Drop: macro (e cena)', groove: 'Groove: cena' };

export type LimitState = 'BREAKDOWN' | 'BUILD_UP';
export type LimitKey = 'trail' | 'fxRings' | 'bgPulse' | 'chroma';
/** Faixa de cada teto (a mesma dos knobs) e rótulo para a tela. */
export const LIMIT_KEYS: Record<LimitKey, { label: string; max: number; step: number }> = {
  trail: { label: 'Rastro', max: 1, step: 0.01 },
  fxRings: { label: 'Anéis', max: 1, step: 0.01 },
  bgPulse: { label: 'Zoom do fundo', max: 0.4, step: 0.01 },
  chroma: { label: 'Aberração', max: 40, step: 0.5 },
};
export const DEFAULT_LIMITS: Record<LimitState, Record<LimitKey, number>> = {
  BREAKDOWN: { trail: 0.3, fxRings: 0.3, bgPulse: 0.05, chroma: 4 },
  BUILD_UP: { trail: 0.75, fxRings: 0.8, bgPulse: 0.25, chroma: 10 },
};

export type SceneRef = { bank: number; index: number } | null;
export type AutomationConfig = {
  enabled: Record<RuleId, boolean>;
  limits: Record<LimitState, Record<LimitKey, number>>;
  dropScene: SceneRef;   // AUTO: cena chamada no drop (nenhuma = só a macro)
  grooveScene: SceneRef; // AUTO: cena chamada ao entrar em groove (nenhuma = nada)
};
export const DEFAULT_AUTOMATION: AutomationConfig = {
  enabled: { breakdown: true, buildUp: true, drop: true, groove: true },
  limits: structuredClone(DEFAULT_LIMITS),
  dropScene: null,
  grooveScene: null,
};

const sceneRef = (x: unknown): SceneRef =>
  isObj(x) && Number.isInteger(x.bank) && Number.isInteger(x.index) && (x.bank as number) >= 0 && (x.bank as number) < MAX_BANKS && (x.index as number) >= 0 && (x.index as number) < 8
    ? { bank: x.bank as number, index: x.index as number } : null;

/** Só o que é conhecido, com o tipo certo; tetos dentro da faixa do knob. */
export function validAutomation(raw: unknown): AutomationConfig {
  if (!isObj(raw)) throw new Error('automação: precisa ser objeto');
  const out = structuredClone(DEFAULT_AUTOMATION);
  const en = isObj(raw.enabled) ? raw.enabled : {};
  for (const id of RULE_IDS) if (typeof en[id] === 'boolean') out.enabled[id] = en[id] as boolean;
  const lim = isObj(raw.limits) ? raw.limits : {};
  for (const st of ['BREAKDOWN', 'BUILD_UP'] as LimitState[]) {
    const src = isObj(lim[st]) ? (lim[st] as Record<string, unknown>) : {};
    for (const [k, { max }] of Object.entries(LIMIT_KEYS) as [LimitKey, { max: number }][]) {
      const v = src[k];
      if (typeof v === 'number' && Number.isFinite(v)) out.limits[st][k] = Math.min(max, Math.max(0, v));
    }
  }
  out.dropScene = sceneRef(raw.dropScene);
  out.grooveScene = sceneRef(raw.grooveScene);
  return out;
}

export const loadAutomation = () => load('doublek.automation', validAutomation, () => structuredClone(DEFAULT_AUTOMATION));
export const saveAutomation = (c: AutomationConfig) => save('doublek.automation', c);
