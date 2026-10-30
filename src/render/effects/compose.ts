// Compositor mínimo (DK-052): mistura o quadro de uma camada com o que estava embaixo, com modo e opacidade.
// Só roda para camadas que precisam (needsCompose: modo ≠ normal ou opacidade < 1); `normal` com opacidade 1
// segue sem passe extra, como antes. Dois alvos próprios em pingue-pongue, criados uma vez (e no resize):
// reordenar ou ligar/desligar camadas não aloca nada.
// Custo: 1 passe e 2 leituras de textura por pixel, por camada misturada.
import type { Blend } from '../layers';
import type { Prog } from '../gl/program';
import type { Target } from '../gl/texture';
import type { Helpers } from './types';

export const COMPOSE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uBase, uLayer;
uniform float uOpacity;
uniform int uMode; // 0 normal · 1 somar · 2 tela · 3 multiplicar

void main() {
  vec3 a = texture(uBase, uv).rgb, b = texture(uLayer, uv).rgb;
  vec3 m = uMode == 1 ? min(a + b, vec3(1.0)) : uMode == 2 ? 1.0 - (1.0 - a) * (1.0 - b) : uMode == 3 ? a * b : b;
  o = vec4(mix(a, m, uOpacity), 1.0);
}`;

const MODE: Record<Blend, number> = { normal: 0, add: 1, screen: 2, multiply: 3 };

export class Compose {
  private h!: Helpers; private prog!: Prog;
  private t: Target[] = []; private W = 0; private H = 0; private flip = 0;

  init(h: Helpers) { this.h = h; this.prog = h.program(COMPOSE, 'compositor'); }

  resize(W: number, H: number) { this.dispose(); this.W = W; this.H = H; }

  /** `base` = o que estava embaixo; `layer` = o quadro que a camada desenhou. Devolve o resultado misturado. */
  apply(gl: WebGL2RenderingContext, base: WebGLTexture, layer: WebGLTexture, opacity: number, blend: Blend) {
    if (!this.t.length) this.t = [this.h.target(this.W, this.H), this.h.target(this.W, this.H)];
    const out = this.t[(this.flip ^= 1)]; // nunca o mesmo que acabou de ser escrito (pode ser o `base`)
    const u = this.h.use(this.prog, out.fb, this.W, this.H);
    gl.uniform1f(u('uOpacity'), opacity);
    gl.uniform1i(u('uMode'), MODE[blend]);
    this.h.bind(0, base, u('uBase'));
    this.h.bind(1, layer, u('uLayer'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return out.tex;
  }

  dispose() { this.t.forEach((t) => this.h.dropTarget(t)); this.t = []; }
}
