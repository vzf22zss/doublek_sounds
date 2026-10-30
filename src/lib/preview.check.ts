// npm run check — Program/Preview (DK-043): preparar, TAKE, banco trocado, regravar, apagar banco, PÂNICO/BLACKOUT.
import assert from 'node:assert/strict';
import { addBank, stepBank, validBanks, type Banks } from './banks.ts';
import { afterCommand, afterRemoveBank, resolve, stage, take, type PreviewRef } from './preview.ts';

const eight = (...s: unknown[]) => [...s, ...Array(8 - s.length).fill(null)];
let b: Banks = validBanks({ active: 0, banks: [
  { name: 'Principal', scenes: eight({ name: 'Azul', look: { color: '#0000ff' } }, null, { name: 'Vermelha', look: { color: '#ff0000' } }) },
  { name: 'Drops', scenes: eight({ name: 'Drop 1', look: { size: 70 } }) },
] });

// preparar
const r1 = stage(b, 0, 2);
assert.ok('ref' in r1);
let ref: PreviewRef = (r1 as { ref: PreviewRef }).ref;
let s = resolve(ref, b)!;
assert.deepEqual([s.bank, s.index, s.name, s.look.color], [0, 2, 'Vermelha', '#ff0000']);
assert.deepEqual(stage(b, 0, 1), { error: 'o pad 2 do banco 1 está vazio' });
assert.deepEqual(stage(b, 3, 0), { error: 'não existe o banco 4' });
assert.equal(resolve(null, b), null);

// TAKE
assert.deepEqual(take(s, 4), { ok: true, take: { bank: 0, index: 2, fade: 4, name: 'Vermelha' } });
assert.deepEqual(take(s, 0), { ok: true, take: { bank: 0, index: 2, fade: 0, name: 'Vermelha' } }); // corte
const none = take(null, 4);
assert.ok(!none.ok && /nada em preview/.test(none.reason));

// trocar de banco não limpa: a referência é banco + pad, não o banco ativo
b = stepBank(b, 1);
assert.equal(b.active, 1);
s = resolve(ref, b)!;
assert.deepEqual([s.bank, s.index, s.name], [0, 2, 'Vermelha']);

// gravar por cima da cena em preview: o preview passa a mostrar o look novo
b.banks[0].scenes[2] = { name: 'Vermelha 2', look: { ...b.banks[0].scenes[2]!.look, color: '#ff8800' } };
s = resolve(ref, b)!;
assert.deepEqual([s.name, s.look.color], ['Vermelha 2', '#ff8800']);
// esvaziar o pad em preview = nada em preview
const vazio = { ...b, banks: b.banks.map((x, i) => (i === 0 ? { ...x, scenes: x.scenes.map((c, j) => (j === 2 ? null : c)) } : x)) };
assert.equal(resolve(ref, vazio), null);

// apagar banco
assert.deepEqual(afterRemoveBank({ bank: 0, index: 2 }, 0), null);              // era o banco do preview
assert.deepEqual(afterRemoveBank({ bank: 2, index: 5 }, 1), { bank: 1, index: 5 }); // estava depois: acompanha
assert.deepEqual(afterRemoveBank({ bank: 0, index: 2 }, 1), { bank: 0, index: 2 }); // estava antes: igual
assert.equal(afterRemoveBank(null, 0), null);
b = addBank(b);
assert.equal(resolve({ bank: 2, index: 0 }, b), null, 'banco novo é vazio');

// PÂNICO limpa; BLACKOUT e o resto não
ref = { bank: 0, index: 2 };
assert.equal(afterCommand(ref, 'PANIC'), null);
assert.equal(afterCommand(ref, 'BLACKOUT'), ref);
assert.equal(afterCommand(ref, 'SCENE_RECALL'), ref);
assert.equal(afterCommand(ref, 'BANK_STEP'), ref);

console.log('preview: ok');
