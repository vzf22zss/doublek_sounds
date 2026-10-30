// Contrato das camadas (DK-051), TS puro e serializável (vai no JSON do visual).
// Camada = um módulo que produz um quadro inteiro a partir do que está embaixo. A ordem decide quem roda antes;
// `blend` e `opacity` combinam o quadro da camada com o de baixo (compositor em effects/compose.ts).
//
// O que é camada e o que é passe fixo:
//   fixo   cena (fundo/foto/vídeo + flash + anéis + espectros + logo/glow) — tudo num shader só; separar em passes
//          mudaria o arredondamento de 8 bits e a imagem de hoje. Vídeo como camada própria fica para DK-063.
//   camada orgânico, túnel, partículas, mandala, caleidoscópio (psy:<módulo>), rastro (overlay), glitch (psy:glitch)
//   fixo   pós (vinheta, grão, strobe, blackout) — sempre por último, é a segurança do telão.
// Os tipos 'bg' | 'logo' | 'video' ficam reservados no contrato para quando a cena for dividida.

export const BLENDS = ['normal', 'add', 'screen', 'multiply'] as const;
export type Blend = (typeof BLENDS)[number];
export const BLEND_NAMES: Record<Blend, string> = { normal: 'Normal', add: 'Somar', screen: 'Tela', multiply: 'Multiplicar' };

/** Ordem de hoje (DK-022/023). `feedback` é o rastro. */
export const LAYER_IDS = ['organic', 'tunnel', 'particles', 'mandala', 'kaleido', 'feedback', 'glitch'] as const;
export type LayerId = (typeof LAYER_IDS)[number];
export const LAYER_NAMES: Record<LayerId, string> = {
  organic: 'Orgânico', tunnel: 'Túnel', particles: 'Partículas', mandala: 'Mandala', kaleido: 'Caleidoscópio',
  feedback: 'Rastro', glitch: 'Glitch',
};

export type LayerType = 'bg' | 'logo' | 'overlay' | 'video' | `psy:${string}`;
export type Layer = { id: string; type: LayerType; enabled: boolean; order: number; opacity: number; blend: Blend };

const typeOf = (id: string): LayerType => (id === 'feedback' ? 'overlay' : `psy:${id}`);
const make = (id: LayerId, order: number): Layer => ({ id, type: typeOf(id), enabled: true, order, opacity: 1, blend: 'normal' });

export const defaultLayers = (): Layer[] => LAYER_IDS.map(make);

/** Qualquer coisa → lista válida: só ids conhecidos (o 1º de cada), valores limitados, ordem estável 0..n-1,
 *  ids que faltarem entram no fim com o padrão. Tipo sempre derivado do id. */
export function sanitizeLayers(raw: unknown): Layer[] {
  const seen = new Map<string, Layer & { i: number }>();
  if (Array.isArray(raw)) raw.forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const r = x as Record<string, unknown>, id = r.id;
    if (typeof id !== 'string' || !(LAYER_IDS as readonly string[]).includes(id) || seen.has(id)) return;
    const op = typeof r.opacity === 'number' && Number.isFinite(r.opacity) ? Math.min(1, Math.max(0, r.opacity)) : 1;
    seen.set(id, {
      ...make(id as LayerId, typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : Infinity),
      enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
      opacity: op,
      blend: (BLENDS as readonly string[]).includes(r.blend as string) ? (r.blend as Blend) : 'normal',
      i,
    });
  });
  LAYER_IDS.forEach((id, k) => { if (!seen.has(id)) seen.set(id, { ...make(id, Infinity), i: 1e6 + k }); });
  return [...seen.values()]
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map(({ i: _, ...l }, order) => ({ ...l, order }));
}

/** Sobe (-1) ou desce (+1) uma camada na ordem. Nas pontas não faz nada. Devolve lista nova. */
export function moveLayer(layers: unknown, id: string, dir: -1 | 1): Layer[] {
  const l = sanitizeLayers(layers), i = l.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= l.length) return l;
  [l[i], l[j]] = [l[j], l[i]];
  return l.map((x, order) => ({ ...x, order }));
}

/** Muda campos de uma camada (enabled/opacity/blend), validando. Devolve lista nova. */
export function setLayer(layers: unknown, id: string, patch: Partial<Pick<Layer, 'enabled' | 'opacity' | 'blend'>>): Layer[] {
  return sanitizeLayers(sanitizeLayers(layers).map((x) => (x.id === id ? { ...x, ...patch } : x)));
}

/** A camada precisa de passe de composição? `normal` com opacidade 1 = não (custo de hoje). */
export const needsCompose = (l: Layer) => l.blend !== 'normal' || l.opacity < 1;

// ---------- DK-053: arrastar, solo e MIDI ----------

/** Leva a camada para a posição `to` (arrastar). Devolve lista nova. */
export function placeLayer(layers: unknown, id: string, to: number): Layer[] {
  const l = sanitizeLayers(layers), i = l.findIndex((x) => x.id === id);
  if (i < 0) return l;
  const [x] = l.splice(i, 1);
  l.splice(Math.max(0, Math.min(l.length, Math.round(to))), 0, x);
  return l.map((y, order) => ({ ...y, order }));
}

/** A camada desenha? Com uma camada em solo (`layerSolo` = id conhecido), só ela — mesmo desligada; o `enabled`
 *  das outras fica como estava. Opacidade 0 nunca desenha. */
export const drawsLayer = (l: Layer, solo: unknown) =>
  ((LAYER_IDS as readonly unknown[]).includes(solo) ? l.id === solo : l.enabled) && l.opacity > 0;

/** Chaves de camada que SET_PARAMETER aceita (MIDI learn): `layers.<id>.opacity` (0–1) e `layers.<id>.on`
 *  (1 liga · 0 desliga · −1 alterna). */
export const LAYER_PARAM = new RegExp(`^layers\\.(${LAYER_IDS.join('|')})\\.(opacity|on)$`);

/** Aplica um SET_PARAMETER de camada. null = não é chave de camada (o App segue com o caminho normal). */
export function applyLayerParam(layers: unknown, key: string, value: number): Layer[] | null {
  const m = LAYER_PARAM.exec(key);
  if (!m || !Number.isFinite(value)) return null;
  const [, id, field] = m;
  if (field === 'opacity') return setLayer(layers, id, { opacity: value });
  const cur = sanitizeLayers(layers).find((x) => x.id === id)!;
  return setLayer(layers, id, { enabled: value < 0 ? !cur.enabled : value >= 0.5 });
}
