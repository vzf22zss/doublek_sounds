// npm run check — bancos de cenas (DK-041): migração de doublek.scenes, limites, saneamento, edição, roundtrip.
import assert from 'node:assert/strict';
import { useStorage, SCHEMA } from './store.ts';
import { loadScenes, VISUAL } from './settings.ts';
import { addBank, loadBanks, MAX_BANKS, removeBank, renameBank, saveBanks, stepBank, usedScenes, validBanks, type Banks } from './banks.ts';

const mem = new Map<string, string>();
useStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
const env = (k: string) => JSON.parse(mem.get(k)!);
const look = { size: 40 };
const eight = (name = 'A') => [{ name, look }, null, null, null, null, null, null, null];

// --- sem nada salvo: 1 banco "Principal" com as cenas de fábrica ---
mem.clear();
{
  const b = loadBanks();
  assert.equal(b.active, 0);
  assert.equal(b.banks.length, 1);
  assert.equal(b.banks[0].name, 'Principal');
  assert.deepEqual(b.banks[0].scenes, loadScenes());          // fábrica
  assert.equal(b.banks[0].scenes[0]!.name, 'Psy clean');
}

// --- migração: só doublek.scenes (v0.3.1 ou v1) → banco 1 com essas cenas; doublek.scenes não é apagado ---
mem.clear();
mem.set('doublek.scenes', JSON.stringify(eight('Minha cena')));           // formato cru da v0.3.1
{
  const b = loadBanks();
  assert.equal(b.banks.length, 1);
  assert.equal(b.banks[0].name, 'Principal');
  assert.equal(b.banks[0].scenes[0]!.name, 'Minha cena');
  assert.equal(b.banks[0].scenes[0]!.look.size, 40);
  assert.equal(b.banks[0].scenes[0]!.look.glow, VISUAL.glow);             // look completado com o padrão
  assert.ok(mem.has('doublek.scenes'));
}

// --- roundtrip: grava envelope v1 e espelha o banco ativo em doublek.scenes ---
{
  let b = loadBanks();
  b = addBank(b, 'Drops');
  b.banks[1].scenes[2] = { name: 'Drop 1', look: { ...b.banks[0].scenes[0]!.look, size: 70 } };
  saveBanks(b);
  assert.equal(env('doublek.banks').v, SCHEMA['doublek.banks']);
  assert.equal(env('doublek.scenes').data[2].name, 'Drop 1');             // ativo = banco 2
  const r = loadBanks();
  assert.equal(r.active, 1);
  assert.deepEqual(r.banks.map((x) => x.name), ['Principal', 'Drops']);
  assert.equal(r.banks[1].scenes[2]!.look.size, 70);
  assert.equal(r.banks[1].scenes[0], null);
}

// --- validBanks: limites e saneamento ---
{
  const five = Array.from({ length: 5 }, (_, i) => ({ name: 'B' + i, scenes: eight() }));
  assert.equal(validBanks({ active: 0, banks: five }).banks.length, MAX_BANKS);
  assert.deepEqual(validBanks({ active: 0, banks: five }).banks.map((b) => b.name), ['B0', 'B1', 'B2', 'B3']);
  assert.equal(validBanks({ active: 7, banks: five }).active, 0);         // fora do intervalo
  assert.equal(validBanks({ active: -1, banks: five }).active, 0);
  assert.equal(validBanks({ active: 1.5, banks: five }).active, 0);
  assert.equal(validBanks({ active: 3, banks: five }).active, 3);
  const s = validBanks({ active: 0, banks: [{ name: 'x'.repeat(40), scenes: [{ name: 'ok', look }, 'lixo', 42, { look: 1 }, null, null, null, null] }] });
  assert.equal(s.banks[0].name.length, 24);
  assert.equal(s.banks[0].scenes[1], null);                               // cena inválida → posição vazia
  assert.equal(s.banks[0].scenes[2], null);
  assert.equal(s.banks[0].scenes[3]!.name, 'Cena 4');                     // objeto sem nome: nome padrão, look padrão
  assert.equal(validBanks({ banks: [{ name: '  ', scenes: eight() }] }).banks[0].name, 'Banco 1');
  // banco com scenes ≠ 8 é descartado; os outros ficam
  assert.deepEqual(validBanks({ banks: [{ name: 'ruim', scenes: [] }, { name: 'bom', scenes: eight() }] }).banks.map((b) => b.name), ['bom']);
  assert.throws(() => validBanks({ banks: [] }), /nenhum banco/);
  assert.throws(() => validBanks([]), /formato/);
  // doublek.banks ilegível → volta para a migração a partir de doublek.scenes (e o bruto vai para .bak)
  mem.clear();
  mem.set('doublek.scenes', JSON.stringify(eight('Salva')));
  mem.set('doublek.banks', JSON.stringify({ v: 1, data: { banks: 'x' } }));
  assert.equal(loadBanks().banks[0].scenes[0]!.name, 'Salva');
  assert.ok(mem.has('doublek.banks.bak'));
}

// --- edição ---
{
  let b: Banks = validBanks({ banks: [{ name: 'A', scenes: eight() }] });
  b = addBank(b); b = addBank(b); b = addBank(b);
  assert.deepEqual(b.banks.map((x) => x.name), ['A', 'Banco 2', 'Banco 3', 'Banco 4']);
  assert.equal(b.active, 3);
  assert.equal(addBank(b), b);                                            // 5º não entra
  assert.equal(usedScenes(b.banks[0]), 1);
  assert.equal(usedScenes(b.banks[3]), 0);
  assert.equal(renameBank(b, 1, '  Drops  ').banks[1].name, 'Drops');
  assert.equal(renameBank(b, 1, '').banks[1].name, 'Banco 2');
  assert.deepEqual([stepBank(b, 1).active, stepBank(b, -1).active, stepBank({ ...b, active: 0 }, -1).active], [0, 2, 3]); // dá a volta
  let r = removeBank({ ...b, active: 3 }, 1);                             // remove antes do ativo: ativo acompanha
  assert.deepEqual([r.active, r.banks.map((x) => x.name).join()], [2, 'A,Banco 3,Banco 4']);
  r = removeBank({ ...b, active: 3 }, 3);                                 // remove o ativo (último): vai para o vizinho
  assert.equal(r.active, 2);
  r = removeBank({ ...b, active: 0 }, 0);
  assert.deepEqual([r.active, r.banks[0].name], [0, 'Banco 2']);
  const one = validBanks({ banks: [{ name: 'só', scenes: eight() }] });
  assert.equal(removeBank(one, 0), one);                                  // nunca o último
}

console.log('banks: ok');
