// MP4 fragmentado mínimo (ISO BMFF) para uma faixa H.264 vinda do VideoEncoder (D-18): o segmento de início
// (ftyp + moov com o avcC) e um fragmento (moof + mdat) por quadro-chave, ~1 s cada — o mesmo ritmo de pedaços que o
// MediaRecorder entrega hoje para o `rec_chunk`. Só o necessário para tocar em qualquer player; sem áudio.

const enc = new TextEncoder();
const u8 = (...a: number[]) => Uint8Array.from(a);
const u16 = (v: number) => u8(v >>> 8 & 255, v & 255);
const u32 = (v: number) => u8(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255);
const u64 = (v: number) => { const hi = Math.floor(v / 2 ** 32); return cat(u32(hi), u32(v - hi * 2 ** 32)); };
const zeros = (n: number) => new Uint8Array(n);
function cat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const box = (type: string, ...body: Uint8Array[]) => { const b = cat(...body); return cat(u32(8 + b.length), enc.encode(type), b); };
const full = (type: string, version: number, flags: number, ...body: Uint8Array[]) => box(type, u8(version, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255), ...body);
const MATRIX = cat(u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000));

/** Escala de tempo da faixa: microssegundos, a mesma dos timestamps de VideoFrame/EncodedVideoChunk. */
export const TIMESCALE = 1_000_000;

/** ftyp + moov de uma faixa de vídeo w×h; `avcC` = `decoderConfig.description` do VideoEncoder (formato 'avc'). */
export function initSegment(w: number, h: number, avcC: Uint8Array): Uint8Array {
  const ftyp = box('ftyp', enc.encode('isom'), u32(0x200), enc.encode('isomiso5iso6avc1mp41'));
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2));
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(0), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(w * 65536), u32(h * 65536));
  const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(0), u16(0x55c4), u16(0));
  const hdlr = full('hdlr', 0, 0, u32(0), enc.encode('vide'), zeros(12), enc.encode('DoubleK\0'));
  const avc1 = box('avc1', zeros(6), u16(1), zeros(16), u16(w), u16(h), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box('avcC', avcC));
  const stbl = box('stbl', full('stsd', 0, 0, u32(1), avc1), full('stts', 0, 0, u32(0)), full('stsc', 0, 0, u32(0)), full('stsz', 0, 0, u32(0), u32(0)), full('stco', 0, 0, u32(0)));
  const minf = box('minf', full('vmhd', 0, 1, zeros(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
  const trak = box('trak', tkhd, box('mdia', mdhd, hdlr, minf));
  const mvex = box('mvex', full('trex', 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)));
  return cat(ftyp, box('moov', mvhd, trak, mvex));
}

export type Sample = { data: Uint8Array; duration: number; key: boolean };

/** moof + mdat com as amostras em ordem; `base` = tempo de decodificação da primeira (na TIMESCALE). */
export function fragment(seq: number, base: number, samples: Sample[]): Uint8Array {
  const trunBody = (offset: number) => cat(u32(samples.length), u32(offset),
    ...samples.map((s) => cat(u32(s.duration), u32(s.data.length), u32(s.key ? 0x02000000 : 0x01010000))));
  // flags do trun: data-offset, duração, tamanho e flags por amostra
  const moof = (offset: number) => box('moof', full('mfhd', 0, 0, u32(seq)),
    box('traf', full('tfhd', 0, 0x020000, u32(1)), full('tfdt', 1, 0, u64(base)), full('trun', 0, 0x000701, trunBody(offset))));
  const size = moof(0).length; // o deslocamento não muda o tamanho do moof
  return cat(moof(size + 8), box('mdat', ...samples.map((s) => s.data)));
}

/**
 * Junta os pedaços do VideoEncoder em fragmentos: um fragmento fecha quando chega o próximo quadro-chave (a duração
 * de cada amostra é a distância até a seguinte). `end()` fecha o último com a duração do quadro anterior.
 */
export function fragmenter(fps: number) {
  let seq = 0, t0 = -1, pend: { data: Uint8Array; ts: number; key: boolean }[] = [], lastDur = Math.round(TIMESCALE / fps);
  const flush = (nextTs: number | null) => {
    if (!pend.length) return null;
    const samples = pend.map((p, i) => {
      const next = i + 1 < pend.length ? pend[i + 1].ts : nextTs;
      const d = next === null ? lastDur : Math.max(1, next - p.ts);
      return { data: p.data, duration: (lastDur = d), key: p.key };
    });
    const out = fragment(++seq, pend[0].ts - t0, samples);
    pend = [];
    return out;
  };
  return {
    /** Um pedaço codificado (timestamp em µs). Devolve um fragmento pronto quando este pedaço abre um novo. */
    push(data: Uint8Array, ts: number, key: boolean): Uint8Array | null {
      if (t0 < 0) { if (!key) return null; t0 = ts; } // o arquivo começa num quadro-chave
      const out = key ? flush(ts) : null;
      pend.push({ data, ts, key });
      return out;
    },
    end: () => flush(null),
  };
}
