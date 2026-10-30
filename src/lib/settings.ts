// Ajustes visuais: a janela de controle é a dona; a saída lê na abertura e recebe o evento 'visual'.
export const VISUAL = {
  // logo
  size: 40, amount: 0.45, chroma: 0, glow: 0.6, color: '#7c5cff', rmWhite: false, white: 230,
  // reação
  rel: 0.12, wave: 0.8, predict: true, offset: -40,
  // fundo
  bgc1: '#0b0b10', bgc2: '#2a1060', bgGrad: false, bgAngle: 160, bgFit: 'cover' as 'cover' | 'contain',
  bgOpacity: 1, bgBlur: 0, bgDim: 100, bgHue: 0, bgPulse: 0.05, bgFlash: 0.15,
  // efeitos
  fxFlash: 0.35, fxRings: 0.4, fxBars: 0, fxRadial: 0, fxVig: 0.4, fxScan: 0, fxGrain: 0, fxShake: 0,
  trail: 0, trailZoom: 0.5, trailRot: 0, strobe: 0, strobeDiv: 1,
  // saída
  renderScale: 1, blackout: false,
};
export type Visual = typeof VISUAL;

const KEY = 'doublek.visual';

export function loadVisual(): Visual {
  try {
    return { ...VISUAL, ...JSON.parse(localStorage.getItem(KEY) ?? '{}'), blackout: false };
  } catch {
    return { ...VISUAL };
  }
}

export function saveVisual(v: Visual) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
}
