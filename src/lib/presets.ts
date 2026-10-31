// Catálogo de presets de fábrica (DK-131): só parâmetros (cores, efeitos, fontes de modulação), sem mídia.
// Nunca são editados no lugar: a interface grava uma cópia num pad ou aplica no visual atual.
import { lookOf, sanitizeLook, VISUAL, type Look } from './settings.ts';
import { checkFile } from './limits.ts';
import { isObj, load, save } from './store.ts';

export const STYLES = {
  psy: 'Psy', dark: 'Dark', forest: 'Forest', hitech: 'Hi-Tech', ambient: 'Ambient', breakdown: 'Breakdown', drop: 'Drop',
} as const;
export type Style = keyof typeof STYLES;
export type Preset = { id: string; name: string; style: Style; tags: string[]; description: string; look: Look };

const base = lookOf(VISUAL);
type Over = Partial<Omit<Look, 'mod' | 'drop'>> & { mod?: Partial<Look['mod']>; drop?: Partial<Look['drop']> };
/** Look completo: tudo que não for sobrescrito vem do padrão, então nunca falta chave. */
const p = (id: string, name: string, style: Style, tags: string[], description: string, o: Over): Preset => ({
  id, name, style, tags, description,
  look: { ...base, ...o, mod: { ...base.mod, ...o.mod }, drop: { ...base.drop, ...o.drop }, bgVideo: '' },
});

const DARK = { bgc1: '#050008', bgc2: '#3a0018', bgGrad: true, fxVig: 0.7 } as const;

export const FACTORY_PRESETS: Preset[] = [
  p('psy-clean', 'Psy Clean', 'psy', ['limpo', 'glow', 'padrão'], 'O padrão do app: logo pulsando com glow e anéis leves.', {}),
  p('psy-rolling', 'Psy Rolling', 'psy', ['rolling', 'bass', 'anéis'],
    'Glow puxado pelo baixo rolante e anéis mais fortes no kick.',
    { color: '#9b7bff', amount: 0.5, glow: 0.75, fxRings: 0.6, bgPulse: 0.08, bgc2: '#34147a', bgGrad: true, mod: { glow: 'bass', amount: 'kick' } }),
  p('dark-tunnel', 'Dark Tunnel', 'dark', ['túnel', 'rastro', 'vermelho'],
    'Rastro em túnel com aberração nos hats; vinheta fechada.',
    { ...DARK, color: '#ff2a55', fxRings: 0.6, trail: 0.75, trailZoom: 0.6, trailRot: 0.2, chroma: 6, mod: { chroma: 'hats' } }),
  p('dark-strobe', 'Dark Strobe', 'dark', ['strobe', 'flash', 'agressivo'],
    'Strobe a cada 2 beats e flash de tela, dentro do limite de 3 flashes por segundo.',
    { ...DARK, color: '#ff2a55', strobe: 0.6, strobeDiv: 2, fxFlash: 0.45, fxShake: 6, glow: 0.8, amount: 0.55 }),
  p('forest-organic', 'Forest Organic', 'forest', ['verde', 'orgânico', 'lento'],
    'Verdes e terrosos, rastro leve girando devagar com o LFO, granulado fino.',
    { color: '#5fbf5a', bgc1: '#06120a', bgc2: '#3a3a12', bgGrad: true, bgHue: 15, amount: 0.35, glow: 0.5, fxRings: 0.3,
      trail: 0.35, trailZoom: 0.3, trailRot: 0.08, fxGrain: 0.15, fxVig: 0.5, mod: { trailZoom: 'lfo', glow: 'sub' } }),
  p('hitech-glitch', 'Hi-Tech Glitch', 'hitech', ['glitch', 'hats', 'tremor', 'ciano'],
    'Aberração nos hats, tremor no kick, linhas de TV; flash só no drop.',
    { color: '#22ff9a', bgc1: '#020607', bgc2: '#06303a', bgGrad: true, chroma: 10, fxShake: 10, fxFlash: 0.4, fxScan: 0.3,
      fxGrain: 0.2, fxBars: 0.4, glow: 0.7, mod: { chroma: 'hats', fxShake: 'kick', fxFlash: 'kick' }, drop: { fxFlash: true } }),
  p('ambient', 'Ambient', 'ambient', ['suave', 'calmo', 'azul'],
    'Pulso suave sem anéis nem flash; tremor e aberração só entram quando o grave volta.',
    { color: '#7fb8ff', bgc2: '#102040', bgGrad: true, amount: 0.25, glow: 0.5, rel: 0.25, wave: 1, fxRings: 0, fxFlash: 0,
      bgPulse: 0.03, bgFlash: 0.1, trail: 0.2, trailZoom: 0.3, chroma: 4, fxShake: 4,
      drop: { chroma: true, fxShake: true, bgFlash: true } }),
  p('breakdown', 'Breakdown', 'breakdown', ['breakdown', 'flutuando', 'sem efeitos'],
    'Logo flutuando no LFO, fundo escurecido, nenhum efeito agressivo.',
    { amount: 0.2, glow: 0.7, rel: 0.3, wave: 1.2, fxRings: 0, fxFlash: 0, bgPulse: 0, bgFlash: 0, bgDim: 70, fxVig: 0.5,
      trail: 0.3, trailZoom: 0.2, mod: { amount: 'lfo', trailZoom: 'lfo' } }),
  p('drop', 'Drop', 'drop', ['drop', 'tudo', 'strobe', 'flash'],
    'Tudo ligado e marcado "só no drop": some no breakdown e volta inteiro com o grave.',
    { amount: 0.6, glow: 0.9, fxFlash: 0.5, fxRings: 0.7, strobe: 0.5, strobeDiv: 1, fxShake: 10, chroma: 8, trail: 0.5,
      trailZoom: 0.6, bgFlash: 0.3, bgPulse: 0.15,
      drop: { fxFlash: true, fxRings: true, strobe: true, fxShake: true, chroma: true, trail: true, bgFlash: true, bgPulse: true } }),
  p('radial-spectrum', 'Radial Spectrum', 'hitech', ['radial', 'espectro', 'ciano'],
    'Espectro radial em volta da logo, glow no baixo.',
    { color: '#22d3ee', fxRadial: 0.8, fxRings: 0.2, glow: 0.8, bgHue: 20, mod: { glow: 'bass' } }),
  p('minimal-logo', 'Minimal Logo', 'ambient', ['mínimo', 'preto', 'só logo'],
    'Fundo preto, logo pulsando de leve, nada mais.',
    { color: '#ffffff', bgc1: '#000000', bgc2: '#000000', amount: 0.3, glow: 0.4, fxRings: 0, fxFlash: 0, fxVig: 0.2, bgPulse: 0, bgFlash: 0 }),
  // Psy Engine (DK-022)
  p('kaleido-psy', 'Kaleido Psy', 'psy', ['caleidoscópio', 'simetria', 'lfo'],
    'Caleidoscópio de 6 fatias girando no LFO, com glow e anéis.',
    { color: '#9b7bff', bgc2: '#34147a', bgGrad: true, glow: 0.8, fxRings: 0.5,
      kaleido: 0.85, kaleidoN: 6, kaleidoSpin: 0.25, mod: { kaleido: 'lfo' } }),
  p('kaleido-dark', 'Kaleido Dark', 'dark', ['caleidoscópio', 'rastro', 'vermelho'],
    'Caleidoscópio de 8 fatias empurrado pelo kick, com rastro e aberração nos hats.',
    { ...DARK, color: '#ff2a55', trail: 0.4, trailZoom: 0.4, chroma: 4,
      kaleido: 1, kaleidoN: 8, kaleidoSpin: -0.15, kaleidoZoom: 1.3, mod: { kaleido: 'kick', chroma: 'hats' } }),
  p('tunnel-fractal', 'Túnel Fractal', 'psy', ['túnel', 'fractal', 'bass'],
    'Túnel fractal por baixo da logo, acelerado pelo baixo rolante.',
    { bgc1: '#05030f', bgc2: '#2a1060', bgGrad: true, fxRings: 0.3,
      tunnel: 0.9, tunnelSpeed: 0.6, tunnelDensity: 0.5, mod: { tunnel: 'bass' } }),
  p('tunnel-hitech', 'Túnel Hi-Tech', 'hitech', ['túnel', 'hats', 'ciano', 'rápido'],
    'Túnel denso e rápido puxado pelos hats, com linhas de TV.',
    { color: '#22ff9a', bgc1: '#020607', bgc2: '#06303a', bgGrad: true, fxScan: 0.2, chroma: 6,
      tunnel: 1, tunnelSpeed: 1.2, tunnelDensity: 0.8, mod: { tunnel: 'hats', chroma: 'hats' } }),
  p('mandala-forest', 'Mandala Forest', 'forest', ['mandala', 'verde', 'orgânico'],
    'Mandala de 10 pétalas acesa pelo sub, em verdes e terrosos.',
    { color: '#5fbf5a', bgc1: '#06120a', bgc2: '#3a3a12', bgGrad: true, glow: 0.5, fxRings: 0, fxGrain: 0.1,
      mandala: 0.9, mandalaPetals: 10, mod: { mandala: 'sub' } }),
  p('mandala-drop', 'Mandala Drop', 'drop', ['mandala', 'túnel', 'drop'],
    'Mandala, túnel e anéis só no drop: somem no breakdown e voltam com o grave.',
    { mandala: 1, mandalaPetals: 12, tunnel: 0.6, fxRings: 0.6, fxFlash: 0.4, mod: { mandala: 'kick' },
      drop: { mandala: true, tunnel: true, fxRings: true, fxFlash: true } }),
  // Psy Engine (DK-023)
  p('particles-psy', 'Partículas Psy', 'psy', ['partículas', 'estrelas', 'kick'],
    'Campo de partículas subindo, com empurrão e brilho no kick.',
    { color: '#9b7bff', bgc2: '#34147a', bgGrad: true, glow: 0.7,
      particles: 0.8, particlesDensity: 0.5, particlesDir: 90, particlesTurb: 0.4, mod: { particles: 'kick' } }),
  p('particles-dark', 'Poeira Dark', 'dark', ['partículas', 'poeira', 'turbulência', 'vermelho'],
    'Poeira caindo em turbulência, puxada pelo baixo, com rastro curto.',
    { ...DARK, color: '#ff2a55', trail: 0.3, trailZoom: 0.3,
      particles: 1, particlesDensity: 0.3, particlesDir: 270, particlesTurb: 0.8, mod: { particles: 'bass' } }),
  p('organic-forest', 'Floresta Orgânica', 'forest', ['orgânico', 'verde', 'textura', 'sub'],
    'Textura orgânica em verdes, girando a matiz devagar, acesa pelo sub.',
    { color: '#7fd36a', bgc1: '#0a1a0c', bgc2: '#2f4a14', bgGrad: true, bgHue: 6, amount: 0.35,
      organic: 0.85, organicScale: 1, mod: { organic: 'sub' } }),
  p('organic-ambient', 'Névoa Ambient', 'ambient', ['orgânico', 'névoa', 'azul', 'calmo'],
    'Névoa azul larga e lenta, sem anéis nem flash.',
    { color: '#7fb8ff', bgc1: '#05070f', bgc2: '#1a2a50', bgGrad: true, bgHue: 4, amount: 0.25, fxRings: 0, fxFlash: 0,
      organic: 0.6, organicScale: 0.6, mod: { organic: 'mid' } }),
  p('glitch-hitech', 'Glitch Hi-Tech', 'hitech', ['glitch', 'hats', 'ciano', 'digital'],
    'Rajadas de glitch nos hats, com linhas de TV e aberração.',
    { color: '#22ff9a', bgc1: '#020607', bgc2: '#06303a', bgGrad: true, fxScan: 0.3, chroma: 6,
      glitch: 0.8, mod: { glitch: 'hats', chroma: 'hats' } }),
  p('glitch-drop', 'Glitch Drop', 'drop', ['glitch', 'partículas', 'drop'],
    'Glitch no kick e partículas, os dois só no drop.',
    { glitch: 1, particles: 0.6, fxRings: 0.5, fxFlash: 0.4, mod: { glitch: 'kick' },
      drop: { glitch: true, particles: true, fxRings: true, fxFlash: true } }),
];

/** Cópia profunda do look: quem recebe pode editar sem mexer no catálogo. */
export function presetLook(id: string): Look {
  const pr = FACTORY_PRESETS.find((x) => x.id === id);
  if (!pr) throw new Error('preset desconhecido: ' + id);
  return structuredClone(pr.look);
}

export function presetsByStyle(): Record<Style, Preset[]> {
  const o = {} as Record<Style, Preset[]>;
  for (const s of Object.keys(STYLES) as Style[]) o[s] = [];
  for (const pr of FACTORY_PRESETS) o[pr.style].push(pr);
  return o;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca em nome, tags e estilo, sem acento nem caixa. Vazio = tudo. */
export function searchPresets(q: string): Preset[] {
  const t = fold(q.trim());
  if (!t) return FACTORY_PRESETS;
  return FACTORY_PRESETS.filter((pr) => fold([pr.name, pr.style, STYLES[pr.style], ...pr.tags].join(' ')).includes(t));
}

// ---------- presets da comunidade como arquivo local (DK-132) ----------
// Formato `.doublekpreset` (docs/PRESETS.md): JSON pequeno, só parâmetros, sem mídia. Importados ficam em
// `doublek.presets` (máx. 100) e aparecem no Catálogo em "Importados"; aplicar = mesmo caminho dos de fábrica.

export const PRESET_FORMAT = 'doublek-preset';
export const PRESET_VERSION = 1;
export const PRESET_EXT = '.doublekpreset';
export const MAX_PRESET_BYTES = 64 * 1024;
export const MAX_IMPORTED = 100;
const NAME_MAX = 60;

export type UserPreset = { id: string; name: string; author?: string; style?: Style; look: Look };
export type PresetFile = { format: typeof PRESET_FORMAT; v: number; name: string; author?: string; style?: Style; look: Look };

/** Look só com chaves de cena conhecidas, completado com o padrão, sem vídeo (vídeo não viaja no arquivo). */
const cleanLook = (x: unknown): Look => ({ ...structuredClone(base), ...sanitizeLook(x), bgVideo: '' } as Look);
const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const pid = () => Math.random().toString(36).slice(2, 10);

/** Arquivo para compartilhar. Avisos em português (ex.: o vídeo de fundo ficou de fora). */
export function exportPreset(name: string, look: Look, meta: { author?: string; style?: Style } = {}): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  if (look.bgVideo) warnings.push('o vídeo de fundo não vai no arquivo (presets levam só parâmetros)');
  const n = text(name, NAME_MAX) || 'Preset';
  const file: PresetFile = {
    format: PRESET_FORMAT, v: PRESET_VERSION, name: n,
    ...(text(meta.author, NAME_MAX) ? { author: text(meta.author, NAME_MAX) } : {}),
    ...(meta.style && meta.style in STYLES ? { style: meta.style } : {}),
    look: cleanLook(look),
  };
  const out = JSON.stringify(file, null, 1);
  if (new TextEncoder().encode(out).length > MAX_PRESET_BYTES) throw new Error(`preset grande demais (máximo ${MAX_PRESET_BYTES / 1024} KB)`);
  return { text: out, warnings };
}

/** Lê um `.doublekpreset`. Lança Error com a mensagem para a linha de status. */
export function parsePreset(file: { name: string; size: number }, content: string): UserPreset {
  const bad = checkFile('json', { name: file.name.replace(/\.doublekpreset$/i, '.json'), size: file.size });
  if (bad) throw new Error(bad);
  if (file.size > MAX_PRESET_BYTES) throw new Error(`preset grande demais (máximo ${MAX_PRESET_BYTES / 1024} KB)`);
  let x: unknown;
  try { x = JSON.parse(content); } catch { throw new Error('arquivo de preset inválido (não é JSON)'); }
  if (!isObj(x) || x.format !== PRESET_FORMAT) throw new Error('não é um preset do DoubleK');
  if (x.v !== PRESET_VERSION) throw new Error(typeof x.v === 'number' && x.v > PRESET_VERSION ? `preset de uma versão mais nova do DoubleK (v${x.v}); atualize o app` : 'versão de preset desconhecida');
  const name = text(x.name, NAME_MAX);
  if (!name) throw new Error('preset sem nome');
  if (!isObj(x.look)) throw new Error('preset sem parâmetros (look)');
  const author = text(x.author, NAME_MAX), style = typeof x.style === 'string' && x.style in STYLES ? (x.style as Style) : undefined;
  return { id: pid(), name, ...(author ? { author } : {}), ...(style ? { style } : {}), look: cleanLook(x.look) };
}

/** Lista guardada: cada item revalidado; o que não presta some; no máximo 100. */
export function validUserPresets(raw: unknown): UserPreset[] {
  if (!Array.isArray(raw)) throw new Error('presets: precisa ser lista');
  const out: UserPreset[] = [], ids = new Set<string>();
  for (const p of raw) {
    if (!isObj(p) || !isObj(p.look) || !text(p.name, NAME_MAX)) continue;
    const id = typeof p.id === 'string' && /^[a-z0-9]{1,16}$/.test(p.id) && !ids.has(p.id) ? p.id : pid();
    ids.add(id);
    const author = text(p.author, NAME_MAX), style = typeof p.style === 'string' && p.style in STYLES ? (p.style as Style) : undefined;
    out.push({ id, name: text(p.name, NAME_MAX), ...(author ? { author } : {}), ...(style ? { style } : {}), look: cleanLook(p.look) });
    if (out.length === MAX_IMPORTED) break;
  }
  return out;
}

export function addUserPreset(list: UserPreset[], p: UserPreset): UserPreset[] {
  if (list.length >= MAX_IMPORTED) throw new Error(`limite de ${MAX_IMPORTED} presets importados: apague algum antes`);
  return [...list, p];
}
export const removeUserPreset = (list: UserPreset[], id: string) => list.filter((p) => p.id !== id);
export const loadUserPresets = () => load('doublek.presets', validUserPresets, () => []);
export const saveUserPresets = (list: UserPreset[]) => save('doublek.presets', list);
