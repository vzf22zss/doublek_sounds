// Efeitos da comunidade (DK-121): formato `.doublekfx` e regras puras (manifesto, GLSL, pacote, saúde do efeito).
// Especificação: docs/SHADERS.md. O autor escreve só o corpo do shader; o app põe na frente o cabeçalho com o
// contrato fixo (abaixo). Validação estática, sem sandbox: GLSL de terceiros ainda pode travar o driver — por isso
// o editor compila num contexto WebGL próprio e desabilita o efeito depois de falhas repetidas.
import { readZip, writeZip } from '../showpack/zip.ts';
import { isObj } from '../store.ts';
import { SOURCES, type Source } from '../settings.ts';

export const FX_FORMAT = 'doublek-fx';
export const FX_VERSION = 1;
export const FX_EXT = '.doublekfx';
export const FX_ENTRY = 'effect.frag';
export const MAX_CODE_BYTES = 32 * 1024;
export const MAX_PACK_BYTES = 64 * 1024;
export const MAX_PARAMS = 8;
export const MAX_LOOP = 256;

/** O que o shader recebe e devolve. Entra antes do código do autor; os erros são remapeados para as linhas dele. */
export const FX_HEADER = `#version 300 es
precision highp float;
uniform sampler2D uInput;
uniform vec2 uRes;
uniform float uTime, uBeat, uPhase, uKick, uLow;
uniform float uBands[5];
uniform float uP[8];
in vec2 vUv;
out vec4 o;
`;
export const HEADER_LINES = FX_HEADER.split('\n').length - 1;

export type FxParam = { key: string; label: string; min: number; max: number; default: number; step: number; mod?: Source };
export type FxManifest = { format: typeof FX_FORMAT; v: number; id: string; name: string; author?: string; version: string; entry: typeof FX_ENTRY; params: FxParam[] };

const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Manifesto → normalizado, ou lança com a mensagem em português. */
export function validateFxManifest(raw: unknown): FxManifest {
  if (!isObj(raw)) throw new Error('manifesto do efeito inválido: precisa ser um objeto JSON');
  if (raw.format !== FX_FORMAT) throw new Error('não é um efeito do DoubleK (format ≠ "doublek-fx")');
  if (raw.v !== FX_VERSION) throw new Error(typeof raw.v === 'number' && raw.v > FX_VERSION ? `efeito de uma versão mais nova do DoubleK (v${raw.v}); atualize o app` : 'versão de efeito desconhecida');
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(raw.id)) throw new Error('id do efeito inválido (3 a 40 letras minúsculas, números e hífen)');
  const name = str(raw.name, 60);
  if (!name) throw new Error('efeito sem nome');
  const version = str(raw.version, 20);
  if (!/^[0-9A-Za-z.+-]{1,20}$/.test(version)) throw new Error('"version" do efeito inválida (ex.: 1.0.0)');
  if (raw.entry !== FX_ENTRY) throw new Error(`"entry" precisa ser "${FX_ENTRY}"`);
  const ps = raw.params ?? [];
  if (!Array.isArray(ps)) throw new Error('"params" precisa ser uma lista');
  if (ps.length > MAX_PARAMS) throw new Error(`no máximo ${MAX_PARAMS} parâmetros (veio ${ps.length})`);
  const keys = new Set<string>();
  const params = ps.map((p, i): FxParam => {
    const at = `parâmetro ${i + 1}`;
    if (!isObj(p)) throw new Error(`${at}: precisa ser um objeto`);
    if (typeof p.key !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(p.key)) throw new Error(`${at}: "key" inválida`);
    if (keys.has(p.key)) throw new Error(`${at}: "key" repetida (${p.key})`);
    keys.add(p.key);
    if (!fin(p.min) || !fin(p.max) || !(p.min < p.max)) throw new Error(`${at} (${p.key}): faixa inválida (min < max)`);
    if (!fin(p.default) || p.default < p.min || p.default > p.max) throw new Error(`${at} (${p.key}): "default" fora da faixa`);
    const step = p.step === undefined ? (p.max - p.min) / 100 : p.step;
    if (!fin(step) || step <= 0 || step > p.max - p.min) throw new Error(`${at} (${p.key}): "step" inválido`);
    if (p.mod !== undefined && !(typeof p.mod === 'string' && p.mod in SOURCES)) throw new Error(`${at} (${p.key}): fonte de modulação desconhecida (${String(p.mod)})`);
    return { key: p.key, label: str(p.label, 24) || p.key, min: p.min, max: p.max, default: p.default, step, ...(p.mod ? { mod: p.mod as Source } : {}) };
  });
  const author = str(raw.author, 60);
  return { format: FX_FORMAT, v: FX_VERSION, id: raw.id, name, ...(author ? { author } : {}), version, entry: FX_ENTRY, params };
}

/**
 * Regras estáticas do GLSL do autor (o corpo, sem o cabeçalho). Lança com a primeira violação.
 * ponytail: são regex sobre o texto, não um parser de GLSL — pegam o óbvio (laço sem teto, extensão, uniform
 * extra); um laço disfarçado (ex.: limite vindo de uma função) passa e fica com o teto do driver/contexto próprio.
 */
export function validateShader(code: string) {
  const bytes = new TextEncoder().encode(code).length;
  if (bytes > MAX_CODE_BYTES) throw new Error(`shader grande demais (${(bytes / 1024).toFixed(1)} KB; máximo ${MAX_CODE_BYTES / 1024} KB)`);
  const bad = code.search(/[^\t\n\r\x20-\x7e]/);
  if (bad >= 0) throw new Error(`shader com caractere fora do ASCII na linha ${lineOf(code, bad)}`);
  const s = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, ''); // sem comentários, linhas no lugar
  const rule = (re: RegExp, msg: string) => { const m = re.exec(s); if (m) throw new Error(`${msg} (linha ${lineOf(s, m.index)})`); };
  rule(/#\s*version\b/, 'não escreva #version: o app põe "#version 300 es" e o contrato na frente');
  rule(/#\s*extension\b/, '#extension não é permitido');
  rule(/#\s*include\b/, '#include não é permitido');
  rule(/\buniform\b/, 'uniform fora do contrato: use uInput, uRes, uTime, uBeat, uPhase, uKick, uLow, uBands[5] e uP[8], que já vêm declarados');
  rule(/\bwhile\b/, 'laço while não é permitido: use for com limite constante');
  rule(/\bdo\s*\{/, 'laço do/while não é permitido: use for com limite constante');
  for (const m of s.matchAll(/\bfor\s*\(([^;]*);([^;]*);/g)) {
    const lim = /^\s*\w+\s*(<=?)\s*(\d+)\s*$/.exec(m[2]);
    const n = lim ? +lim[2] + (lim[1] === '<=' ? 1 : 0) : NaN;
    if (!(n <= MAX_LOOP)) throw new Error(`laço sem limite constante ≤ ${MAX_LOOP} (linha ${lineOf(s, m.index)}): use algo como "for (int i = 0; i < 64; i++)"`);
  }
  if (!/\bvoid\s+main\s*\(\s*\)/.test(s)) throw new Error('o shader precisa de "void main()" que escreve em "o"');
}

const lineOf = (s: string, i: number) => s.slice(0, i).split('\n').length;

/** Código final que vai para o WebGL: cabeçalho + corpo do autor. */
export const fullSource = (code: string) => FX_HEADER + code;

/** Log de erro do compilador → linhas do autor ("ERROR: 0:12: …" vira "linha 3: …"). */
export function mapErrors(log: string): { line: number | null; message: string }[] {
  return log.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(l);
    if (!m) return { line: null, message: l };
    const line = +m[1] - HEADER_LINES;
    return { line: line >= 1 ? line : null, message: m[2] };
  });
}

// ---------- pacote .doublekfx ----------

export type FxPack = { manifest: FxManifest; code: string };

export function readFxPack(bytes: Uint8Array): FxPack {
  if (bytes.length > MAX_PACK_BYTES) throw new Error(`pacote de efeito grande demais (máximo ${MAX_PACK_BYTES / 1024} KB)`);
  const files = new Map(readZip(bytes).map((e) => [e.path, e.data]));
  const mf = files.get('manifest.json'), fx = files.get(FX_ENTRY);
  if (!mf) throw new Error('pacote sem manifest.json');
  if (!fx) throw new Error(`pacote sem ${FX_ENTRY}`);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(mf)); } catch { throw new Error('manifest.json não é JSON'); }
  const manifest = validateFxManifest(raw);
  let code: string;
  try { code = new TextDecoder('utf-8', { fatal: true }).decode(fx); } catch { throw new Error(`${FX_ENTRY} não é texto`); }
  validateShader(code);
  return { manifest, code };
}

export function writeFxPack(p: FxPack): Uint8Array {
  const manifest = validateFxManifest(p.manifest);
  validateShader(p.code);
  const enc = new TextEncoder();
  return writeZip([{ path: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 1)) }, { path: FX_ENTRY, data: enc.encode(p.code) }]);
}

// ---------- saúde do efeito (o editor compila num contexto próprio; isto decide quando parar de tentar) ----------

export type FxStatus = 'ok' | 'suspeito' | 'desabilitado';
export type FxHealth = { status: FxStatus; fails: number };
export const HEALTHY: FxHealth = { status: 'ok', fails: 0 };
export const MAX_FAILS = 3;
/**
 * lost = contexto WebGL perdido; slow = 1ª renderização (ou link) > 2 s → suspeito, sem recompilar sozinho;
 * 3 falhas → desabilitado até o usuário reativar. retry = o usuário pediu para tentar de novo um suspeito.
 */
export function nextHealth(h: FxHealth, e: 'lost' | 'slow' | 'ok' | 'retry' | 'reactivate'): FxHealth {
  if (e === 'reactivate') return HEALTHY;
  if (h.status === 'desabilitado') return h;
  if (e === 'lost' || e === 'slow') { const fails = h.fails + 1; return { status: fails >= MAX_FAILS ? 'desabilitado' : 'suspeito', fails }; }
  if (e === 'retry') return h.status === 'suspeito' ? { ...h, status: 'ok' } : h;
  return h; // ok: renderizou bem; não zera as falhas (só reativar zera)
}

/** Quando compilar: 500 ms depois da última edição e pelo menos 500 ms depois da última compilação (≤ 2/s). */
export const compileAt = (lastEdit: number, lastCompile: number) => Math.max(lastEdit + 500, lastCompile + 500);

/** Lista guardada em `doublek.fx` (o código fica no IndexedDB, chave `fx:<id>`). */
export type FxEntry = { manifest: FxManifest; values: number[]; health: FxHealth };
export function validFxList(raw: unknown): FxEntry[] {
  if (!Array.isArray(raw)) throw new Error('efeitos: precisa ser lista');
  const out: FxEntry[] = [], ids = new Set<string>();
  for (const x of raw) {
    if (!isObj(x)) continue;
    let manifest: FxManifest;
    try { manifest = validateFxManifest(x.manifest); } catch { continue; }
    if (ids.has(manifest.id)) continue;
    ids.add(manifest.id);
    const vs = Array.isArray(x.values) ? x.values : [];
    const values = manifest.params.map((p, i) => (fin(vs[i]) ? Math.min(p.max, Math.max(p.min, vs[i])) : p.default));
    const h = isObj(x.health) ? x.health : {};
    const status: FxStatus = h.status === 'suspeito' || h.status === 'desabilitado' ? h.status : 'ok';
    out.push({ manifest, values, health: { status, fails: fin(h.fails) ? Math.max(0, Math.floor(h.fails)) : 0 } });
  }
  return out;
}
