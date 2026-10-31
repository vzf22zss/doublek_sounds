// npm run check — vídeo de fundo (DK-062): janela de loop, volta no compasso, 1 tocando + 1 pré-carregado.
import assert from 'node:assert/strict';
import { barDelayMs, entryTarget, loopWindow, nextVideo, toRelease, videoInfo, wrapTarget } from './videoloop.ts';

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

// a cada quadro: volta para o início só ao passar do fim
{
  const w = loopWindow({ start: 2, end: 6 }, 10);
  assert.equal(wrapTarget(3, w), null);
  assert.equal(wrapTarget(5.99, w), 2);
  assert.equal(wrapTarget(6.5, w), 2);
  assert.equal(wrapTarget(9, loopWindow({}, 10)), null, 'arquivo inteiro: o <video> cuida');
}

// fix/video-loop: quadro-chave anterior ao início durante o seek NÃO manda buscar de novo
{
  const w = loopWindow({ start: 1, end: 3 }, 8);
  // o exe real: SEEK→1.000, e o próximo quadro mostrado tem mediaTime 0.417 (quadro-chave), com seeking=true
  assert.equal(wrapTarget(0.417, w, true), null, 'durante o seek: espera');
  assert.equal(wrapTarget(0.417, w, false), null, 'mesmo sem seeking: antes do início não é regra de quadro');
  assert.equal(wrapTarget(0.999, w), null, 'pousou um pouco antes do início');
  assert.equal(wrapTarget(3.2, w, true), null, 'velho quadro depois do fim durante a busca: espera');
  assert.equal(wrapTarget(3.0, w, false), 1);
  // simulação: 30 quadros com quadro-chave a cada 2 s → 1 seek por volta, nunca em laço
  let seeks = 0, seeking = false, t = 0.4;
  for (let i = 0; i < 300; i++) {
    const shown = seeking ? 0.417 : t; // enquanto busca, o quadro mostrado é o quadro-chave de 0 s (≈ 0,417 exibido)
    const to = wrapTarget(shown, w, seeking);
    if (to !== null) { seeks++; seeking = true; t = to; continue; }
    if (seeking && i % 3 === 0) seeking = false; // a busca termina alguns quadros depois
    if (!seeking) t += 1 / 30;
  }
  assert.ok(seeks >= 3 && seeks <= 6, `uma busca por volta de 2 s (${seeks} em 10 s)`);
}

// ao entrar na tela: fora da janela vai para o início
{
  const w = loopWindow({ start: 2, end: 6 }, 10);
  assert.equal(entryTarget(0.5, w), 2, 'antes do início');
  assert.equal(entryTarget(7, w), 2, 'depois do fim');
  assert.equal(entryTarget(3, w), null);
  assert.equal(entryTarget(1.97, w), null, 'colado no início');
  assert.equal(entryTarget(5, loopWindow({}, 10)), null, 'arquivo inteiro');
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
