// Programa GLSL: compila/linka com erro legível e guarda as localizações de uniform. Mais o triângulo de tela cheia.

/** Vértice comum a todos os passes: um triângulo que cobre a tela, `uv` de 0 a 1. */
export const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

export type Prog = { p: WebGLProgram; u: (n: string) => WebGLUniformLocation | null };

/** `name` só entra na mensagem de erro, para saber qual módulo não compilou. */
export function program(gl: WebGL2RenderingContext, fs: string, name = 'shader'): Prog {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s) || 'sem log';
      gl.deleteShader(s);
      throw new Error(`${name}: ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader não compilou: ${log}`);
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: link falhou: ${gl.getProgramInfoLog(p) || 'sem log'}`);
  const cache = new Map<string, WebGLUniformLocation | null>();
  return { p, u: (n) => (cache.has(n) ? cache.get(n)! : (cache.set(n, gl.getUniformLocation(p, n)), cache.get(n)!)) };
}

/** Liga o programa desenhando em `fb` (null = tela) e devolve o leitor de uniforms. */
export function use(gl: WebGL2RenderingContext, pr: Prog, fb: WebGLFramebuffer | null, W: number, H: number) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, W, H);
  gl.useProgram(pr.p);
  return pr.u;
}

/** Triângulo de tela cheia no atributo 0 (`p`); fica ligado no VAO para todos os passes. */
export function quad(gl: WebGL2RenderingContext) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}
