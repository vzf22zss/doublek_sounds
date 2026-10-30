// npm run check — armazenamento versionado: migração v0 → v1, dado inválido, versão futura, roundtrip (DK-002).
import assert from 'node:assert/strict';
import { load, save, useStorage, SCHEMA, shaped, type Key } from './store.ts';
import { loadVisual, loadScenes, saveScenes, validVisual, VISUAL } from './settings.ts';
import { loadRoteiros, saveRoteiros, validRoteiros } from './roteiro.ts';

const mem = new Map<string, string>();
useStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) });
const raw = (k: string) => mem.get(k);
const env = (k: string) => JSON.parse(raw(k)!);

// --- v0 (formato da v0.3.1, sem envelope) é migrado e persistido já na versão atual ---
mem.clear();
mem.set('doublek.visual', JSON.stringify({ ...VISUAL, size: 55, blackout: true, mod: { glow: 'bass' } }));
const v = loadVisual();
assert.equal(v.size, 55);
assert.equal(v.mod.glow, 'bass');
assert.equal(v.mod.amount, 'auto');       // chave que faltava no mod antigo vem do padrão
assert.equal(v.blackout, false);          // estado de operação não sobrevive ao reinício
assert.equal(env('doublek.visual').v, SCHEMA['doublek.visual']);
assert.equal(env('doublek.visual').data.size, 55);

mem.set('doublek.trans', '4'); // v0.3.1 salvava como texto
assert.equal(load('doublek.trans', (r) => r as number, () => 2), 4);
assert.equal(env('doublek.trans').v, 1);

// --- dado inválido: cai no padrão, mas o bruto fica em .bak ---
mem.set('doublek.visual', '{nada');
assert.equal(loadVisual().size, VISUAL.size);
assert.equal(raw('doublek.visual.bak'), '{nada');

mem.set('doublek.scenes', JSON.stringify([null, null]));
assert.equal(loadScenes().length, 8);
assert.ok(raw('doublek.scenes.bak'));

// tipos errados dentro de um objeto válido: só o campo errado cai no padrão
mem.set('doublek.visual', JSON.stringify({ size: 'grande', glow: 0.9, mod: { glow: 'xpto' }, extra: 1 }));
const w = loadVisual();
assert.equal(w.size, VISUAL.size);
assert.equal(w.glow, 0.9);
assert.equal(w.mod.glow, 'auto');
assert.ok(!('extra' in w));

// --- versão futura: não arrisca ---
mem.set('doublek.visual', JSON.stringify({ v: 99, data: { size: 10 } }));
assert.equal(loadVisual().size, VISUAL.size);
assert.equal(env('doublek.visual.bak').v, 99);

// --- cenas: look incompleto ganha o resto do padrão; nome cortado ---
mem.set('doublek.scenes', JSON.stringify([{ name: 'x'.repeat(40), look: { trail: 0.5, strobeDiv: 'dois' } }, null, null, null, null, null, null, null]));
const sc = loadScenes();
assert.equal(sc[0]!.name.length, 24);
assert.equal(sc[0]!.look.trail, 0.5);
assert.equal(sc[0]!.look.strobeDiv, 1);
assert.equal(sc[0]!.look.glow, VISUAL.glow);
saveScenes(sc);
assert.deepEqual(loadScenes(), sc); // roundtrip

// --- roteiros: inválidos somem, ids são mantidos (o app aponta para eles) ---
mem.set('doublek.roteiros', JSON.stringify([
  { id: 'r1', name: 'ok', track: 't.mp3', trackName: 't', bpm: 148, anchor: 0.2, barShift: 0, goBeat: 0, cues: [{ id: 'c1', beat: 4, kind: 'scene', scene: 1 }] },
  { name: 'sem cues' },
  'lixo',
]));
const rs = loadRoteiros();
assert.equal(rs.length, 1);
assert.equal(rs[0].id, 'r1');
assert.equal(rs[0].cues[0].id, 'c1');
saveRoteiros(rs);
assert.deepEqual(loadRoteiros(), rs);
assert.throws(() => validRoteiros({}));

// --- shaped: só as chaves do padrão, um nível de aninhamento ---
assert.deepEqual(shaped({ a: 1, b: 'x', c: { d: true, e: 'n' }, z: 9 }, { a: 0, b: 's', c: { d: false, e: 0 } }), { a: 1, b: 'x', c: { d: true, e: 0 } });
assert.deepEqual(shaped(null, { a: 1 }), { a: 1 });
assert.equal(validVisual({ size: Infinity }).size, VISUAL.size);

// --- toda chave do schema tem migrações suficientes para sair do v0 ---
for (const k of Object.keys(SCHEMA) as Key[]) {
  mem.set(k, JSON.stringify(k === 'doublek.trans' ? 4 : k.endsWith('s') && k !== 'doublek.settings' ? [] : {}));
  load(k, (r) => r, () => null);
  assert.equal(env(k).v, SCHEMA[k], k);
}

// --- save grava envelope ---
save('doublek.midi', { 'cc:0:16': { id: 'v:glow', label: 'Glow' } });
assert.deepEqual(env('doublek.midi'), { v: 1, data: { 'cc:0:16': { id: 'v:glow', label: 'Glow' } } });

console.log('store: ok');
