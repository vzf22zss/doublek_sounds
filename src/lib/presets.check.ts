// npm run check — catálogo de presets de fábrica (DK-131).
import assert from 'node:assert/strict';
import { FACTORY_PRESETS, presetLook, presetsByStyle, searchPresets, STYLES } from './presets.ts';
import { lookOf, sanitizeLook, VISUAL } from './settings.ts';
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

console.log('presets: ok');
