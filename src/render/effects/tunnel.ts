// Túnel fractal: anéis e segmentos em coordenadas log-polares, cada camada no dobro da frequência.
// Desenhado "por baixo": a luminância do quadro é a máscara, então logo e anéis claros ficam por cima.
// Fonte de modulação = velocidade (o grave empurra o túnel). Paleta: cores do fundo → cor da logo.
// Custo: 1 passe; 1 leitura de textura + {2, 3, 5} camadas (2 cossenos cada) por pixel.
import type { DropTarget, ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Ctx } from './types';
import { hex, Pass, quality } from './pass';

export const TUNNEL = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uMix, uZ, uDensity;
uniform vec3 uC1, uC2, uColor;
uniform int uOct;

void main() {
  vec3 src = texture(uSrc, uv).rgb;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x) / 6.28318531;      // -0.5..0.5; 8 segmentos inteiros: sem emenda
  float z = 1.0 / r + uZ;                      // profundidade: o centro é longe
  float v = 0.0, amp = 0.5, f = 1.0;
  for (int i = 0; i < 5; i++) {
    if (i >= uOct) break;
    float rings = 0.5 + 0.5 * cos(6.28318531 * z * uDensity * f);
    float segs = 0.5 + 0.5 * cos(6.28318531 * (a * 8.0 * f + z * 0.3));
    v += amp * rings * segs;
    amp *= 0.5; f *= 2.0;
  }
  float fog = smoothstep(0.0, 0.35, r);        // some no fundo do túnel, onde a frequência explode
  vec3 pal = mix(mix(uC1, uC2, 0.5 + 0.5 * cos(z * 0.7)), uColor, clamp(v * 1.4, 0.0, 1.0));
  vec3 tun = pal * v * 1.6 * fog;
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  float mask = 1.0 - smoothstep(0.15, 0.5, lum);
  o = vec4(mix(src, max(src, tun), uMix * mask), 1.0);
}`;

export class TunnelEffect extends Pass {
  id = 'tunnel';
  protected fs = TUNNEL;
  protected label = 'túnel';
  private z = 0;

  render(ctx: Ctx) {
    const { gl, uniforms: U, visual: v } = ctx;
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const amt = v.tunnel * U.fx * d('tunnel');
    const dt = this.dt(U.now);
    if (!(amt > 0.001) || !ctx.src) return null;
    this.z += dt * v.tunnelSpeed * (0.3 + m('tunnel')) * 2;
    const u = this.begin(ctx);
    gl.uniform1f(u('uMix'), Math.min(1, amt));
    gl.uniform1f(u('uZ'), this.z % 1000); // precisão do float no shader
    gl.uniform1f(u('uDensity'), 0.5 + 2 * v.tunnelDensity);
    gl.uniform3f(u('uC1'), ...hex(v.bgc1));
    gl.uniform3f(u('uC2'), ...hex(v.bgc2));
    gl.uniform3f(u('uColor'), ...hex(v.color));
    gl.uniform1i(u('uOct'), [2, 3, 5][quality(v)]);
    return this.end(gl);
  }
}
