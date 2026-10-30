// Texturas e alvos de render (framebuffer + textura).

export function texture(gl: WebGL2RenderingContext, w = 1, h = 1) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Imagem, canvas ou quadro de vídeo → textura com mipmap (o mipmap serve de desfoque barato do vídeo). */
export function upload(gl: WebGL2RenderingContext, t: WebGLTexture, img: TexImageSource) {
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
}

export function bind(gl: WebGL2RenderingContext, unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.uniform1i(loc, unit);
}

export type Target = { fb: WebGLFramebuffer; tex: WebGLTexture };

/** Alvo W×H, já limpo de preto. */
export function target(gl: WebGL2RenderingContext, W: number, H: number): Target {
  const tex = texture(gl, W, H), fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { fb, tex };
}

export function dropTarget(gl: WebGL2RenderingContext, t: Target) {
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
}
