// Exportação do Show Pack (DK-012): estado + assets → manifest.json validado → ZIP (docs/SHOWPACK.md).
// Puro: nada de localStorage/IndexedDB aqui (isso é collect.ts). Roda no Node e no WebView2 (crypto.subtle).
import { ext, LIMITS, fmtMB } from '../limits.ts';
import { isObj, type Envelope } from '../store.ts';
import { FILES, validateManifest, type AssetKind, type Manifest, type ValidateOpts } from './manifest.ts';
import { writeZip, type ZipEntry } from './zip.ts';

/** Envelope `{ v, data }` de uma chave doublek.*, como está no localStorage (objeto ou o texto JSON). */
export type EnvelopeIn = Envelope | string;
/** `scenes` = banco ativo (compatibilidade); `banks` = todos os bancos (DK-041), opcional para quem só tem 8 cenas. */
export type StateIn = { visual: EnvelopeIn; trans: EnvelopeIn; videos: EnvelopeIn; scenes: EnvelopeIn; banks?: EnvelopeIn | null; roteiros: EnvelopeIn; midi?: EnvelopeIn | null };
export type AssetIn = { kind: AssetKind; refId: string; mime: string; name: string; bytes: Uint8Array };
export type ShowPackInput = { name: string; appVersion: string; state: StateIn; assets: AssetIn[] };
export type BuildOpts = ValidateOpts & { includeTracks?: boolean; createdAt?: Date };

export const EXTENSION = '.doublekshow';

/** Nome de arquivo para salvar: só [A-Za-z0-9._-], sem acento, até 60 caracteres, + .doublekshow. */
export function showPackFileName(name: string) {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return (base || 'show') + EXTENSION;
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Caminho do asset dentro de assets/: logo.png, bg.jpg, <idVideo>.mp4, <idTrack> (já tem extensão). */
export const assetPath = (a: Pick<AssetIn, 'kind' | 'refId' | 'name'>) => (a.kind === 'track' ? a.refId : `${a.refId}.${ext(a.name)}`);

function envelope(key: string, e: EnvelopeIn | null | undefined): Envelope {
  let x: unknown = e;
  if (typeof e === 'string') { try { x = JSON.parse(e); } catch { throw new Error(`${key}: JSON inválido`); } }
  if (!isObj(x) || typeof x.v !== 'number' || !('data' in x)) throw new Error(`${key}: esperado envelope { v, data }`);
  return { v: x.v, data: x.data };
}

function jsonFile(path: string, obj: unknown): ZipEntry {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  if (data.length > LIMITS.json) throw new Error(`${path} grande demais (${fmtMB(data.length)} MB; máximo ${fmtMB(LIMITS.json)} MB)`);
  return { path, data };
}

/** Monta o pacote. Lança Error (mensagem em português) se o manifesto não validar; nesse caso nada é gerado. */
export async function buildShowPack(input: ShowPackInput, opts: BuildOpts = {}): Promise<{ bytes: Uint8Array; manifest: Manifest }> {
  const includeTracks = opts.includeTracks ?? false, createdAt = opts.createdAt ?? new Date();

  const assets = await Promise.all(input.assets.map(async (a) => ({
    path: assetPath(a), kind: a.kind, bytes: a.bytes.length, sha256: await sha256(a.bytes), mime: a.mime, refId: a.refId,
  })));
  const r = validateManifest({
    schemaVersion: 1, appVersion: input.appVersion, createdAt: createdAt.toISOString(), name: input.name, includeTracks, assets,
  }, opts);
  if (!r.ok) throw new Error(r.error);
  const manifest = r.manifest;

  const s = input.state;
  const files: ZipEntry[] = [
    jsonFile(FILES.manifest, manifest),
    jsonFile(FILES.visual, { 'doublek.visual': envelope('visual', s.visual), 'doublek.trans': envelope('trans', s.trans), 'doublek.videos': envelope('videos', s.videos) }),
    jsonFile(FILES.scenes, { 'doublek.scenes': envelope('scenes', s.scenes) }),
    jsonFile(FILES.roteiros, { 'doublek.roteiros': envelope('roteiros', s.roteiros) }),
  ];
  if (s.banks) files.push(jsonFile(FILES.banks, { 'doublek.banks': envelope('banks', s.banks) }));
  if (s.midi) files.push(jsonFile(FILES.midi, { 'doublek.midi': envelope('midi', s.midi) }));
  for (const [i, a] of manifest.assets.entries()) files.push({ path: FILES.assets + a.path, data: input.assets[i].bytes });

  return { bytes: writeZip(files, createdAt), manifest };
}
