// npm run check — catálogo de presets de fábrica (DK-131).
import assert from 'node:assert/strict';
import { FACTORY_PRESETS, presetLook, presetsByStyle, searchPresets, STYLES } from './presets.ts';
import { blend, lookOf, sanitizeLook, validScenes, VISUAL } from './settings.ts';
import { defaultLayers, moveLayer, setLayer } from '../render/layers.ts';
import { SAFE_FLASH_MAX, SAFE_STROBE_MAX } from './safety.ts';

assert.ok(FACTORY_PRESETS.length >= 10, 'pelo menos 10 presets');
assert.equal(new Set(FACTORY_PRESETS.map((p) => p.id)).size, FACTORY_PRESETS.length, 'ids únicos');

const keys = Object.keys(lookOf(VISUAL)).sort();
for (const p of FACTORY_PRESETS) {
  assert.ok(p.style in STYLES, `${p.id}: estilo`);
  assert.ok(p.name && p.description && p.tags.length, `${p.id}: metadados`);
  assert.deepEqual(Object.keys(p.look).sort(), keys, `${p.id}: todas as chaves de cena`);
  assert.deepEqual(sanitizeLook(p.look), p.look, `${p.id}: sanitizeLook não pode perder nada`);
  assert.ok(p.look.strobe <= SAFE_STROBE_MAX, `${p.id}: strobe ≤ ${SAFE_STROBE_MAX}`);
  assert.ok(p.look.fxFlash <= SAFE_FLASH_MAX, `${p.id}: fxFlash ≤ ${SAFE_FLASH_MAX}`);
  assert.ok([1, 2, 4].includes(p.look.strobeDiv), `${p.id}: strobeDiv`);
  assert.equal(p.look.bgVideo, '', `${p.id}: sem vídeo embutido`);
}

assert.equal(searchPresets('tunel')[0]?.id, 'dark-tunnel');
assert.equal(searchPresets('TÚNEL')[0]?.id, 'dark-tunnel');
assert.ok(searchPresets('hi-tech').some((p) => p.id === 'hitech-glitch'));
assert.equal(searchPresets('   ').length, FACTORY_PRESETS.length);
assert.equal(searchPresets('nadaquever').length, 0);

const by = presetsByStyle();
assert.deepEqual(Object.keys(by).sort(), Object.keys(STYLES).sort());
assert.equal(Object.values(by).flat().length, FACTORY_PRESETS.length);

const copy = presetLook('dark-tunnel');
copy.color = '#000000';
copy.mod.chroma = 'lfo';
assert.equal(presetLook('dark-tunnel').color, '#ff2a55', 'presetLook devolve cópia');
assert.equal(presetLook('dark-tunnel').mod.chroma, 'hats', 'cópia profunda (mod)');
assert.throws(() => presetLook('x'));

// DK-053: camadas entram nas cenas e nos presets
{
  const custom = moveLayer(setLayer(defaultLayers(), 'mandala', { blend: 'add', opacity: 0.5 }), 'kaleido', -1);
  const withLayers = { ...presetLook('psy-clean'), layers: custom };
  assert.deepEqual(sanitizeLook(withLayers), withLayers, 'cena/preset com camadas sobrevive ao sanitizeLook');
  const empty = Array(7).fill(null);
  const [old] = validScenes([{ name: 'antiga', look: { color: '#ffffff' } }, ...empty]);
  assert.deepEqual(old!.look.layers, defaultLayers(), 'cena antiga sem layers ganha o padrão');
  const [bad] = validScenes([{ name: 'x', look: { layers: [{ id: 'evil' }, { id: 'glitch', opacity: 9 }] } }, ...empty]);
  assert.equal(bad!.look.layers.length, 7, 'lixo nas camadas vira lista completa');
  assert.equal(bad!.look.layers[0].id, 'glitch');
  assert.equal(bad!.look.layers[0].opacity, 1);
  // crossfade de cenas: a lista troca inteira em t = 0,5, sem erro
  const from = { ...VISUAL, layers: defaultLayers() };
  assert.deepEqual(blend(from, withLayers, 0.49).layers, from.layers);
  assert.deepEqual(blend(from, withLayers, 0.5).layers, custom);
  assert.ok(FACTORY_PRESETS.every((p) => p.look.layers.length === 7), 'todo preset leva as camadas padrão');
}

console.log('presets: ok');
