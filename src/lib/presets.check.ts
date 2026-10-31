// npm run check — catálogo de presets de fábrica (DK-131).
import assert from 'node:assert/strict';
import { addUserPreset, exportPreset, FACTORY_PRESETS, MAX_IMPORTED, MAX_PRESET_BYTES, parsePreset, presetLook, presetsByStyle, removeUserPreset, searchPresets, STYLES, validUserPresets, type UserPreset } from './presets.ts';
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

// --- DK-132: presets como arquivo (.doublekpreset) ---
{
  const look = { ...presetLook('dark-tunnel'), bgVideo: 'k3j2h1g0' };
  const ex = exportPreset('  Meu túnel  ', look, { author: 'DJ Teste', style: 'dark' });
  assert.deepEqual(ex.warnings, ['o vídeo de fundo não vai no arquivo (presets levam só parâmetros)']);
  const f = JSON.parse(ex.text);
  assert.deepEqual([f.format, f.v, f.name, f.author, f.style, f.look.bgVideo], ['doublek-preset', 1, 'Meu túnel', 'DJ Teste', 'dark', '']);
  assert.ok(ex.text.length < MAX_PRESET_BYTES);
  // ida e volta: o look volta igual (menos o vídeo)
  const file = (t: string, name = 'meu.doublekpreset') => ({ name, size: new TextEncoder().encode(t).length });
  const back = parsePreset(file(ex.text), ex.text);
  assert.deepEqual(back.look, { ...presetLook('dark-tunnel'), bgVideo: '' });
  assert.deepEqual([back.name, back.author, back.style], ['Meu túnel', 'DJ Teste', 'dark']);
  assert.match(back.id, /^[a-z0-9]{1,16}$/);
  assert.deepEqual(sanitizeLook(back.look), back.look, 'nada fora do sanitizeLook');
  assert.deepEqual(exportPreset('', presetLook('ambient')).warnings, []);
  assert.equal(JSON.parse(exportPreset('', presetLook('ambient')).text).name, 'Preset');
  assert.equal(JSON.parse(exportPreset('x'.repeat(200), presetLook('ambient')).text).name.length, 60);

  // chaves desconhecidas / tipos errados no look: somem ou caem no padrão; nome longo é cortado
  const weird = JSON.stringify({ format: 'doublek-preset', v: 1, name: 'n'.repeat(90), style: 'rock', look: { color: '#123456', glow: 'muito', hack: '<script>', mod: { glow: 'bass', x: 1 }, size: 55 } });
  const w = parsePreset(file(weird), weird);
  assert.equal(w.name.length, 60);
  assert.equal(w.style, undefined, 'estilo desconhecido some');
  assert.equal(w.look.color, '#123456');
  assert.equal(w.look.size, 55);
  assert.equal(w.look.glow, VISUAL.glow, 'tipo errado cai no padrão');
  assert.ok(!('hack' in w.look));
  assert.equal(w.look.mod.glow, 'bass');
  assert.ok(!('x' in w.look.mod));
  assert.deepEqual(Object.keys(w.look).sort(), Object.keys(lookOf(VISUAL)).sort(), 'look completo');

  // lixo e formatos recusados, com mensagem em português
  const bad = (t: string, re: RegExp, name?: string, size?: number) =>
    assert.throws(() => parsePreset(size !== undefined ? { name: name ?? 'a.doublekpreset', size } : file(t, name), t), re);
  bad('não é json', /não é JSON/);
  bad('[1,2]', /não é um preset do DoubleK/);
  bad(JSON.stringify({ format: 'outro', v: 1, name: 'a', look: {} }), /não é um preset do DoubleK/);
  bad(JSON.stringify({ format: 'doublek-preset', v: 2, name: 'a', look: {} }), /versão mais nova do DoubleK \(v2\)/);
  bad(JSON.stringify({ format: 'doublek-preset', v: '1', name: 'a', look: {} }), /versão de preset desconhecida/);
  bad(JSON.stringify({ format: 'doublek-preset', v: 1, name: '   ', look: {} }), /sem nome/);
  bad(JSON.stringify({ format: 'doublek-preset', v: 1, name: 'a', look: 'x' }), /sem parâmetros/);
  bad('{}', /tipo não aceito/, 'preset.exe');
  bad('{}', /grande demais .*64 KB/, undefined, MAX_PRESET_BYTES + 1);
  bad('{}', /vazio/, undefined, 0);

  // lista guardada: revalida, deduplica id, corta em 100; adicionar além do limite recusa
  const lst = validUserPresets([back, back, { name: 'sem look' }, 'lixo', { id: 'BAD ID', name: 'ok', look: { size: 20 } }]);
  assert.equal(lst.length, 3);
  assert.equal(new Set(lst.map((p) => p.id)).size, 3, 'ids únicos');
  assert.equal(lst[2].look.size, 20);
  assert.throws(() => validUserPresets({}), /lista/);
  const many: UserPreset[] = Array.from({ length: 130 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, look: presetLook('ambient') }));
  assert.equal(validUserPresets(many).length, MAX_IMPORTED);
  assert.throws(() => addUserPreset(validUserPresets(many), back), /limite de 100/);
  assert.equal(addUserPreset([], back).length, 1);
  assert.deepEqual(removeUserPreset(lst, lst[0].id).map((p) => p.id), [lst[1].id, lst[2].id]);
}

console.log('presets: ok');
