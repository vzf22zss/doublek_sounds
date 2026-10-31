// Contrato das camadas (DK-051), TS puro e serializável (vai no JSON do visual).
// Camada = um módulo que produz um quadro inteiro a partir do que está embaixo. A ordem decide quem roda antes;
// `blend` e `opacity` combinam o quadro da camada com o de baixo (compositor em effects/compose.ts).
//
// O que é camada e o que é passe fixo:
//   fixo   cena (fundo/foto/vídeo + flash + anéis + espectros + logo/glow) — tudo num shader só; separar em passes
//          mudaria o arredondamento de 8 bits e a imagem de hoje (DK-063 decidiu não dividir; ver VIDEO_LAYER).
//   camada orgânico, túnel, partículas, mandala, caleidoscópio (psy:<módulo>), rastro (overlay), glitch (psy:glitch)
//   opcional vídeo (`video`, DK-063) e até 2 efeitos da comunidade (`fx:<id>`, DK-123) — só se o operador puser
//   fixo   pós (vinheta, grão, strobe, blackout) — sempre por último, é a segurança do telão.
// Os tipos 'bg' | 'logo' ficam reservados no contrato para se um dia a cena for dividida.

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

export type LayerType = 'bg' | 'logo' | 'overlay' | 'video' | 'fx' | `psy:${string}`;
export type Layer = { id: string; type: LayerType; enabled: boolean; order: number; opacity: number; blend: Blend };

// DK-123: efeito da comunidade como camada, id `fx:<id do manifesto>`; no máximo MAX_FX ao mesmo tempo
export const MAX_FX = 2;
export const FX_LAYER = /^fx:[a-z0-9][a-z0-9-]{2,39}$/;
export const isFxLayer = (id: unknown): id is string => typeof id === 'string' && FX_LAYER.test(id);

// DK-063: vídeo como camada própria, OPCIONAL. Sem ela (padrão, cenas e Show Pack antigos), o vídeo continua no
// fundo da cena, atrás da logo, como sempre. Com ela, o vídeo sai do fundo e entra na ordem das camadas — por
// cima da cena fixa (logo incluída): use Tela/Somar ou opacidade < 100% para a logo aparecer. Desligada = sem vídeo.
export const VIDEO_LAYER = 'video';

const typeOf = (id: string): LayerType => (isFxLayer(id) ? 'fx' : id === VIDEO_LAYER ? 'video' : id === 'feedback' ? 'overlay' : `psy:${id}`);
const make = (id: string, order: number): Layer => ({ id, type: typeOf(id), enabled: true, order, opacity: 1, blend: 'normal' });

export const defaultLayers = (): Layer[] => LAYER_IDS.map(make);

/** Qualquer coisa → lista válida: só ids conhecidos (o 1º de cada), valores limitados, ordem estável 0..n-1,
 *  ids que faltarem entram no fim com o padrão. Tipo sempre derivado do id.
 *  Camadas `fx:<id>` (DK-123): ficam as primeiras MAX_FX bem formadas; com `fxIds` (os efeitos instalados e
 *  saudáveis), só as desses ids. Sem `fxIds` (salvar/carregar cena), ficam todas as bem formadas. */
export function sanitizeLayers(raw: unknown, fxIds?: readonly string[]): Layer[] {
  const seen = new Map<string, Layer & { i: number }>();
  let fx = 0;
  if (Array.isArray(raw)) raw.forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const r = x as Record<string, unknown>, id = r.id;
    if (typeof id !== 'string' || seen.has(id)) return;
    if (isFxLayer(id)) {
      if (fx >= MAX_FX || (fxIds && !fxIds.includes(id.slice(3)))) return;
      fx++;
    } else if (id !== VIDEO_LAYER && !(LAYER_IDS as readonly string[]).includes(id)) return;
    const op = typeof r.opacity === 'number' && Number.isFinite(r.opacity) ? Math.min(1, Math.max(0, r.opacity)) : 1;
    seen.set(id, {
      ...make(id, typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : Infinity),
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
  ((LAYER_IDS as readonly unknown[]).includes(solo) || isFxLayer(solo) ? l.id === solo : l.enabled) && l.opacity > 0;

/** Põe um efeito da comunidade como camada, no topo das camadas (logo antes do pós). Já presente ou cheio: igual. */
export function addFxLayer(layers: unknown, fxId: string): Layer[] {
  const l = sanitizeLayers(layers), id = `fx:${fxId}`;
  if (!isFxLayer(id) || l.some((x) => x.id === id) || l.filter((x) => x.type === 'fx').length >= MAX_FX) return l;
  return sanitizeLayers([...l, make(id, l.length)]);
}

/** Põe o vídeo como camada (DK-063), no topo das camadas. Já presente: igual. */
export function addVideoLayer(layers: unknown): Layer[] {
  const l = sanitizeLayers(layers);
  return l.some((x) => x.id === VIDEO_LAYER) ? l : sanitizeLayers([...l, make(VIDEO_LAYER, l.length)]);
}

/** Tira uma camada opcional (efeito da comunidade ou vídeo; o vídeo volta para o fundo). As do app não saem. */
export const removeExtraLayer = (layers: unknown, id: string): Layer[] =>
  isFxLayer(id) || id === VIDEO_LAYER ? sanitizeLayers(sanitizeLayers(layers).filter((x) => x.id !== id)) : sanitizeLayers(layers);

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
