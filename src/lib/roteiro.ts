// Roteiro: pontos marcados numa música, em BEATS (não em segundos). Assim o mesmo roteiro serve
// quando o app toca o arquivo (grade exata) e quando o DJ toca nos decks com o pitch mexido (GO).
import { load, save } from './store.ts';

export type CueKind = 'scene' | 'fx' | 'video' | 'knob';
export type FxKind = 'strobe' | 'flash' | 'blackout' | 'logoOnly';

export type Cue = {
  id: string;
  beat: number;
  kind: CueKind;
  scene?: number; fade?: number;              // cena i, crossfade em beats
  fx?: FxKind; beats?: number; div?: number;  // efeito pontual por N beats (strobe em 1/div)
  video?: string;                             // id do vídeo ('' = sem vídeo)
  key?: string; to?: number; ramp?: number;   // ajuste visual até `to` em `ramp` beats
};

export type Roteiro = {
  id: string;
  name: string;
  track: string;     // id da música guardada no app
  trackName: string;
  bpm: number;
  anchor: number;    // s do 1º beat no arquivo
  barShift: number;  // 0..3: em qual beat começa o compasso
  goBeat: number;    // modo DJ: em que beat do roteiro o GO é apertado
  cues: Cue[];
};

export const FX_NAMES: Record<FxKind, string> = { strobe: 'Strobe', flash: 'Flash', blackout: 'Blackout', logoOnly: 'Só logo' };
export const KIND_NAMES: Record<CueKind, string> = { scene: 'Cena', fx: 'Efeito', video: 'Vídeo', knob: 'Knob' };

// ajustes que um ponto "Knob" pode levar até um valor: [nome, mín, máx] (mesma faixa dos sliders)
export const KNOBS: Record<string, [string, number, number]> = {
  amount: ['Pulso', 0, 1.5], glow: ['Glow', 0, 1], size: ['Tamanho da logo', 10, 150], chroma: ['Aberração', 0, 40],
  fxFlash: ['Flash', 0, 1], fxRings: ['Anéis', 0, 1], fxBars: ['Espectro barras', 0, 1], fxRadial: ['Espectro radial', 0, 1],
  trail: ['Rastro', 0, 1], trailZoom: ['Zoom do rastro', -1, 1], trailRot: ['Giro do rastro', -1, 1], strobe: ['Strobe', 0, 1],
  fxShake: ['Tremor', 0, 30], fxVig: ['Vinheta', 0, 1], fxScan: ['Linhas de TV', 0, 1], fxGrain: ['Granulado', 0, 1],
  bgPulse: ['Zoom do fundo', 0, 0.4], bgFlash: ['Brilho do fundo', 0, 1], bgOpacity: ['Opacidade do fundo', 0, 1],
  bgDim: ['Brilho da foto/vídeo', 0, 150], bgHue: ['Girar matiz', -180, 180], videoSpeed: ['Velocidade do vídeo', 0.25, 2],
};

/** Lista salva → só roteiros válidos, mantendo os ids (os pontos e o roteiro atual apontam para eles). */
export function validRoteiros(raw: unknown): Roteiro[] {
  if (!Array.isArray(raw)) throw new Error('roteiros: precisa ser lista');
  return raw.map((x) => sanitizeRoteiro(x, true)).filter((r): r is Roteiro => !!r);
}
export function loadRoteiros(): Roteiro[] {
  return load('doublek.roteiros', validRoteiros, () => []);
}
export function saveRoteiros(r: Roteiro[]) {
  save('doublek.roteiros', r);
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newCue(kind: CueKind, beat: number): Cue {
  const base = { id: uid(), beat, kind };
  if (kind === 'scene') return { ...base, scene: 0, fade: 4 };
  if (kind === 'fx') return { ...base, fx: 'strobe', beats: 4, div: 2 };
  if (kind === 'video') return { ...base, video: '' };
  return { ...base, key: 'trail', to: 0.7, ramp: 8 };
}

// ---------- tempo ----------
export const period = (r: Roteiro) => 60 / r.bpm;
export const beatAt = (r: Roteiro, t: number) => (t - r.anchor) / period(r);
export const timeAt = (r: Roteiro, beat: number) => r.anchor + beat * period(r);
/** "33.2" = compasso 33, 2º tempo (compassos de 4, começando no barShift). */
export function barLabel(r: Roteiro, beat: number) {
  const b = Math.floor(beat) - r.barShift;
  return `${Math.floor(b / 4) + 1}.${(((b % 4) + 4) % 4) + 1}`;
}
export const snap = (r: Roteiro, beat: number, bar: boolean) =>
  bar ? Math.round((beat - r.barShift) / 4) * 4 + r.barShift : Math.round(beat);

// ---------- execução ----------
/** Pontos a disparar quando o cursor anda de `from` (exclusivo) até `to` (inclusivo). */
export const due = (cues: Cue[], from: number, to: number) =>
  cues.filter((c) => c.beat > from && c.beat <= to).sort((a, b) => a.beat - b.beat);

/** Começando (ou pulando) no meio: a última cena e o último vídeo antes do cursor valem já. */
export function stateAt(cues: Cue[], beat: number) {
  const last = (k: CueKind) => cues.filter((c) => c.kind === k && c.beat <= beat).sort((a, b) => b.beat - a.beat)[0];
  return { scene: last('scene'), video: last('video') };
}

/** Valor da rampa de knob no beat `beat` (começa em `from` no beat do ponto). */
export function rampAt(c: Cue, from: number, beat: number) {
  const r = c.ramp ?? 0, to = c.to ?? from;
  if (r <= 0 || beat >= c.beat + r) return to;
  return from + (to - from) * Math.max(0, (beat - c.beat) / r);
}

export function cueLabel(c: Cue, scenes: ({ name: string } | null)[], videos: { id: string; name: string }[]) {
  if (c.kind === 'scene') return scenes[c.scene ?? 0]?.name ?? `Cena ${(c.scene ?? 0) + 1}`;
  if (c.kind === 'fx') return `${FX_NAMES[c.fx ?? 'strobe']} ${c.beats ?? 1}b`;
  if (c.kind === 'video') return c.video ? videos.find((v) => v.id === c.video)?.name ?? 'vídeo' : 'sem vídeo';
  return `${KNOBS[c.key ?? '']?.[0] ?? c.key} → ${+(c.to ?? 0).toFixed(2)}`;
}

/** Roteiro vindo de arquivo (ids novos) ou do armazenamento (`keepIds`): só campos conhecidos com o tipo certo. */
export function sanitizeRoteiro(x: any, keepIds = false): Roteiro | null {
  if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !Array.isArray(x.cues)) return null;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v.slice(0, 80) : d);
  const id = (v: unknown) => (keepIds && typeof v === 'string' && v ? v : uid());
  const kinds = Object.keys(KIND_NAMES), fxs = Object.keys(FX_NAMES);
  return {
    id: id(x.id), name: str(x.name, 'Roteiro'), track: str(x.track, ''), trackName: str(x.trackName, ''),
    bpm: num(x.bpm, 0), anchor: num(x.anchor, 0), barShift: num(x.barShift, 0) & 3, goBeat: num(x.goBeat, 0),
    cues: x.cues
      .filter((c: any) => c && kinds.includes(c.kind) && Number.isFinite(c.beat))
      .map((c: any): Cue => ({
        id: id(c.id), beat: c.beat, kind: c.kind,
        scene: num(c.scene, 0), fade: num(c.fade, 4),
        fx: fxs.includes(c.fx) ? c.fx : 'strobe', beats: num(c.beats, 4), div: num(c.div, 1),
        video: str(c.video, ''), key: str(c.key, 'trail'), to: num(c.to, 0), ramp: num(c.ramp, 0),
      })),
  };
}
