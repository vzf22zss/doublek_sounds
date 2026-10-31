// Vídeo como camada própria (DK-063, opcional). Só roda com a camada `video` na lista; aí a cena desenha só a
// foto/cor e o vídeo entra aqui, na posição da camada, com o mesmo enquadramento (cobrir/caber), zoom e brilho
// na batida, desfoque (mipmap), opacidade e a matiz que gira o fundo (mesma fórmula da cena).
// Custo: 1 passe; 2 leituras de textura por pixel (+ o passe do compositor se a camada não for Normal 100%).
import type { DropTarget, ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Ctx } from './types';
import { Pass } from './pass';

export const VIDEO = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc, uVid;
uniform vec2 uRes, uScale;
uniform float uZoom, uBias, uDim, uBright, uMix, uHue;

vec3 hue(vec3 c, float a) { // igual à cena
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 y = toYIQ * c;
  float s = sin(a), k = cos(a);
  y.yz = mat2(k, s, -s, k) * y.yz;
  return toRGB * y;
}

void main() {
  vec3 src = texture(uSrc, uv).rgb;
  vec2 buv = (uv - 0.5) / uZoom + 0.5;
  vec2 iuv = (buv - 0.5) * uScale + 0.5;
  iuv.y = 1.0 - iuv.y;
  float inside = step(0.0, iuv.x) * step(iuv.x, 1.0) * step(0.0, iuv.y) * step(iuv.y, 1.0);
  vec4 im = texture(uVid, iuv, uBias);
  o = vec4(mix(src, hue(im.rgb * uDim, uHue) * uBright, im.a * uMix * inside), 1.0);
}`;

export class VideoEffect extends Pass {
  id = 'video';
  psy = false;
  protected fs = VIDEO;
  protected label = 'vídeo (camada)';

  render(ctx: Ctx) {
    const { gl, uniforms: U, visual: v, textures: T, W, H } = ctx;
    if (!T.vid || !(T.vidAspect > 0) || !ctx.src) return null;
    const m = (k: ModTarget) => mod(U, v, k), d = (k: DropTarget) => gate(U, v, k);
    const u = this.begin(ctx);
    const A = W / H, B = 1 / T.vidAspect, wide = B > A; // mesma conta de enquadramento da cena
    gl.uniform2f(u('uScale'), ...((v.bgFit === 'cover') === wide ? [A / B, 1] : [1, B / A]) as [number, number]);
    gl.uniform1f(u('uZoom'), 1 + m('bgPulse') * v.bgPulse * d('bgPulse'));
    gl.uniform1f(u('uBias'), Math.log2(1 + v.bgBlur * 0.6));
    gl.uniform1f(u('uDim'), v.bgDim / 100);
    gl.uniform1f(u('uBright'), 1 + m('bgFlash') * v.bgFlash * d('bgFlash'));
    gl.uniform1f(u('uMix'), v.bgOpacity * d('bgMedia'));
    gl.uniform1f(u('uHue'), ((U.now / 1000) * v.bgHue * Math.PI) / 180); // a mesma conta da cena
    this.h.bind(1, T.vid, u('uVid'));
    return this.end(gl);
  }
}
