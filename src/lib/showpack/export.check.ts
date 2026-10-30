// npm run check — exportação do Show Pack (DK-012): ZIP mínimo re-lido por zip.readZip, buildShowPack
// com estado + assets, sha256 conferido à parte, erro antes de montar quando o manifesto não valida.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LIMITS } from '../limits.ts';
import { buildShowPack, showPackFileName, sha256, type ShowPackInput } from './export.ts';
import { crc32, readZip as readEntries, writeZip } from './zip.ts';

// leitor da biblioteca (DK-013), que confere assinaturas, STORE, tamanhos e CRC; aqui só vira Map
const readZip = (z: Uint8Array) => new Map(readEntries(z).map((e) => [e.path, e.data]));
const enc = (s: string) => new TextEncoder().encode(s);
const json = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
const rejects = async (p: Promise<unknown>, re: RegExp) => { let e = ''; try { await p; } catch (x) { e = (x as Error).message; } assert.match(e, re); };

// --- (1) zip.ts ---
assert.equal(crc32(enc('')), 0);
assert.equal(crc32(enc('123456789')), 0xcbf43926); // vetor padrão do CRC-32
{
  const bin = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff);
  const z = writeZip([{ path: 'a.json', data: enc('{"a":1}') }, { path: 'assets/x.bin', data: bin }, { path: 'vazio.txt', data: new Uint8Array(0) }]);
  const got = readZip(z);
  assert.deepEqual([...got.keys()], ['a.json', 'assets/x.bin', 'vazio.txt']);
  assert.deepEqual(got.get('a.json'), enc('{"a":1}'));
  assert.deepEqual(got.get('assets/x.bin'), bin);
  assert.equal(got.get('vazio.txt')!.length, 0);
  assert.equal(z.length, 3 * 30 + 3 * 46 + 22 + 2 * (6 + 12 + 9) + 7 + 1000); // sem compressão: tamanho previsível
  assert.throws(() => writeZip([{ path: 'a', data: bin }, { path: 'a', data: bin }]), /repetido/);
  assert.throws(() => writeZip([{ path: '', data: bin }]), /vazio/);
}

// --- (2) buildShowPack ---
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const mp4 = new Uint8Array(4096).map((_, i) => i & 0xff);
const input = (): ShowPackInput => ({
  name: 'Set de sábado',
  appVersion: '0.3.1',
  state: {
    visual: { v: 1, data: { size: 55, bgVideo: 'v1' } },
    trans: JSON.stringify({ v: 1, data: 4 }),                                  // texto, como sai do localStorage
    videos: { v: 1, data: [{ id: 'v1', name: 'loop' }] },
    scenes: { v: 1, data: [{ name: 'A', look: {} }, null] },
    roteiros: { v: 1, data: [{ id: 'r1', name: 'R', track: 'abc.mp3', cues: [] }] },
    midi: { v: 1, data: { 'cc:1:7': { id: 'size', label: 'Tamanho' } } },
  },
  assets: [
    { kind: 'logo', refId: 'logo', mime: 'image/png', name: 'minha logo.png', bytes: png },
    { kind: 'video', refId: 'v1', mime: 'video/mp4', name: 'loop.mp4', bytes: mp4 },
  ],
});
{
  const when = new Date('2026-10-30T12:00:00Z');
  const { bytes, manifest } = await buildShowPack(input(), { createdAt: when });
  const files = readZip(bytes);
  assert.deepEqual([...files.keys()], ['manifest.json', 'visual.json', 'scenes.json', 'roteiros.json', 'midi.json', 'assets/logo.png', 'assets/v1.mp4']);
  assert.deepEqual(json(files.get('manifest.json')!), manifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.createdAt, '2026-10-30T12:00:00.000Z');
  assert.equal(manifest.includeTracks, false);
  assert.deepEqual(manifest.assets.map((a) => [a.path, a.kind, a.bytes, a.refId]), [['logo.png', 'logo', 8, 'logo'], ['v1.mp4', 'video', 4096, 'v1']]);
  assert.equal(manifest.assets[0].sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(manifest.assets[1].sha256, createHash('sha256').update(mp4).digest('hex'));
  assert.equal(await sha256(png), manifest.assets[0].sha256);
  assert.deepEqual(files.get('assets/logo.png'), png);
  assert.deepEqual(files.get('assets/v1.mp4'), mp4);
  const vis = json(files.get('visual.json')!);
  assert.deepEqual(Object.keys(vis), ['doublek.visual', 'doublek.trans', 'doublek.videos']);
  assert.deepEqual(vis['doublek.trans'], { v: 1, data: 4 });
  assert.equal(vis['doublek.visual'].data.size, 55);
  assert.deepEqual(Object.keys(json(files.get('scenes.json')!)), ['doublek.scenes']);
  assert.equal(json(files.get('roteiros.json')!)['doublek.roteiros'].data[0].track, 'abc.mp3');
  assert.equal(json(files.get('midi.json')!)['doublek.midi'].data['cc:1:7'].id, 'size');

  // sem midi e sem assets: pacote só de estado, sem midi.json
  const semMidi = await buildShowPack({ ...input(), state: { ...input().state, midi: null }, assets: [] });
  assert.deepEqual([...readZip(semMidi.bytes).keys()], ['manifest.json', 'visual.json', 'scenes.json', 'roteiros.json']);
  assert.equal(semMidi.manifest.assets.length, 0);
}

// --- (3) erros antes de montar ---
{
  const i = input();
  i.assets[1].bytes = new Uint8Array(LIMITS.video + 1); // teto do tipo
  await rejects(buildShowPack(i), /asset 2 \(v1\.mp4\): arquivo grande demais .*máximo 600 MB/);
}
await rejects(buildShowPack({ ...input(), assets: [{ kind: 'logo', refId: 'logo', mime: 'image/png', name: 'logo.exe', bytes: png }] }), /tipo não aceito \(\.exe\)/);
await rejects(buildShowPack({ ...input(), assets: [{ kind: 'logo', refId: 'logo', mime: 'image/png', name: 'sem-extensao', bytes: png }] }), /tipo não aceito/);
await rejects(buildShowPack({ ...input(), name: '' }), /"name"/);
await rejects(buildShowPack(input(), { maxTotalBytes: 100 }), /pacote grande demais/);
await rejects(buildShowPack({ ...input(), state: { ...input().state, visual: 'não é json' } }), /visual: JSON inválido/);
await rejects(buildShowPack({ ...input(), state: { ...input().state, scenes: { x: 1 } as any } }), /scenes: esperado envelope/);
await rejects(buildShowPack({ ...input(), state: { ...input().state, roteiros: { v: 1, data: 'x'.repeat(LIMITS.json) } } }), /roteiros\.json grande demais/);

// --- (4) música sem includeTracks ---
const track = { kind: 'track' as const, refId: 'abc.mp3', mime: 'audio/mpeg', name: 'abc.mp3', bytes: new Uint8Array([1, 2, 3]) };
await rejects(buildShowPack({ ...input(), assets: [track] }), /música no pacote, mas "includeTracks" é false/);
{
  const r = await buildShowPack({ ...input(), assets: [track] }, { includeTracks: true });
  assert.deepEqual(r.manifest.assets.map((a) => a.path), ['abc.mp3']);
  assert.ok(readZip(r.bytes).has('assets/abc.mp3'));
}

// --- nome do arquivo ---
assert.equal(showPackFileName('Set de sábado — v2'), 'Set-de-sabado-v2.doublekshow');
assert.equal(showPackFileName('   '), 'show.doublekshow');
assert.equal(showPackFileName('../x'), 'x.doublekshow');

console.log('showpack/export: ok');
