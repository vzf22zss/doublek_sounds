// Contrato dos módulos visuais (ADR 0002). Cada passe do renderer é um módulo: recebe a textura do passe
// anterior em `src` e devolve a sua (ou null para não mudar nada, ou quando desenha direto na tela).
import type { Visual } from '../../lib/settings';
import type { MusicUniforms } from '../music';
import type { Prog } from '../gl/program';
import type { Target } from '../gl/texture';

/** Ferramentas GL que o renderer empresta aos módulos. `program` vem de um cache por código-fonte. */
export type Helpers = {
  program(fs: string, name: string): Prog;
  use(pr: Prog, fb: WebGLFramebuffer | null, W: number, H: number): Prog['u'];
  bind(unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null): void;
  target(W: number, H: number): Target;
  dropTarget(t: Target): void;
};

/** Texturas de entrada, mantidas pelo renderer. `bg` já é o vídeo quando há vídeo. */
export type Textures = { logo: WebGLTexture; glow: WebGLTexture; bg: WebGLTexture; bgAspect: number; logoAspect: number; video: boolean };

export type Ctx = {
  gl: WebGL2RenderingContext;
  uniforms: MusicUniforms;
  visual: Visual;
  textures: Textures;
  px: number; // ajustes em "px" são relativos a 1080p
  W: number; H: number;
  src?: WebGLTexture;
};

export interface Effect {
  id: string;
  /** Sem ele não há imagem: erro propaga (o telão trata). Os outros são desligados sozinhos. */
  required?: boolean;
  /** Módulo do Psy Engine: pula com `psySafe` e entra no orçamento automático. */
  psy?: boolean;
  init(gl: WebGL2RenderingContext, h: Helpers): void;
  resize(W: number, H: number): void;
  render(ctx: Ctx): WebGLTexture | null;
  dispose(): void;
}
