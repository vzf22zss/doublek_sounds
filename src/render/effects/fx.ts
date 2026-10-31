// Efeito da comunidade como camada (DK-123): o GLSL do autor (docs/SHADERS.md) compilado no contexto do telão,
// com o mesmo cabeçalho do editor (FX_HEADER). Recebe a corrente até ali em `uInput`, o áudio e os 8 parâmetros.
// Custo: 1 passe; o resto depende do autor (laços com teto de 256, checado no validateShader).
import { fullSource } from '../../lib/shaders/manifest';
import { FX_VS } from '../gl/program';
import type { Ctx } from './types';
import { Pass } from './pass';

export class FxEffect extends Pass {
  id: string;
  psy = false; // não é do Psy Engine: psySafe e o orçamento do Psy não mexem; quem manda é o fxSafe
  protected fs: string;
  protected label: string;
  protected vs = FX_VS;
  protected srcName = 'uInput';
  private p = new Float32Array(8);
  readonly code: string;

  constructor(fxId: string, code: string, values: number[]) {
    super();
    this.id = `fx:${fxId}`;
    this.code = code;
    this.fs = fullSource(code);
    this.label = `efeito "${fxId}"`;
    this.setValues(values);
  }

  setValues(values: number[]) {
    this.p.fill(0);
    values.slice(0, 8).forEach((x, i) => (this.p[i] = Number.isFinite(x) ? x : 0));
  }

  render(ctx: Ctx) {
    const { gl, uniforms: U } = ctx;
    if (!ctx.src) return null;
    const u = this.begin(ctx);
    gl.uniform1f(u('uTime'), U.now / 1000);
    gl.uniform1f(u('uBeat'), U.absBeat + U.beatPhase);
    gl.uniform1f(u('uPhase'), U.beatPhase);
    gl.uniform1f(u('uKick'), Math.min(1, U.kick));
    gl.uniform1f(u('uLow'), U.drop);
    gl.uniform1fv(u('uBands'), U.bands as number[]);
    gl.uniform1fv(u('uP'), this.p);
    return this.end(gl);
  }
}
