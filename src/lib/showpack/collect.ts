// Ponte com o app (DK-012): junta o estado real (localStorage + IndexedDB) e monta o Show Pack.
// Só roda no navegador; a lógica testável fica em export.ts. Sem músicas nesta versão (DEC-09 pendente).
import { invoke } from '@tauri-apps/api/core';
import { getAsset, listVideos, setAsset, type VideoInfo } from '../assets.ts';
import { loadBanks } from '../banks.ts';
import { loadRoteiros } from '../roteiro.ts';
import { loadScenes, loadVisual } from '../settings.ts';
import { load, SCHEMA, type Envelope } from '../store.ts';
import { buildShowPack, showPackFileName, type AssetIn } from './export.ts';
import type { ApplyDeps } from './import.ts';
import type { AssetKind } from './manifest.ts';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};

const env = (key: keyof typeof SCHEMA, data: unknown): Envelope => ({ v: SCHEMA[key], data });

async function assetIn(kind: AssetKind, refId: string, key: Parameters<typeof getAsset>[0]): Promise<AssetIn | null> {
  const b = await getAsset(key);
  if (!b) return null;
  const name = (b as File).name || `${refId}.${MIME_EXT[b.type] ?? 'bin'}`; // o app guarda o File original, que tem nome
  return { kind, refId, mime: b.type || `application/octet-stream`, name, bytes: new Uint8Array(await b.arrayBuffer()) };
}

export type CollectOpts = {
  name: string;
  appVersion: string;
  /** `midi.map` de src/control/midi.svelte.ts; omitir/null = não incluir midi.json. */
  midi?: Record<string, unknown> | null;
};

/** Lê tudo do app e monta o pacote. Lança Error em português se algo não validar. */
export async function collectShowPack(o: CollectOpts) {
  const assets: AssetIn[] = [];
  const logo = await assetIn('logo', 'logo', 'logo'), bg = await assetIn('bg', 'bg', 'bg');
  if (logo) assets.push(logo);
  if (bg) assets.push(bg);
  const videos: VideoInfo[] = [];
  for (const v of listVideos()) {
    const a = await assetIn('video', v.id, `video:${v.id}`);
    if (a) { assets.push(a); videos.push(v); } // vídeo na lista sem arquivo no IndexedDB fica de fora do pacote
  }
  const trans = load('doublek.trans', (r) => { if (![0, 1, 2, 4, 8].includes(r as number)) throw new Error('transição'); return r as number; }, () => 4);
  return buildShowPack({
    name: o.name, appVersion: o.appVersion,
    state: {
      visual: env('doublek.visual', loadVisual()), trans: env('doublek.trans', trans), videos: env('doublek.videos', videos),
      scenes: env('doublek.scenes', loadScenes()), banks: env('doublek.banks', loadBanks()), roteiros: env('doublek.roteiros', loadRoteiros()),
      midi: o.midi ? env('doublek.midi', o.midi) : null,
    },
    assets,
  });
}

/**
 * Dependências reais de applyShowPack. O backup é um .doublekshow do estado atual (com o MIDI atual) gravado pelo
 * comando Rust `save_backup` em app_data/backups (5 mais recentes). Músicas: `put_track` (id já definido, nunca
 * sobrescreve) e `remove_track`. `onBackup` recebe o caminho gravado, para a linha de status.
 */
export function importDeps(o: CollectOpts & { onBackup?(path: string): void }): ApplyDeps {
  return {
    backup: async () => {
      const name = `backup ${new Date().toISOString().slice(0, 19)}`;
      const { bytes } = await collectShowPack({ ...o, name });
      try {
        o.onBackup?.(await invoke<string>('save_backup', bytes, { headers: { 'x-name': showPackFileName(name) } }));
      } catch (e) { throw new Error(`não consegui fazer o backup do show atual (${e})`); }
    },
    addTrack: (id, bytes) => invoke<boolean>('put_track', bytes, { headers: { 'x-id': id } }),
    removeTrack: (id) => invoke('remove_track', { id }),
    getAsset: (k) => getAsset(k),
    setAsset: (k, v) => setAsset(k, v),
    listVideoIds: () => listVideos().map((v) => v.id),
    getText: (k) => localStorage.getItem(k),
    setText: (k, t) => (t == null ? localStorage.removeItem(k) : localStorage.setItem(k, t)),
    checkImage: async (bytes, mime, path) => {
      if (mime === 'image/svg+xml') return; // createImageBitmap não decodifica SVG no Chromium; o <img> do app valida depois
      try { (await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))).close(); }
      catch { throw new Error(`imagem inválida (${path})`); }
    },
  };
}

/** Salva pela caixa de download do WebView2, igual ao exportFile de Performance.svelte. */
export function downloadShowPack(bytes: Uint8Array, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  a.download = showPackFileName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
