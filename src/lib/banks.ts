// Bancos de cenas (DK-041): até 4 bancos de 8 cenas (32). Os pads, o MIDI `c:0..7`, as teclas 1–8 e o
// `cue.scene` do roteiro agem sempre no banco ATIVO. `doublek.scenes` continua gravado com o banco ativo, para o
// código e os Show Packs que só conhecem 8 cenas seguirem funcionando.
import { load, save, isObj } from './store.ts';
import { loadScenes, saveScenes, validScenes, type Scene } from './settings.ts';

export type Bank = { name: string; scenes: Scene[] };
export type Banks = { active: number; banks: Bank[] };
export const MAX_BANKS = 4;
const NAME = 24;

const bankName = (x: unknown, i: number) => (typeof x === 'string' ? x.trim().slice(0, NAME) : '') || `Banco ${i + 1}`;
const empty = (): Scene[] => Array(8).fill(null);

/** 1–4 bancos, cada um com 8 posições saneadas como em validScenes; banco ilegível é descartado; `active` no intervalo. */
export function validBanks(raw: unknown): Banks {
  if (!isObj(raw) || !Array.isArray(raw.banks)) throw new Error('bancos: formato inválido');
  const banks: Bank[] = [];
  for (const b of raw.banks) {
    if (banks.length === MAX_BANKS) break;
    if (!isObj(b)) continue;
    try { banks.push({ name: bankName(b.name, banks.length), scenes: validScenes(b.scenes) }); } catch {}
  }
  if (!banks.length) throw new Error('bancos: nenhum banco válido');
  const a = raw.active;
  return { active: typeof a === 'number' && Number.isInteger(a) && a >= 0 && a < banks.length ? a : 0, banks };
}

/** Sem `doublek.banks` (ou ilegível): banco 1 "Principal" = as 8 cenas de hoje (ou as de fábrica). */
export const fromScenes = (scenes: Scene[]): Banks => ({ active: 0, banks: [{ name: 'Principal', scenes }] });

export function loadBanks(): Banks {
  return load('doublek.banks', validBanks, () => fromScenes(loadScenes()));
}

export function saveBanks(b: Banks) {
  save('doublek.banks', b);
  saveScenes(b.banks[b.active].scenes); // compatibilidade: doublek.scenes = banco ativo
}

// ---------- edição (puras: devolvem um Banks novo; nada muda se a operação não couber) ----------

export function addBank(b: Banks, name?: string): Banks {
  if (b.banks.length >= MAX_BANKS) return b;
  const banks = [...b.banks, { name: bankName(name, b.banks.length), scenes: empty() }];
  return { active: banks.length - 1, banks };
}

/** Nunca remove o último banco. O ativo continua apontando para o mesmo banco (ou o vizinho, se foi ele o removido). */
export function removeBank(b: Banks, i: number): Banks {
  if (b.banks.length <= 1 || i < 0 || i >= b.banks.length) return b;
  const banks = b.banks.filter((_, j) => j !== i);
  const active = b.active > i ? b.active - 1 : Math.min(b.active, banks.length - 1);
  return { active, banks };
}

/**
 * Referência a banco (índice) depois de apagar o banco `removed`: os de antes ficam, os de depois descem 1,
 * o apagado vira null. Usado para `cue.bank` dos roteiros e as cenas do mapa de automação — a única operação que
 * muda índices hoje é apagar; se um dia houver "mover banco", ele deve passar pelo mesmo tipo de remapeamento.
 */
export function shiftAfterRemove(ref: number | undefined, removed: number): number | undefined | null {
  if (ref === undefined) return undefined;
  return ref === removed ? null : ref > removed ? ref - 1 : ref;
}

export function renameBank(b: Banks, i: number, name: string): Banks {
  if (i < 0 || i >= b.banks.length) return b;
  return { ...b, banks: b.banks.map((x, j) => (j === i ? { ...x, name: bankName(name, i) } : x)) };
}

/** Anterior/seguinte, dando a volta (um botão só do controlador percorre todos). */
export const stepBank = (b: Banks, d: number): Banks => ({ ...b, active: (((b.active + d) % b.banks.length) + b.banks.length) % b.banks.length });

export const usedScenes = (bank: Bank) => bank.scenes.filter(Boolean).length;
