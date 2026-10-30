// Mandala: anéis de pétalas concêntricos em volta da logo, que andam um espaço para fora a cada compasso
// (o de dentro nasce, o de fora some, sem salto) e giram devagar. Mistura aditiva.
// Fonte de modulação = brilho (o kick acende). Custo: 1 passe; 1 leitura de textura + {3, 5, 8} anéis por pixel.
import type { DropTarget, ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Ctx } from './types';
import { hex, Pass, quality } from './pass';

export const MANDALA = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uMix, uR0, uBar, uRot, uPetals, uPx;
uniform vec3 uColor;
uniform int uRings;

void main() {
  vec3 src = texture(uSrc, uv).rgb;
  vec2 d = uv * uRes - uRes * 0.5;
  float r = length(d), a = atan(d.y, d.x) + uRot;
  float n = float(uRings);
  vec3 add = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uRings) break;
    float k = float(i) + uBar;                              // posição contínua no compasso
    float petal = abs(cos(a * uPetals * 0.5 + k));         // pétalas inteiras: sem emenda no ângulo
    float edge = uR0 * (1.25 + 0.45 * k) * (1.0 + 0.12 * petal);
    float w = (1.5 + 3.0 * petal) * uPx;
    float line = 1.0 - smoothstep(0.0, w, abs(r - edge));
    float fade = smoothstep(0.0, 1.0, k) * (1.0 - smoothstep(n - 1.0, n, k)) * (1.0 - k / (n + 1.0));
    add += mix(uColor, vec3(1.0), 0.25 * k / n) * line * fade;
  }
  o = vec4(src + add * uMix, 1.0);
}`;

export class MandalaEffect extends Pass {
  id = 'mandala';
  protected fs = MANDALA;
  protected label = 'mandala';

  render(ctx: Ctx) {
    const { gl, uniforms: U, visual: v, textures: T, W, H, px } = ctx;
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const amt = v.mandala * (0.4 + 0.6 * m('mandala')) * U.fx * d('mandala');
    this.dt(U.now);
    if (!(amt > 0.001) || !ctx.src) return null;
    const u = this.begin(ctx);
    gl.uniform1f(u('uMix'), amt);
    gl.uniform1f(u('uR0'), (v.size / 100) * Math.min(W, H) * 0.5 * Math.max(1, T.logoAspect)); // raio da logo, como na cena
    gl.uniform1f(u('uBar'), U.bar);
    gl.uniform1f(u('uRot'), (U.now / 1000) * 0.1);
    gl.uniform1f(u('uPetals'), 2 * Math.max(2, Math.min(8, Math.round(v.mandalaPetals / 2)))); // par: 4–16
    gl.uniform1f(u('uPx'), Math.max(1, px));
    gl.uniform3f(u('uColor'), ...hex(v.color));
    gl.uniform1i(u('uRings'), [3, 5, 8][quality(v)]);
    return this.end(gl);
  }
}
