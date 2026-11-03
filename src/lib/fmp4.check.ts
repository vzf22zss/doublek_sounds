// npm run check — MP4 fragmentado do vertical (D-18): caixas bem formadas, deslocamento do trun aponta para o mdat,
// durações pelos timestamps, fragmento novo a cada quadro-chave, arquivo começa num quadro-chave.
import assert from 'node:assert/strict';
import { fragment, fragmenter, initSegment, TIMESCALE } from './fmp4.ts';

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const type = (b: Uint8Array, o: number) => String.fromCharCode(...b.subarray(o + 4, o + 8));
/** Caixas de primeiro nível (tipo, início, tamanho), conferindo que somam o arquivo inteiro. */
function boxes(b: Uint8Array, from = 0, to = b.length) {
  const out: { t: string; o: number; n: number }[] = [];
  for (let o = from; o < to;) { const n = dv(b).getUint32(o); assert.ok(n >= 8 && o + n <= to, `caixa ${type(b, o)} com tamanho ${n}`); out.push({ t: type(b, o), o, n }); o += n; }
  return out;
}
const find = (b: Uint8Array, path: string[], from = 0, to = b.length): { o: number; n: number } => {
  const x = boxes(b, from, to).find((y) => y.t === path[0]);
  assert.ok(x, `falta ${path[0]}`);
  if (path.length === 1) return x;
  const skip = ({ moov: 8, trak: 8, mdia: 8, minf: 8, stbl: 8, moof: 8, traf: 8, mvex: 8, dinf: 8 } as Record<string, number>)[path[0]];
  assert.ok(skip, `não sei descer em ${path[0]}`);
  return find(b, path.slice(1), x.o + skip, x.o + x.n);
};

// segmento de início: ftyp + moov, avcC dentro do avc1, tamanho do vídeo no tkhd
const avcC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);
const init = initSegment(1080, 1920, avcC);
assert.deepEqual(boxes(init).map((x) => x.t), ['ftyp', 'moov']);
const tkhd = find(init, ['moov', 'trak', 'tkhd']);
assert.equal(dv(init).getUint32(tkhd.o + tkhd.n - 8) / 65536, 1080);
assert.equal(dv(init).getUint32(tkhd.o + tkhd.n - 4) / 65536, 1920);
const mdhd = find(init, ['moov', 'trak', 'mdia', 'mdhd']);
assert.equal(dv(init).getUint32(mdhd.o + 20), TIMESCALE);
const stsd = find(init, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']);
const avc1 = stsd.o + 16;
assert.equal(type(init, avc1), 'avc1');
assert.equal(dv(init).getUint16(avc1 + 32), 1080);
assert.equal(dv(init).getUint16(avc1 + 34), 1920);
assert.equal(type(init, avc1 + 86), 'avcC');
assert.deepEqual([...init.subarray(avc1 + 94, avc1 + 94 + avcC.length)], [...avcC]);
find(init, ['moov', 'mvex', 'trex']);

// fragmento: data_offset do trun (relativo ao moof) cai no começo dos dados do mdat
const s = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const fr = fragment(3, 2_000_000, [{ data: s(10, 1), duration: 33_333, key: true }, { data: s(7, 2), duration: 33_334, key: false }]);
assert.deepEqual(boxes(fr).map((x) => x.t), ['moof', 'mdat']);
const trun = find(fr, ['moof', 'traf', 'trun']);
const off = dv(fr).getUint32(trun.o + 16);
const mdat = boxes(fr)[1];
assert.equal(off, mdat.o + 8);
assert.deepEqual([...fr.subarray(off, off + 10)], Array(10).fill(1));
assert.equal(dv(fr).getUint32(trun.o + 12), 2, 'duas amostras');
assert.deepEqual([dv(fr).getUint32(trun.o + 20), dv(fr).getUint32(trun.o + 24), dv(fr).getUint32(trun.o + 28).toString(16)], [33_333, 10, '2000000']);
assert.deepEqual([dv(fr).getUint32(trun.o + 32), dv(fr).getUint32(trun.o + 36), dv(fr).getUint32(trun.o + 40).toString(16)], [33_334, 7, '1010000']);
const tfdt = find(fr, ['moof', 'traf', 'tfdt']);
assert.equal(dv(fr).getBigUint64(tfdt.o + 12), 2_000_000n);
assert.equal(dv(fr).getUint32(find(fr, ['moof', 'mfhd']).o + 12), 3);

// fragmentador: descarta até o 1º quadro-chave; fecha um fragmento a cada quadro-chave novo; durações = diferenças
const f = fragmenter(30);
const T0 = 5_000_000;
assert.equal(f.push(s(5, 9), T0 - 33_333, false), null, 'antes do 1º quadro-chave: descartado');
const outs: Uint8Array[] = [];
for (let i = 0; i < 65; i++) { const o = f.push(s(4, i), T0 + i * 33_333, i % 30 === 0); if (o) outs.push(o); }
outs.push(f.end()!);
assert.equal(f.end(), null, 'end() duas vezes: nada');
assert.equal(outs.length, 3, '0–29, 30–59, 60–64');
const counts = outs.map((o) => dv(o).getUint32(find(o, ['moof', 'traf', 'trun']).o + 12));
assert.deepEqual(counts, [30, 30, 5]);
const bases = outs.map((o) => Number(dv(o).getBigUint64(find(o, ['moof', 'traf', 'tfdt']).o + 12)));
assert.deepEqual(bases, [0, 30 * 33_333, 60 * 33_333], 'tempo começa em 0 no 1º quadro-chave');
const durs = (o: Uint8Array) => { const t = find(o, ['moof', 'traf', 'trun']); const n = dv(o).getUint32(t.o + 12); return Array.from({ length: n }, (_, i) => dv(o).getUint32(t.o + 20 + i * 12)); };
assert.ok(durs(outs[0]).every((d) => d === 33_333));
assert.equal(durs(outs[2]).at(-1), 33_333, 'última amostra: duração da anterior');
assert.deepEqual(outs.map((o) => dv(o).getUint32(find(o, ['moof', 'mfhd']).o + 12)), [1, 2, 3], 'sequência dos fragmentos');
console.log('fmp4: ok');
