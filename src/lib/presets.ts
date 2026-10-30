// Catálogo de presets de fábrica (DK-131): só parâmetros (cores, efeitos, fontes de modulação), sem mídia.
// Nunca são editados no lugar: a interface grava uma cópia num pad ou aplica no visual atual.
import { lookOf, VISUAL, type Look } from './settings.ts';

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
