// Passe 2 — rastro (feedback em ping-pong). Só desenha com o rastro ligado; senão devolve null e a cena passa direto.
import type { ModTarget } from '../../lib/settings';
import { gate, mod } from '../music';
import type { Prog } from '../gl/program';
import type { Target } from '../gl/texture';
import type { Ctx, Effect, Helpers } from './types';

export const FEEDBACK = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uScene, uPrev;
uniform float uDecay, uZoom, uRot;
void main() {
  vec2 q = uv - 0.5;
  float s = sin(uRot), c = cos(uRot);
  q = mat2(c, s, -s, c) * q / uZoom;
  o = vec4(max(texture(uScene, uv).rgb, texture(uPrev, q + 0.5).rgb * uDecay), 1.0);
}`;

export class FeedbackEffect implements Effect {
  id = 'feedback';
  private h!: Helpers; private prog!: Prog; private t: Target[] = []; private ping = 0;

  init(_gl: WebGL2RenderingContext, h: Helpers) { this.h = h; this.prog = h.program(FEEDBACK, 'rastro'); }

  resize(W: number, H: number) {
    this.t.forEach((t) => this.h.dropTarget(t));
    this.t = [this.h.target(W, H), this.h.target(W, H)];
  }

  render({ gl, uniforms: U, visual: v, W, H, src }: Ctx) {
    const m = (k: ModTarget) => mod(U, v, k);
    const trail = v.trail * gate(U, v, 'trail');
    if (!(trail > 0.01 && U.fx) || !src) return null;
    const cur = this.t[this.ping], prev = this.t[1 - this.ping];
    const u = this.h.use(this.prog, cur.fb, W, H);
    gl.uniform1f(u('uDecay'), 0.6 + 0.38 * trail);
    gl.uniform1f(u('uZoom'), 1 + v.trailZoom * 0.03 * (1 + m('trailZoom')));
    gl.uniform1f(u('uRot'), v.trailRot * 0.01);
    this.h.bind(0, src, u('uScene'));
    this.h.bind(1, prev.tex, u('uPrev'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.ping ^= 1;
    return cur.tex;
  }

  dispose() { this.t.forEach((t) => this.h.dropTarget(t)); this.t = []; }
}
