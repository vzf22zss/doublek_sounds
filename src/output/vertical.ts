// Vertical 9:16 sem cópia por quadro (D-18): captureStream do canvas do telão → MediaStreamTrackProcessor →
// VideoFrame recortado (`visibleRect`, não copia pixels) → VideoEncoder H.264 no tamanho de saída (ele escala) →
// MP4 fragmentado montado aqui (`fmp4.ts`), um fragmento por quadro-chave (~1 s). Expõe a mesma superfície que o
// `record.ts` usa do MediaRecorder; qualquer coisa sem suporte lança antes de começar e o chamador cai na cópia 2D.
import { cropRect, evenRect, type Framing, type WebCodecsSupport } from '../lib/recorder';
import { fragmenter, initSegment } from '../lib/fmp4';

// Chromium/WebView2: o processador de faixa existe na janela (ainda não está no lib.dom do TypeScript)
type Processor = { readable: ReadableStream<VideoFrame> };
declare const MediaStreamTrackProcessor: { new (init: { track: MediaStreamTrack }): Processor } | undefined;

export const webCodecsSupport = (): WebCodecsSupport => ({
  processor: typeof MediaStreamTrackProcessor === 'function',
  encoder: typeof VideoEncoder === 'function',
  frame: typeof VideoFrame === 'function',
});

export type FrameRec = {
  state: RecordingState;
  stream: MediaStream;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: { error?: Error }) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
};

const join = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
const bytes = (d: AllowSharedBufferSource) =>
  ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));

/** Recorte 9:16 w×h do canvas por WebCodecs. Lança se o WebView não codifica esse H.264 ou não aceita o recorte. */
export async function webCodecsRecorder(canvas: HTMLCanvasElement, o: { mime: string; fps: number; bitrate: number; w: number; h: number },
  framing: () => Framing): Promise<FrameRec> {
  const codec = o.mime.split('codecs=')[1] ?? '';
  const cfg: VideoEncoderConfig = { codec, width: o.w, height: o.h, bitrate: o.bitrate, framerate: o.fps, avc: { format: 'avc' } };
  if (!(await VideoEncoder.isConfigSupported(cfg)).supported) throw new Error(`o WebView não codifica ${codec} em ${o.w}×${o.h}`);
  const stream = canvas.captureStream(o.fps), track = stream.getVideoTracks()[0];
  const reader = new MediaStreamTrackProcessor!({ track }).readable.getReader();
  const crop = (f: VideoFrame) => {
    const W = f.displayWidth, H = f.displayHeight;
    return new VideoFrame(f, { visibleRect: evenRect(cropRect(W, H, o.w, o.h, framing()), W, H), displayWidth: o.w, displayHeight: o.h });
  };
  // ensaio no 1º quadro: recorte aceito? (WebView antigo / formato sem recorte → cópia 2D)
  try {
    const first = await Promise.race([reader.read(), new Promise<never>((_, no) => setTimeout(() => no(new Error('o telão não entregou quadro')), 2000))]);
    if (first.done) throw new Error('o telão não entregou quadro');
    try { crop(first.value).close(); } finally { first.value.close(); }
  } catch (err) {
    reader.cancel().catch(() => {}); track.stop();
    throw err;
  }

  const frag = fragmenter(o.fps);
  let init: Uint8Array | null = null, sentInit = false, lastKey = -Infinity;
  const r: FrameRec = { state: 'inactive', stream, ondataavailable: null, onstop: null, onerror: null, start, stop };
  /** Um fragmento pronto vai como pedaço; o 1º leva na frente o ftyp + moov. */
  const send = (b: Uint8Array | null) => {
    if (!b) return;
    if (!sentInit) {
      if (!init) return error(new Error('o codificador não mandou o avcC'));
      sentInit = true;
      b = join(init, b);
    }
    r.ondataavailable?.({ data: new Blob([b as Uint8Array<ArrayBuffer>]) });
  };
  const error = (e: unknown) => r.onerror?.({ error: e instanceof Error ? e : new Error(String(e)) });
  const enc: VideoEncoder = new VideoEncoder({
    output: (chunk, md) => {
      const d = md?.decoderConfig?.description;
      if (d && !init) init = initSegment(o.w, o.h, bytes(d));
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      send(frag.push(data, chunk.timestamp, chunk.type === 'key'));
    },
    error,
  });
  enc.configure(cfg);

  function start() {
    r.state = 'recording';
    (async () => {
      while (r.state === 'recording') {
        const { value: f, done } = await reader.read();
        if (done) break;
        try {
          // codificador atrasado: pula o quadro (o MP4 guarda a duração real pelo timestamp)
          if (r.state === 'recording' && enc.state === 'configured' && enc.encodeQueueSize < 4) {
            const v = crop(f), key = f.timestamp - lastKey >= 1_000_000; // quadro-chave a cada 1 s = um fragmento por segundo
            if (key) lastKey = f.timestamp;
            enc.encode(v, { keyFrame: key });
            v.close();
          }
        } finally { f.close(); }
      }
    })().catch(error);
  }
  function stop() {
    if (r.state === 'inactive') return;
    r.state = 'inactive';
    reader.cancel().catch(() => {});
    track.stop();
    enc.flush().then(() => { send(frag.end()); enc.close(); r.onstop?.(); }, error);
  }
  return r;
}
