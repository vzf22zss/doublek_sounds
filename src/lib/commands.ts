// Protocolo de comandos único (DK-042 / ADR 0003): teclado, MIDI, botões, roteiro e (no futuro) automação, OSC e
// celular chegam todos como `ShowCommand` em `dispatch(cmd, source)`. Aqui só regras, sem Svelte nem navegador:
// validação, autorização por fonte, BLACKOUT/PÂNICO na frente, override manual, histórico; e as curvas das macros.
import { VISUAL } from './settings.ts';
import { MAX_BANKS } from './banks.ts';
import { SAFE_FLASH_MAX, SAFE_STROBE_MAX } from './safety.ts';
import { LAYER_IDS, LAYER_PARAM } from '../render/layers.ts';

export const MACROS = ['BUILD_UP', 'DROP', 'CHAOS', 'RESET'] as const;
export type MacroId = (typeof MACROS)[number];
export const AUTOMATION_MODES = ['MANUAL', 'ASSIST', 'AUTO'] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export type ShowCommand =
  | { type: 'TAP' }
  | { type: 'TEMPO_HALF' }
  | { type: 'TEMPO_DOUBLE' }
  | { type: 'NUDGE'; ms: number }
  | { type: 'BLACKOUT'; on?: boolean }         // sem `on` = alterna
  | { type: 'LOGO_ONLY'; on?: boolean }
  | { type: 'PANIC' }
  | { type: 'SCENE_RECALL'; index: number; fade?: number; now?: boolean } // pad 0–7 do banco ativo; `now` = sem esperar o beat
  | { type: 'SCENE_SAVE'; index: number }
  | { type: 'BANK_STEP'; delta: number }
  | { type: 'BANK_SET'; index: number }
  | { type: 'SET_PARAMETER'; key: string; value: number }
  | { type: 'ROTEIRO_GO' }
  | { type: 'ROTEIRO_STOP' }
  | { type: 'ROTEIRO_NUDGE'; beats: number }
  | { type: 'ROTEIRO_AB' }
  | { type: 'MACRO'; id: MacroId }
  | { type: 'AUTOMATION_MODE'; mode: AutomationMode }; // só o tipo: sem efeito até DK-030/040
export type CommandType = ShowCommand['type'];
export type Source = 'keyboard' | 'midi' | 'ui' | 'roteiro' | 'automation' | 'osc' | 'remote';

export type Handlers = { [K in CommandType]?: (cmd: Extract<ShowCommand, { type: K }>, source: Source) => void };
export type Result = { ok: true } | { ok: false; reason: string };
export type HistoryEntry = { t: number; source: Source; cmd: ShowCommand; ok: boolean; reason?: string };
export type DispatchOpts = { now?: () => number; cooldownMs?: number; historyMax?: number };

/** Comandos que passam na frente de tudo: sem fila, sem cooldown de override. */
export const PRIORITY: ReadonlySet<CommandType> = new Set(['BLACKOUT', 'PANIC']);
const MANUAL: ReadonlySet<Source> = new Set(['keyboard', 'midi', 'ui']);
/** Fontes de rede: recusadas enquanto não existir servidor (DK-080/090). */
const NETWORK_OFF: Partial<Record<Source, string>> = {
  osc: 'OSC desligado: este app ainda não tem servidor OSC',
  remote: 'controle remoto desligado: este app ainda não tem servidor de rede',
};

const int = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const fin = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const optBool = (x: unknown) => x === undefined || typeof x === 'boolean';
/** Chaves do Visual que SET_PARAMETER aceita: as numéricas. Mais as de camada (DK-053): `layers.<id>.opacity`
 *  e `layers.<id>.on` — o handler aplica com `applyLayerParam` (render/layers.ts). */
export const isParameter = (k: unknown): k is string =>
  typeof k === 'string' && ((Object.hasOwn(VISUAL, k) && typeof (VISUAL as any)[k] === 'number') || LAYER_PARAM.test(k));

/** Motivo da recusa, ou null se o comando é válido. */
export function validate(c: unknown): string | null {
  if (!c || typeof c !== 'object' || typeof (c as any).type !== 'string') return 'comando sem tipo';
  const x = c as any;
  switch (x.type as CommandType) {
    case 'TAP': case 'TEMPO_HALF': case 'TEMPO_DOUBLE': case 'PANIC': case 'ROTEIRO_GO': case 'ROTEIRO_STOP': case 'ROTEIRO_AB':
      return null;
    case 'NUDGE': return fin(x.ms) && Math.abs(x.ms) <= 50 && x.ms !== 0 ? null : 'NUDGE: ms entre -50 e 50, diferente de 0';
    case 'BLACKOUT': case 'LOGO_ONLY': return optBool(x.on) ? null : `${x.type}: "on" precisa ser true/false`;
    case 'SCENE_RECALL':
      if (!int(x.index, 0, 7)) return 'SCENE_RECALL: índice de 0 a 7';
      if (x.fade !== undefined && !(fin(x.fade) && x.fade >= 0 && x.fade <= 32)) return 'SCENE_RECALL: fade de 0 a 32 beats';
      return optBool(x.now) ? null : 'SCENE_RECALL: "now" precisa ser true/false';
    case 'SCENE_SAVE': return int(x.index, 0, 7) ? null : 'SCENE_SAVE: índice de 0 a 7';
    case 'BANK_STEP': return int(x.delta, -MAX_BANKS, MAX_BANKS) && x.delta !== 0 ? null : `BANK_STEP: delta de -${MAX_BANKS} a ${MAX_BANKS}, diferente de 0`;
    case 'BANK_SET': return int(x.index, 0, MAX_BANKS - 1) ? null : `BANK_SET: índice de 0 a ${MAX_BANKS - 1}`;
    case 'SET_PARAMETER':
      if (!isParameter(x.key)) return `SET_PARAMETER: ajuste desconhecido ou não numérico (${String(x.key)})`;
      return fin(x.value) ? null : 'SET_PARAMETER: valor precisa ser número';
    case 'ROTEIRO_NUDGE': return int(x.beats, -16, 16) && x.beats !== 0 ? null : 'ROTEIRO_NUDGE: beats inteiro de -16 a 16, diferente de 0';
    case 'MACRO': return (MACROS as readonly string[]).includes(x.id) ? null : `MACRO: desconhecida (${String(x.id)})`;
    case 'AUTOMATION_MODE': return (AUTOMATION_MODES as readonly string[]).includes(x.mode) ? null : 'AUTOMATION_MODE: modo desconhecido';
    default: return `comando desconhecido (${String(x.type)})`;
  }
}

/**
 * Dispatcher único. Ordem: valida → autoriza a fonte → BLACKOUT/PÂNICO na hora → automação descartada durante o
 * override manual → executa (ou enfileira, se já há um comando executando) → histórico. Nunca lança.
 */
export function createDispatcher(handlers: Handlers, opts: DispatchOpts = {}) {
  const now = opts.now ?? (() => Date.now()), cooldown = opts.cooldownMs ?? 8000, max = opts.historyMax ?? 50;
  const history: HistoryEntry[] = [];
  let manualUntil = -Infinity, running = false;
  let queue: [ShowCommand, Source][] = [];

  const record = (source: Source, cmd: ShowCommand, r: Result) => {
    const e: HistoryEntry = { t: now(), source, cmd, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) };
    // knob MIDI manda dezenas de SET_PARAMETER por segundo: o mesmo ajuste, seguido, vira uma linha só
    const last = history[history.length - 1];
    if (last && r.ok && last.ok && cmd.type === 'SET_PARAMETER' && last.cmd.type === 'SET_PARAMETER' && last.cmd.key === cmd.key && last.source === source) history[history.length - 1] = e;
    else history.push(e);
    if (history.length > max) history.splice(0, history.length - max);
    return r;
  };

  const run = (cmd: ShowCommand, source: Source): Result => {
    const h = handlers[cmd.type] as ((c: ShowCommand, s: Source) => void) | undefined;
    if (!h) return { ok: false, reason: `${cmd.type}: sem efeito nesta versão` };
    try { h(cmd, source); return { ok: true }; }
    catch (e) { return { ok: false, reason: `${cmd.type}: ${e instanceof Error ? e.message : String(e)}` }; }
  };

  function dispatch(cmd: ShowCommand, source: Source): Result {
    const bad = validate(cmd);
    if (bad) return record(source, cmd, { ok: false, reason: bad });
    const off = NETWORK_OFF[source];
    if (off) return record(source, cmd, { ok: false, reason: off });
    const prio = PRIORITY.has(cmd.type);
    if (source === 'automation' && !prio && now() < manualUntil)
      return record(source, cmd, { ok: false, reason: `override manual: automação pausada por mais ${Math.ceil((manualUntil - now()) / 1000)} s` });
    if (MANUAL.has(source)) manualUntil = now() + cooldown;
    if (running && !prio) { queue.push([cmd, source]); return { ok: true }; } // histórico quando executar
    if (cmd.type === 'PANIC') queue = []; // nada que estava esperando volta a mexer no visual depois do pânico
    if (running) return record(source, cmd, run(cmd, source)); // prioridade dentro de outro comando: executa já
    running = true;
    try {
      const r = record(source, cmd, run(cmd, source));
      while (queue.length) { const [c, s] = queue.shift()!; record(s, c, run(c, s)); }
      return r;
    } finally { running = false; }
  }

  return {
    dispatch,
    /** Últimos comandos (mais antigo primeiro), para o Diagnóstico. */
    history: () => history.slice(),
    /** ms restantes de override manual (0 = automação liberada). */
    manualLeft: () => Math.max(0, manualUntil - now()),
  };
}

// ---------- compatibilidade com o MIDI learn salvo (doublek.midi) ----------

/** Ids `a:<ação>` de antes do dispatcher → comando. Nenhum mapeamento salvo pode quebrar. */
export const LEGACY_ACTIONS: Record<string, ShowCommand> = {
  'a:tap': { type: 'TAP' },
  'a:half': { type: 'TEMPO_HALF' },
  'a:double': { type: 'TEMPO_DOUBLE' },
  'a:nudge-': { type: 'NUDGE', ms: -5 },
  'a:nudge+': { type: 'NUDGE', ms: 5 },
  'a:blackout': { type: 'BLACKOUT' },
  'a:logoOnly': { type: 'LOGO_ONLY' },
  'a:panic': { type: 'PANIC' },
  'a:go': { type: 'ROTEIRO_GO' },
  'a:stop': { type: 'ROTEIRO_STOP' },
  'a:beat-': { type: 'ROTEIRO_NUDGE', beats: -1 },
  'a:beat+': { type: 'ROTEIRO_NUDGE', beats: 1 },
  'a:bar-': { type: 'ROTEIRO_NUDGE', beats: -4 },
  'a:bar+': { type: 'ROTEIRO_NUDGE', beats: 4 },
  'a:ab': { type: 'ROTEIRO_AB' },
  'a:bank-': { type: 'BANK_STEP', delta: -1 },
  'a:bank+': { type: 'BANK_STEP', delta: 1 },
  ...Object.fromEntries(MACROS.map((id) => [`a:macro:${id}`, { type: 'MACRO', id } as ShowCommand])),
  // DK-053: botão/pad liga-desliga uma camada (−1 = alterna). A opacidade vai pelo caminho de knob:
  // alvo `v:layers.<id>.opacity` com min 0 / max 1 → fromTarget gera SET_PARAMETER sozinho.
  ...Object.fromEntries(LAYER_IDS.map((id) => [`l:${id}:on`, { type: 'SET_PARAMETER', key: `layers.${id}.on`, value: -1 } as ShowCommand])),
};

export type MidiTarget = { id: string; label?: string; min?: number; max?: number; step?: number };

/**
 * Alvo do MIDI learn + valor 0–127 → comando. `v:<chave>` (knob: precisa de min/max), `c:<i>` (pad do banco ativo),
 * `a:<ação>` (tabela acima). null = alvo desconhecido ou sem faixa.
 */
export function fromTarget(t: MidiTarget, val = 127): ShowCommand | null {
  if (t.id.startsWith('v:')) {
    if (t.min === undefined || t.max === undefined) return null;
    const x = t.min + (val / 127) * (t.max - t.min), st = t.step ?? 0.01;
    return { type: 'SET_PARAMETER', key: t.id.slice(2), value: +(Math.round(x / st) * st).toFixed(6) };
  }
  if (t.id.startsWith('c:')) return /^c:\d+$/.test(t.id) ? { type: 'SCENE_RECALL', index: +t.id.slice(2) } : null;
  const c = LEGACY_ACTIONS[t.id];
  return c ? structuredClone(c) : null;
}

// ---------- macros: curvas puras (o App só aplica a cada quadro) ----------

/** Alvos e durações. Tetos de strobe/flash respeitam o safeFlash (DK-006). */
export const MACRO_SPEC = {
  BUILD_UP: { beats: 16, to: { trail: 0.8, fxRings: 0.9, bgPulse: 0.25 } },   // sobe até aqui (nunca desce)
  DROP: { beats: 2, hit: { fxFlash: 1, strobe: 1, strobeDiv: 1, fxRings: 1 } }, // depois volta ao look anterior
  CHAOS: { beats: 4, range: { chroma: [0, 20], fxShake: [0, 15], trailRot: [-0.4, 0.4] } }, // sorteia a cada beat; depois volta
} as const;

export type MacroRun = { keys: string[]; update(beat: number): { set: Record<string, number>; done: boolean } };

/** Uma execução de macro a partir dos valores atuais (`from`). RESET não tem curva: é SAFE_LOOK direto. */
export function startMacro(id: Exclude<MacroId, 'RESET'>, from: Record<string, number>, safe: boolean, rng: () => number = Math.random): MacroRun {
  const restore = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, from[k]]));
  if (id === 'BUILD_UP') {
    const { beats, to } = MACRO_SPEC.BUILD_UP, keys = Object.keys(to);
    return {
      keys,
      update(b) {
        const t = Math.min(1, Math.max(0, b / beats)), e = t * t * (3 - 2 * t);
        const set = Object.fromEntries(keys.map((k) => { const a = from[k], z = Math.max(a, (to as any)[k]); return [k, a + (z - a) * e]; }));
        return { set, done: t >= 1 };
      },
    };
  }
  if (id === 'DROP') {
    const { beats, hit } = MACRO_SPEC.DROP, keys = Object.keys(hit);
    const set = { ...hit, ...(safe ? { fxFlash: Math.min(hit.fxFlash, SAFE_FLASH_MAX), strobe: Math.min(hit.strobe, SAFE_STROBE_MAX) } : {}) };
    return { keys, update: (b) => (b < beats ? { set: { ...set }, done: false } : { set: restore(keys), done: true }) };
  }
  const { beats, range } = MACRO_SPEC.CHAOS, keys = Object.keys(range);
  let step = -1, cur: Record<string, number> = {};
  return {
    keys,
    update(b) {
      if (b >= beats) return { set: restore(keys), done: true };
      const s = Math.floor(Math.max(0, b));
      if (s !== step) {
        step = s;
        cur = Object.fromEntries(keys.map((k) => { const [lo, hi] = (range as any)[k] as [number, number]; return [k, +(lo + rng() * (hi - lo)).toFixed(3)]; }));
      }
      return { set: { ...cur }, done: false };
    },
  };
}
