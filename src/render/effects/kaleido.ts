// Caleidoscópio: dobra o quadro inteiro em N fatias em volta do centro. Opera sobre tudo que veio antes,
// então a logo entra no caleidoscópio (é o visual psy clássico). Fonte de modulação = empurrão no giro.
// Custo: 1 passe; 1 + {1, 2, 4} leituras de textura por pixel (baixa/média/alta: anti-serrilhado na costura).
import type { DropTarget, ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Ctx } from './types';
import { Pass, quality } from './pass';

export const KALEIDO = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uN, uRot, uZoom, uMix, uMirror;
uniform int uSamples;

vec2 fold(vec2 p) {
  float r = length(p), a = atan(p.y, p.x) + uRot;
  float seg = 6.28318531 / uN;
  a = mod(a, seg);
  if (uMirror > 0.5) a = abs(a - seg * 0.5); // espelha cada fatia: costura sem emenda
  return vec2(cos(a), sin(a)) * r / uZoom;
}

void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  float jit = uSamples > 1 ? 1.0 : 0.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uSamples) break;
    vec2 j = (vec2(float(i & 1), float(i >> 1)) - 0.5) * jit;
    vec2 k = fold((uv + j / uRes - 0.5) * asp) / asp + 0.5;
    k = 1.0 - abs(1.0 - mod(k, 2.0)); // fora da borda: espelha em vez de esticar
    acc += texture(uSrc, k).rgb;
  }
  o = vec4(mix(texture(uSrc, uv).rgb, acc / float(uSamples), uMix), 1.0);
}`;

export class KaleidoEffect extends Pass {
  id = 'kaleido';
  protected fs = KALEIDO;
  protected label = 'caleidoscópio';
  private rot = 0;

  render(ctx: Ctx) {
    const { gl, uniforms: U, visual: v } = ctx;
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const amt = v.kaleido * U.fx * d('kaleido');
    const dt = this.dt(U.now);
    if (!(amt > 0.001) || !ctx.src) return null;
    this.rot += dt * v.kaleidoSpin;
    const u = this.begin(ctx);
    gl.uniform1f(u('uN'), Math.max(3, Math.min(12, Math.round(v.kaleidoN))));
    gl.uniform1f(u('uRot'), this.rot + 0.35 * m('kaleido'));
    gl.uniform1f(u('uZoom'), Math.max(0.25, v.kaleidoZoom));
    gl.uniform1f(u('uMix'), Math.min(1, amt));
    gl.uniform1f(u('uMirror'), v.kaleidoMirror ? 1 : 0);
    gl.uniform1i(u('uSamples'), [1, 2, 4][quality(v)]);
    return this.end(gl);
  }
}
