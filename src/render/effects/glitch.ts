// Hi-Tech Glitch: fatias horizontais deslocadas, blocos quantizados e separação RGB, só durante uma rajada
// curta depois do disparo (a fonte de modulação cruzando 0,5; "só no drop" corta o disparo no breakdown).
// Teto em music.ts: até 3 rajadas por segundo com o limite de flashes ligado (6 sem ele), 120 ms cada.
// Fora da rajada não desenha nada. Custo: 1 passe só durante a rajada; 4 leituras de textura por pixel (fixo).
import type { DropTarget, ModTarget } from '../../lib/settings';
import { burst, burstState, gate, mod } from '../music';
import type { Ctx } from './types';
import { Pass } from './pass';

export const GLITCH = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uAmt, uSeed;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  vec2 p = uv;
  float row = floor(uv.y * 24.0);
  if (hash(vec2(row, uSeed)) > 0.6) p.x += (hash(vec2(row, uSeed + 1.0)) - 0.5) * 0.15 * uAmt; // fatias
  vec2 blk = floor(uv * vec2(16.0, 9.0));
  if (hash(blk + uSeed * 3.7) > 1.0 - 0.3 * uAmt) p = (floor(p * vec2(64.0, 36.0)) + 0.5) / vec2(64.0, 36.0); // blocos
  float sh = 0.012 * uAmt;
  vec3 g = vec3(texture(uSrc, p + vec2(sh, 0.0)).r, texture(uSrc, p).g, texture(uSrc, p - vec2(sh, 0.0)).b); // RGB
  o = vec4(mix(texture(uSrc, uv).rgb, g, min(1.0, uAmt * 1.5)), 1.0);
}`;

export class GlitchEffect extends Pass {
  id = 'glitch';
  protected fs = GLITCH;
  protected label = 'glitch';
  private b = burstState();

  render(ctx: Ctx) {
    const { gl, uniforms: U, visual: v } = ctx;
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    if (!(v.glitch > 0.001) || !U.fx || !ctx.src) return null;
    const env = burst(this.b, U.now, m('glitch') * d('glitch'), v.safeFlash);
    if (!(env > 0)) return null;
    const u = this.begin(ctx);
    gl.uniform1f(u('uAmt'), Math.min(1, v.glitch) * env);
    gl.uniform1f(u('uSeed'), this.b.n % 997);
    return this.end(gl);
  }
}
