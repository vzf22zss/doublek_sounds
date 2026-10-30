// Base dos módulos de 1 passe que leem `src` e devolvem uma textura nova (Psy Engine, DK-022).
// O alvo só é criado na 1ª vez que o módulo desenha: desligado, não ocupa memória de vídeo nem custa nada.
import type { Visual } from '../../lib/settings';
import type { Prog } from '../gl/program';
import type { Target } from '../gl/texture';
import type { Ctx, Effect, Helpers } from './types';

/** '#rrggbb' → [r, g, b] de 0 a 1. */
export const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] as const;
};

/** 0 baixa · 1 média · 2 alta (o valor pode vir fracionado do crossfade de cenas). */
export const quality = (v: Visual) => Math.max(0, Math.min(2, Math.round(v.psyQuality)));

export abstract class Pass implements Effect {
  abstract id: string;
  psy = true;
  protected abstract fs: string;
  protected abstract label: string;
  protected h!: Helpers;
  protected prog!: Prog;
  private t: Target | null = null;
  private W = 0; private H = 0;
  private last = -1;

  init(_gl: WebGL2RenderingContext, h: Helpers) { this.h = h; this.prog = h.program(this.fs, this.label); }

  resize(W: number, H: number) {
    if (this.t) this.h.dropTarget(this.t);
    this.t = null;
    this.W = W; this.H = H;
  }

  /** Segundos desde o último quadro desenhado (0 no primeiro; no máximo 0,1). */
  protected dt(now: number) {
    const d = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    return d;
  }

  /** Liga o programa no alvo próprio (criado agora se preciso) e devolve o leitor de uniforms. */
  protected begin(ctx: Ctx) {
    if (!this.t) this.t = this.h.target(this.W || ctx.W, this.H || ctx.H);
    const u = this.h.use(this.prog, this.t.fb, ctx.W, ctx.H);
    ctx.gl.uniform2f(u('uRes'), ctx.W, ctx.H);
    this.h.bind(0, ctx.src!, u('uSrc'));
    return u;
  }

  protected end(gl: WebGL2RenderingContext) {
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.t!.tex;
  }

  abstract render(ctx: Ctx): WebGLTexture | null;

  dispose() { if (this.t) this.h.dropTarget(this.t); this.t = null; }
}
