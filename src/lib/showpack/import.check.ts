// npm run check — importação do Show Pack (DK-013): readZip, roundtrip build → inspect → apply com deps em Map,
// cada recusa da inspeção, modo 'new' reescrevendo ids, rollback quando a gravação falha no meio.
import assert from 'node:assert/strict';
import { buildShowPack, type ShowPackInput } from './export.ts';
import { applyShowPack, inspectShowPack, type ApplyDeps, type Plan } from './import.ts';
import { readZip, writeZip, type ZipEntry } from './zip.ts';

const te = new TextEncoder(), dec = new TextDecoder();
const enc = (s: string) => te.encode(s);
const json = (b: Uint8Array) => JSON.parse(dec.decode(b));
const bad = async (bytes: Uint8Array, re: RegExp) => { const r = await inspectShowPack(bytes); assert.equal(r.ok, false, `devia recusar: ${re}`); if (!r.ok) assert.match(r.error, re); };
/** Reabre o ZIP, mexe nas entradas e fecha de novo (a adulteração mais comum: editar e re-zipar). */
const tamper = (bytes: Uint8Array, f: (e: ZipEntry[]) => ZipEntry[] | void) => { const e = readZip(bytes); return writeZip(f(e) ?? e); };
const editJson = (e: ZipEntry[], path: string, f: (o: any) => void) => { const x = e.find((x) => x.path === path)!; const o = json(x.data); f(o); x.data = enc(JSON.stringify(o)); };

// --- readZip: recusa o que o escritor nunca produz ---
{
  const ok = writeZip([{ path: 'a.txt', data: enc('a') }, { path: 'assets/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  assert.deepEqual(readZip(ok).map((e) => e.path), ['a.txt', 'assets/b.bin']);
  assert.throws(() => readZip(new Uint8Array(10)), /pequeno demais/);
  assert.throws(() => readZip(new Uint8Array(100)), /fim do ZIP/);
  for (const name of ['../x', 'a/../b', '/abs', 'C:/x', 'a\\b', 'a//b', './a', 'x\u0000']) assert.throws(() => readZip(writeZip([{ path: name, data: enc('x') }])), /nome de arquivo perigoso/, name);
  const dv = (z: Uint8Array) => new DataView(z.buffer, z.byteOffset, z.byteLength);
  const flip = (z: Uint8Array, f: (d: DataView) => void) => { const c = z.slice(); f(dv(c)); return c; };
  const cd = dv(ok).getUint32(ok.length - 22 + 16, true);
  assert.throws(() => readZip(flip(ok, (d) => d.setUint16(cd + 10, 8, true))), /compressão não é aceita/);     // método deflate no central
  assert.throws(() => readZip(flip(ok, (d) => d.setUint16(cd + 8, 0x0008, true))), /descritor de dados/);
  assert.throws(() => readZip(flip(ok, (d) => d.setUint16(cd + 8, 0x0001, true))), /senha/);
  assert.throws(() => readZip(flip(ok, (d) => d.setUint32(cd + 20, 5, true))), /tamanhos inconsistentes/);
  assert.throws(() => readZip(flip(ok, (d) => d.setUint16(ok.length - 22 + 10, 0xffff, true))), /ZIP64/);
  assert.throws(() => readZip(flip(ok, (d) => d.setUint8(35, 0x62))), /conteúdo corrompido \(a\.txt\)/);        // dado de 'a' vira 'b': CRC não bate
  assert.throws(() => readZip(flip(ok, (d) => d.setUint32(ok.length - 22 + 16, cd + 1, true))), /diretório central/);
}

// --- pacote de referência ---
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]);
const mp4 = new Uint8Array(2048).map((_, i) => (i * 13) & 0xff);
const look = { bgVideo: '' };
const input = (): ShowPackInput => ({
  name: 'Show A', appVersion: '0.3.1',
  state: {
    visual: { v: 1, data: { size: 61, bgVideo: 'v1' } },
    trans: { v: 1, data: 8 },
    videos: { v: 1, data: [{ id: 'v1', name: 'loop' }] },
    scenes: { v: 1, data: [{ name: 'Um', look: { bgVideo: 'v1' } }, { name: 'Dois', look }, null, null, null, null, null, null] },
    roteiros: { v: 1, data: [{ id: 'r1', name: 'Rot', track: 'abc.mp3', trackName: 'Faixa', bpm: 145, anchor: 0, barShift: 0, goBeat: 0, cues: [{ id: 'c1', beat: 0, kind: 'video', video: 'v1' }, { id: 'c2', beat: 8, kind: 'scene', scene: 1 }] }] },
    midi: { v: 1, data: { 'cc:1:7': { id: 'v:size', label: 'Tamanho' } } },
  },
  assets: [
    { kind: 'logo', refId: 'logo', mime: 'image/png', name: 'logo.png', bytes: png },
    { kind: 'video', refId: 'v1', mime: 'video/mp4', name: 'loop.mp4', bytes: mp4 },
  ],
});
const pack = (await buildShowPack(input())).bytes;

// --- deps em memória ---
const mk = (failOn?: string) => {
  const assets = new Map<string, Blob>(), ls = new Map<string, string>();
  let backups = 0;
  const deps: ApplyDeps = {
    backup: async () => { backups++; },
    getAsset: async (k) => assets.get(k),
    setAsset: async (k, v) => { if (k === failOn) throw new Error('IndexedDB cheio'); v ? assets.set(k, v) : assets.delete(k); },
    listVideoIds: () => [...assets.keys()].filter((k) => k.startsWith('video:')).map((k) => k.slice(6)),
    getText: (k) => ls.get(k) ?? null,
    setText: (k, t) => { t == null ? ls.delete(k) : ls.set(k, t); },
  };
  const key = (k: string) => JSON.parse(ls.get(k)!);
  const snapshot = () => JSON.stringify([[...ls], [...assets].map(([k, b]) => [k, b.size])]);
  return { assets, ls, deps, key, snapshot, backups: () => backups };
};
const seed = (m: ReturnType<typeof mk>) => {
  m.assets.set('logo', new File([enc('antiga')], 'antiga.png', { type: 'image/png' }));
  m.assets.set('video:old', new File([enc('velho')], 'velho.mp4', { type: 'video/mp4' }));
  m.ls.set('doublek.videos', JSON.stringify({ v: 1, data: [{ id: 'old', name: 'velho' }] }));
  m.ls.set('doublek.roteiros', JSON.stringify({ v: 1, data: [{ id: 'r0', name: 'Antigo', track: '', trackName: '', bpm: 0, anchor: 0, barShift: 0, goBeat: 0, cues: [] }] }));
  m.ls.set('doublek.midi', JSON.stringify({ v: 1, data: { 'cc:2:2': { id: 'v:glow', label: 'Glow' } } }));
};

// --- (1) inspeção do pacote bom ---
const insp = await inspectShowPack(pack);
assert.ok(insp.ok, (insp as any).error);
const plan = (insp as { ok: true; plan: Plan }).plan;
assert.equal(plan.visual.size, 61);
assert.equal(plan.visual.bgVideo, 'v1');
assert.equal(plan.trans, 8);
// pacote sem banks.json (como os gerados antes da DK-041): um banco "Principal" com o scenes.json
assert.deepEqual([plan.banks.active, plan.banks.banks.length, plan.banks.banks[0].name], [0, 1, 'Principal']);
assert.equal(plan.banks.banks[0].scenes.length, 8);
assert.equal(plan.banks.banks[0].scenes[0]!.look.bgVideo, 'v1');
assert.equal(plan.roteiros[0].cues.length, 2);
assert.equal(plan.midi!['cc:1:7'].id, 'v:size');
assert.equal(plan.assets.length, 2);
assert.deepEqual(plan.assets[1].bytes, mp4);
assert.deepEqual(plan.warnings, ['roteiro "Rot": música "Faixa" não veio no pacote; use "Trocar música"']); // includeTracks=false

// --- (2) aplicar em modo 'replace' ---
{
  const m = mk(); seed(m);
  const rep = await applyShowPack(plan, 'replace', m.deps);
  assert.equal(m.backups(), 1);
  assert.deepEqual(rep, { mode: 'replace', assets: 2, videos: 1, roteiros: 1, idMap: {}, warnings: plan.warnings });
  assert.deepEqual([...m.assets.keys()].sort(), ['logo', 'video:v1']);          // bg ausente no pacote → removido; vídeo velho → removido
  assert.equal((m.assets.get('logo') as File).name, 'logo.png');
  assert.equal(m.assets.get('video:v1')!.size, 2048);
  assert.equal(m.key('doublek.visual').v, 1);
  assert.equal(m.key('doublek.visual').data.size, 61);
  assert.equal(m.key('doublek.visual').data.blackout, false);
  assert.equal(m.key('doublek.trans').data, 8);
  assert.deepEqual(m.key('doublek.videos').data, [{ id: 'v1', name: 'loop' }]);
  assert.equal(m.key('doublek.scenes').data[0].look.bgVideo, 'v1');
  assert.deepEqual(m.key('doublek.roteiros').data.map((r: any) => r.id), ['r1']);
  assert.equal(m.key('doublek.midi').data['cc:2:2'].id, 'v:glow');              // midi não aplicado sem applyMidi
  const m2 = mk(); seed(m2);
  await applyShowPack({ ...plan, applyMidi: true }, 'replace', m2.deps);
  assert.deepEqual(Object.keys(m2.key('doublek.midi').data), ['cc:1:7']);
}

// --- (3) modo 'new': ids novos, referências reescritas, estado antigo preservado ---
{
  const m = mk(); seed(m);
  const rep = await applyShowPack(plan, 'new', m.deps);
  const nv = rep.idMap['v1'];
  assert.ok(nv && nv !== 'v1' && /^[a-z0-9]{8}$/.test(nv));
  assert.deepEqual([...m.assets.keys()].sort(), ['logo', 'video:old', `video:${nv}`].sort());
  assert.equal((m.assets.get('logo') as File).name, 'antiga.png');               // logo mantida sem replaceLogoBg
  assert.equal(m.key('doublek.visual').data.bgVideo, nv);
  assert.equal(m.key('doublek.scenes').data[0].look.bgVideo, nv);
  assert.deepEqual(m.key('doublek.videos').data, [{ id: 'old', name: 'velho' }, { id: nv, name: 'loop' }]);
  const rots = m.key('doublek.roteiros').data;
  assert.deepEqual(rots.map((r: any) => r.name), ['Antigo', 'Rot']);
  assert.notEqual(rots[1].id, 'r1');
  assert.equal(rots[1].cues[0].video, nv);
  assert.notEqual(rots[1].cues[0].id, 'c1');
  assert.equal(rots[1].track, 'abc.mp3');                                        // sem música no pacote: id fica para "Trocar música"
  const m2 = mk(); seed(m2);
  await applyShowPack({ ...plan, replaceLogoBg: true }, 'new', m2.deps);
  assert.equal((m2.assets.get('logo') as File).name, 'logo.png');
}

// --- (4) rollback: falha no 2º asset deixa tudo como estava ---
{
  const m = mk('video:v1'); seed(m);
  const before = m.snapshot();
  await assert.rejects(applyShowPack(plan, 'replace', m.deps), /importação desfeita: IndexedDB cheio/);
  assert.equal(m.snapshot(), before);
  assert.equal(m.backups(), 1);
}

// --- (5) recusas da inspeção ---
await bad(new Uint8Array(30), /inválido/);
await bad(writeZip([{ path: 'visual.json', data: enc('{}') }]), /manifest\.json ausente/);
await bad(tamper(pack, (e) => editJson(e, 'manifest.json', (o) => (o.schemaVersion = 2))), /versão mais nova/);
await bad(tamper(pack, (e) => { e.find((x) => x.path === 'assets/logo.png')!.data = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]); }), /logo\.png: conteúdo não bate com o hash/);
await bad(tamper(pack, (e) => editJson(e, 'manifest.json', (o) => (o.assets[0].bytes = 11))), /logo\.png: tamanho diferente do manifesto \(10 ≠ 11/);
await bad(tamper(pack, (e) => e.filter((x) => x.path !== 'assets/v1.mp4')), /v1\.mp4: falta no pacote/);
await bad(tamper(pack, (e) => [...e, { path: 'assets/extra.bin', data: enc('x') }]), /fora do manifesto: assets\/extra\.bin/);
await bad(writeZip([...readZip(pack), { path: '../fora.txt', data: enc('x') }]), /nome de arquivo perigoso/);
await bad(tamper(pack, (e) => e.filter((x) => x.path !== 'scenes.json')), /scenes\.json ausente/);
await bad(tamper(pack, (e) => editJson(e, 'visual.json', (o) => (o['doublek.visual'] = { size: 1 }))), /visual\.json: "doublek\.visual" ausente ou sem envelope/);
await bad(tamper(pack, (e) => editJson(e, 'visual.json', (o) => (o['doublek.visual'].v = 99))), /visual\.json: doublek\.visual: versão 99 é mais nova/);
await bad(tamper(pack, (e) => editJson(e, 'scenes.json', (o) => (o['doublek.scenes'].data = []))), /scenes\.json: cenas: precisa de 8/);
await bad(tamper(pack, (e) => { e.find((x) => x.path === 'roteiros.json')!.data = enc('{"doublek.roteiros": [}'); }), /roteiros\.json: JSON inválido/);
await bad(tamper(pack, (e) => editJson(e, 'visual.json', (o) => (o['doublek.visual'].data.bgVideo = 'zz'))), /visual usa o vídeo zz/);
await bad(tamper(pack, (e) => editJson(e, 'scenes.json', (o) => (o['doublek.scenes'].data[1].look.bgVideo = 'zz'))), /cena 2 usa o vídeo zz/);
await bad(tamper(pack, (e) => editJson(e, 'roteiros.json', (o) => (o['doublek.roteiros'].data[0].cues[0].video = 'zz'))), /roteiro "Rot" usa o vídeo zz/);
await bad(tamper(pack, (e) => editJson(e, 'visual.json', (o) => o['doublek.videos'].data.push({ id: 'zz', name: 'fantasma' }))), /vídeo "fantasma" \(zz\) está na lista mas não no pacote/);
await bad(tamper(pack, (e) => editJson(e, 'manifest.json', (o) => (o.includeTracks = true))), /roteiro "Rot" usa a música abc\.mp3, que não está no pacote/);
{
  // vídeo no pacote fora da lista: só aviso; sem midi.json: midi null
  const r = await inspectShowPack(tamper(pack, (e) => { editJson(e, 'visual.json', (o) => (o['doublek.videos'].data = [])); return e.filter((x) => x.path !== 'midi.json'); }));
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.plan.midi, null); assert.ok(r.plan.warnings.some((w) => /vídeo v1 está no pacote mas não na lista/.test(w))); }
}

// --- (6) música: addTrack obrigatório quando o pacote traz track; rollback remove ---
{
  const withTrack = (await buildShowPack({ ...input(), assets: [...input().assets, { kind: 'track', refId: 'abc.mp3', mime: 'audio/mpeg', name: 'abc.mp3', bytes: new Uint8Array([7, 7, 7]) }] }, { includeTracks: true })).bytes;
  const r = await inspectShowPack(withTrack);
  assert.ok(r.ok, (r as any).error);
  const p = (r as { ok: true; plan: Plan }).plan;
  assert.deepEqual(p.warnings, []);
  const m = mk();
  await assert.rejects(applyShowPack(p, 'replace', m.deps), /ainda não importa músicas/);
  const added: string[] = [], removed: string[] = [];
  const m2 = mk();
  const rep = await applyShowPack(p, 'new', { ...m2.deps, addTrack: async (id) => { added.push(id); }, removeTrack: async (id) => { removed.push(id); } });
  assert.match(rep.idMap['abc.mp3'], /^[a-z0-9]{8}\.mp3$/);
  assert.deepEqual(added, [rep.idMap['abc.mp3']]);
  assert.equal(m2.key('doublek.roteiros').data[0].track, rep.idMap['abc.mp3']);
  const m3 = mk();
  m3.deps.setText = () => { throw new Error('localStorage cheio'); };
  await assert.rejects(applyShowPack(p, 'replace', { ...m3.deps, addTrack: async (id) => { added.push(id); }, removeTrack: async (id) => { removed.push(id); } }), /desfeita: localStorage cheio/);
  assert.deepEqual(removed, ['abc.mp3']);
  // música que já existia (put_track devolve false): o rollback não a apaga
  removed.length = 0;
  await assert.rejects(applyShowPack(p, 'replace', { ...m3.deps, addTrack: async () => false, removeTrack: async (id) => { removed.push(id); } }), /desfeita/);
  assert.deepEqual(removed, []);
}

// --- bancos (DK-041): banks.json manda; doublek.scenes = banco ativo; ids reescritos em todos os bancos ---
{
  const eight = (s0: unknown) => [s0, null, null, null, null, null, null, null];
  const banks = { v: 1, data: { active: 1, banks: [
    { name: 'Principal', scenes: eight({ name: 'Um', look: {} }) },
    { name: 'Drops', scenes: eight({ name: 'Drop', look: { bgVideo: 'v1' } }) },
  ] } };
  const bp = (await buildShowPack({ ...input(), state: { ...input().state, banks } })).bytes;
  const r = await inspectShowPack(bp);
  assert.ok(r.ok, (r as any).error);
  const p = (r as { ok: true; plan: Plan }).plan;
  assert.deepEqual([p.banks.active, p.banks.banks.map((b) => b.name).join()], [1, 'Principal,Drops']);
  const m = mk(); seed(m);
  await applyShowPack(p, 'replace', m.deps);
  assert.deepEqual(m.key('doublek.banks').data.banks.map((b: any) => b.name), ['Principal', 'Drops']);
  assert.equal(m.key('doublek.banks').v, 1);
  assert.equal(m.key('doublek.scenes').data[0].name, 'Drop');                // banco ativo espelhado
  const m2 = mk(); seed(m2);
  const rep = await applyShowPack(p, 'new', m2.deps);
  assert.equal(m2.key('doublek.banks').data.banks[1].scenes[0].look.bgVideo, rep.idMap['v1']);
  assert.equal(m2.key('doublek.scenes').data[0].look.bgVideo, rep.idMap['v1']);
  await bad(tamper(bp, (e) => editJson(e, 'banks.json', (o) => (o['doublek.banks'].data.banks[1].scenes[0].look.bgVideo = 'zz'))), /banco 2, cena 1 usa o vídeo zz/);
  await bad(tamper(bp, (e) => editJson(e, 'banks.json', (o) => (o['doublek.banks'].data = { banks: [] }))), /banks\.json: bancos: nenhum banco/);
  await bad(tamper(bp, (e) => editJson(e, 'banks.json', (o) => (o['doublek.banks'].v = 2))), /banks\.json: doublek\.banks: versão 2 é mais nova/);
}

console.log('showpack/import: ok');
