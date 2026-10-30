// Renderer WebGL2: orquestra os módulos cena → Psy Engine → rastro (feedback) → glitch → pós. Usado pela janela de
// saída e pelo preview. Tudo que é por quadro roda na GPU; o CPU só calcula envelopes e uniforms (music.ts, testável).
// Módulo que falha ao compilar ou ao desenhar é desligado sozinho (log + onEffectError); a cena e o pós são
// a base: erro neles sobe para quem chamou, como antes (o telão mostra preto e avisa o controle).
//
// ---------- O que esperar de custo (DK-022/023/024) ----------
// Cada módulo do Psy Engine ligado = 1 passe de tela cheia + 1 textura RGBA8 do tamanho do canvas (criada no 1º uso).
// Intensidade 0, `psySafe` ou desligado pelo orçamento = não desenha, custo ~0. Por pixel (baixa / média / alta):
//
//   módulo         leituras de textura      iterações do laço                       custo relativo (budget.ts)
//   orgânico       1                        3 fbm × 2/3/4 oitavas × 4 hashes        25 / 37 / 49
//   partículas     1                        8/16/32 camadas × ~4 hashes             9 / 17 / 33
//   mandala        1                        3/5/8 anéis                             4 / 6 / 9
//   túnel          1                        2/3/5 camadas × 2 cossenos              3 / 4 / 6
//   caleidoscópio  1 + 1/2/4                 1/2/4 amostras                          2 / 3 / 5
//   glitch         4 (fixo)                 — (só desenha nos 120 ms da rajada)     4 / 4 / 4
//   + mistura      2 por camada não-normal ou translúcida (1 passe; 2 alvos do compositor, criados uma vez)
//
// Camadas (DK-051/052, layers.ts): a ordem dos módulos entre a cena e o pós vem de `visual.layers`; cada camada
// pode ser desligada (não desenha) e misturada com a de baixo (normal/somar/tela/multiplicar + opacidade).
// Reordenar não aloca nada: cada módulo guarda o seu alvo, e o compositor usa os mesmos dois o tempo todo.
//
// Medição: `costs()` dá a média de ~1 s de cada passe — CPU sempre; GPU só com EXT_disjoint_timer_query_webgl2
// (lida 2–3 quadros depois, nunca bloqueia; sem a extensão, como no swiftshader, `gpuMs` = null).
// Orçamento: com `onBudget` registrado e `psyAuto`, o p95 do intervalo entre quadros acima de `psyBudgetMs` por 3 s
// (ignorando os 5 s de abertura)
// desce a qualidade e depois desliga o módulo mais caro (budget.ts). É opt-in porque o preview desenha a 30 fps de
// propósito (33 ms entre quadros) e se rebaixaria sozinho: só quem desenha o telão deve registrar o callback.
import type { Frame } from '../lib/types';
import type { Visual } from '../lib/settings';
import type { Prepared } from '../lib/assets';
import { percentile } from '../lib/telemetry';
import { music, musicFrame, musicState } from './music';
import { budgetState, budgetStep, effQuality, ESTIMATE, type BudgetInfo } from './budget';
import { program, quad, use, type Prog } from './gl/program';
import { bind, dropTarget, target, texture, upload } from './gl/texture';
import type { Ctx, Effect, Helpers } from './effects/types';
import { SceneEffect } from './effects/scene';
import { FeedbackEffect } from './effects/feedback';
import { PostEffect } from './effects/post';
import { TunnelEffect } from './effects/tunnel';
import { MandalaEffect } from './effects/mandala';
import { KaleidoEffect } from './effects/kaleido';
import { OrganicEffect } from './effects/organic';
import { ParticlesEffect } from './effects/particles';
import { GlitchEffect } from './effects/glitch';
import { Compose } from './effects/compose';
import { drawsLayer, needsCompose, sanitizeLayers, type Layer } from './layers';

export type Cost = { id: string; cpuMs: number; gpuMs: number | null };
export type { BudgetInfo };

// EXT_disjoint_timer_query_webgl2 não tem tipo no lib.dom do TypeScript
type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
const GRACE_MS = 5000;

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

  // medição por passe (média móvel de ~1 s)
  private timer: TimerExt | null;
  private pending: { q: WebGLQuery; id: string; dt: number }[] = [];
  private pool: WebGLQuery[] = [];
  private cost = new Map<string, { cpu: number; gpu: number | null }>();
  private lastNow = -1;

  // orçamento automático (só com onBudget registrado)
  /** Registre no telão para ligar o ajuste automático; recebe cada mudança (mensagem pronta em `msg`). */
  onBudget?: (info: BudgetInfo) => void;
  private budget = budgetState();
  private win: number[] = []; private winStart = -1; private born = -1;
  private drew = new Set<string>();

  // camadas (DK-051/052): ordem e mistura dos módulos entre a cena e o pós
  private byId = new Map<string, Effect>();
  private compose = new Compose(); private composeOk = true;
  private layersRaw: unknown = Symbol(); // força validar na 1ª vez
  private chain: { e: Effect; layer?: Layer }[] = [];

  constructor(private canvas: HTMLCanvasElement, v: Visual, private onEffectError?: (id: string, e: Error) => void) {
    this.v = v;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 indisponível');
    this.gl = gl;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
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
    // Psy Engine (DK-022/023): orgânico, túnel e partículas por baixo da logo; mandala em volta dela; caleidoscópio
    // dobrando tudo; glitch depois do rastro (não deixa rastro). Com intensidade 0 cada um devolve null e não desenha.
    this.effects = [
      new SceneEffect(), new OrganicEffect(), new TunnelEffect(), new ParticlesEffect(), new MandalaEffect(), new KaleidoEffect(),
      new FeedbackEffect(), new GlitchEffect(), new PostEffect(),
    ];
    for (const e of this.effects) this.guard(e, () => e.init(gl, h));
    this.byId = new Map(this.effects.map((e) => [e.id, e]));
    try { this.compose.init(h); } catch (err) {
      this.composeOk = false; // sem compositor, toda camada desenha como `normal` (a imagem de hoje)
      console.error('Renderer: compositor desligado:', err);
      this.onEffectError?.('compose', err instanceof Error ? err : new Error(String(err)));
    }
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

  /** Custo médio (~1 s) de cada passe, em ms. `gpuMs` = null sem timer de GPU. */
  costs(): Cost[] {
    return [...this.cost].map(([id, c]) => ({ id, cpuMs: +c.cpu.toFixed(3), gpuMs: c.gpu === null ? null : +c.gpu.toFixed(3) }));
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

  /** Média móvel exponencial de ~1 s (o 1º valor entra direto). */
  private track(id: string, kind: 'cpu' | 'gpu', ms: number, dt: number) {
    const c = this.cost.get(id) ?? { cpu: ms, gpu: kind === 'gpu' ? ms : null };
    if (kind === 'gpu' && c.gpu === null) c.gpu = ms;
    const a = 1 - Math.exp(-dt / 1000);
    c[kind] = c[kind]! + (ms - c[kind]!) * a;
    this.cost.set(id, c);
  }

  /** Lê, sem esperar, os timers de GPU que já ficaram prontos (normalmente 2–3 quadros depois). */
  private pollTimers() {
    const { gl, timer } = this;
    if (!timer) return;
    const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT); // GPU trocou de clock/contexto: descarta o lote
    while (this.pending.length) {
      const p = this.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) this.track(p.id, 'gpu', gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6, p.dt);
      this.pool.push(p.q);
    }
  }

  /** Cena → camadas na ordem do visual → pós. Só recalcula quando a lista muda (cada evento 'visual' traz uma nova). */
  private chainFor(raw: unknown) {
    if (raw === this.layersRaw) return this.chain;
    this.layersRaw = raw;
    const mid = sanitizeLayers(raw).flatMap((layer) => {
      const e = this.byId.get(layer.id);
      return e ? [{ e, layer }] : [];
    });
    this.chain = [{ e: this.byId.get('scene')! }, ...mid, { e: this.byId.get('post')! }];
    return this.chain;
  }

  /** Junta o intervalo entre quadros e, a cada segundo, manda o p95 para o orçamento. */
  private sampleBudget(now: number, dt: number) {
    if (!this.onBudget) return;
    if (this.born < 0) this.born = now;
    // aba escondida, 1º quadro, e os 5 s de abertura (compilação, upload de logo/vídeo) não contam
    if (dt <= 0 || dt > 1000 || now - this.born < GRACE_MS) { this.win = []; this.winStart = now; return; }
    this.win.push(dt);
    if (now - this.winStart < 1000) return;
    const v = this.v, q = effQuality(this.budget, v.psyQuality);
    const gpu = this.timer && [...this.drew].every((id) => this.cost.get(id)?.gpu != null);
    const active = [...this.drew].map((id) => ({ id, cost: gpu ? this.cost.get(id)!.gpu! : ESTIMATE[id]?.[q] ?? 1 }));
    const p95 = percentile(this.win.sort((a, b) => a - b), 0.95);
    this.win = []; this.winStart = now; this.drew.clear();
    const info = budgetStep(this.budget, { now, p95, budgetMs: v.psyBudgetMs, auto: v.psyAuto, quality: v.psyQuality, active });
    if (info) { console.info(info.msg); this.onBudget(info); }
  }

  render(now = performance.now()) {
    const { gl, v } = this;
    const dt = this.lastNow < 0 ? 0 : now - this.lastNow;
    this.lastNow = now;
    this.pollTimers();
    this.sampleBudget(now, dt);
    const u = music(this.st, v, now);

    // tamanho do canvas (escala de render para notebook fraco)
    const W = Math.max(2, Math.round(this.canvas.clientWidth * devicePixelRatio * v.renderScale));
    const H = Math.max(2, Math.round(this.canvas.clientHeight * devicePixelRatio * v.renderScale));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    if (W !== this.fbW || H !== this.fbH) {
      for (const e of this.effects) if (!this.off.has(e.id)) this.guard(e, () => e.resize(W, H));
      this.compose.resize(W, H);
      this.fbW = W; this.fbH = H;
    }

    const vid = this.video && this.video.videoWidth ? this.video : null;
    if (vid && this.vidFresh) { upload(gl, this.tex.vid, vid); this.vidFresh = false; }
    // o orçamento só baixa a qualidade que os módulos leem; o visual do operador não muda
    const q = effQuality(this.budget, v.psyQuality);
    const ctx: Ctx = {
      gl, uniforms: u, visual: q === Math.round(v.psyQuality) ? v : { ...v, psyQuality: q }, W, H,
      px: H / 1080, // ajustes em "px" são relativos a 1080p
      textures: {
        logo: this.tex.logo, glow: this.tex.glow, bg: vid ? this.tex.vid : this.tex.bg,
        bgAspect: vid ? vid.videoHeight / vid.videoWidth : this.bgAspect, logoAspect: this.logoAspect, video: !!vid,
      },
    };
    for (const { e, layer } of this.chainFor(v.layers)) {
      if (this.off.has(e.id)) continue; // módulo quebrado (desligado no init, no resize ou num quadro anterior)
      // interruptor, orçamento, camada desligada/transparente ou outra camada em solo: não desenha
      if ((e.psy && (v.psySafe || this.budget.off.includes(e.id))) || (layer && !drawsLayer(layer, v.layerSolo))) {
        this.cost.delete(e.id);
        continue;
      }
      const t0 = performance.now();
      const qy = this.timer ? this.pool.pop() ?? gl.createQuery() : null;
      if (qy) gl.beginQuery(this.timer!.TIME_ELAPSED_EXT, qy);
      let out: WebGLTexture | null = null;
      try {
        const base = ctx.src;
        out = this.guard(e, () => e.render(ctx));
        // camada não-normal ou translúcida: mistura com o de baixo (o custo entra na conta da própria camada)
        if (out && base && layer && this.composeOk && needsCompose(layer)) out = this.compose.apply(gl, base, out, layer.opacity, layer.blend);
      } finally {
        if (qy) {
          gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
          this.pending.push({ q: qy, id: e.id, dt });
          if (this.pending.length > 64) this.pool.push(this.pending.shift()!.q); // GPU muito atrás: descarta o mais velho
        }
        this.track(e.id, 'cpu', performance.now() - t0, dt);
      }
      if (out) {
        ctx.src = out;
        if (e.psy) this.drew.add(e.id);
      }
    }
    return u.p;
  }
}
