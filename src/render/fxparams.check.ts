// npm run check — parâmetros dos efeitos da comunidade com modulação (D-21a).
import assert from 'node:assert/strict';
import { fxParams, sourceValue, type FxParamSpec } from './fxparams.ts';

const S = { auto: 0.4, kick: 1, sub: 0.2, bass: 0.5, mid: 0.3, hats: 0.8, beat: 0.6, bar: 0.25, lfo: 0.75 };
const src = (s: keyof typeof S) => S[s];
const near = (a: Float32Array, b: number[]) => b.forEach((x, i) => assert.ok(Math.abs(a[i] - x) < 1e-6, `uP[${i}] = ${a[i]}, esperado ${x}`));

// sem mod: valor salvo, intacto (mesmo fora da faixa, que o manifesto já limitou ao salvar)
near(fxParams([0.5, 0.3], [{ min: 0, max: 1 }, { min: 0, max: 1 }], src), [0.5, 0.3, 0, 0, 0, 0, 0, 0]);

// com mod: valor × fonte
{
  const ps: FxParamSpec[] = [{ min: 0, max: 1, mod: 'bass' }, { min: 0, max: 1, mod: 'kick' }, { min: 0, max: 1, mod: 'lfo' }];
  near(fxParams([0.8, 0.6, 1], ps, src), [0.4, 0.6, 0.75]);
}

// dentro de min..max: fonte 0 com mínimo > 0 fica no mínimo; faixa negativa também
{
  const zero = (_: string) => 0;
  near(fxParams([0.8], [{ min: 0.2, max: 1, mod: 'sub' }], zero), [0.2]);
  near(fxParams([-4], [{ min: -2, max: 2, mod: 'kick' }], src), [-2]);
  near(fxParams([5], [{ min: 0, max: 3, mod: 'kick' }], src), [3]);
}

// lixo e limites: NaN vira 0; mais de 8 valores ignora o resto; param sem spec = sem mod
near(fxParams([NaN, 0.5], [{ min: 0, max: 1, mod: 'kick' }], src), [0, 0.5]);
assert.equal(fxParams(Array(12).fill(1), [], src).length, 8);

// reaproveita o buffer e zera o que sobrou do quadro anterior
{
  const out = new Float32Array(8);
  fxParams([1, 1, 1], [], src, out);
  fxParams([0.5], [], src, out);
  near(out, [0.5, 0, 0]);
}

// fonte: com sinal, o valor da matriz; sem sinal (stale), o pulso que respira
assert.equal(sourceValue({ stale: false, p: 0.1, S }, 'hats'), 0.8);
assert.equal(sourceValue({ stale: true, p: 0.1, S }, 'hats'), 0.1);

console.log('fxparams: ok');
