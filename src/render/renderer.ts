// Renderer WebGL2 em 3 passes: cena → rastro (feedback) → pós. Usado pela janela de saída e pelo preview.
// Tudo que é por quadro roda na GPU; o CPU só calcula envelopes e uniforms.
import type { Frame } from '../lib/types';
import type { Visual } from '../lib/settings';
import { LOGO_PAD, type Prepared } from '../lib/assets';

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const SCENE = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec2 uRes;
uniform vec3 uC1, uC2, uColor, uGlowColor;
uniform float uGrad, uAngle, uHasBg, uBgOpacity, uBgDim, uHue, uBgZoom, uBgBright, uFlash;
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
    vec4 im = texture(uBg, iuv);
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

const FEEDBACK = `#version 300 es
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

const POST = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uRes, uShake;
uniform float uVig, uScan, uGrain, uStrobe, uTime, uBlack, uPx;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 col = texture(uSrc, uv + uShake / uRes).rgb;
  col *= 1.0 - smoothstep(0.4, 1.0, length(uv - 0.5) / 0.7071) * 0.95 * uVig;
  if (mod(gl_FragCoord.y, 3.0 * uPx) < uPx) col *= 1.0 - 0.6 * uScan;
  col += (hash(floor(gl_FragCoord.xy / uPx) + fract(uTime) * 100.0) - 0.5) * uGrain * 0.35;
  col = mix(col, vec3(1.0), uStrobe);
  o = vec4(col * (1.0 - uBlack), 1.0);
}`;

type Prog = { p: WebGLProgram; u: (n: string) => WebGLUniformLocation | null };

const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] as const;
};

export class Renderer {
  private gl: WebGL2RenderingContext;
  private scene: Prog; private feedback: Prog; private post: Prog;
  private tex: Record<'logo' | 'glow' | 'bg', WebGLTexture>;
  private fbs: { fb: WebGLFramebuffer; tex: WebGLTexture }[] = [];
  private fbW = 0; private fbH = 0; private ping = 0;
  private logoAspect = 1; private bgAspect = 0;

  private v: Visual;
  private frame: Frame | null = null;
  private rxAt = 0; private lastT = 0; private lastKickRx = -1e9; private strength = 0.8;
  private kickEnv = 0; private waveEnv = 0; private presence = 0; private black = 0;
  private prevPh = 0; private lastTrig = -1e9;
  private rings: { t: number; s: number }[] = [];
  private spec = new Float32Array(64);

  constructor(private canvas: HTMLCanvasElement, v: Visual) {
    this.v = v;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 indisponível');
    this.gl = gl;
    this.scene = this.prog(SCENE);
    this.feedback = this.prog(FEEDBACK);
    this.post = this.prog(POST);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = { logo: this.texture(), glow: this.texture(), bg: this.texture() };
  }

  setVisual(v: Visual) { this.v = v; }

  setFrame(f: Frame) {
    const now = performance.now();
    this.frame = f;
    this.rxAt = now;
    if (f.kick > 0) {
      this.lastKickRx = now;
      this.strength = f.kick;
      if (!this.predicting()) this.trigger(now, f.kick);
    }
  }

  setLogo(p: Prepared) {
    this.upload(this.tex.logo, p.image);
    if (p.glow) this.upload(this.tex.glow, p.glow);
    this.logoAspect = p.aspect;
  }

  setBg(p: Prepared | null) {
    if (p) this.upload(this.tex.bg, p.image);
    this.bgAspect = p ? p.aspect : 0;
  }

  /** Com o andamento travado, o pulso sai da fase prevista (adiantada pelo offset), não do kick detectado. */
  private predicting() {
    const f = this.frame;
    return !!f && this.v.predict && f.locked && !f.holding && f.bpm > 0;
  }

  private trigger(now: number, s: number) {
    this.kickEnv = Math.max(this.kickEnv, s);
    this.lastTrig = now;
    this.rings.push({ t: now, s });
    if (this.rings.length > 16) this.rings.shift();
  }

  render(now = performance.now()) {
    const { gl, v } = this;
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const f = this.frame;
    const stale = !f || now - this.rxAt > 3000;
    const period = f?.bpm ? 60000 / f.bpm : 420;

    // fase do beat extrapolada, já com o offset visual (negativo = adiantado)
    let ph = 0;
    if (f?.bpm) {
      const x = f.beatPhase + ((now - this.rxAt - v.offset) / 1000) * (f.bpm / 60);
      ph = x - Math.floor(x);
      if (this.predicting() && ph < this.prevPh - 0.5 && now - this.lastTrig > period * 0.5) this.trigger(now, this.strength);
    }
    this.prevPh = ph;

    // envelopes (independem da taxa de quadros)
    this.kickEnv *= Math.exp(-dt / Math.max(0.01, v.rel));
    const b = !stale && f ? f.bands : [0, 0, 0, 0, 0];
    const w = Math.max(b[0], b[1]) * 0.6 + b[2] * 0.4;
    this.waveEnv += (w - this.waveEnv) * (1 - Math.exp(-dt / (w > this.waveEnv ? 0.012 : Math.max(0.02, v.rel * 0.8))));
    const target = this.predicting() || now - this.lastKickRx < period * 1.6 ? 1 : 0;
    this.presence += (target - this.presence) * (1 - Math.exp(-dt / (target > this.presence ? 0.04 : 0.3)));
    const kick = this.presence * this.kickEnv;
    let p = kick + (1 - this.presence) * this.waveEnv * v.wave;
    if (stale) p = 0.12 * (0.5 + 0.5 * Math.sin(now / 1000 * 1.6)); // sem sinal: respira devagar
    this.black += ((v.blackout ? 1 : 0) - this.black) * (1 - Math.exp(-dt / 0.08));
    if (f && !stale) for (let i = 0; i < 64; i++) {
      const s = f.spectrum[i] ?? 0;
      this.spec[i] += (s - this.spec[i]) * (s > this.spec[i] ? 0.6 : 0.15);
    }

    // tamanho do canvas (escala de render para notebook fraco)
    const W = Math.max(2, Math.round(this.canvas.clientWidth * devicePixelRatio * v.renderScale));
    const H = Math.max(2, Math.round(this.canvas.clientHeight * devicePixelRatio * v.renderScale));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    if (W !== this.fbW || H !== this.fbH) this.resizeFbs(W, H);
    const px = H / 1080; // ajustes em "px" são relativos a 1080p
    const mn = Math.min(W, H);

    // ---- passe 1: cena ----
    let u = this.use(this.scene, this.fbs[0].fb, W, H);
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform3f(u('uC1'), ...hex(v.bgc1));
    gl.uniform3f(u('uC2'), ...hex(v.bgc2));
    gl.uniform3f(u('uColor'), ...hex(v.color));
    gl.uniform3f(u('uGlowColor'), ...hex(v.color));
    gl.uniform1f(u('uGrad'), v.bgGrad ? 1 : 0);
    gl.uniform1f(u('uAngle'), v.bgAngle);
    gl.uniform1f(u('uHasBg'), this.bgAspect ? 1 : 0);
    gl.uniform1f(u('uBgOpacity'), v.bgOpacity);
    gl.uniform1f(u('uBgDim'), v.bgDim / 100);
    gl.uniform1f(u('uHue'), ((now / 1000) * v.bgHue * Math.PI) / 180);
    gl.uniform1f(u('uBgZoom'), 1 + p * v.bgPulse);
    gl.uniform1f(u('uBgBright'), 1 + p * v.bgFlash);
    gl.uniform1f(u('uFlash'), p * v.fxFlash);
    const A = W / H, B = this.bgAspect ? 1 / this.bgAspect : A; // aspecto largura/altura
    const wide = B > A;
    gl.uniform2f(u('uBgScale'), ...((v.bgFit === 'cover') === wide ? [A / B, 1] : [1, B / A]) as [number, number]);
    const logoW = (v.size / 100) * mn * (1 + p * v.amount);
    gl.uniform2f(u('uLogoSize'), logoW * (1 + 2 * LOGO_PAD), logoW * this.logoAspect * (1 + 2 * LOGO_PAD));
    gl.uniform1f(u('uLogoR'), (v.size / 100) * mn * 0.5 * Math.max(1, this.logoAspect));
    gl.uniform1f(u('uGlowAmt'), v.glow * (0.15 + p * 1.5));
    gl.uniform1f(u('uChroma'), p * v.chroma * px);
    gl.uniform1f(u('uBars'), v.fxBars);
    gl.uniform1f(u('uRadial'), v.fxRadial);
    gl.uniform1fv(u('uSpec'), this.spec);
    const r0 = (mn * v.size) / 200, rMax = Math.max(W, H) * 0.75, rings = new Float32Array(64);
    this.rings = this.rings.filter((r) => now - r.t < 900);
    this.rings.forEach((r, i) => {
      const q = (now - r.t) / 900;
      rings.set([r0 + (rMax - r0) * (1 - (1 - q) ** 2), (1 - q) ** 1.5 * r.s * v.fxRings, (2 + 7 * (1 - q) * r.s) * px, 0], i * 4);
    });
    gl.uniform4fv(u('uRings'), rings);
    gl.uniform1i(u('uNRings'), v.fxRings > 0 ? this.rings.length : 0);
    this.bind(0, this.tex.bg, u('uBg'));
    this.bind(1, this.tex.logo, u('uLogo'));
    this.bind(2, this.tex.glow, u('uGlow'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    let src = this.fbs[0].tex;

    // ---- passe 2: rastro (só se ligado) ----
    if (v.trail > 0) {
      const cur = 1 + this.ping, prev = 2 - this.ping;
      u = this.use(this.feedback, this.fbs[cur].fb, W, H);
      gl.uniform1f(u('uDecay'), 0.6 + 0.38 * v.trail);
      gl.uniform1f(u('uZoom'), 1 + v.trailZoom * 0.03 * (1 + p));
      gl.uniform1f(u('uRot'), v.trailRot * 0.01);
      this.bind(0, src, u('uScene'));
      this.bind(1, this.fbs[prev].tex, u('uPrev'));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = this.fbs[cur].tex;
      this.ping ^= 1;
    }

    // ---- passe 3: pós ----
    u = this.use(this.post, null, W, H);
    const shake = kick * v.fxShake * px;
    gl.uniform2f(u('uRes'), W, H);
    gl.uniform2f(u('uShake'), (Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    gl.uniform1f(u('uVig'), v.fxVig);
    gl.uniform1f(u('uScan'), v.fxScan);
    gl.uniform1f(u('uGrain'), v.fxGrain);
    gl.uniform1f(u('uTime'), now / 1000);
    gl.uniform1f(u('uPx'), Math.max(1, px));
    let strobe = 0;
    if (v.strobe > 0) {
      const sub = (ph * v.strobeDiv) % 1;
      strobe = this.predicting() ? (sub < 0.15 ? 1 - sub / 0.15 : 0) : this.kickEnv;
      strobe *= v.strobe;
    }
    gl.uniform1f(u('uStrobe'), strobe);
    gl.uniform1f(u('uBlack'), this.black);
    this.bind(0, src, u('uSrc'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return p;
  }

  // ---------- helpers WebGL ----------
  private prog(fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const cache = new Map<string, WebGLUniformLocation | null>();
    return { p, u: (n) => (cache.has(n) ? cache.get(n)! : (cache.set(n, gl.getUniformLocation(p, n)), cache.get(n)!)) };
  }

  private use(pr: Prog, fb: WebGLFramebuffer | null, W: number, H: number) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
    this.gl.viewport(0, 0, W, H);
    this.gl.useProgram(pr.p);
    return pr.u;
  }

  private bind(unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, t);
    this.gl.uniform1i(loc, unit);
  }

  private texture(w = 1, h = 1) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private upload(t: WebGLTexture, img: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  private resizeFbs(W: number, H: number) {
    const gl = this.gl;
    this.fbs.forEach(({ fb, tex }) => { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); });
    this.fbs = [0, 1, 2].map(() => {
      const tex = this.texture(W, H), fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { fb, tex };
    });
    this.fbW = W; this.fbH = H;
  }
}
