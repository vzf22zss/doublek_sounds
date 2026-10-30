// Campo de partículas desenhado no fragment, sem buffers de vértice: cada camada é uma grade, cada célula
// tem no máximo uma partícula (sorteada por hash) sempre longe da borda, então não precisa olhar as vizinhas.
// Camadas do fundo são menores e mais lentas (paralaxe). A fonte de modulação empurra a velocidade e o brilho.
// Passa por baixo da logo (máscara de luminância). Custo: 1 passe; 1 leitura de textura + {8, 16, 32} camadas por pixel.
import type { DropTarget, ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Ctx } from './types';
import { hex, Pass, quality } from './pass';

const MAX = 32;
const scaleOf = (i: number) => 6 + i * 1.7;     // células por altura de tela na camada i
const depthOf = (i: number) => 1 + i * 0.35;    // camadas mais fundas andam mais devagar

export const PARTICLES = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uOff[${MAX}];   // deslocamento de cada camada, em células, já módulo 1024 (sem perder precisão)
uniform float uMix, uDensity, uTurb, uTime, uGlow;
uniform vec3 uColor;
uniform int uLayers;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  vec3 src = texture(uSrc, uv).rgb;
  vec2 p0 = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float acc = 0.0;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uLayers) break;
    float fi = float(i);
    vec2 p = p0 * (6.0 + fi * 1.7) + uOff[i] + vec2(fi * 17.3, fi * 9.1);
    // turbulência com período de 8 células: divide 1024, então a volta do módulo não dá salto
    p += uTurb * 0.35 * vec2(sin(p.y * 0.7853982 + uTime * 0.7 + fi), cos(p.x * 0.7853982 + uTime * 0.6 + fi));
    vec2 cell = mod(floor(p), 1024.0), f = fract(p);
    float h = hash(cell + fi * 7.13);
    if (h > uDensity) continue;
    vec2 c = 0.25 + 0.5 * vec2(hash(cell + 1.7 + fi), hash(cell + 3.1 + fi));
    float r = 0.06 + 0.08 * hash(cell + 5.3);
    float tw = 0.6 + 0.4 * sin(uTime * (2.0 + 4.0 * h) + h * 40.0);   // cintila
    acc += (1.0 - smoothstep(0.0, r, length(f - c))) * tw / (1.0 + fi * 0.35);
  }
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  float mask = 1.0 - smoothstep(0.2, 0.6, lum);
  o = vec4(src + uColor * (1.0 + 0.6 * uGlow) * acc * uMix * mask, 1.0);
}`;

export class ParticlesEffect extends Pass {
  id = 'particles';
  protected fs = PARTICLES;
  protected label = 'partículas';
  private dist = 0; // distância andada, em alturas de tela (double no CPU)
  private off = new Float32Array(MAX * 2);

  render(ctx: Ctx) {
    const { gl, uniforms: U, visual: v } = ctx;
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const amt = v.particles * U.fx * d('particles');
    const dt = this.dt(U.now);
    if (!(amt > 0.001) || !ctx.src) return null;
    const push = m('particles');
    this.dist += dt * 0.25 * (0.3 + 1.5 * push);
    const a = (v.particlesDir * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const layers = [8, 16, 32][quality(v)];
    for (let i = 0; i < layers; i++) {
      const k = (-this.dist * scaleOf(i)) / depthOf(i);
      for (const [j, x] of [[0, k * dx], [1, k * dy]]) this.off[i * 2 + j] = x - 1024 * Math.floor(x / 1024);
    }
    const u = this.begin(ctx);
    gl.uniform2fv(u('uOff'), this.off);
    gl.uniform1f(u('uMix'), Math.min(1, amt));
    gl.uniform1f(u('uDensity'), 0.1 + 0.6 * v.particlesDensity);
    gl.uniform1f(u('uTurb'), v.particlesTurb);
    gl.uniform1f(u('uTime'), U.now / 1000);
    gl.uniform1f(u('uGlow'), push);
    gl.uniform3f(u('uColor'), ...hex(v.color));
    gl.uniform1i(u('uLayers'), layers);
    return this.end(gl);
  }
}
