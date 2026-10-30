// Renderer WebGL2: orquestra os módulos cena → rastro (feedback) → pós. Usado pela janela de saída e pelo preview.
// Tudo que é por quadro roda na GPU; o CPU só calcula envelopes e uniforms (em music.ts, testável no Node).
// Módulo que falha ao compilar ou ao desenhar é desligado sozinho (log + onEffectError); a cena e o pós são
// a base: erro neles sobe para quem chamou, como antes (o telão mostra preto e avisa o controle).
import type { Frame } from '../lib/types';
import type { Visual } from '../lib/settings';
import type { Prepared } from '../lib/assets';
import { music, musicFrame, musicState } from './music';
import { program, quad, use, type Prog } from './gl/program';
import { bind, dropTarget, target, texture, upload } from './gl/texture';
import type { Ctx, Effect, Helpers } from './effects/types';
import { SceneEffect } from './effects/scene';
import { FeedbackEffect } from './effects/feedback';
import { PostEffect } from './effects/post';

export class Renderer {
  private gl: WebGL2RenderingContext;
  private effects: Effect[];
  private off = new Set<string>();
  private progs = new Map<string, Prog>(); // cache por código-fonte do fragment shader
  private tex: Record<'logo' | 'glow' | 'bg' | 'vid', WebGLTexture>;
  private fbW = 0; private fbH = 0;
  private logoAspect = 1; private bgAspect = 0;
  private video: HTMLVideoElement | null = null; private vidFresh = false;

  private v: Visual;
  private st = musicState();

  constructor(private canvas: HTMLCanvasElement, v: Visual, private onEffectError?: (id: string, e: Error) => void) {
    this.v = v;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 indisponível');
    this.gl = gl;
    const h: Helpers = {
      program: (fs, name) => {
        let p = this.progs.get(fs);
        if (!p) this.progs.set(fs, (p = program(gl, fs, name)));
        return p;
      },
      use: (pr, fb, W, H) => use(gl, pr, fb, W, H),
      bind: (unit, t, loc) => bind(gl, unit, t, loc),
      target: (W, H) => target(gl, W, H),
      dropTarget: (t) => dropTarget(gl, t),
    };
    this.effects = [new SceneEffect(), new FeedbackEffect(), new PostEffect()];
    for (const e of this.effects) this.guard(e, () => e.init(gl, h));
    quad(gl);
    this.tex = { logo: texture(gl), glow: texture(gl), bg: texture(gl), vid: texture(gl) };
  }

  setVisual(v: Visual) { this.v = v; }

  setFrame(f: Frame) { musicFrame(this.st, f, this.v, performance.now()); }

  setLogo(p: Prepared) {
    upload(this.gl, this.tex.logo, p.image);
    if (p.glow) upload(this.gl, this.tex.glow, p.glow);
    this.logoAspect = p.aspect;
  }

  /** Vídeo em loop no fundo (tem prioridade sobre a foto). Só sobe para a GPU quando chega quadro novo. */
  setBgVideo(el: HTMLVideoElement | null) {
    this.video = el;
    this.vidFresh = !!el;
    const watch = () => {
      if (this.video !== el || !el) return;
      this.vidFresh = true;
      el.requestVideoFrameCallback(watch);
    };
    el?.requestVideoFrameCallback(watch);
  }

  setBg(p: Prepared | null) {
    if (p) upload(this.gl, this.tex.bg, p.image);
    this.bgAspect = p ? p.aspect : 0;
  }

  /** Roda `fn` no módulo; se ele não for base, um erro o desliga em vez de derrubar o quadro. */
  private guard<T>(e: Effect, fn: () => T): T | null {
    try {
      return fn();
    } catch (err) {
      if (e.required) throw err;
      this.off.add(e.id);
      try { e.dispose(); } catch { /* já está quebrado */ }
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`Renderer: módulo "${e.id}" desligado:`, error);
      this.onEffectError?.(e.id, error);
      return null;
    }
  }

  render(now = performance.now()) {
    const { gl, v } = this;
    const u = music(this.st, v, now);

    // tamanho do canvas (escala de render para notebook fraco)
    const W = Math.max(2, Math.round(this.canvas.clientWidth * devicePixelRatio * v.renderScale));
    const H = Math.max(2, Math.round(this.canvas.clientHeight * devicePixelRatio * v.renderScale));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const active = this.effects.filter((e) => !this.off.has(e.id));
    if (W !== this.fbW || H !== this.fbH) {
      for (const e of active) this.guard(e, () => e.resize(W, H));
      this.fbW = W; this.fbH = H;
    }

    const vid = this.video && this.video.videoWidth ? this.video : null;
    if (vid && this.vidFresh) { upload(gl, this.tex.vid, vid); this.vidFresh = false; }
    const ctx: Ctx = {
      gl, uniforms: u, visual: v, W, H,
      px: H / 1080, // ajustes em "px" são relativos a 1080p
      textures: {
        logo: this.tex.logo, glow: this.tex.glow, bg: vid ? this.tex.vid : this.tex.bg,
        bgAspect: vid ? vid.videoHeight / vid.videoWidth : this.bgAspect, logoAspect: this.logoAspect, video: !!vid,
      },
    };
    for (const e of active) {
      if (this.off.has(e.id)) continue; // desligado no resize deste quadro
      const out = this.guard(e, () => e.render(ctx));
      if (out) ctx.src = out;
    }
    return u.p;
  }
}
