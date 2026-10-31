// Parâmetros dos efeitos da comunidade (D-21a): o `mod` do manifesto modula o valor como a matriz de modulação
// do Psy Engine — valor salvo × fonte (0..1), dentro de min..max. Sem `mod`, vai o valor salvo. TS puro.
import type { Source } from '../lib/settings.ts';
import type { MusicUniforms } from './music.ts';

export type FxParamSpec = { min: number; max: number; mod?: Source };

/** Valor da fonte agora; sem sinal, o pulso que respira (mesma regra do `mod` dos módulos). */
export const sourceValue = (u: Pick<MusicUniforms, 'stale' | 'p' | 'S'>, s: Source) => (u.stale ? u.p : u.S[s] ?? u.p);

/** `values` salvos + specs do manifesto → os 8 `uP` do shader. Escreve em `out` (sem alocar por quadro). */
export function fxParams(values: readonly number[], params: readonly FxParamSpec[], src: (s: Source) => number, out = new Float32Array(8)) {
  out.fill(0);
  for (let i = 0; i < Math.min(8, values.length); i++) {
    const v = Number.isFinite(values[i]) ? values[i] : 0, p = params[i];
    out[i] = p?.mod ? Math.min(p.max, Math.max(p.min, v * src(p.mod))) : v;
  }
  return out;
}
