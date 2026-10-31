// npm run check — efeitos da comunidade (DK-121): manifesto, regras do GLSL, pacote .doublekfx, exemplos de
// docs/examples/fx, mapa de erros, saúde do efeito, ritmo de compilação, lista guardada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileAt, FX_HEADER, HEADER_LINES, HEALTHY, mapErrors, MAX_CODE_BYTES, MAX_PACK_BYTES, nextHealth, readFxPack,
  validateFxManifest, validateShader, validFxList, writeFxPack, type FxManifest,
} from './manifest.ts';
import { writeZip } from '../showpack/zip.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../..');
const ex = (id: string) => ({
  manifest: JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/examples/fx', id, 'manifest.json'), 'utf8')),
  code: fs.readFileSync(path.join(ROOT, 'docs/examples/fx', id, 'effect.frag'), 'utf8'),
});
const good = (): FxManifest => validateFxManifest(ex('rgb-split-kick').manifest);
const bad = (raw: unknown, re: RegExp) => assert.throws(() => validateFxManifest(raw), re);
const badCode = (code: string, re: RegExp) => assert.throws(() => validateShader(code), re);

// --- os exemplos passam e fazem ida e volta pelo pacote ---
for (const id of ['rgb-split-kick', 'ondas-grave']) {
  const e = ex(id);
  const m = validateFxManifest(e.manifest);
  assert.equal(m.id, id);
  validateShader(e.code);
  const pack = writeFxPack({ manifest: m, code: e.code });
  assert.ok(pack.length < MAX_PACK_BYTES);
  const back = readFxPack(pack);
  assert.deepEqual(back.manifest, m);
  assert.equal(back.code, e.code);
}
assert.equal(validateFxManifest(ex('ondas-grave').manifest).params.length, 3);
assert.equal(validateFxManifest(ex('rgb-split-kick').manifest).params[0].mod, 'kick');

// --- manifesto ---
const m0 = { ...ex('rgb-split-kick').manifest };
bad(null, /objeto JSON/);
bad({ ...m0, format: 'outro' }, /não é um efeito do DoubleK/);
bad({ ...m0, v: 2 }, /versão mais nova do DoubleK \(v2\)/);
bad({ ...m0, v: '1' }, /versão de efeito desconhecida/);
bad({ ...m0, id: 'X' }, /id do efeito inválido/);
bad({ ...m0, id: '../x' }, /id do efeito inválido/);
bad({ ...m0, name: ' ' }, /sem nome/);
bad({ ...m0, version: '' }, /"version"/);
bad({ ...m0, entry: 'main.glsl' }, /"entry" precisa ser "effect.frag"/);
bad({ ...m0, params: {} }, /lista/);
bad({ ...m0, params: Array.from({ length: 9 }, (_, i) => ({ key: 'p' + i, min: 0, max: 1, default: 0 })) }, /no máximo 8 parâmetros/);
bad({ ...m0, params: [{ key: 'a', min: 0, max: 1, default: 0 }, { key: 'a', min: 0, max: 1, default: 0 }] }, /repetida/);
bad({ ...m0, params: [{ key: '1a', min: 0, max: 1, default: 0 }] }, /"key" inválida/);
bad({ ...m0, params: [{ key: 'a', min: 1, max: 1, default: 1 }] }, /faixa inválida/);
bad({ ...m0, params: [{ key: 'a', min: 0, max: 1, default: 2 }] }, /"default" fora da faixa/);
bad({ ...m0, params: [{ key: 'a', min: 0, max: 1, default: 0, step: 0 }] }, /"step" inválido/);
bad({ ...m0, params: [{ key: 'a', min: 0, max: 1, default: 0, mod: 'laser' }] }, /modulação desconhecida \(laser\)/);
{
  const m = validateFxManifest({ ...m0, name: 'x'.repeat(80), author: '  Fulano  ', params: [{ key: 'a', min: 0, max: 2, default: 1 }], extra: 1 });
  assert.equal(m.name.length, 60);
  assert.equal(m.author, 'Fulano');
  assert.equal(m.params[0].step, 0.02, 'step padrão = faixa/100');
  assert.equal(m.params[0].label, 'a');
  assert.ok(!('extra' in m));
  assert.deepEqual(validateFxManifest({ ...m0, params: undefined }).params, []);
}

// --- GLSL ---
validateShader('void main() { o = texture(uInput, vUv); }');
validateShader('void main(){ vec4 a=vec4(0); for (int i = 0; i <= 255; i++) a += texture(uInput, vUv); o = a / 256.0; }');
validateShader('// while e uniform so em comentario\n/* #extension tambem */\nvoid main() { o = vec4(1); }');
validateShader('precision mediump float;\nfloat f(float x){return x;}\nvoid main(){ o = vec4(f(1.0)); }');
badCode('x'.repeat(MAX_CODE_BYTES + 1), /grande demais .*32 KB/);
badCode('void main() { o = vec4(1); } // ação', /fora do ASCII na linha 1/);
badCode('#version 300 es\nvoid main(){}', /não escreva #version/);
badCode('#extension GL_EXT_foo : enable\nvoid main(){}', /#extension não é permitido/);
badCode('#include "x"\nvoid main(){}', /#include não é permitido/);
badCode('uniform float uMeu;\nvoid main(){ o = vec4(uMeu); }', /uniform fora do contrato: .*\(linha 1\)/);
badCode('void main(){\n  while (true) {}\n}', /while não é permitido: .*\(linha 2\)/);
badCode('void main(){ do { } while(false); }', /while não é permitido/);
badCode('void main(){\n\n for (int i = 0; i < 1000; i++) {}\n}', /laço sem limite constante ≤ 256 \(linha 3\)/);
badCode('void main(){ int n = 5; for (int i = 0; i < n; i++) {} }', /laço sem limite constante/);
badCode('void main(){ for (int i = 0; i <= 256; i++) {} }', /laço sem limite constante/);
badCode('float f(){ return 1.0; }', /void main\(\)/);

// --- pacote ruim ---
{
  const enc = (s: string) => new TextEncoder().encode(s);
  const e = ex('rgb-split-kick');
  assert.throws(() => readFxPack(writeZip([{ path: 'effect.frag', data: enc(e.code) }])), /sem manifest.json/);
  assert.throws(() => readFxPack(writeZip([{ path: 'manifest.json', data: enc(JSON.stringify(e.manifest)) }])), /sem effect.frag/);
  assert.throws(() => readFxPack(writeZip([{ path: 'manifest.json', data: enc('{') }, { path: 'effect.frag', data: enc(e.code) }])), /não é JSON/);
  assert.throws(() => readFxPack(writeZip([{ path: 'manifest.json', data: enc(JSON.stringify({ ...e.manifest, format: 'x' })) }, { path: 'effect.frag', data: enc(e.code) }])), /não é um efeito/);
  assert.throws(() => readFxPack(writeZip([{ path: 'manifest.json', data: enc(JSON.stringify(e.manifest)) }, { path: 'effect.frag', data: enc('uniform float x; void main(){}') }])), /uniform fora do contrato/);
  assert.throws(() => readFxPack(new Uint8Array(MAX_PACK_BYTES + 1)), /grande demais/);
  assert.throws(() => readFxPack(new Uint8Array(100)), /inválido/);
}

// --- erros do compilador nas linhas do autor ---
assert.equal(HEADER_LINES, 9);
assert.ok(FX_HEADER.startsWith('#version 300 es\n'));
assert.deepEqual(mapErrors(`ERROR: 0:${HEADER_LINES + 3}: 'foo' : undeclared identifier\nERROR: 0:2: header\nWARNING: 0:${HEADER_LINES + 1}: x\nlink failed`), [
  { line: 3, message: "'foo' : undeclared identifier" }, { line: null, message: 'header' }, { line: 1, message: 'x' }, { line: null, message: 'link failed' },
]);

// --- saúde: suspeito, 3 falhas desabilita, só reativar volta ---
let h = HEALTHY;
h = nextHealth(h, 'slow'); assert.deepEqual(h, { status: 'suspeito', fails: 1 });
h = nextHealth(h, 'retry'); assert.deepEqual(h, { status: 'ok', fails: 1 });
h = nextHealth(h, 'ok'); assert.equal(h.fails, 1, 'renderizar bem não zera as falhas');
h = nextHealth(h, 'lost'); assert.deepEqual(h, { status: 'suspeito', fails: 2 });
h = nextHealth(nextHealth(h, 'retry'), 'lost'); assert.deepEqual(h, { status: 'desabilitado', fails: 3 });
assert.deepEqual(nextHealth(h, 'retry'), h, 'desabilitado não volta com retry');
assert.deepEqual(nextHealth(h, 'ok'), h);
assert.deepEqual(nextHealth(h, 'reactivate'), HEALTHY);

// --- ritmo de compilação: 500 ms depois de digitar, no máximo 2/s ---
assert.equal(compileAt(1000, 0), 1500);
assert.equal(compileAt(1000, 1200), 1700, 'compilou há pouco: espera completar 500 ms');
assert.equal(compileAt(5000, 1000), 5500);

// --- lista guardada (doublek.fx) ---
{
  const m = good();
  const l = validFxList([
    { manifest: m, values: [5, 'x', 9], health: { status: 'desabilitado', fails: 3 } },
    { manifest: m, values: [] },                    // id repetido: some
    { manifest: { ...m, id: 'outro', format: 'x' } }, // manifesto ruim: some
    'lixo',
    { manifest: { ...m, id: 'sem-valores' }, health: { status: 'hack', fails: -2 } },
  ]);
  assert.equal(l.length, 2);
  assert.deepEqual(l[0].values, [1, 0], 'valores na faixa; inválido = default; sobra cortada');
  assert.deepEqual(l[0].health, { status: 'desabilitado', fails: 3 });
  assert.deepEqual(l[1].values, [0.6, 0]);
  assert.deepEqual(l[1].health, { status: 'ok', fails: 0 });
  assert.throws(() => validFxList({}), /lista/);
}

console.log('shaders/manifest: ok');
