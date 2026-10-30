// OSC → comando (DK-091): o servidor Rust (src-tauri/src/osc.rs) entrega `{ addr, args }`; aqui o endereço versionado
// `/doublek/v1/...` vira um `ShowCommand` para o dispatcher único. Só regras, sem Svelte nem Tauri. Faixas de valor
// (fade, nudge) quem confere é o `validate` do dispatcher; aqui, endereço, índice e tipo de argumento.
import type { MacroId, ShowCommand } from './commands.ts';
import { KNOBS } from './roteiro.ts';
import { MAX_BANKS } from './banks.ts';

export type OscArg = { t: 'i' | 'f' | 's' | 'b' | 'T' | 'F'; v?: unknown };
export type OscResult = { cmd: ShowCommand } | { error: string };

export const OSC_PREFIX = '/doublek/v1/';
const OSC_MACROS: readonly MacroId[] = ['BUILD_UP', 'DROP', 'CHAOS', 'RESET'];

/**
 * Faixa [mín, máx, passo] de cada ajuste que `/parameter/{chave}` aceita (0–1 → mín–máx). Vem do KNOBS do roteiro
 * e, para o resto, dos sliders da tela. Fora daqui (de propósito): strobeDiv (só 1/2/4) e os ajustes de operação
 * (renderScale, psyQuality, psyBudgetMs, offset, white), que não mudam no meio do set por um fader de rede.
 */
export const OSC_PARAMS: Record<string, [number, number, number]> = {
  ...Object.fromEntries(Object.entries(KNOBS).map(([k, [, lo, hi]]) => [k, [lo, hi, 0.001]])),
  rel: [0.03, 0.5, 0.01], wave: [0, 1, 0.01], dropFade: [0.25, 8, 0.25], bgAngle: [0, 360, 1], bgBlur: [0, 40, 1],
  kaleido: [0, 1, 0.01], kaleidoN: [3, 12, 1], kaleidoSpin: [-1, 1, 0.01], kaleidoZoom: [0.5, 2, 0.01],
  tunnel: [0, 1, 0.01], tunnelSpeed: [0, 2, 0.01], tunnelDensity: [0, 1, 0.01],
  mandala: [0, 1, 0.01], mandalaPetals: [4, 16, 2],
  particles: [0, 1, 0.01], particlesDensity: [0, 1, 0.01], particlesDir: [0, 360, 1], particlesTurb: [0, 1, 0.01],
  organic: [0, 1, 0.01], organicScale: [0.3, 3, 0.01], glitch: [0, 1, 0.01],
};

const num = (a?: OscArg) => (a?.t === 'i' || a?.t === 'f') && typeof a.v === 'number' && Number.isFinite(a.v) ? a.v : undefined;
const intArg = (a?: OscArg) => { const n = num(a); return n !== undefined && Number.isInteger(n) ? n : undefined; };
/** Liga/desliga: T/F, ou inteiro (0 = desliga). */
const onArg = (a?: OscArg) => (a?.t === 'T' ? true : a?.t === 'F' ? false : a?.t === 'i' && typeof a.v === 'number' ? a.v !== 0 : undefined);
/** "1".."hi" → índice 0-based, ou undefined. */
const slot = (s: string | undefined, hi: number) => (s && /^[1-9]\d*$/.test(s) && +s <= hi ? +s - 1 : undefined);

/** Endereço + argumentos → comando, ou o motivo da recusa (em português, para o Diagnóstico). Nunca lança. */
export function oscToCommand(addr: string, args: OscArg[] = []): OscResult {
  if (typeof addr !== 'string' || !addr.startsWith(OSC_PREFIX)) return { error: `endereço fora do protocolo (use ${OSC_PREFIX}...): ${String(addr)}` };
  if (!Array.isArray(args)) args = [];
  const [head, sub, ...extra] = addr.slice(OSC_PREFIX.length).split('/');
  const a = args[0];
  const err = (e: string): OscResult => ({ error: `${addr}: ${e}` });
  if (extra.length) return err('endereço desconhecido');
  const noSub = sub === undefined;

  // liga/desliga com argumento opcional (sem argumento = alterna)
  const toggle = (type: 'BLACKOUT' | 'LOGO_ONLY'): OscResult => {
    if (!noSub) return err('endereço desconhecido');
    if (!a) return { cmd: { type } };
    const on = onArg(a);
    return on === undefined ? err('argumento precisa ser i, T ou F') : { cmd: { type, on } };
  };
  // fade opcional em beats (i ou f)
  const fade = (): number | undefined | null => (a ? num(a) ?? null : undefined);

  switch (head) {
    case 'scene': case 'preview': {
      const index = slot(sub, 8);
      if (index === undefined) return err('cena de 1 a 8');
      if (head === 'preview') return { cmd: { type: 'SCENE_PREVIEW', index } };
      const f = fade();
      if (f === null) return err('fade precisa ser número (beats)');
      return { cmd: f === undefined ? { type: 'SCENE_RECALL', index } : { type: 'SCENE_RECALL', index, fade: f } };
    }
    case 'take': {
      if (!noSub) return err('endereço desconhecido');
      const f = fade();
      if (f === null) return err('fade precisa ser número (beats)');
      return { cmd: f === undefined ? { type: 'SCENE_TAKE' } : { type: 'SCENE_TAKE', fade: f } };
    }
    case 'bank': {
      const index = slot(sub, MAX_BANKS);
      return index === undefined ? err(`banco de 1 a ${MAX_BANKS}`) : { cmd: { type: 'BANK_SET', index } };
    }
    case 'blackout': return toggle('BLACKOUT');
    case 'logo': return toggle('LOGO_ONLY');
    case 'tap': return noSub ? { cmd: { type: 'TAP' } } : err('endereço desconhecido');
    case 'panic': return noSub ? { cmd: { type: 'PANIC' } } : err('endereço desconhecido');
    case 'macro':
      return OSC_MACROS.includes(sub as MacroId) ? { cmd: { type: 'MACRO', id: sub as MacroId } } : err(`macro desconhecida (use ${OSC_MACROS.join(', ')})`);
    case 'parameter': {
      const r = sub !== undefined && Object.hasOwn(OSC_PARAMS, sub) ? OSC_PARAMS[sub] : undefined;
      if (!r) return err('ajuste desconhecido ou sem faixa para OSC');
      const x = num(a);
      if (x === undefined || x < 0 || x > 1) return err('valor precisa ser número de 0 a 1');
      const [lo, hi, st] = r;
      const v = Math.min(hi, Math.max(lo, Math.round((lo + x * (hi - lo)) / st) * st));
      return { cmd: { type: 'SET_PARAMETER', key: sub!, value: +v.toFixed(6) } };
    }
    case 'roteiro':
      if (sub === 'go') return { cmd: { type: 'ROTEIRO_GO' } };
      if (sub === 'stop') return { cmd: { type: 'ROTEIRO_STOP' } };
      if (sub === 'ab') return { cmd: { type: 'ROTEIRO_AB' } };
      if (sub === 'nudge') {
        const beats = intArg(a);
        return beats === undefined ? err('nudge precisa de um inteiro (beats)') : { cmd: { type: 'ROTEIRO_NUDGE', beats } };
      }
      return err('roteiro aceita go, stop, ab ou nudge');
    default: return err('endereço desconhecido');
  }
}
