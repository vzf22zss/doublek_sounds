// npm run check — vídeo de fundo (DK-062): janela de loop, volta no compasso, 1 tocando + 1 pré-carregado.
import assert from 'node:assert/strict';
import { barDelayMs, loopWindow, nextVideo, toRelease, videoInfo, wrapTarget } from './videoloop.ts';

// metadados: campos novos opcionais; inválidos somem; nada de padrão acrescentado
assert.deepEqual(videoInfo({ id: 'a', name: 'x' }), { id: 'a', name: 'x' });
assert.deepEqual(videoInfo({ id: 'a', name: 'x', start: 1.5, end: 4, barRestart: true }), { id: 'a', name: 'x', start: 1.5, end: 4, barRestart: true });
assert.deepEqual(videoInfo({ id: 'a', name: 'x', start: -1, end: NaN, barRestart: 'sim' }), { id: 'a', name: 'x' });
assert.equal(videoInfo({ id: '', name: 'x' }), null);
assert.equal(videoInfo({ id: 'a' }), null);
assert.equal(videoInfo(null), null);

// janela: padrão = arquivo inteiro com o loop nativo
assert.deepEqual(loopWindow({}, 10), { start: 0, end: 10, native: true });
assert.deepEqual(loopWindow({ start: 0, end: 0 }, 10), { start: 0, end: 10, native: true });
assert.deepEqual(loopWindow({ start: 2, end: 6 }, 10), { start: 2, end: 6, native: false });
assert.deepEqual(loopWindow({ start: 2 }, 10), { start: 2, end: 10, native: false });
assert.deepEqual(loopWindow({ end: 99 }, 10), { start: 0, end: 10, native: true }, 'fim além do arquivo = até o fim');
assert.deepEqual(loopWindow({ start: 5, end: 5.05 }, 10), { start: 5, end: 10, native: false }, 'janela curta demais = até o fim');
assert.equal(loopWindow({ start: 50 }, 10).start, 9.9, 'início além do arquivo fica no último 0,1 s');
assert.deepEqual(loopWindow({ start: 1, end: 3 }, NaN), { start: 1, end: 3, native: false }, 'duração ainda desconhecida');

// volta para o início ao passar do fim, e se estiver antes do início
{
  const w = loopWindow({ start: 2, end: 6 }, 10);
  assert.equal(wrapTarget(3, w), null);
  assert.equal(wrapTarget(5.99, w), 2);
  assert.equal(wrapTarget(6.5, w), 2);
  assert.equal(wrapTarget(0.5, w), 2);
  assert.equal(wrapTarget(9, loopWindow({}, 10)), null, 'arquivo inteiro: o <video> cuida');
}

// reiniciar no compasso
assert.equal(barDelayMs(null), 0);
assert.equal(barDelayMs({ bpm: 120, locked: false, beat: 1, beatPhase: 0.5 }), 0, 'sem BPM travado: na hora');
assert.equal(barDelayMs({ bpm: 120, locked: true, holding: true, beat: 1, beatPhase: 0.5 }), 0, 'segurando: na hora');
assert.equal(barDelayMs({ bpm: 120, locked: true, beat: 4, beatPhase: 0 }), 0, 'já no 1º tempo');
assert.equal(barDelayMs({ bpm: 120, locked: true, beat: 5, beatPhase: 0.5 }), 1250, '2,5 beats a 120 BPM');
assert.equal(barDelayMs({ bpm: 150, locked: true, beat: 7, beatPhase: 0.75 }), 100, '0,25 beat a 150 BPM');
assert.equal(barDelayMs({ bpm: 120, locked: true, beat: -1, beatPhase: 0 }), 500, 'beat negativo antes do 1º kick');

// 1 tocando + 1 pré-carregado
assert.deepEqual(toRelease('a', 'b', ['a', 'b', 'c', 'd']), ['c', 'd']);
assert.deepEqual(toRelease('a', '', ['a', 'b']), ['b']);
assert.deepEqual(toRelease('', '', ['a']), ['a'], 'sem vídeo na tela: solta tudo');
assert.deepEqual(toRelease('a', 'a', ['a']), []);

// próximo vídeo do roteiro
{
  const cues = [{ kind: 'video', beat: 16, video: 'v2' }, { kind: 'scene', beat: 8 }, { kind: 'video', beat: 0, video: 'v1' }, { kind: 'video', beat: 32, video: 'v1' }, { kind: 'video', beat: 48, video: 'v3' }];
  assert.equal(nextVideo(cues, -1, ''), 'v1');
  assert.equal(nextVideo(cues, 0, 'v1'), 'v2');
  assert.equal(nextVideo(cues, 16, 'v2'), 'v1');
  assert.equal(nextVideo(cues, 32, 'v1'), 'v3');
  assert.equal(nextVideo(cues, 48, 'v3'), '');
  assert.equal(nextVideo([{ kind: 'video', beat: 4 }], 0, ''), '', 'ponto de vídeo sem vídeo (tirar o vídeo)');
}

console.log('videoloop: ok');
