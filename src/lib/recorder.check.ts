// npm run check — gravação (DK-072): codec, nome, máquina de estados e aviso de desempenho.
import assert from 'node:assert/strict';
import { BITRATE, IDLE, pickMime, recLabel, recName, reduce, type RecEvent, type RecState } from './recorder.ts';

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

console.log('recorder: ok');
