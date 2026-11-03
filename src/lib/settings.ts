// Ajustes visuais: a janela de controle é a dona; a saída lê na abertura e recebe o evento 'visual'.
import { isObj, load, save, shaped } from './store.ts';
import { defaultLayers, sanitizeLayers } from '../render/layers.ts';

// De onde cada efeito tira o movimento. "Auto" = kick quando há kick, a onda quando não há.
export const SOURCES = {
  auto: 'Auto', kick: 'Kick', sub: 'Sub', bass: 'Bass', mid: 'Mid', hats: 'Hats',
  beat: 'Beat', bar: 'Compasso', lfo: 'LFO',
} as const;
export type Source = keyof typeof SOURCES;
export const PAUSES = { stop: 'parar', breathe: 'respirar', beat: 'seguir o beat' } as const;
export type Pause = keyof typeof PAUSES;
export type ModTarget = 'amount' | 'glow' | 'chroma' | 'bgPulse' | 'bgFlash' | 'fxFlash' | 'fxShake' | 'trailZoom' | 'kaleido' | 'tunnel' | 'mandala' | 'particles' | 'organic' | 'glitch';
// Efeitos que podem ficar "só no drop": somem no breakdown sem grave e entram quando o grave volta.
export type DropTarget = 'fxFlash' | 'fxRings' | 'fxBars' | 'fxRadial' | 'trail' | 'strobe' | 'chroma' | 'fxShake' | 'bgPulse' | 'bgFlash' | 'bgMedia' | 'kaleido' | 'tunnel' | 'mandala' | 'particles' | 'organic' | 'glitch';

export const VISUAL = {
  // logo
  size: 40, amount: 0.45, chroma: 0, glow: 0.6, color: '#7c5cff', rmWhite: false, white: 230,
  // reação
  rel: 0.12, wave: 0.8, predict: true, offset: -40,
  // na pausa (sem kick, nível abaixo de pauseThr): parar, respirar ou seguir o beat (o pulso previsto de antes da Onda 10;
  // as fontes de banda e a onda usam `levels` em todos os modos). Fora das cenas
  pause: 'breathe' as Pause, pauseThr: 0.08,
  mod: {
    amount: 'auto', glow: 'auto', chroma: 'auto', bgPulse: 'auto',
    bgFlash: 'auto', fxFlash: 'auto', fxShake: 'kick', trailZoom: 'auto',
    kaleido: 'lfo', tunnel: 'bass', mandala: 'kick', particles: 'kick', organic: 'sub', glitch: 'kick',
  } as Record<ModTarget, Source>,
  // régua: [mín, máx] do nível da fonte; abaixo do mínimo o efeito fica parado, no máximo chega a 100%.
  // Sem entrada = [0, 1] (a fonte passa direto, como antes).
  range: {} as Partial<Record<ModTarget, [number, number]>>,
  drop: {
    fxFlash: false, fxRings: false, fxBars: false, fxRadial: false, trail: false, strobe: false,
    chroma: false, fxShake: false, bgPulse: false, bgFlash: false, bgMedia: false,
    kaleido: false, tunnel: false, mandala: false, particles: false, organic: false, glitch: false,
  } as Record<DropTarget, boolean>,
  dropFade: 1, // beats para os efeitos "só no drop" entrarem/saírem
  // fundo
  bgc1: '#0b0b10', bgc2: '#2a1060', bgGrad: false, bgAngle: 160, bgFit: 'cover' as 'cover' | 'contain',
  bgOpacity: 1, bgBlur: 0, bgDim: 100, bgHue: 0, bgPulse: 0.05, bgFlash: 0.15,
  bgVideo: '', videoSpeed: 1, // vídeo em loop no fundo (id da biblioteca; '' = foto/cor)
  // efeitos
  fxFlash: 0.35, fxRings: 0.4, fxBars: 0, fxRadial: 0, fxVig: 0.4, fxScan: 0, fxGrain: 0, fxShake: 0,
  trail: 0, trailZoom: 0.5, trailRot: 0, strobe: 0, strobeDiv: 1,
  // Psy Engine (DK-022): intensidade 0 = módulo desligado, sem custo
  kaleido: 0, kaleidoN: 6, kaleidoSpin: 0.2, kaleidoZoom: 1, kaleidoMirror: true,
  tunnel: 0, tunnelSpeed: 0.5, tunnelDensity: 0.5,
  mandala: 0, mandalaPetals: 8,
  // Psy Engine (DK-023)
  particles: 0, particlesDensity: 0.5, particlesDir: 90, particlesTurb: 0.3, // direção em graus (90 = sobe)
  organic: 0, organicScale: 1,
  glitch: 0, // rajadas curtas no disparo; teto em music.ts (BURST_HZ, BURST_MS)
  // DK-051/053: ordem, liga/desliga, opacidade e mistura de cada camada; entra nas cenas (sanitizeLayers valida).
  // No crossfade de cenas a lista troca inteira em t = 0,5, como os outros objetos (ver `blend`).
  layers: defaultLayers(),
  // saída / operação (fora das cenas)
  layerSolo: '',    // DK-053: id da camada em solo ('' = nenhuma); só ela desenha, sem mexer no `enabled` das outras
  fxSafe: false,    // DK-123: modo seguro — nenhum efeito da comunidade carrega no telão
  psyQuality: 1, // 0 baixa · 1 média · 2 alta: amostras/iterações por pixel dos módulos do Psy Engine
  psyAuto: true,    // DK-024: baixa a qualidade / desliga o módulo mais caro se o telão engasgar
  psyBudgetMs: 22,  // teto do p95 do frametime para o ajuste automático
  psySafe: false,   // interruptor: true = os módulos do Psy Engine param de desenhar, sem mexer nas cenas
  renderScale: 1, blackout: false, logoOnly: false,
  react: true, // false = "só roteiro": o visual muda só nos pontos marcados, sem reagir ao som
  safeFlash: true, // limita strobe/flash a 3 por segundo (fotossensibilidade); fora das cenas, ligado por padrão
};
export type Visual = typeof VISUAL;

/** Régua salva → só alvos conhecidos com 0 ≤ mín < máx ≤ 1; o resto é descartado (volta a [0, 1]). */
export function validRange(x: unknown): Visual['range'] {
  const o: Visual['range'] = {};
  if (!isObj(x)) return o;
  for (const [k, r] of Object.entries(x)) {
    if (!(k in VISUAL.mod) || !Array.isArray(r) || r.length !== 2) continue;
    const [lo, hi] = r;
    if (typeof lo === 'number' && typeof hi === 'number' && 0 <= lo && lo < hi && hi <= 1) o[k as ModTarget] = [lo, hi];
  }
  return o;
}

/** Visual salvo → completo, com os tipos certos e só valores conhecidos; estados de operação voltam ao neutro. */
export function validVisual(raw: unknown): Visual {
  const v = shaped(raw, VISUAL);
  for (const k of Object.keys(v.mod) as ModTarget[]) if (!(v.mod[k] in SOURCES)) v.mod[k] = VISUAL.mod[k];
  v.range = validRange(isObj(raw) ? raw.range : null); // `shaped` com o padrão {} jogaria tudo fora
  if (v.bgFit !== 'cover' && v.bgFit !== 'contain') v.bgFit = VISUAL.bgFit;
  if (![1, 2, 4].includes(v.strobeDiv)) v.strobeDiv = VISUAL.strobeDiv;
  if (!Object.hasOwn(PAUSES, v.pause)) v.pause = VISUAL.pause; // `in` aceitaria 'toString'
  v.pauseThr = Math.min(0.3, Math.max(0, v.pauseThr));
  v.layers = sanitizeLayers(v.layers); // dado salvo passa pelo mesmo crivo que o renderer e a UI
  return { ...v, blackout: false, logoOnly: false, react: true };
}

export function loadVisual(): Visual {
  return load('doublek.visual', validVisual, () => ({ ...VISUAL }));
}

export function saveVisual(v: Visual) {
  save('doublek.visual', v);
}

// ---------- cenas ----------
// Uma cena é o "visual" sem os ajustes de operação (sincronia, desempenho, blackout, recorte da logo).
const NOT_IN_SCENE = ['renderScale', 'psyQuality', 'psyAuto', 'psyBudgetMs', 'psySafe', 'layerSolo', 'fxSafe', 'offset', 'predict', 'pause', 'pauseThr', 'blackout', 'logoOnly', 'rmWhite', 'white', 'react', 'safeFlash'] as const;
export type Look = Omit<Visual, (typeof NOT_IN_SCENE)[number]>;
export type Scene = { name: string; look: Look } | null;

export function lookOf(v: Visual): Look {
  const o: any = structuredClone(v);
  NOT_IN_SCENE.forEach((k) => delete o[k]);
  return o;
}

const base = lookOf(VISUAL);
const DEFAULT_SCENES: Scene[] = [
  { name: 'Psy clean', look: base },
  {
    name: 'Dark túnel',
    look: {
      ...base, color: '#ff2a55', bgc1: '#050008', bgc2: '#3a0018', bgGrad: true, fxVig: 0.7, fxRings: 0.6,
      trail: 0.75, trailZoom: 0.6, trailRot: 0.2, chroma: 6, mod: { ...base.mod, chroma: 'hats' },
    },
  },
  { name: 'Strobe', look: { ...base, strobe: 0.5, strobeDiv: 2, fxFlash: 0.6, fxShake: 8, glow: 0.9, amount: 0.6 } },
  { name: 'Radial', look: { ...base, color: '#22d3ee', fxRadial: 0.8, fxRings: 0.2, glow: 0.8, bgHue: 20, mod: { ...base.mod, glow: 'bass' } } },
  null, null, null, null,
];

/** 8 posições; cada cena com nome e look completo (o que vier errado cai no padrão), ou null. */
export function validScenes(raw: unknown): Scene[] {
  if (!Array.isArray(raw) || raw.length !== 8) throw new Error('cenas: precisa de 8 posições');
  return raw.map((s, i): Scene =>
    isObj(s) ? { name: String(s.name ?? `Cena ${i + 1}`).slice(0, 24), look: { ...base, ...sanitizeLook(s.look) } as Look } : null);
}

export function loadScenes(): Scene[] {
  return load('doublek.scenes', validScenes, () => structuredClone(DEFAULT_SCENES));
}

export function saveScenes(s: Scene[]) {
  save('doublek.scenes', s);
}

const lerpHex = (a: string, b: string, t: number) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = (s: number) => Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * t);
  return '#' + ((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0');
};

/** Passo do crossfade: números e cores deslizam; o resto troca no meio. Só devolve as chaves da cena. */
export function blend(from: Visual, to: Look, t: number): Look {
  const o: any = {};
  for (const [k, y] of Object.entries(to)) {
    const x = (from as any)[k];
    if (typeof x === 'number' && typeof y === 'number' && k !== 'strobeDiv') o[k] = x + (y - x) * t;
    else if (typeof x === 'string' && typeof y === 'string' && x[0] === '#' && y[0] === '#') o[k] = lerpHex(x, y, t);
    else o[k] = t < 0.5 ? x : structuredClone(y);
  }
  return o;
}

/** Aceita só chaves conhecidas com o tipo certo (presets vêm de arquivo). */
export function sanitizeLook(x: unknown): Partial<Look> {
  const o: any = {};
  if (!x || typeof x !== 'object') return o;
  const base = lookOf(VISUAL) as any;
  for (const [k, v] of Object.entries(x)) {
    if (k === 'mod' && v && typeof v === 'object') {
      o.mod = { ...VISUAL.mod };
      for (const [t, src] of Object.entries(v)) if (t in VISUAL.mod && typeof src === 'string' && src in SOURCES) o.mod[t] = src;
    } else if (k === 'drop' && v && typeof v === 'object') {
      o.drop = { ...VISUAL.drop };
      for (const [t, on] of Object.entries(v)) if (t in VISUAL.drop && typeof on === 'boolean') o.drop[t] = on;
    } else if (k === 'range') {
      o.range = validRange(v);
    } else if (k === 'layers') {
      o.layers = sanitizeLayers(v); // DK-053: camadas entram nas cenas, presets e Show Pack
    } else if (k in base && typeof base[k] !== 'object' && typeof v === typeof base[k] && (typeof v !== 'number' || Number.isFinite(v))) o[k] = v;
  }
  return o;
}
