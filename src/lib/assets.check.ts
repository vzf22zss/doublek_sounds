// npm run check — latest(): o desfoque da foto do fundo no crossfade entre cenas (o bgBlur muda a cada quadro).
import assert from 'node:assert/strict';
import { latest } from './assets.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 30 pedidos seguidos (um por quadro) com um trabalho lento: roda o 1º, depois só o último; nunca dois ao mesmo tempo
{
  const ran: number[] = [], applied: number[] = [];
  let running = 0, most = 0;
  const run = latest(async (x: number) => {
    ran.push(x); most = Math.max(most, ++running);
    await sleep(20);
    applied.push(x); running--;
  });
  const ps = Array.from({ length: 30 }, (_, i) => run(i));
  await Promise.all(ps);
  assert.deepEqual(ran, [0, 29]);
  assert.equal(most, 1);
  assert.equal(applied.at(-1), 29); // o que fica na tela é o último pedido
}

// trabalho que demora mais para o valor antigo: o último pedido ainda é o que fica (sem a fila, o antigo chegava
// depois e ficava na tela)
{
  const applied: number[] = [];
  const run = latest(async (x: number) => { await sleep(x === 0 ? 30 : 1); applied.push(x); });
  await Promise.all([run(0), run(1), run(2)]);
  assert.deepEqual(applied, [0, 2]);
}

// erro no trabalho não trava a fila
{
  const run = latest(async (x: number) => { if (x === 1) throw new Error('falhou'); });
  await assert.rejects(run(1), /falhou/);
  await run(2); // roda de novo normalmente
}

console.log('assets: ok');
