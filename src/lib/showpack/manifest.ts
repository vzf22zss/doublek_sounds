// Show Pack (.doublekshow) — contrato do manifesto (DK-011 / ADR 0001). Especificação: docs/SHOWPACK.md.
// Só tipos e funções puras: sem ZIP, sem fs, sem navegador. Roda no Node (npm run check) e no app.
// Ordem de validação (igual à spec): forma → versão → caminhos → tamanhos/limites → hashes → referências.
import { checkFile, fmtMB, LIMITS, type Kind } from '../limits.ts';
import { bool, isObj, num, str } from '../store.ts';

export const SCHEMA_VERSION = 1;
export const MAX_ASSETS = 50;
export const MAX_TOTAL_BYTES = 2 * 1024 ** 3; // 2 GiB descomprimido (DEC-03)
export const MAX_NAME = 120;

/** Arquivos dentro do ZIP. */
export const FILES = { manifest: 'manifest.json', visual: 'visual.json', scenes: 'scenes.json', banks: 'banks.json', roteiros: 'roteiros.json', midi: 'midi.json', assets: 'assets/' } as const;

export type AssetKind = 'logo' | 'bg' | 'video' | 'track';
export const ASSET_KINDS: readonly AssetKind[] = ['logo', 'bg', 'video', 'track'];
/** Teto e extensões de cada tipo de asset vêm de limits.ts (DK-005): mesmo limite dentro e fora do pacote. */
export const KIND_LIMIT: Record<AssetKind, Kind> = { logo: 'image', bg: 'image', video: 'video', track: 'audio' };

export type AssetEntry = {
  path: string;    // nome do arquivo dentro de assets/ (ver safeAssetPath)
  kind: AssetKind;
  bytes: number;   // tamanho descomprimido, inteiro > 0
  sha256: string;  // 64 hex minúsculos
  mime: string;    // tipo real do conteúdo
  refId: string;   // 'logo' | 'bg' | id em doublek.videos | Roteiro.track
};

export type Manifest = {
  schemaVersion: typeof SCHEMA_VERSION;
  appVersion: string;
  createdAt: string; // ISO 8601 com fuso
  name: string;
  includeTracks: boolean; // música dos roteiros é opt-in (DEC-09)
  assets: AssetEntry[];
};

export type ValidateOpts = { maxAssets?: number; maxTotalBytes?: number };
export type ValidateResult = { ok: true; manifest: Manifest } | { ok: false; error: string };

const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,254}$/;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i; // nomes de dispositivo do Windows
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;                             // compatível com track::check_id (Rust)
const SHA_RE = /^[0-9a-f]{64}$/;
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Caminho de asset seguro ou null. Relativo a assets/, um nome só (sem pasta), sem `..`, sem `/` ou `\`,
 * sem espaço, só [A-Za-z0-9._-], não começa com ponto, até 255 caracteres, sem nome reservado do Windows.
 */
export function safeAssetPath(p: string): string | null {
  if (typeof p !== 'string' || !PATH_RE.test(p) || p.includes('..') || RESERVED_RE.test(p)) return null;
  return p;
}

const fail = (error: string): ValidateResult => ({ ok: false, error });
const at = (i: number, a: Record<string, unknown>) => `asset ${i + 1}${typeof a.path === 'string' ? ` (${a.path})` : ''}`;

/** Valida e normaliza o manifesto (mantém só os campos conhecidos). Nunca lança: erro vira mensagem em português. */
export function validateManifest(x: unknown, opts: ValidateOpts = {}): ValidateResult {
  const maxAssets = opts.maxAssets ?? MAX_ASSETS, maxTotal = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;

  // 1. forma
  if (!isObj(x)) return fail('manifesto inválido: precisa ser um objeto JSON');
  const name = str(x.name, '').trim(), appVersion = str(x.appVersion, '').trim(), createdAt = str(x.createdAt, '');
  if (!name || name.length > MAX_NAME) return fail(`manifesto inválido: "name" precisa ser texto de 1 a ${MAX_NAME} caracteres`);
  if (!appVersion || appVersion.length > 40) return fail('manifesto inválido: "appVersion" ausente');
  if (!ISO_RE.test(createdAt) || Number.isNaN(Date.parse(createdAt))) return fail('manifesto inválido: "createdAt" precisa ser data ISO 8601 com fuso (ex.: 2026-10-30T12:00:00Z)');
  if (typeof x.includeTracks !== 'boolean') return fail('manifesto inválido: "includeTracks" precisa ser true ou false');
  if (!Array.isArray(x.assets)) return fail('manifesto inválido: "assets" precisa ser uma lista');
  const includeTracks = bool(x.includeTracks, false);
  const raw = x.assets as unknown[];
  for (let i = 0; i < raw.length; i++) if (!isObj(raw[i])) return fail(`asset ${i + 1}: precisa ser um objeto`);
  const list = raw as Record<string, unknown>[];

  // 2. versão — futura é recusada sem tocar em nada
  const v = num(x.schemaVersion, NaN);
  if (!Number.isInteger(v) || v < 1) return fail('manifesto inválido: "schemaVersion" ausente ou inválida');
  if (v > SCHEMA_VERSION) return fail(`pacote de uma versão mais nova do DoubleK (schema ${v}; este app lê até ${SCHEMA_VERSION}). Atualize o app.`);

  // 3. caminhos
  const seen = new Set<string>();
  for (const [i, a] of list.entries()) {
    const p = safeAssetPath(a.path as string);
    if (!p) return fail(`${at(i, a)}: caminho inválido (use só letras, números, ".", "_" e "-", sem pastas, sem espaço)`);
    if (seen.has(p)) return fail(`${at(i, a)}: caminho repetido`);
    seen.add(p);
  }

  // 4. tamanhos e limites
  if (list.length > maxAssets) return fail(`pacote com ${list.length} assets; máximo ${maxAssets}`);
  let total = 0;
  for (const [i, a] of list.entries()) {
    const kind = a.kind as AssetKind;
    if (!ASSET_KINDS.includes(kind)) return fail(`${at(i, a)}: tipo desconhecido (${String(a.kind)}); use ${ASSET_KINDS.join(', ')}`);
    const bytes = num(a.bytes, NaN);
    if (!Number.isInteger(bytes) || bytes <= 0) return fail(`${at(i, a)}: "bytes" precisa ser inteiro maior que zero`);
    const mime = str(a.mime, '');
    if (!MIME_RE.test(mime) || mime === 'application/octet-stream') return fail(`${at(i, a)}: "mime" ausente ou inválido`);
    const err = checkFile(KIND_LIMIT[kind], { name: a.path as string, size: bytes, type: mime }); // extensão, teto e mime do tipo
    if (err) return fail(`${at(i, a)}: ${err}`);
    if (kind === 'track' && !includeTracks) return fail(`${at(i, a)}: música no pacote, mas "includeTracks" é false`);
    total += bytes;
    if (total > maxTotal) return fail(`pacote grande demais (${fmtMB(total)} MB descomprimidos; máximo ${fmtMB(maxTotal)} MB)`);
  }

  // 5. hashes
  for (const [i, a] of list.entries()) {
    const h = str(a.sha256, '').toLowerCase();
    if (!SHA_RE.test(h)) return fail(`${at(i, a)}: "sha256" precisa ter 64 caracteres hexadecimais`);
  }

  // 6. referências — só as internas ao manifesto; as cruzadas (visual/roteiros → assets) são do importador
  const refs = new Set<string>();
  for (const [i, a] of list.entries()) {
    const kind = a.kind as AssetKind, refId = str(a.refId, '');
    if (!ID_RE.test(refId)) return fail(`${at(i, a)}: "refId" ausente ou inválido`);
    if ((kind === 'logo' || kind === 'bg') && refId !== kind) return fail(`${at(i, a)}: "refId" de ${kind} precisa ser "${kind}"`);
    const key = kind + ':' + refId;
    if (refs.has(key)) return fail(`${at(i, a)}: "refId" repetido para o tipo ${kind} (${refId})`);
    refs.add(key);
  }

  const assets: AssetEntry[] = list.map((a) => ({
    path: a.path as string, kind: a.kind as AssetKind, bytes: a.bytes as number,
    sha256: (a.sha256 as string).toLowerCase(), mime: a.mime as string, refId: a.refId as string,
  }));
  return { ok: true, manifest: { schemaVersion: SCHEMA_VERSION, appVersion, createdAt, name, includeTracks, assets } };
}

/** Teto por tipo de asset, para a UI e para o exportador. */
export const assetLimit = (kind: AssetKind) => LIMITS[KIND_LIMIT[kind]];
