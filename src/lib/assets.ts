// Logo e foto de fundo ficam no IndexedDB (as duas janelas têm a mesma origem, então compartilham).
// O processamento pesado (tirar o branco, borrar o glow, borrar o fundo) roda uma vez por troca, não por quadro.
import type { Visual } from './settings';
import { load, save } from './store.ts';
import { barDelayMs, loopWindow, toRelease, videoInfo, wrapTarget, type VideoInfo } from './videoloop.ts';

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

type Key = 'logo' | 'bg' | `video:${string}`;

export async function getAsset(k: Key): Promise<Blob | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function setAsset(k: Key, v: Blob | null) {
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
  const vivid = (c: (typeof cols)[number]) => c.n * (c.hsl[1] * Math.min(c.hsl[2], 1 - c.hsl[2])) ** 2;
  const [h, s] = best(vivid).hsl;
  // segunda cor: a mais viva com matiz bem diferente (logo lima e roxa → fundo roxo); senão, a própria
  const far = (c: (typeof cols)[number]) => Math.min(Math.abs(c.hsl[0] - h), 360 - Math.abs(c.hsl[0] - h)) > 40 && c.hsl[1] > 0.15;
  const [h2, s2] = cols.some(far) ? best((c) => (far(c) ? vivid(c) : -1)).hsl : [h, s];
  return {
    color: hslHex(h, s > 0.08 ? Math.max(s, 0.6) : s, 0.62), // brilho: viva e clara, para aparecer no escuro
    bgc1: hslHex(h2, s2 * 0.8, 0.05),
    bgc2: hslHex(h2, s2 * 0.9, 0.22),
  };
}

export async function imageColors(kind: 'logo' | 'bg') {
  const img = await imageFrom(await getAsset(kind), kind === 'logo' ? DEFAULT_LOGO : undefined);
  if (!img) return null;
  const [, x] = canvas(48, 48);
  x.drawImage(img, 0, 0, 48, 48);
  return pickColors(x.getImageData(0, 0, 48, 48).data);
}

// ---------- vídeos de fundo ----------
// O arquivo fica no IndexedDB ("video:<id>"); a lista (id, nome e, desde DK-062, início/fim do loop e "reiniciar
// no compasso") no localStorage, que as duas janelas leem. Regras puras em videoloop.ts.
export type { VideoInfo } from './videoloop.ts';

export function validVideos(raw: unknown): VideoInfo[] {
  if (!Array.isArray(raw)) throw new Error('vídeos: precisa ser lista');
  return raw.map(videoInfo).filter((x): x is VideoInfo => !!x);
}

/** Muda início/fim do loop ou "reiniciar no compasso" de um vídeo da biblioteca. */
export function updateVideo(id: string, patch: Partial<Pick<VideoInfo, 'start' | 'end' | 'barRestart'>>) {
  save('doublek.videos', listVideos().map((x) => (x.id === id ? videoInfo({ ...x, ...patch }) ?? x : x)));
}

const PLAY_HINT = 'converta para MP4 H.264 ou WebM VP9';
const MIME_BY_EXT: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

/** Na importação: abre o arquivo de verdade e espera o 1º quadro. Devolve a mensagem de recusa, ou null se toca.
 *  Não basta o `canPlayType`: ele diz "não" para .mov que tem H.264 dentro (e toca) e "talvez" para MP4 com HEVC
 *  (que não toca neste Windows). Quando recusa, a mensagem diz o que o `canPlayType` achou. */
export async function probeVideo(f: File, timeoutMs = 8000): Promise<string | null> {
  const type = f.type || MIME_BY_EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || '';
  const el = Object.assign(document.createElement('video'), { muted: true, preload: 'auto' });
  const url = URL.createObjectURL(f);
  try {
    const ok = await new Promise<boolean>((res) => {
      el.onloadeddata = () => res(el.videoWidth > 0);
      el.onerror = () => res(false);
      setTimeout(() => res(false), timeoutMs);
      el.src = url;
    });
    if (ok) return null;
    const can = type ? el.canPlayType(type) : '';
    return `"${f.name}" não toca neste Windows${can ? '' : ` (formato ${type || 'desconhecido'} sem suporte)`}: ${PLAY_HINT}.`;
  } finally {
    el.removeAttribute('src');
    el.load();
    URL.revokeObjectURL(url);
  }
}

export function listVideos(): VideoInfo[] {
  return load('doublek.videos', validVideos, () => []);
}

export async function addVideo(f: File) {
  const id = Math.random().toString(36).slice(2, 10);
  await setAsset(`video:${id}`, f);
  save('doublek.videos', [...listVideos(), { id, name: f.name.replace(/\.[^.]+$/, '') }]);
  return id;
}

export async function removeVideo(id: string) {
  await setAsset(`video:${id}`, null);
  save('doublek.videos', listVideos().filter((x) => x.id !== id));
}

// Um <video> por id, mas no máximo 2 vivos por janela (DK-062): o que está na tela (`curId`) e o próximo
// pré-carregado (`preId`). Os outros são pausados e soltam o arquivo (src + URL), para não decodificar à toa.
type Entry = { p: Promise<HTMLVideoElement | null>; url: string };
const pool = new Map<string, Entry>();
let curId = '', preId = '';

function drop(id: string) {
  const e = pool.get(id);
  if (!e) return;
  pool.delete(id);
  e.p.then((el) => { if (el) { el.pause(); el.removeAttribute('src'); el.load(); } });
  if (e.url) URL.revokeObjectURL(e.url);
}
const trim = () => toRelease(curId, preId, pool.keys()).forEach(drop);

/** Ids com <video> carregado nesta janela (diagnóstico e testes). */
export const loadedVideos = () => [...pool.keys()];

export function getVideo(id: string): Promise<HTMLVideoElement | null> {
  const hit = pool.get(id);
  if (hit) return hit.p;
  const entry: Entry = { p: Promise.resolve(null), url: '' };
  pool.set(id, entry);
  entry.p = getAsset(`video:${id}`).then((b) => {
    if (!b || pool.get(id) !== entry) return null;
    entry.url = URL.createObjectURL(b);
    const el = Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true, preload: 'auto', src: entry.url });
    return new Promise<HTMLVideoElement | null>((res) => {
      el.onloadeddata = () => res(el);
      el.onerror = () => { drop(id); res(null); };
    });
  });
  return entry.p;
}

/** O próximo vídeo (do roteiro) fica carregado e parado, para a troca ser instantânea. '' = nenhum. */
export function preloadVideo(id: string) {
  preId = id === curId ? '' : id;
  if (preId) getVideo(preId);
  trim();
}

type BeatLike = { bpm: number; locked: boolean; holding?: boolean; beat: number; beatPhase: number };

/** Vigia o vídeo na tela: janela de loop, "reiniciar no compasso" e travamento. Devolve a função que para. */
function watchVideo(el: HTMLVideoElement, info: VideoInfo, o: { restart: boolean; beat?: () => BeatLike | null; fail: (why: string) => void }) {
  let alive = true, last = Date.now();
  const win = () => loopWindow(info, el.duration);
  el.loop = win().native; // arquivo inteiro: o loop do próprio <video>; janela: a gente volta ao início
  const seek = (t: number) => { el.currentTime = t; };
  const onTime = () => { last = Date.now(); };
  const onEnded = () => { seek(win().start); el.play().catch(() => {}); };
  const onError = () => alive && o.fail('deu erro ao tocar');
  el.addEventListener('timeupdate', onTime);
  el.addEventListener('ended', onEnded);
  el.addEventListener('error', onError);
  const frame = (_: number, m: VideoFrameCallbackMetadata) => {
    if (!alive) return;
    last = Date.now();
    const to = wrapTarget(m.mediaTime, win());
    if (to !== null) seek(to);
    el.requestVideoFrameCallback(frame);
  };
  el.requestVideoFrameCallback(frame);
  const to = wrapTarget(el.currentTime, win()); // entrou na tela parado fora da janela
  if (to !== null) seek(to);
  const restart = o.restart && info.barRestart ? setTimeout(() => alive && seek(win().start), barDelayMs(o.beat?.() ?? null)) : 0;
  // sem quadro nem timeupdate por 2 s com a janela visível = travou
  const stall = setInterval(() => { if (alive && !document.hidden && Date.now() - last > 2000) o.fail('travou (2 s sem avançar)'); }, 500);
  return () => {
    alive = false;
    clearTimeout(restart);
    clearInterval(stall);
    el.removeEventListener('timeupdate', onTime);
    el.removeEventListener('ended', onEnded);
    el.removeEventListener('error', onError);
  };
}

export async function videoColors(id: string) {
  const el = await getVideo(id);
  if (!el) return null;
  const [, x] = canvas(48, 48);
  x.drawImage(el, 0, 0, 48, 48);
  return pickColors(x.getImageData(0, 0, 48, 48).data);
}

export type SyncOpts = {
  /** Último frame do motor (BPM/fase), para "reiniciar no compasso". Sem ele, reinicia na hora. */
  beat?: () => BeatLike | null;
  /** Vídeo falhou e o fundo voltou para a foto/cor: mensagem pronta para o diário. */
  onVideoFail?: (msg: string) => void;
};

/** Reprocessa logo/fundo só quando o arquivo ou um ajuste que os afeta mudou; troca o vídeo do fundo.
 *  Se o vídeo não abre, dá erro ou trava, o fundo volta sozinho para a foto/cor (nunca tela preta por vídeo)
 *  e só tenta de novo quando escolherem outro vídeo. */
export function assetSync(r: { setLogo(p: Prepared): void; setBg(p: Prepared | null): void; setBgVideo(el: HTMLVideoElement | null): void }, o: SyncOpts = {}) {
  let logoKey = '', bgKey = '', vid = '', cur: HTMLVideoElement | null = null, failed = '', token = 0;
  let unwatch = () => {};
  const fallback = (id: string, why: string) => {
    if (vid !== id || failed === id) return;
    failed = id;
    unwatch(); unwatch = () => {};
    cur?.pause(); cur = null;
    curId = ''; trim();
    r.setBgVideo(null);
    const name = listVideos().find((x) => x.id === id)?.name ?? id;
    o.onVideoFail?.(`Vídeo de fundo "${name}" ${why}: o telão voltou para a foto/cor.`);
  };
  return async (v: Visual, force = false) => {
    const lk = `${v.rmWhite}|${v.white}`, bk = `${v.bgBlur}`;
    const doLogo = force || lk !== logoKey, doBg = force || bk !== bgKey;
    logoKey = lk; bgKey = bk;
    if (doLogo) r.setLogo(await prepareLogo(v));
    if (doBg) r.setBg(await prepareBg(v));
    if (force || v.bgVideo !== vid) {
      const changed = v.bgVideo !== vid, my = ++token;
      vid = v.bgVideo;
      if (changed) failed = '';
      unwatch(); unwatch = () => {};
      const id = vid && vid !== failed ? vid : '';
      curId = id;
      if (preId === id) preId = ''; // o pré-carregado virou o da tela
      const el = id ? await getVideo(id) : null;
      if (my !== token) return; // outra troca chegou enquanto este carregava
      if (cur && cur !== el) cur.pause();
      cur = el;
      trim();
      r.setBgVideo(el);
      if (id && !el) return fallback(id, 'não abriu');
      if (el) {
        const info = listVideos().find((x) => x.id === id) ?? { id, name: id };
        unwatch = watchVideo(el, info, { restart: changed, beat: o.beat, fail: (why) => fallback(id, why) });
        el.play().catch(() => {});
      }
    }
    if (cur) cur.playbackRate = v.videoSpeed;
  };
}
