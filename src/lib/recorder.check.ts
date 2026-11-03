// npm run check — gravação (DK-072): codec, nome, máquina de estados e aviso de desempenho.
import assert from 'node:assert/strict';
import { BITRATE, cropRect, evenRect, IDLE, pickMime, recLabel, recName, reduce, verticalPath, verticalSize, type RecEvent, type RecState } from './recorder.ts';

// codec: MP4/H.264 primeiro (nível certo para o fps), depois WebM
const all = () => true, only = (...ok: string[]) => (m: string) => ok.includes(m);
assert.deepEqual(pickMime(30, all), { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' });
assert.deepEqual(pickMime(60, all), { mime: 'video/mp4;codecs=avc1.64002A', ext: 'mp4' });
assert.deepEqual(pickMime(30, only('video/webm;codecs=vp9', 'video/webm')), { mime: 'video/webm;codecs=vp9', ext: 'webm' });
assert.deepEqual(pickMime(60, only('video/webm;codecs=vp8')), { mime: 'video/webm;codecs=vp8', ext: 'webm' });
assert.deepEqual(pickMime(30, only('video/webm')), { mime: 'video/webm', ext: 'webm' });
assert.equal(pickMime(30, () => false), null);
assert.deepEqual(pickMime(30, all, true), { mime: 'video/webm;codecs=vp9', ext: 'webm' }, 'MP4 que não fragmenta: WebM daqui em diante');
assert.equal(pickMime(30, () => { throw new Error('x'); }), null, 'isTypeSupported que lança = sem suporte');
assert.ok(BITRATE.LEVE < BITRATE.MEDIA && BITRATE.MEDIA < BITRATE.ALTA);

// nome aceito pelo Rust (track::check_id: só letras, números e um ponto; nada de ..)
const n = recName(new Date(2026, 9, 30, 23, 5, 9), 'mp4');
assert.equal(n, '20261030T230509.mp4');
assert.match(n, /^[A-Za-z0-9]+\.(mp4|webm)$/);
assert.equal(recName(new Date(2026, 0, 2, 3, 4, 5), 'webm'), '20260102T030405.webm');

// máquina de estados
const run = (evs: RecEvent[], s: RecState = IDLE) => evs.reduce(reduce, s);
let s = run([{ t: 'start', id: n, mime: 'video/mp4;codecs=avc1.640028', at: 1000, p95: 10 }]);
assert.equal(s.phase, 'starting');
assert.equal(reduce(s, { t: 'start', id: 'x.mp4', mime: '', at: 0, p95: 0 }).message, 'Já está gravando.');
s = run([{ t: 'started', at: 1100 }], s);
assert.equal(s.phase, 'recording');
assert.match(s.message, /Gravando a saída do telão \(MP4, sem áudio\)/);
s = run([{ t: 'progress', bytes: 5 * 1048576, at: 1100 + 65_000 }], s);
assert.equal(recLabel(s), '01:05 · 5.0 MB');
s = run([{ t: 'stop' }], s);
assert.equal(s.phase, 'stopping');
assert.equal(reduce(s, { t: 'stop' }).phase, 'stopping', 'parar duas vezes não muda nada');
s = run([{ t: 'progress', bytes: 6 * 1048576, at: 1100 + 66_000 }], s);
assert.equal(s.bytes, 6 * 1048576, 'o último pedaço ainda chega durante a finalização');
s = run([{ t: 'done', path: 'C:/rec/' + n, bytes: 6 * 1048576 }], s);
assert.equal(s.phase, 'idle');
assert.equal(s.path, 'C:/rec/' + n);
assert.equal(s.message, `Gravação salva: C:/rec/${n} (6.0 MB).`);
// parada automática (limite) e erro
assert.match(run([{ t: 'done', path: 'p', bytes: 1, reason: 'limite de 4 GiB por gravação' }]).message, /parou sozinha: limite de 4 GiB/);
const e = run([{ t: 'start', id: n, mime: 'video/webm', at: 0, p95: 0 }, { t: 'started', at: 0 }, { t: 'error', message: 'disco cheio' }], { ...IDLE, path: 'anterior' });
assert.deepEqual([e.phase, e.path, e.message], ['idle', 'anterior', 'A gravação parou: disco cheio. O telão segue normal.']);
// eventos fora de hora não mudam o estado
assert.equal(run([{ t: 'started', at: 1 }]).phase, 'idle');
assert.equal(run([{ t: 'progress', bytes: 9, at: 9 }]).bytes, 0);
assert.equal(run([{ t: 'stop' }]).phase, 'idle');

// aviso de desempenho: p95 > 1,3× o de antes, depois de 3 s gravando, uma vez só
s = run([{ t: 'start', id: n, mime: 'video/mp4', at: 0, p95: 10 }, { t: 'started', at: 0 }]);
assert.equal(reduce(s, { t: 'telemetry', p95: 20, at: 2000 }).warned, false, 'antes de 3 s: espera assentar');
assert.equal(reduce(s, { t: 'telemetry', p95: 12.9, at: 5000 }).warned, false, '+29%: ok');
const w = reduce(s, { t: 'telemetry', p95: 13.5, at: 5000 });
assert.ok(w.warned);
assert.match(w.message, /pesando no telão \(p95 10\.0 → 13\.5 ms\): baixe para 30 fps ou qualidade Leve/);
assert.equal(reduce(w, { t: 'telemetry', p95: 30, at: 9000 }).message, '', 'avisa uma vez só');
assert.equal(run([{ t: 'start', id: n, mime: 'video/mp4', at: 0, p95: 0 }, { t: 'started', at: 0 }, { t: 'telemetry', p95: 99, at: 9000 }]).warned, false, 'sem telemetria de antes: não compara');

// --- vertical 9:16 (DK-073) ---
{
  assert.equal(recName(new Date(2026, 9, 30, 23, 5, 9), 'mp4', true), '20261030T230509V9x16.mp4');
  assert.match(recName(new Date(), 'webm', true), /^[A-Za-z0-9]+\.(mp4|webm)$/, 'nome vertical aceito pelo track::check_id');
  assert.deepEqual(verticalSize('LEVE'), { w: 720, h: 1280 });
  assert.deepEqual(verticalSize('ALTA'), { w: 1080, h: 1920 });
  // padrão no telão 1920×1080: faixa central 9:16 da altura inteira
  const c0 = cropRect(1920, 1080, 1080, 1920, { zoom: 1, offset: 0 });
  assert.deepEqual([c0.sx, c0.sy, c0.sh].map((x) => +x.toFixed(3)), [656.25, 0, 1080]);
  assert.ok(Math.abs(c0.sw - 607.5) < 1e-9);
  assert.equal(cropRect(1920, 1080, 1080, 1920, { zoom: 1, offset: -1 }).sx, 0, 'offset −1 encosta na esquerda');
  const r = cropRect(1920, 1080, 1080, 1920, { zoom: 1, offset: 1 });
  assert.ok(Math.abs(r.sx + r.sw - 1920) < 1e-9, 'offset 1 encosta na direita');
  const z2 = cropRect(1920, 1080, 1080, 1920, { zoom: 2, offset: 0 });
  assert.ok(Math.abs(z2.sh - 540) < 1e-9 && Math.abs(z2.sy - 270) < 1e-9, 'zoom 2: metade da altura, centrado na logo');
  // fora da faixa é trazido para dentro
  assert.deepEqual(cropRect(1920, 1080, 1080, 1920, { zoom: 9, offset: 5 }), cropRect(1920, 1080, 1080, 1920, { zoom: 3, offset: 1 }));
  assert.deepEqual(cropRect(1920, 1080, 1080, 1920, { zoom: 0.2, offset: NaN }), cropRect(1920, 1080, 1080, 1920, { zoom: 1, offset: 0 }));
  // varredura: qualquer telão (paisagem, 4:3, ultra-wide, retrato), qualquer zoom/offset → dentro do canvas e com o aspecto da saída
  let n = 0;
  for (const [W, H] of [[1920, 1080], [1280, 720], [1024, 768], [3440, 1440], [1080, 1920], [800, 800], [641, 359]])
    for (const [ow, oh] of [[1080, 1920], [720, 1280]])
      for (let z = 1; z <= 3; z += 0.25)
        for (let o = -1; o <= 1; o += 0.125) {
          const q = cropRect(W, H, ow, oh, { zoom: z, offset: o });
          const eps = 1e-6;
          assert.ok(q.sx >= -eps && q.sy >= -eps && q.sx + q.sw <= W + eps && q.sy + q.sh <= H + eps, `${W}×${H} z${z} o${o}: dentro`);
          assert.ok(Math.abs(q.sw / q.sh - ow / oh) < 1e-9, 'aspecto da saída');
          assert.ok(q.sw > 0 && q.sh > 0);
          n++;
        }
  assert.equal(n, 7 * 2 * 9 * 17, `${n} combinações conferidas`);
}

assert.match(run([{ t: 'start', id: 'x.mp4', mime: 'video/mp4', at: 0, p95: 0, vertical: true }, { t: 'started', at: 0 }]).message, /\(MP4, vertical 9:16, sem áudio\)/);

// D-18: caminho do vertical — WebCodecs só com as três APIs, MP4/H.264 e sem falha anterior; o resto cai na cópia 2D
const tem = { processor: true, encoder: true, frame: true };
const MP4 = 'video/mp4;codecs=avc1.640028';
assert.equal(verticalPath(tem, MP4, false), 'webcodecs');
assert.equal(verticalPath(tem, 'video/mp4;codecs=avc1.64002A', false), 'webcodecs', '60 fps');
assert.equal(verticalPath({ ...tem, processor: false }, MP4, false), '2d', 'WebView sem MediaStreamTrackProcessor');
assert.equal(verticalPath({ ...tem, encoder: false }, MP4, false), '2d', 'sem VideoEncoder');
assert.equal(verticalPath({ ...tem, frame: false }, MP4, false), '2d', 'sem VideoFrame');
assert.equal(verticalPath(tem, 'video/webm;codecs=vp9', false), '2d', 'WebM: o MP4 fragmentado é só H.264');
assert.equal(verticalPath(tem, MP4, true), '2d', 'falhou nesta sessão: não tenta de novo');

// recorte em pixels pares e sempre dentro do quadro, para todo telão/zoom/posição
for (const [W, H] of [[1920, 1080], [1280, 720], [1366, 768], [801, 601], [1080, 1920], [3840, 1080], [3, 3]])
  for (const [w, h] of [[1080, 1920], [720, 1280]])
    for (let z = 1; z <= 3; z += 0.25)
      for (let off = -1; off <= 1; off += 0.125) {
        const c = cropRect(W, H, w, h, { zoom: z, offset: off }), r = evenRect(c, W, H);
        assert.ok([r.x, r.y, r.width, r.height].every((v) => Number.isInteger(v) && v % 2 === 0), `pares ${W}×${H} z${z} ${off}: ${JSON.stringify(r)}`);
        assert.ok(r.width >= 2 && r.height >= 2 && r.x + r.width <= W && r.y + r.height <= H, `dentro ${W}×${H} z${z} ${off}: ${JSON.stringify(r)}`);
        if (W >= 100) assert.ok(Math.abs(r.width - c.sw) <= 2 && Math.abs(r.height - c.sh) <= 2 && Math.abs(r.x - c.sx) <= 2, 'perto do recorte exato');
      }
assert.deepEqual(evenRect(cropRect(1280, 720, 1080, 1920, { zoom: 1, offset: 0 }), 1280, 720), { x: 436, y: 0, width: 404, height: 720 });

console.log('recorder: ok');
