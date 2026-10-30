// Importação do Show Pack (DK-013 / ADR 0001): duas fases.
//   1. inspectShowPack — pura (Node): ZIP → manifesto → assets (tamanho + sha256) → estado migrado e validado
//      → referências cruzadas. Devolve um Plan pronto ou o primeiro erro, em português. Nunca toca em storage.
//   2. applyShowPack — grava via `deps` injetadas (IndexedDB, localStorage, tracks) com backup antes e rollback
//      por operações inversas se qualquer passo falhar. Testável em Node com deps em Map.
import { LIMITS, fmtMB } from '../limits.ts';
import { validVideos, type VideoInfo } from '../assets.ts';
import { sanitizeRoteiro, uid, validRoteiros, type Roteiro } from '../roteiro.ts';
import { validScenes, validVisual, type Scene, type Visual } from '../settings.ts';
import { isObj, migrate, SCHEMA, type Envelope, type Key } from '../store.ts';
import { sha256 } from './export.ts';
import { FILES, validateManifest, type AssetEntry, type Manifest, type ValidateOpts } from './manifest.ts';
import { readZip } from './zip.ts';

export type MidiTarget = { id: string; label: string; min?: number; max?: number; step?: number };

/** Espelho de validMidiMap (src/control/midi.svelte.ts não roda no Node). Manter igual. */
export function validMidi(raw: unknown): Record<string, MidiTarget> {
  if (!isObj(raw)) throw new Error('midi: precisa ser objeto');
  const out: Record<string, MidiTarget> = {};
  for (const [k, t] of Object.entries(raw)) {
    if (!/^(cc|note):\d+:\d+$/.test(k) || !isObj(t) || typeof t.id !== 'string' || typeof t.label !== 'string') continue;
    const o: MidiTarget = { id: t.id, label: t.label };
    for (const f of ['min', 'max', 'step'] as const) if (typeof t[f] === 'number' && Number.isFinite(t[f])) o[f] = t[f] as number;
    out[k] = o;
  }
  return out;
}

export type PlanAsset = { entry: AssetEntry; bytes: Uint8Array };
export type Plan = {
  manifest: Manifest;
  visual: Visual; trans: number; videos: VideoInfo[]; scenes: Scene[]; roteiros: Roteiro[];
  midi: Record<string, MidiTarget> | null;
  assets: PlanAsset[];
  warnings: string[];
  /** Decisões da UI antes de aplicar (DK-014). */
  replaceLogoBg?: boolean; // modo 'new': trocar logo/foto atuais pelas do pacote
  applyMidi?: boolean;     // aplicar midi.json (padrão: não)
};
export type Inspection = { ok: true; plan: Plan } | { ok: false; error: string };

const TRANS = [0, 1, 2, 4, 8];
const dec = new TextDecoder();

function parseJson(path: string, data: Uint8Array): Record<string, unknown> {
  if (data.length > LIMITS.json) throw new Error(`${path} grande demais (${fmtMB(data.length)} MB; máximo ${fmtMB(LIMITS.json)} MB)`);
  let x: unknown;
  try { x = JSON.parse(dec.decode(data)); } catch { throw new Error(`${path}: JSON inválido`); }
  if (!isObj(x)) throw new Error(`${path}: precisa ser um objeto`);
  return x;
}

/** Migra e valida uma chave doublek.* vinda de um JSON do pacote. */
function state<T>(path: string, file: Record<string, unknown>, key: Key, validate: (raw: unknown) => T): T {
  const env = file[key];
  if (!isObj(env) || typeof env.v !== 'number' || !('data' in env)) throw new Error(`${path}: "${key}" ausente ou sem envelope { v, data }`);
  try { return validate(migrate(key, env as Envelope)); }
  catch (e) { throw new Error(`${path}: ${(e as Error).message}`); }
}

export async function inspectShowPack(bytes: Uint8Array, opts: ValidateOpts = {}): Promise<Inspection> {
  try {
    // 1–2. ZIP e manifesto (forma, versão, caminhos, limites, hashes declarados, refs internas)
    const files = new Map(readZip(bytes).map((e) => [e.path, e.data]));
    const mf = files.get(FILES.manifest);
    if (!mf) throw new Error('não é um Show Pack: manifest.json ausente');
    const r = validateManifest(parseJson(FILES.manifest, mf), opts);
    if (!r.ok) throw new Error(r.error);
    const manifest = r.manifest;

    // 3. assets: existem, tamanho real e hash real batem; nada em assets/ fora do manifesto
    const assets: PlanAsset[] = [];
    for (const entry of manifest.assets) {
      const data = files.get(FILES.assets + entry.path);
      if (!data) throw new Error(`asset ${entry.path}: falta no pacote`);
      if (data.length !== entry.bytes) throw new Error(`asset ${entry.path}: tamanho diferente do manifesto (${data.length} ≠ ${entry.bytes} bytes)`);
      if ((await sha256(data)) !== entry.sha256) throw new Error(`asset ${entry.path}: conteúdo não bate com o hash do manifesto`);
      assets.push({ entry, bytes: data });
    }
    const declared = new Set(manifest.assets.map((a) => FILES.assets + a.path));
    for (const p of files.keys()) if (p.startsWith(FILES.assets) && !declared.has(p)) throw new Error(`arquivo fora do manifesto: ${p}`);

    // 4. estado: cada chave migrada e validada pelos validadores do app
    const need = (p: string) => { const d = files.get(p); if (!d) throw new Error(`${p} ausente`); return parseJson(p, d); };
    const vj = need(FILES.visual), sj = need(FILES.scenes), rj = need(FILES.roteiros), mj = files.get(FILES.midi);
    const visual = state(FILES.visual, vj, 'doublek.visual', validVisual);
    const trans = state(FILES.visual, vj, 'doublek.trans', (x) => (TRANS.includes(x as number) ? (x as number) : 4));
    const videos = state(FILES.visual, vj, 'doublek.videos', validVideos);
    const scenes = state(FILES.scenes, sj, 'doublek.scenes', validScenes);
    const roteiros = state(FILES.roteiros, rj, 'doublek.roteiros', validRoteiros);
    const midi = mj ? state(FILES.midi, parseJson(FILES.midi, mj), 'doublek.midi', validMidi) : null;

    // 5. referências cruzadas (§5 da spec)
    const vids = new Set(manifest.assets.filter((a) => a.kind === 'video').map((a) => a.refId));
    const tracks = new Set(manifest.assets.filter((a) => a.kind === 'track').map((a) => a.refId));
    const warnings: string[] = [];
    for (const v of videos) if (!vids.has(v.id)) throw new Error(`vídeo "${v.name}" (${v.id}) está na lista mas não no pacote`);
    if (visual.bgVideo && !vids.has(visual.bgVideo)) throw new Error(`visual usa o vídeo ${visual.bgVideo}, que não está no pacote`);
    scenes.forEach((s, i) => { if (s?.look.bgVideo && !vids.has(s.look.bgVideo)) throw new Error(`cena ${i + 1} usa o vídeo ${s.look.bgVideo}, que não está no pacote`); });
    for (const r of roteiros) {
      for (const c of r.cues) if (c.kind === 'video' && c.video && !vids.has(c.video)) throw new Error(`roteiro "${r.name}" usa o vídeo ${c.video}, que não está no pacote`);
      if (r.track && !tracks.has(r.track)) {
        if (manifest.includeTracks) throw new Error(`roteiro "${r.name}" usa a música ${r.track}, que não está no pacote`);
        warnings.push(`roteiro "${r.name}": música "${r.trackName || r.track}" não veio no pacote; use "Trocar música"`);
      }
    }
    for (const id of vids) if (!videos.some((v) => v.id === id)) warnings.push(`vídeo ${id} está no pacote mas não na lista; será ignorado`);

    return { ok: true, plan: { manifest, visual, trans, videos, scenes, roteiros, midi, assets, warnings } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------- fase 2: aplicar ----------

export type AssetKey = 'logo' | 'bg' | `video:${string}`;
export type ApplyDeps = {
  /** Gera o backup do show atual (collectShowPack → saveBackup). Falha aqui aborta antes de qualquer escrita. */
  backup(): Promise<void>;
  getAsset(k: AssetKey): Promise<Blob | undefined>;
  setAsset(k: AssetKey, v: Blob | null): Promise<void>;
  listVideoIds(): string[];
  /** Texto cru da chave no localStorage (envelope), para desfazer. */
  getText(key: Key): string | null;
  setText(key: Key, text: string | null): void;
  addTrack?(id: string, bytes: Uint8Array): Promise<void>;
  removeTrack?(id: string): Promise<void>;
  /** Navegador: confere que a imagem decodifica (createImageBitmap). Em Node não existe e é pulado. */
  checkImage?(bytes: Uint8Array, mime: string, path: string): Promise<void>;
};
export type ApplyMode = 'replace' | 'new';
export type Report = { mode: ApplyMode; assets: number; videos: number; roteiros: number; idMap: Record<string, string>; warnings: string[] };

const envelopeText = (key: Key, data: unknown) => JSON.stringify({ v: SCHEMA[key], data } satisfies Envelope);
const file = (a: PlanAsset) => new File([a.bytes as BlobPart], a.entry.path, { type: a.entry.mime });

/** Aplica o plano. Ordem: imagens → backup → assets → chaves. Qualquer falha desfaz o que já foi escrito e relança. */
export async function applyShowPack(plan: Plan, mode: ApplyMode, deps: ApplyDeps): Promise<Report> {
  const tracks = plan.assets.filter((a) => a.entry.kind === 'track');
  if (tracks.length && !deps.addTrack) throw new Error('este app ainda não importa músicas do pacote');
  if (deps.checkImage) for (const a of plan.assets) if (a.entry.kind === 'logo' || a.entry.kind === 'bg') await deps.checkImage(a.bytes, a.entry.mime, a.entry.path);

  // ids: 'replace' mantém; 'new' renomeia vídeos, músicas e roteiros, reescrevendo as referências
  const idMap: Record<string, string> = {};
  if (mode === 'new') {
    for (const a of plan.assets) if (a.entry.kind === 'video') idMap[a.entry.refId] = uid();
    for (const a of plan.assets) if (a.entry.kind === 'track') idMap[a.entry.refId] = uid() + a.entry.refId.slice(a.entry.refId.lastIndexOf('.'));
  }
  const map = (id: string) => idMap[id] ?? id;
  const visual: Visual = { ...plan.visual, bgVideo: map(plan.visual.bgVideo) };
  const scenes: Scene[] = plan.scenes.map((s) => (s ? { ...s, look: { ...s.look, bgVideo: map(s.look.bgVideo) } } : null));
  const videos: VideoInfo[] = plan.videos.map((v) => ({ ...v, id: map(v.id) }));
  const roteiros: Roteiro[] = plan.roteiros.map((r) => {
    const o = { ...r, track: map(r.track), cues: r.cues.map((c) => ({ ...c, video: map(c.video ?? '') })) };
    return mode === 'new' ? sanitizeRoteiro(o, false)! : o; // 'new': ids novos de roteiro e cues
  });

  await deps.backup();

  const undo: (() => Promise<void> | void)[] = [];
  const putAsset = async (k: AssetKey, v: Blob | null) => {
    const prev = await deps.getAsset(k);
    await deps.setAsset(k, v);
    undo.push(() => deps.setAsset(k, prev ?? null));
  };
  const putText = (key: Key, data: unknown) => {
    const prev = deps.getText(key);
    deps.setText(key, envelopeText(key, data));
    undo.push(() => deps.setText(key, prev));
  };

  try {
    const logo = plan.assets.find((a) => a.entry.kind === 'logo'), bg = plan.assets.find((a) => a.entry.kind === 'bg');
    if (mode === 'replace') {
      for (const id of deps.listVideoIds()) if (!videos.some((v) => v.id === id)) await putAsset(`video:${id}`, null); // ficam no backup
      await putAsset('logo', logo ? file(logo) : null);
      await putAsset('bg', bg ? file(bg) : null);
    } else if (plan.replaceLogoBg) {
      if (logo) await putAsset('logo', file(logo));
      if (bg) await putAsset('bg', file(bg));
    }
    for (const a of plan.assets) if (a.entry.kind === 'video') await putAsset(`video:${map(a.entry.refId)}`, file(a));
    for (const a of tracks) {
      const id = map(a.entry.refId);
      await deps.addTrack!(id, a.bytes);
      undo.push(() => deps.removeTrack?.(id));
    }

    putText('doublek.visual', visual);
    putText('doublek.trans', plan.trans);
    putText('doublek.scenes', scenes);
    if (mode === 'replace') {
      putText('doublek.videos', videos);
      putText('doublek.roteiros', roteiros);
    } else {
      const curV = safeList('doublek.videos', deps.getText('doublek.videos'), validVideos);
      const curR = safeList('doublek.roteiros', deps.getText('doublek.roteiros'), validRoteiros);
      putText('doublek.videos', [...curV.filter((v) => !videos.some((n) => n.id === v.id)), ...videos]);
      putText('doublek.roteiros', [...curR, ...roteiros]);
    }
    if (plan.midi && plan.applyMidi) putText('doublek.midi', plan.midi);
  } catch (e) {
    for (const u of undo.reverse()) { try { await u(); } catch {} }
    throw new Error(`importação desfeita: ${(e as Error).message}`);
  }

  return { mode, assets: plan.assets.length, videos: videos.length, roteiros: roteiros.length, idMap, warnings: plan.warnings };
}

/** Lista atual de uma chave a partir do texto cru; inválida/ausente = vazia (o app faria o mesmo em load). */
function safeList<T>(key: Key, text: string | null, validate: (raw: unknown) => T[]): T[] {
  if (!text) return [];
  try { return validate(migrate(key, JSON.parse(text))); } catch { return []; }
}
