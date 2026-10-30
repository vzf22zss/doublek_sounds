// npm run check — contrato das camadas (DK-051).
import assert from 'node:assert/strict';
import { defaultLayers, LAYER_IDS, moveLayer, needsCompose, sanitizeLayers, setLayer } from './layers.ts';

const ids = (l: { id: string }[]) => l.map((x) => x.id).join(',');
const D = defaultLayers();

// padrão = a ordem de hoje, tudo ligado, normal, opacidade 1, sem passe extra
assert.equal(ids(D), 'organic,tunnel,particles,mandala,kaleido,feedback,glitch');
assert.ok(D.every((l, i) => l.order === i && l.enabled && l.opacity === 1 && l.blend === 'normal' && !needsCompose(l)));
assert.equal(D.find((l) => l.id === 'feedback')!.type, 'overlay');
assert.equal(D.find((l) => l.id === 'kaleido')!.type, 'psy:kaleido');
assert.deepEqual(sanitizeLayers(D), D, 'padrão passa intacto');
assert.deepEqual(sanitizeLayers(JSON.parse(JSON.stringify(D))), D, 'ida e volta em JSON');

// lixo vira padrão
for (const raw of [undefined, null, 42, 'x', {}, { 0: D[0] }, []]) assert.deepEqual(sanitizeLayers(raw), D, String(raw));

// ids desconhecidos e repetidos saem; faltantes entram no fim; tipo vem do id
{
  const l = sanitizeLayers([
    { id: 'glitch', order: 0 }, { id: 'evil', order: 1 }, { id: 'glitch', order: 2, blend: 'add' },
    { id: 'tunnel', order: 3, type: 'bg' }, 7, null,
  ]);
  assert.equal(ids(l), 'glitch,tunnel,organic,particles,mandala,kaleido,feedback');
  assert.equal(l[0].blend, 'normal', 'vale o 1º glitch');
  assert.equal(l[1].type, 'psy:tunnel');
  assert.deepEqual(l.map((x) => x.order), [0, 1, 2, 3, 4, 5, 6]);
}

// valores limitados
{
  const l = sanitizeLayers([{ id: 'mandala', opacity: 7, blend: 'xor', enabled: 'sim', order: NaN }, { id: 'kaleido', opacity: -1 }]);
  const m = l.find((x) => x.id === 'mandala')!, k = l.find((x) => x.id === 'kaleido')!;
  assert.deepEqual([m.opacity, m.blend, m.enabled, k.opacity], [1, 'normal', true, 0]);
}

// ordem estável: empate pela posição no array
assert.equal(ids(sanitizeLayers([{ id: 'kaleido', order: 1 }, { id: 'organic', order: 1 }])).slice(0, 16), 'kaleido,organic,');

// mover: troca vizinhos; nas pontas não faz nada
assert.equal(ids(moveLayer(D, 'tunnel', -1)), 'tunnel,organic,particles,mandala,kaleido,feedback,glitch');
assert.equal(ids(moveLayer(D, 'feedback', 1)), 'organic,tunnel,particles,mandala,kaleido,glitch,feedback');
assert.deepEqual(moveLayer(D, 'organic', -1), D);
assert.deepEqual(moveLayer(D, 'glitch', 1), D);
assert.deepEqual(moveLayer(D, 'nope', 1), D);
assert.deepEqual(moveLayer(moveLayer(D, 'mandala', -1), 'mandala', 1), D, 'subir e descer volta ao mesmo');
assert.equal(D[0].id, 'organic', 'não muda a lista recebida');

// setLayer valida e só mexe na camada pedida
{
  const l = setLayer(D, 'tunnel', { blend: 'add', opacity: 2 });
  const t = l.find((x) => x.id === 'tunnel')!;
  assert.deepEqual([t.blend, t.opacity], ['add', 1]);
  assert.ok(needsCompose(t));
  assert.ok(needsCompose({ ...D[0], opacity: 0.5 }));
  assert.equal(l.filter((x) => x !== t).every((x) => x.blend === 'normal'), true);
  assert.equal(setLayer(D, 'glitch', { enabled: false }).find((x) => x.id === 'glitch')!.enabled, false);
}
assert.equal(LAYER_IDS.length, 7);

console.log('layers: ok');
