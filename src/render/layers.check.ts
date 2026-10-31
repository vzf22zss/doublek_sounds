// npm run check — contrato das camadas (DK-051).
import assert from 'node:assert/strict';
import { addFxLayer, addVideoLayer, applyLayerParam, defaultLayers, drawsLayer, LAYER_IDS, LAYER_ON, LAYER_PARAM, MAX_FX, moveLayer, needsCompose, placeLayer, removeExtraLayer, sanitizeLayers, setLayer, VIDEO_LAYER } from './layers.ts';

// D-21b: MIDI learn das camadas extras (vídeo e fx:<id>) pelo mesmo SET_PARAMETER
{
  const l = addFxLayer(addVideoLayer(defaultLayers()), 'ondas-grave');
  const get = (x: ReturnType<typeof sanitizeLayers>, id: string) => x.find((y) => y.id === id)!;
  assert.ok(LAYER_PARAM.test('layers.video.opacity') && LAYER_PARAM.test('layers.fx:ondas-grave.on'));
  assert.ok(!LAYER_PARAM.test('layers.fx:X.on') && !LAYER_PARAM.test('layers.fx:a.b.on') && !LAYER_PARAM.test('layers.videos.on'));
  assert.ok(LAYER_ON.test('l:video:on') && LAYER_ON.test('l:fx:ondas-grave:on') && LAYER_ON.test('l:tunnel:on'));
  assert.ok(!LAYER_ON.test('l:fx:ab:on') && !LAYER_ON.test('l:fx:ondas-grave:off'));
  assert.equal(get(applyLayerParam(l, 'layers.fx:ondas-grave.opacity', 0.3)!, 'fx:ondas-grave').opacity, 0.3);
  assert.equal(get(applyLayerParam(l, 'layers.video.on', -1)!, 'video').enabled, false, 'alterna o vídeo');
  assert.equal(get(applyLayerParam(l, 'layers.fx:ondas-grave.on', 0)!, 'fx:ondas-grave').enabled, false);
  // camada extra que não está na lista: devolve a lista igual (não cai no caminho "vs[chave] = valor")
  assert.deepEqual(applyLayerParam(defaultLayers(), 'layers.fx:outro-fx.on', -1), defaultLayers());
  assert.deepEqual(applyLayerParam(defaultLayers(), 'layers.video.opacity', 0.5), defaultLayers());
}

// DK-063: vídeo como camada opcional
{
  const D0 = defaultLayers();
  assert.ok(!D0.some((l) => l.id === VIDEO_LAYER), 'padrão: vídeo no fundo, sem camada');
  const v = addVideoLayer(D0);
  assert.deepEqual(v.at(-1), { id: 'video', type: 'video', enabled: true, order: 7, opacity: 1, blend: 'normal' });
  assert.deepEqual(addVideoLayer(v), v, 'repetido: igual');
  assert.deepEqual(sanitizeLayers(JSON.parse(JSON.stringify(v))), v, 'sobrevive a salvar/carregar');
  assert.deepEqual(sanitizeLayers([...D0, { id: 'video' }, { id: 'video', blend: 'add' }]).filter((l) => l.id === 'video').length, 1);
  assert.equal(moveLayer(v, 'video', -1).at(-2)!.id, 'video');
  assert.deepEqual(removeExtraLayer(v, 'video'), D0, 'tirar: o vídeo volta para o fundo');
  assert.equal(addFxLayer(v, 'algum-fx').length, 9, 'vídeo não conta no limite de efeitos');
  assert.equal(setLayer(v, 'video', { blend: 'screen', opacity: 0.5 }).at(-1)!.blend, 'screen');
}

// DK-123: camadas de efeito da comunidade (fx:<id>)
{
  const D0 = defaultLayers();
  const one = addFxLayer(D0, 'rgb-split-kick');
  assert.equal(one.length, 8);
  assert.deepEqual(one.at(-1), { id: 'fx:rgb-split-kick', type: 'fx', enabled: true, order: 7, opacity: 1, blend: 'normal' });
  assert.deepEqual(addFxLayer(one, 'rgb-split-kick'), one, 'repetido: igual');
  const two = addFxLayer(one, 'ondas-grave');
  assert.equal(addFxLayer(two, 'terceiro-fx').length, 9, `no máximo ${MAX_FX}`);
  assert.deepEqual(addFxLayer(D0, 'X invalido'), D0, 'id fora do formato do manifesto');
  assert.deepEqual(sanitizeLayers(JSON.parse(JSON.stringify(two))), two, 'sobrevive a salvar/carregar');
  // com a lista de instalados, só os instalados ficam
  assert.equal(sanitizeLayers(two, ['ondas-grave']).filter((l) => l.type === 'fx').map((l) => l.id).join(), 'fx:ondas-grave');
  assert.equal(sanitizeLayers(two, []).length, 7, 'nenhum instalado: só as do app');
  // lixo: id mal formado sai; mais de 2 corta nos 2 primeiros
  const many = sanitizeLayers([...D0, { id: 'fx:aaa', order: 7 }, { id: 'fx:bbb', order: 8 }, { id: 'fx:ccc', order: 9 }, { id: 'fx:', order: 10 }, { id: 'fx:../x' }]);
  assert.equal(many.filter((l) => l.type === 'fx').map((l) => l.id).join(), 'fx:aaa,fx:bbb');
  // tirar: só camada fx sai
  assert.equal(removeExtraLayer(two, 'fx:ondas-grave').length, 8);
  assert.deepEqual(removeExtraLayer(D0, 'tunnel'), D0, 'camada do app não sai');
  // mover, solo, mistura funcionam com fx
  assert.equal(moveLayer(two, 'fx:ondas-grave', -1).at(-1)!.id, 'fx:rgb-split-kick');
  assert.equal(two.filter((l) => drawsLayer(l, 'fx:ondas-grave')).map((l) => l.id).join(), 'fx:ondas-grave', 'solo em fx');
  assert.equal(setLayer(two, 'fx:ondas-grave', { blend: 'screen' }).at(-1)!.blend, 'screen');
  assert.deepEqual(sanitizeLayers(D0, []), D0, 'sem fx, a lista do app não muda');
}

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

// DK-053: arrastar para uma posição
assert.equal(ids(placeLayer(D, 'glitch', 0)), 'glitch,organic,tunnel,particles,mandala,kaleido,feedback');
assert.equal(ids(placeLayer(D, 'organic', 99)), 'tunnel,particles,mandala,kaleido,feedback,glitch,organic');
assert.equal(ids(placeLayer(D, 'mandala', 1)), 'organic,mandala,tunnel,particles,kaleido,feedback,glitch');
assert.deepEqual(placeLayer(D, 'nope', 0), D);
assert.deepEqual(placeLayer(D, 'tunnel', 1), D);
assert.deepEqual(placeLayer(D, 'glitch', 0).map((x) => x.order), [0, 1, 2, 3, 4, 5, 6]);

// solo: só a camada em solo desenha, mesmo desligada; sem solo (ou solo desconhecido) vale o enabled
{
  const l = setLayer(D, 'tunnel', { enabled: false });
  const draws = (solo: unknown) => l.filter((x) => drawsLayer(x, solo)).map((x) => x.id).join(',');
  assert.equal(draws(''), 'organic,particles,mandala,kaleido,feedback,glitch');
  assert.equal(draws('tunnel'), 'tunnel');
  assert.equal(draws('mandala'), 'mandala');
  assert.equal(draws('evil'), draws(''));
  assert.equal(drawsLayer({ ...D[0], opacity: 0 }, 'organic'), false, 'opacidade 0 nunca desenha');
  assert.equal(l.find((x) => x.id === 'tunnel')!.enabled, false, 'solo não mexe no enabled');
}

// SET_PARAMETER de camada (MIDI learn)
{
  assert.ok(LAYER_PARAM.test('layers.kaleido.opacity') && LAYER_PARAM.test('layers.feedback.on'));
  assert.ok(!LAYER_PARAM.test('layers.evil.on') && !LAYER_PARAM.test('layers.kaleido.blend') && !LAYER_PARAM.test('size'));
  assert.equal(applyLayerParam(D, 'size', 1), null);
  assert.equal(applyLayerParam(D, 'layers.kaleido.opacity', NaN), null);
  const op = (l: ReturnType<typeof sanitizeLayers>, id: string) => l.find((x) => x.id === id)!;
  assert.equal(op(applyLayerParam(D, 'layers.kaleido.opacity', 0.42)!, 'kaleido').opacity, 0.42);
  assert.equal(op(applyLayerParam(D, 'layers.kaleido.opacity', 3)!, 'kaleido').opacity, 1);
  const off = applyLayerParam(D, 'layers.glitch.on', 0)!;
  assert.equal(op(off, 'glitch').enabled, false);
  assert.equal(op(applyLayerParam(off, 'layers.glitch.on', 1)!, 'glitch').enabled, true);
  assert.equal(op(applyLayerParam(off, 'layers.glitch.on', -1)!, 'glitch').enabled, true, '−1 alterna');
  assert.equal(op(applyLayerParam(D, 'layers.glitch.on', -1)!, 'glitch').enabled, false);
}

console.log('layers: ok');
