// Passe 3 — pós, direto na tela: tremor, vinheta, scanlines, grão, strobe e blackout.
// É base também: é o único passe que chega à tela (e carrega o blackout do preview).
import type { DropTarget, ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Prog } from '../gl/program';
import type { Ctx, Effect, Helpers } from './types';

export const POST = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes, uShake;
uniform float uVig, uScan, uGrain, uStrobe, uTime, uBlack, uPx;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 col = texture(uSrc, uv + uShake / uRes).rgb;
  col *= 1.0 - smoothstep(0.4, 1.0, length(uv - 0.5) / 0.7071) * 0.95 * uVig;
  if (mod(gl_FragCoord.y, 3.0 * uPx) < uPx) col *= 1.0 - 0.6 * uScan;
  col += (hash(floor(gl_FragCoord.xy / uPx) + fract(uTime) * 100.0) - 0.5) * uGrain * 0.35;
  col = mix(col, vec3(1.0), uStrobe);
  o = vec4(col * (1.0 - uBlack), 1.0);
}`;

export class PostEffect implements Effect {
  id = 'post';
  required = true;
  private h!: Helpers; private prog!: Prog;

  init(_gl: WebGL2RenderingContext, h: Helpers) { this.h = h; this.prog = h.program(POST, 'pós'); }

  resize() {}

  render({ gl, uniforms: U, visual: v, px, W, H, src }: Ctx) {
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const fx = U.fx;
    const u = this.h.use(this.prog, null, W, H);
    const shake = m('fxShake') * v.fxShake * px * fx * d('fxShake');
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform2f(u('uShake'), (Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    gl.uniform1f(u('uVig'), v.fxVig);
    gl.uniform1f(u('uScan'), v.fxScan * fx);
    gl.uniform1f(u('uGrain'), v.fxGrain * fx);
    gl.uniform1f(u('uTime'), U.now / 1000);
    gl.uniform1f(u('uPx'), Math.max(1, px));
    gl.uniform1f(u('uStrobe'), U.strobe);
    gl.uniform1f(u('uBlack'), U.black);
    this.h.bind(0, src!, u('uSrc'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return null;
  }

  dispose() {}
}
