// Passe 1 — cena: fundo (cor/degradê/foto/vídeo) + flash + anéis + espectros + logo/glow/aberração.
// É a base: se falhar, o erro sobe (não há imagem sem ela).
import type { DropTarget, ModTarget } from '../../lib/settings';
import { LOGO_PAD } from '../../lib/assets';
import { SAFE_FLASH_MAX } from '../../lib/safety';
import { gate, mod } from '../music';
import type { Prog } from '../gl/program';
import type { Target } from '../gl/texture';
import type { Ctx, Effect, Helpers } from './types';

export const SCENE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec2 uRes;
uniform vec3 uC1, uC2, uColor, uGlowColor;
uniform float uGrad, uAngle, uHasBg, uBgBias, uBgOpacity, uBgDim, uHue, uBgZoom, uBgBright, uFlash;
uniform vec2 uBgScale, uLogoSize;
uniform sampler2D uBg, uLogo, uGlow;
uniform float uGlowAmt, uChroma, uBars, uRadial, uLogoR;
uniform vec4 uRings[16];
uniform int uNRings;
uniform float uSpec[64];

vec3 hue(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 y = toYIQ * c;
  float s = sin(a), k = cos(a);
  y.yz = mat2(k, s, -s, k) * y.yz;
  return toRGB * y;
}

void main() {
  vec2 d = uv * uRes - uRes * 0.5;
  float r = length(d);

  // fundo: cor/degradê + foto, com zoom e brilho na batida
  vec2 buv = (uv - 0.5) / uBgZoom + 0.5;
  float a = radians(uAngle);
  float t = clamp(0.5 + dot(buv - 0.5, vec2(sin(a), cos(a))), 0.0, 1.0);
  vec3 col = mix(uC1, mix(uC1, uC2, t), uGrad);
  if (uHasBg > 0.5) {
    vec2 iuv = (buv - 0.5) * uBgScale + 0.5;
    iuv.y = 1.0 - iuv.y;
    float inside = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);
    vec4 im = texture(uBg, iuv, uBgBias); // vídeo: desfoque barato pelo mipmap
    col = mix(col, im.rgb * uBgDim, im.a * uBgOpacity * inside);
  }
  col = hue(col, uHue) * uBgBright;

  // flash radial
  col += uColor * uFlash * (1.0 - smoothstep(0.0, 0.6 * length(uRes * 0.5), r));

  // anéis a cada kick
  for (int i = 0; i < 16; i++) {
    if (i >= uNRings) break;
    vec4 g = uRings[i];
    col += uColor * g.y * (1.0 - smoothstep(0.0, g.z, abs(r - g.x)));
  }

  // espectro em barras (embaixo)
  if (uBars > 0.0) {
    float fx = fract(uv.x * 64.0);
    if (uv.y < uSpec[int(min(63.0, uv.x * 64.0))] * 0.35 && fx > 0.08 && fx < 0.92) col = mix(col, uColor, uBars);
  }
  // espectro radial em volta da logo (espelhado: graves embaixo, agudos em cima)
  if (uRadial > 0.0) {
    float m = abs(atan(d.x, -d.y)) / 3.14159265;
    float lvl = uSpec[int(min(63.0, m * 64.0))];
    float seg = fract(m * 64.0), r0 = uLogoR * 1.08;
    if (r > r0 && r < r0 + lvl * uLogoR * 0.8 && seg > 0.15 && seg < 0.85) col = mix(col, uColor, uRadial);
  }

  // logo: glow pré-borrado + aberração cromática
  vec2 luv = d / uLogoSize + 0.5;
  luv.y = 1.0 - luv.y;
  col += uGlowColor * min(1.0, texture(uGlow, luv).a * 1.5) * uGlowAmt;
  vec4 lc = texture(uLogo, luv);
  if (uChroma > 0.0) {
    vec2 off = vec2(uChroma / uLogoSize.x, 0.0);
    col = mix(col, vec3(1.0, 0.0, 0.27), texture(uLogo, luv + off).a * (1.0 - lc.a) * 0.85);
    col = mix(col, vec3(0.0, 0.9, 1.0), texture(uLogo, luv - off).a * (1.0 - lc.a) * 0.85);
  }
  col = mix(col, lc.rgb, lc.a);
  o = vec4(col, 1.0);
}`;

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] as const;
};

export class SceneEffect implements Effect {
  id = 'scene';
  required = true;
  private h!: Helpers; private prog!: Prog; private t: Target | null = null;

  init(_gl: WebGL2RenderingContext, h: Helpers) { this.h = h; this.prog = h.program(SCENE, 'cena'); }

  resize(W: number, H: number) {
    if (this.t) this.h.dropTarget(this.t);
    this.t = this.h.target(W, H);
  }

  render({ gl, uniforms: U, visual: v, textures: T, px, W, H }: Ctx) {
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const { fx, now } = U;
    const mn = Math.min(W, H);
    const u = this.h.use(this.prog, this.t!.fb, W, H);
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform3f(u('uC1'), ...hex(v.bgc1));
    gl.uniform3f(u('uC2'), ...hex(v.bgc2));
    gl.uniform3f(u('uColor'), ...hex(v.color));
    gl.uniform3f(u('uGlowColor'), ...hex(v.color));
    gl.uniform1f(u('uGrad'), v.bgGrad ? 1 : 0);
    gl.uniform1f(u('uAngle'), v.bgAngle);
    const bgAspect = T.bgAspect;
    gl.uniform1f(u('uHasBg'), bgAspect ? 1 : 0);
    gl.uniform1f(u('uBgBias'), T.video ? Math.log2(1 + v.bgBlur * 0.6) : 0); // a foto já vem borrada
    gl.uniform1f(u('uBgOpacity'), v.bgOpacity * d('bgMedia'));
    gl.uniform1f(u('uBgDim'), v.bgDim / 100);
    gl.uniform1f(u('uHue'), ((now / 1000) * v.bgHue * Math.PI) / 180);
    gl.uniform1f(u('uBgZoom'), 1 + m('bgPulse') * v.bgPulse * d('bgPulse'));
    gl.uniform1f(u('uBgBright'), 1 + m('bgFlash') * v.bgFlash * d('bgFlash'));
    const flashAmt = v.safeFlash ? Math.min(v.fxFlash, SAFE_FLASH_MAX) : v.fxFlash;
    gl.uniform1f(u('uFlash'), m('fxFlash') * flashAmt * fx * d('fxFlash'));
    const A = W / H, B = bgAspect ? 1 / bgAspect : A; // aspecto largura/altura
    const wide = B > A;
    gl.uniform2f(u('uBgScale'), ...((v.bgFit === 'cover') === wide ? [A / B, 1] : [1, B / A]) as [number, number]);
    const logoW = (v.size / 100) * mn * (1 + m('amount') * v.amount);
    gl.uniform2f(u('uLogoSize'), logoW * (1 + 2 * LOGO_PAD), logoW * T.logoAspect * (1 + 2 * LOGO_PAD));
    gl.uniform1f(u('uLogoR'), (v.size / 100) * mn * 0.5 * Math.max(1, T.logoAspect));
    gl.uniform1f(u('uGlowAmt'), v.glow * (0.15 + m('glow') * 1.5));
    gl.uniform1f(u('uChroma'), m('chroma') * v.chroma * px * d('chroma'));
    gl.uniform1f(u('uBars'), v.fxBars * fx * d('fxBars'));
    gl.uniform1f(u('uRadial'), v.fxRadial * fx * d('fxRadial'));
    gl.uniform1fv(u('uSpec'), U.spec);
    const r0 = (mn * v.size) / 200, rMax = Math.max(W, H) * 0.75, rings = new Float32Array(64);
    U.rings.forEach((r, i) => {
      const q = (now - r.t) / 900;
      rings.set([r0 + (rMax - r0) * (1 - (1 - q) ** 2), (1 - q) ** 1.5 * r.s * v.fxRings * d('fxRings'), (2 + 7 * (1 - q) * r.s) * px, 0], i * 4);
    });
    gl.uniform4fv(u('uRings'), rings);
    gl.uniform1i(u('uNRings'), v.fxRings > 0 && fx ? U.rings.length : 0);
    this.h.bind(0, T.bg, u('uBg'));
    this.h.bind(1, T.logo, u('uLogo'));
    this.h.bind(2, T.glow, u('uGlow'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.t!.tex;
  }

  dispose() { if (this.t) this.h.dropTarget(this.t); this.t = null; }
}
