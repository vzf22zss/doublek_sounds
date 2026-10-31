// Gravação da saída visual (DK-072): regras puras — escolha do codec, nome do arquivo, qualidade → bitrate e a
// máquina de estados que a janela de controle mostra (o telão grava; o Rust escreve o arquivo em pedaços).
// Sem áudio (DK-070: áudio é etapa posterior e opt-in).

export type Quality = 'LEVE' | 'MEDIA' | 'ALTA';
export const QUALITY_NAMES: Record<Quality, string> = { LEVE: 'Leve', MEDIA: 'Média', ALTA: 'Alta' };
/** Bits por segundo para 1080p (o tamanho do telão manda; em telas menores sobra qualidade). */
export const BITRATE: Record<Quality, number> = { LEVE: 4_000_000, MEDIA: 8_000_000, ALTA: 16_000_000 };
export type Fps = 30 | 60;

/**
 * Codec, do preferido ao último recurso (DK-071): MP4/H.264 (codificador de hardware no WebView2 desta geração,
 * toca em qualquer player) e WebM VP9/VP8 como alternativa. H.264 nível 4.0 vai até 1080p30; 60 fps pede 4.2.
 */
export function pickMime(fps: Fps, isSupported: (m: string) => boolean, noMp4 = false): { mime: string; ext: 'mp4' | 'webm' } | null {
  const order = [
    ...(noMp4 ? [] : [fps === 60 ? 'video/mp4;codecs=avc1.64002A' : 'video/mp4;codecs=avc1.640028']),
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mime = order.find((m) => { try { return isSupported(m); } catch { return false; } });
  return mime ? { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}

/** `<AAAAMMDD>T<HHMMSS>.<ext>` na hora local (o Rust só aceita letras, números e um ponto). */
export function recName(d: Date, ext: 'mp4' | 'webm') {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

export type Phase = 'idle' | 'starting' | 'recording' | 'stopping';
export type RecState = {
  phase: Phase;
  id: string;
  mime: string;
  startedAt: number;  // ms (relógio da janela de controle)
  ms: number;         // duração gravada
  bytes: number;
  path: string;       // última gravação terminada
  message: string;    // para a linha de status ('' = nada novo)
  p95Base: number;    // p95 do telão antes de gravar (0 = sem telemetria)
  warned: boolean;
};
export const IDLE: RecState = { phase: 'idle', id: '', mime: '', startedAt: 0, ms: 0, bytes: 0, path: '', message: '', p95Base: 0, warned: false };

export type RecEvent =
  | { t: 'start'; id: string; mime: string; at: number; p95: number }
  | { t: 'started'; at: number }
  | { t: 'progress'; bytes: number; at: number } // duração pelo relógio do controle
  | { t: 'stop' }
  | { t: 'done'; path: string; bytes: number; reason?: string }
  | { t: 'error'; message: string }
  | { t: 'telemetry'; p95: number; at: number };

/** Gravar com o p95 do telão mais de 30% acima do de antes = a gravação está pesando (avisa uma vez, depois de 3 s). */
export const PERF_RATIO = 1.3;
const mb = (b: number) => (b / 1048576).toFixed(1);

export function reduce(s: RecState, e: RecEvent): RecState {
  switch (e.t) {
    case 'start':
      if (s.phase !== 'idle') return { ...s, message: 'Já está gravando.' };
      return { ...IDLE, path: s.path, phase: 'starting', id: e.id, mime: e.mime, startedAt: e.at, p95Base: e.p95, message: '' };
    case 'started':
      return s.phase === 'starting' ? { ...s, phase: 'recording', startedAt: e.at, message: `Gravando a saída do telão (${s.mime.split(';')[0].split('/')[1].toUpperCase()}, sem áudio).` } : s;
    case 'progress':
      return s.phase === 'recording' || s.phase === 'stopping' ? { ...s, bytes: e.bytes, ms: Math.max(0, e.at - s.startedAt), message: '' } : s;
    case 'stop':
      return s.phase === 'recording' || s.phase === 'starting' ? { ...s, phase: 'stopping', message: 'Finalizando a gravação…' } : s;
    case 'done':
      return { ...IDLE, path: e.path, message: `Gravação salva: ${e.path} (${mb(e.bytes)} MB)` + (e.reason ? ` — parou sozinha: ${e.reason}.` : '.') };
    case 'error':
      return { ...IDLE, path: s.path, message: `A gravação parou: ${e.message}. O telão segue normal.` };
    case 'telemetry':
      if (s.phase !== 'recording' || s.warned || !(s.p95Base > 0) || e.at - s.startedAt < 3000 || !(e.p95 > s.p95Base * PERF_RATIO)) return { ...s, message: '' };
      return { ...s, warned: true, message: `A gravação está pesando no telão (p95 ${s.p95Base.toFixed(1)} → ${e.p95.toFixed(1)} ms): baixe para 30 fps ou qualidade Leve.` };
  }
}

/** "01:23 · 12.3 MB" para o indicador. */
export const recLabel = (s: RecState) => {
  const sec = Math.floor(s.ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')} · ${mb(s.bytes)} MB`;
};
