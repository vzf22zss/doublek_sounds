// Orgânico / Forest: ruído fbm com domain warp (o ruído entorta as coordenadas do próprio ruído), em poucas oitavas.
// Cores das duas cores do fundo, com a cor da logo nos picos; a matiz gira com o knob "Matiz" do fundo.
// A fonte de modulação acende a cor. Passa por baixo da logo (máscara de luminância), como o túnel.
// Custo: 1 passe; 1 leitura de textura + 3 fbm × {2, 3, 4} oitavas (4 hashes cada) por pixel.
import type { DropTarget, ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Ctx } from './types';
import { hex, Pass, quality } from './pass';

export const ORGANIC = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uMix, uScale, uTime, uPulse, uHue;
uniform vec3 uC1, uC2, uColor;
uniform int uOct;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= uOct) break;
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
vec3 hue(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 y = toYIQ * c;
  float s = sin(a), k = cos(a);
  y.yz = mat2(k, s, -s, k) * y.yz;
  return toRGB * y;
}

void main() {
  vec3 src = texture(uSrc, uv).rgb;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 3.0 * uScale;
  vec2 q = vec2(fbm(p + uTime * 0.10), fbm(p + vec2(5.2, 1.3) - uTime * 0.08));
  float f = fbm(p + 3.0 * q + uTime * 0.05);
  vec3 col = mix(uC1, uC2, smoothstep(0.2, 0.8, f) * 1.6);
  col = mix(col, uColor, smoothstep(0.5, 0.9, f) * (0.35 + 0.65 * uPulse));
  col = max(hue(col, uHue), 0.0) * (0.5 + f);
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  float mask = 1.0 - smoothstep(0.15, 0.5, lum);
  o = vec4(mix(src, max(src, col), uMix * mask), 1.0);
}`;

export class OrganicEffect extends Pass {
  id = 'organic';
  protected fs = ORGANIC;
  protected label = 'orgânico';

  render(ctx: Ctx) {
    const { gl, uniforms: U, visual: v } = ctx;
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const amt = v.organic * U.fx * d('organic');
    this.dt(U.now);
    if (!(amt > 0.001) || !ctx.src) return null;
    const u = this.begin(ctx);
    gl.uniform1f(u('uMix'), Math.min(1, amt));
    gl.uniform1f(u('uScale'), Math.max(0.2, v.organicScale));
    gl.uniform1f(u('uTime'), U.now / 1000);
    gl.uniform1f(u('uPulse'), m('organic'));
    gl.uniform1f(u('uHue'), ((U.now / 1000) * v.bgHue * Math.PI) / 180); // mesma matiz do fundo
    gl.uniform3f(u('uC1'), ...hex(v.bgc1));
    gl.uniform3f(u('uC2'), ...hex(v.bgc2));
    gl.uniform3f(u('uColor'), ...hex(v.color));
    gl.uniform1i(u('uOct'), [2, 3, 4][quality(v)]);
    return this.end(gl);
  }
}
