// Logo e foto de fundo ficam no IndexedDB (as duas janelas têm a mesma origem, então compartilham).
// O processamento pesado (tirar o branco, borrar o glow, borrar o fundo) roda uma vez por troca, não por quadro.
import type { Visual } from './settings';

const DEFAULT_LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 200 200">' +
      '<circle cx="100" cy="100" r="90" fill="#7c5cff"/>' +
      '<path d="M60 100 L85 100 L100 60 L120 140 L135 100 L145 100" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>',
  );

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const q = indexedDB.open('doublek', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export async function getAsset(k: 'logo' | 'bg'): Promise<Blob | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function setAsset(k: 'logo' | 'bg', v: Blob | null) {
  const d = await db();
  return new Promise<void>((res, rej) => {
    const st = d.transaction('kv', 'readwrite').objectStore('kv');
    const r = v ? st.put(v, k) : st.delete(k);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('imagem inválida'));
    i.src = src;
  });
}

async function imageFrom(blob: Blob | undefined, fallback?: string) {
  if (!blob) return fallback ? loadImage(fallback) : null;
  const url = URL.createObjectURL(blob);
  try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
}

export const LOGO_PAD = 0.25; // margem em volta da logo para o glow caber

export type Prepared = { image: HTMLCanvasElement; glow?: HTMLCanvasElement; aspect: number };

async function prepareLogo(v: Visual): Promise<Prepared> {
  const img = (await imageFrom(await getAsset('logo'), DEFAULT_LOGO))!;
  const s = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const [c, x] = canvas(Math.round(w * (1 + 2 * LOGO_PAD)), Math.round(h * (1 + 2 * LOGO_PAD)));
  x.drawImage(img, w * LOGO_PAD, h * LOGO_PAD, w, h);
  if (v.rmWhite) {
    // mesmo critério do app antigo: some o branco e suaviza a borda
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data, t = v.white;
    for (let i = 0; i < p.length; i += 4) {
      const m = Math.min(p[i], p[i + 1], p[i + 2]);
      if (m >= t) p[i + 3] = 0;
      else if (m >= t - 25) p[i + 3] = Math.round((p[i + 3] * (t - m)) / 25);
    }
    x.putImageData(d, 0, 0);
  }
  const [g, gx] = canvas(c.width, c.height);
  gx.filter = `blur(${Math.round(Math.max(w, h) * 0.06)}px)`;
  gx.drawImage(c, 0, 0);
  gx.drawImage(c, 0, 0); // duas passadas = halo mais denso
  return { image: c, glow: g, aspect: h / w };
}

async function prepareBg(v: Visual): Promise<Prepared | null> {
  const img = await imageFrom(await getAsset('bg'));
  if (!img) return null;
  const s = Math.min(1, 2560 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const [c, x] = canvas(w, h);
  if (v.bgBlur > 0) x.filter = `blur(${v.bgBlur * s}px)`;
  x.drawImage(img, 0, 0, w, h);
  return { image: c, aspect: h / w };
}

// ---------- cores da foto ----------
function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslHex(h: number, s: number, l: number) {
  const f = (n: number) => {
    const k = (n + h / 30) % 12, c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

/** Pixels RGBA → cor de destaque (a mais viva que aparece bastante) e as duas cores do fundo. */
export function pickColors(px: ArrayLike<number>) {
  const bins = new Map<number, number[]>(); // 8 níveis por canal: soma r, g, b e contagem
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const k = ((px[i] >> 5) << 6) | ((px[i + 1] >> 5) << 3) | (px[i + 2] >> 5);
    const b = bins.get(k) ?? [0, 0, 0, 0];
    b[0] += px[i]; b[1] += px[i + 1]; b[2] += px[i + 2]; b[3]++;
    bins.set(k, b);
  }
  if (!bins.size) return null;
  const cols = [...bins.values()].map(([r, g, b, n]) => ({ hsl: toHsl(r / n, g / n, b / n), n }));
  const best = (score: (c: (typeof cols)[number]) => number) => cols.reduce((a, c) => (score(c) > score(a) ? c : a));
  // destaque: área × saturação² × "meio-tom"² — senão um fundo escuro enorme ganha de um detalhe vivo
  const [h, s] = best((c) => c.n * (c.hsl[1] * Math.min(c.hsl[2], 1 - c.hsl[2])) ** 2).hsl;
  const dom = best((c) => c.n).hsl;
  return {
    color: hslHex(h, s > 0.08 ? Math.max(s, 0.6) : s, 0.62), // brilho: viva e clara, para aparecer no escuro
    bgc1: hslHex(dom[0], dom[1] * 0.8, Math.min(dom[2], 0.08)),
    bgc2: hslHex(h, s * 0.9, 0.22),
  };
}

export async function bgColors() {
  const img = await imageFrom(await getAsset('bg'));
  if (!img) return null;
  const [, x] = canvas(48, 48);
  x.drawImage(img, 0, 0, 48, 48);
  return pickColors(x.getImageData(0, 0, 48, 48).data);
}

/** Reprocessa logo/fundo só quando o arquivo ou um ajuste que os afeta mudou. */
export function assetSync(r: { setLogo(p: Prepared): void; setBg(p: Prepared | null): void }) {
  let logoKey = '', bgKey = '';
  return async (v: Visual, force = false) => {
    const lk = `${v.rmWhite}|${v.white}`, bk = `${v.bgBlur}`;
    const doLogo = force || lk !== logoKey, doBg = force || bk !== bgKey;
    logoKey = lk; bgKey = bk;
    if (doLogo) r.setLogo(await prepareLogo(v));
    if (doBg) r.setBg(await prepareBg(v));
  };
}
