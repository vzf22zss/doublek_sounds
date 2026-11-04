// Armazenamento local com versão de schema (DK-002 / ADR 0001).
// Todas as chaves `doublek.*` passam por aqui: um envelope { v, data } por chave, migrações numeradas
// e um validador por tipo. Dado inválido vira o padrão (e o valor bruto fica guardado em `.bak`),
// nunca um crash. Sem versão (dado da v0.3.1 ou anterior) = v0.
//
// Sem dependência do navegador: o `storage` pode ser trocado por um Map nos testes (node).

export type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

let storage: Storage = typeof localStorage !== 'undefined' ? localStorage : new Map<string, string>() as any;
if (storage instanceof Map) {
  const m = storage as unknown as Map<string, string>;
  storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
/** Testes: troca o armazenamento. */
export const useStorage = (s: Storage) => (storage = s);

/** Versão atual de cada chave. Subir o número = acrescentar uma migração em MIGRATIONS. */
export const SCHEMA = {
  'doublek.settings': 1,
  'doublek.visual': 1,
  'doublek.scenes': 1,
  'doublek.trans': 1,
  'doublek.midi': 1,
  'doublek.videos': 1,
  'doublek.roteiros': 1,
  'doublek.banks': 1, // DK-041: até 4 bancos de 8 cenas; doublek.scenes segue = banco ativo
  'doublek.automation': 1, // DK-035: mapa de automação (show-engine/config.ts)
  'doublek.presets': 1, // DK-132: presets importados (lib/presets.ts)
  'doublek.fx': 1, // DK-122: efeitos da comunidade instalados (código no IndexedDB, chave fx:<id>)
} as const;
export type Key = keyof typeof SCHEMA;

type Migration = (data: any) => any;
/** MIGRATIONS[key][n] leva a versão n → n+1. v0 = formato cru da v0.3.1 (sem envelope). */
const MIGRATIONS: Record<Key, Migration[]> = {
  // v0 → v1: só ganha o envelope. Os merges com os defaults continuam nos validadores.
  'doublek.settings': [(d) => d],
  'doublek.visual': [(d) => d],
  'doublek.scenes': [(d) => d],
  'doublek.trans': [(d) => (typeof d === 'string' ? +d : d)], // antes era salvo como texto cru
  'doublek.midi': [(d) => d],
  'doublek.videos': [(d) => d],
  'doublek.roteiros': [(d) => d],
  'doublek.banks': [(d) => d], // nasceu na v1; o v0 nunca existiu
  'doublek.automation': [(d) => d], // nasceu na v1
  'doublek.presets': [(d) => d], // nasceu na v1
  'doublek.fx': [(d) => d], // nasceu na v1
};

export type Envelope = { v: number; data: unknown };

const isEnvelope = (x: any): x is Envelope => !!x && typeof x === 'object' && typeof x.v === 'number' && 'data' in x;

/** Lê, migra e valida. `validate` devolve o valor pronto ou lança para cair no padrão. */
export function load<T>(key: Key, validate: (raw: unknown) => T, fallback: () => T): T {
  const text = storage.getItem(key);
  if (text == null) return fallback();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { backup(key, text); return fallback(); }
  try {
    const out = validate(migrate(key, raw));
    if (!isEnvelope(raw) || raw.v !== SCHEMA[key]) save(key, out); // persiste já migrado
    return out;
  } catch {
    // inválido, ou de uma versão futura do app: não arrisca; guarda o bruto e usa o padrão
    backup(key, text);
    return fallback();
  }
}

/** Leva um envelope (ou dado cru v0) até a versão atual da chave. Lança se for de versão futura.
 *  Usado por `load` e pela importação do Show Pack, que lê os mesmos envelopes de dentro do ZIP. */
export function migrate(key: Key, raw: unknown): unknown {
  let { v, data } = isEnvelope(raw) ? raw : { v: 0, data: raw };
  const target = SCHEMA[key];
  if (v > target) throw new Error(`${key}: versão ${v} é mais nova que a deste app (${target})`);
  for (; v < target; v++) data = MIGRATIONS[key][v](data);
  return data;
}

export function save<T>(key: Key, data: T) {
  try { storage.setItem(key, JSON.stringify({ v: SCHEMA[key], data } satisfies Envelope)); } catch {}
}

/** Guarda o valor bruto que não deu para carregar, para não perder o trabalho de ninguém. */
function backup(key: Key, text: string) {
  try { storage.setItem(key + '.bak', text); } catch {}
}

/** Cópia profunda de dado JSON (objeto simples, array, primitivo), também através do $state do Svelte, registrando a
 *  leitura de cada campo como o $state.snapshot. O snapshot faz um structuredClone por campo primitivo e passa pelo
 *  getOwnPropertyDescriptor do proxy em cada chave: no visual (~150 campos), que muda a cada quadro numa transição de
 *  cena, macro ou rampa, era o grosso dos ~4 ms de script por mudança na janela de controle. */
export function plain<T>(x: T): T {
  if (typeof x !== 'object' || x === null) return x;
  if (Array.isArray(x)) {
    const a = new Array(x.length);
    for (let i = 0; i < x.length; i++) a[i] = plain(x[i]);
    return a as T;
  }
  const o: Record<string, unknown> = {};
  for (const k of Reflect.ownKeys(x)) if (typeof k === 'string') o[k] = plain((x as Record<string, unknown>)[k]);
  return o as T;
}

// ---------- validadores reutilizáveis ----------
export const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
export const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Mantém só as chaves de `defaults`, cada uma com o tipo do padrão; objetos aninhados idem (um nível). */
export function shaped<T extends Record<string, any>>(raw: unknown, defaults: T): T {
  const src = isObj(raw) ? raw : {};
  const out: any = {};
  for (const [k, d] of Object.entries(defaults)) {
    const v = src[k];
    if (isObj(d)) out[k] = shaped(v, d);
    else if (typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
    else out[k] = d;
  }
  return out;
}
