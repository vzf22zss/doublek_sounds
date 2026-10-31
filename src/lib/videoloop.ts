// Vídeo de fundo (DK-062), regras puras: janela de loop, volta no compasso, quem fica decodificando e qual
// é o próximo vídeo do roteiro. Sem DOM; quem mexe no <video> é assets.ts.

/** Metadados por vídeo na biblioteca (`doublek.videos`). Campos novos são opcionais: ausente = padrão. */
export type VideoInfo = {
  id: string; name: string;
  start?: number;       // s; início do loop (padrão 0)
  end?: number;         // s; fim do loop (padrão 0 = até o fim do arquivo)
  barRestart?: boolean; // ao entrar na tela, volta ao início no próximo compasso (sem BPM travado: na hora)
};

const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** Valida um item da lista. Campos novos inválidos somem (viram padrão); nunca acrescenta padrão, para a
 *  lista salva/exportada continuar igual quando ninguém mexeu no loop. null = item inválido. */
export function videoInfo(x: unknown): VideoInfo | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string') return null;
  const o: VideoInfo = { id: r.id, name: r.name };
  if (num(r.start)) o.start = r.start as number;
  if (num(r.end)) o.end = r.end as number;
  if (typeof r.barRestart === 'boolean') o.barRestart = r.barRestart;
  return o;
}

export type LoopWindow = { start: number; end: number; native: boolean };

/** Janela efetiva para um arquivo de `duration` s. Fim ausente, 0, além do arquivo ou colado no início = até
 *  o fim. `native` = arquivo inteiro: o `loop` do próprio <video> resolve, sem vigiar quadro a quadro. */
export function loopWindow(v: Pick<VideoInfo, 'start' | 'end'>, duration: number): LoopWindow {
  const d = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const start = Math.min(v.start ?? 0, Number.isFinite(d) ? Math.max(0, d - 0.1) : v.start ?? 0);
  let end = v.end && v.end > 0 ? Math.min(v.end, d) : d;
  if (end - start < 0.1) end = d; // janela de menos de 0,1 s não é loop: vale o arquivo até o fim
  return { start, end, native: start === 0 && end === d };
}

/** A cada quadro: passou do fim → volta ao início (s); senão null. Nada durante um seek, nem "antes do início":
 *  enquanto busca o início, o quadro mostrado é o quadro-chave ANTERIOR ao destino (ex.: 0,417 s para início 1 s),
 *  e reagir a ele mandava buscar de novo, em laço — o vídeo parava (fix/video-loop). */
export function wrapTarget(t: number, w: LoopWindow, seeking = false): number | null {
  if (w.native || seeking) return null;
  return t >= w.end - 0.02 ? w.start : null;
}

/** Ao entrar na tela: parado fora da janela (antes do início ou depois do fim) → vai para o início; senão null. */
export function entryTarget(t: number, w: LoopWindow): number | null {
  if (w.native) return null;
  return t < w.start - 0.05 || t >= w.end - 0.02 ? w.start : null;
}

/** "Reiniciar no compasso": quanto esperar (ms) até o próximo 1º tempo. Sem BPM travado: 0 (na hora). */
export function barDelayMs(f: { bpm: number; locked: boolean; holding?: boolean; beat: number; beatPhase: number } | null) {
  if (!f || !f.locked || f.holding || !(f.bpm > 0)) return 0;
  const inBar = (((f.beat % 4) + 4) % 4) + f.beatPhase; // 0..4 beats dentro do compasso
  return ((4 - inBar) % 4) * (60000 / f.bpm);
}

/** Política de decodificação: no máximo 1 tocando (`current`) + 1 pré-carregado (`pre`). Devolve os ids a
 *  soltar (pausar e liberar o arquivo). */
export function toRelease(current: string, pre: string, loaded: Iterable<string>): string[] {
  return [...loaded].filter((id) => id !== current && id !== pre);
}

/** Próximo vídeo do roteiro depois de `beat` que seja diferente do atual ('' = nenhum). */
export function nextVideo(cues: readonly { kind: string; beat: number; video?: string }[], beat: number, current: string) {
  let best: { beat: number; video: string } | null = null;
  for (const c of cues) {
    if (c.kind !== 'video' || !c.video || c.video === current || c.beat <= beat) continue;
    if (!best || c.beat < best.beat) best = { beat: c.beat, video: c.video };
  }
  return best?.video ?? '';
}
