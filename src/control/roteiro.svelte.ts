// Motor do roteiro: cursor em beats, disparo dos pontos, efeitos com duração e rampas de knob.
// App toca: cursor = posição do arquivo na grade analisada. DJ toca: no GO, o beat ao vivo vira o
// beat `goBeat` do roteiro e o cursor anda junto com o relógio do beat ao vivo (segue o pitch).
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { getVideo } from '../lib/assets';
import type { Visual } from '../lib/settings';
import type { Frame } from '../lib/types';
import { beatAt, due, loadRoteiros, newCue, rampAt, sanitizeRoteiro, stateAt, timeAt, uid, type Cue, type CueKind, type Roteiro } from '../lib/roteiro';

export type TrackInfo = { duration: number; bpm: number; anchor: number; peaks: number[]; lows: number[] };

export const rt = $state({
  list: loadRoteiros(),
  cur: '',
  info: null as TrackInfo | null, // forma de onda da música carregada
  loaded: '',                     // id da música pronta no motor
  busy: '',
  source: 'app' as 'app' | 'dj',
  mode: 'live' as 'live' | 'only',
  output: '',
  running: false,
  cursor: 0,
  selected: '',
  kind: 'scene' as CueKind,       // tipo do próximo ponto criado
});

export const current = () => rt.list.find((r) => r.id === rt.cur) ?? null;
export const selectedCue = () => current()?.cues.find((c) => c.id === rt.selected) ?? null;

type Ctx = {
  vs(): Visual;
  recall(i: number, fade: number, now: boolean): void;
  status(s: string): void;
  listen(): void;                 // volta para a entrada ao vivo (para o arquivo)
  range(): [number, number];
};
let ctx: Ctx;
export const attach = (c: Ctx) => (ctx = c);

// ---------- arquivo / análise ----------
export async function load(r: Roteiro) {
  rt.busy = 'Analisando a música…';
  try {
    const [lo, hi] = ctx.range();
    const info = await invoke<TrackInfo>('load_track', { id: r.track, lo, hi, output: rt.output || null });
    rt.info = info;
    rt.loaded = r.track;
    if (!r.bpm && info.bpm) Object.assign(r, { bpm: +info.bpm.toFixed(3), anchor: info.anchor });
    ctx.status(r.bpm ? `${r.trackName}: ${r.bpm.toFixed(2)} BPM` : 'Não achei o BPM: confira a faixa de andamento (aba Áudio) e analise de novo, ou digite o BPM.');
  } catch (e) {
    rt.info = null;
    rt.loaded = '';
    ctx.status(String(e));
  } finally {
    rt.busy = '';
  }
}

async function upload(file: File) {
  rt.busy = 'Guardando a música…';
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3';
  return invoke<string>('add_track', new Uint8Array(await file.arrayBuffer()), { headers: { 'x-ext': ext } });
}

export async function create(file: File) {
  try {
    const track = await upload(file);
    const r: Roteiro = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), track, trackName: file.name, bpm: 0, anchor: 0, barShift: 0, goBeat: 0, cues: [] };
    rt.list.push(r);
    await open(r.id);
  } catch (e) {
    rt.busy = '';
    ctx.status('Não consegui guardar a música: ' + e);
  }
}

/** Troca a música (ex.: roteiro importado de outro computador), mantendo os pontos. */
export async function replaceTrack(file: File) {
  const r = current();
  if (!r) return;
  try {
    Object.assign(r, { track: await upload(file), trackName: file.name, bpm: 0, anchor: 0 });
    await load(r);
  } catch (e) {
    rt.busy = '';
    ctx.status('Não consegui guardar a música: ' + e);
  }
}

export async function open(id: string) {
  stop();
  rt.cur = id;
  rt.info = null;
  rt.selected = '';
  const r = current();
  if (r) await load(r);
}

export function remove(id: string) {
  const r = rt.list.find((x) => x.id === id);
  if (!r) return;
  if (rt.cur === id) { stop(); rt.cur = ''; rt.info = null; }
  rt.list = rt.list.filter((x) => x.id !== id);
  if (!rt.list.some((x) => x.track === r.track)) invoke('remove_track', { id: r.track }).catch(() => {});
}

export function exportFile() {
  const r = current();
  if (!r) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'doublek-roteiro', version: 1, roteiro: $state.snapshot(r) }, null, 2)], { type: 'application/json' }));
  a.download = `roteiro-${r.name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function importFile(f: File) {
  try {
    const d = JSON.parse(await f.text());
    const r = sanitizeRoteiro(d?.app === 'doublek-roteiro' ? d.roteiro : null);
    if (!r) throw new Error('não é um roteiro do DoubleK');
    rt.list.push(r);
    await open(r.id);
    ctx.status(`Roteiro "${r.name}" importado. Se a música não estiver neste computador, use "Trocar música".`);
  } catch (e) {
    ctx.status('Não consegui ler o roteiro: ' + (e as Error).message);
  }
}

// ---------- pontos ----------
export function addCue(beat: number) {
  const r = current();
  if (!r) return;
  const c = newCue(rt.kind, beat);
  r.cues.push(c);
  rt.selected = c.id;
}

export function deleteCue(id = rt.selected) {
  const r = current();
  if (r) r.cues = r.cues.filter((c) => c.id !== id);
  if (rt.selected === id) rt.selected = '';
}

// ---------- execução ----------
let last = -Infinity;
let goAt: { live: number; beat: number } | null = null;
let lastFrame: Frame | null = null, lastFrameAt = 0;
let active: { end: number; undo: () => void }[] = [];
let ramps: { cue: Cue; from: number }[] = [];

const liveBeat = (f: Frame, at: number) => f.beat + f.beatPhase + ((performance.now() - at) / 1000) * (f.bpm / 60);

function fire(c: Cue) {
  const vs = ctx.vs() as any;
  if (c.kind === 'scene') ctx.recall(c.scene ?? 0, c.fade ?? 0, true);
  else if (c.kind === 'video') vs.bgVideo = c.video ?? '';
  else if (c.kind === 'knob') {
    if (!c.key || typeof vs[c.key] !== 'number') return;
    ramps = ramps.filter((x) => x.cue.key !== c.key);
    ramps.push({ cue: c, from: vs[c.key] });
  } else {
    const end = c.beat + (c.fx === 'flash' ? 1 : c.beats ?? 1);
    if (c.fx === 'strobe' || c.fx === 'flash') {
      const prev = { strobe: vs.strobe, strobeDiv: vs.strobeDiv };
      Object.assign(vs, { strobe: 1, strobeDiv: c.fx === 'flash' ? 1 : c.div ?? 1 });
      active.push({ end, undo: () => Object.assign(vs, prev) });
    } else {
      const k = c.fx as 'blackout' | 'logoOnly';
      vs[k] = true;
      active.push({ end, undo: () => (vs[k] = false) });
    }
  }
}

function undoAll() {
  active.forEach((a) => a.undo());
  active = [];
  ramps = [];
}

/** Começo ou pulo no meio: aplica o que já devia estar valendo, sem disparar tudo de novo. */
function chase(r: Roteiro, beat: number) {
  undoAll();
  const st = stateAt(r.cues, beat), vs = ctx.vs() as any;
  if (st.scene) ctx.recall(st.scene.scene ?? 0, 0, true);
  if (st.video) vs.bgVideo = st.video.video ?? '';
  r.cues.filter((c) => c.kind === 'knob' && c.beat <= beat && c.key && typeof vs[c.key] === 'number')
    .sort((a, b) => a.beat - b.beat)
    .forEach((c) => (vs[c.key!] = rampAt(c, vs[c.key!], beat)));
}

/** Chamado a cada quadro pela janela de controle. */
export function tick(f: Frame | null, frameAt: number) {
  lastFrame = f;
  lastFrameAt = frameAt;
  const r = current();
  if (!r || !rt.running || !f) return;
  let cur: number;
  if (rt.source === 'app') {
    if (f.pos < 0 || !r.bpm) return; // o arquivo ainda não começou
    cur = beatAt(r, f.pos + (performance.now() - frameAt) / 1000);
  } else {
    if (!goAt || !f.bpm) return;
    cur = goAt.beat + (liveBeat(f, frameAt) - goAt.live);
  }
  if (cur < last || cur - last > 8) chase(r, cur);
  else due(r.cues, last, cur).forEach(fire);
  last = cur;
  rt.cursor = cur;
  active = active.filter((a) => (cur >= a.end ? (a.undo(), false) : true));
  ramps = ramps.filter(({ cue, from }) => {
    (ctx.vs() as any)[cue.key!] = rampAt(cue, from, cur);
    return cur < cue.beat + (cue.ramp ?? 0);
  });
}

function begin(r: Roteiro, at: number) {
  const vids = [...new Set(r.cues.filter((c) => c.kind === 'video' && c.video).map((c) => c.video!))];
  vids.forEach(getVideo);
  emitTo('output', 'preload', vids);
  if (rt.mode === 'only') ctx.vs().react = false;
  chase(r, at - 0.001);
  last = at - 0.001; // pontos exatamente no começo também disparam
  rt.running = true;
}

/** App toca: toca do cursor. DJ toca: GO (o beat ao vivo mais próximo vira o `goBeat`). */
export async function play() {
  const r = current();
  if (!r) return ctx.status('Crie ou escolha um roteiro primeiro.');
  if (!r.bpm) return ctx.status('Este roteiro ainda não tem BPM.');
  if (rt.source === 'app') {
    if (rt.loaded !== r.track) await load(r);
    if (rt.loaded !== r.track) return;
    const from = Math.max(0, timeAt(r, rt.cursor));
    try {
      await invoke('play_track', { from, anchor: r.anchor, period: 60 / r.bpm, output: rt.output || null });
    } catch (e) {
      return ctx.status(String(e));
    }
    begin(r, rt.cursor);
  } else {
    const f = lastFrame;
    if (!f?.bpm) return ctx.status('GO precisa do BPM ao vivo: espere travar ou dê TAP.');
    if (!f.locked) ctx.status('Atenção: BPM ao vivo ainda não travou; o roteiro pode escorregar.');
    goAt = { live: Math.round(liveBeat(f, lastFrameAt)), beat: r.goBeat };
    rt.cursor = r.goBeat;
    begin(r, r.goBeat);
  }
}

export function pause() {
  if (!rt.running) return;
  rt.running = false;
  goAt = null;
  undoAll();
  ctx.vs().react = true;
  if (rt.source === 'app') ctx.listen();
}

export function stop() {
  pause();
  rt.cursor = rt.source === 'dj' ? current()?.goBeat ?? 0 : 0;
}

/** Posiciona o cursor. Tocando: o app pula na música; no DJ, re-sincroniza o beat ao vivo com ele. */
export function seek(beat: number) {
  rt.cursor = beat;
  if (!rt.running) return;
  if (rt.source === 'app') play();
  else if (lastFrame?.bpm) goAt = { live: liveBeat(lastFrame, lastFrameAt), beat };
}

/** ±1 beat / ±1 compasso: corrige um GO fora do tempo (DJ) ou pula na música (app). */
export function nudge(beats: number) {
  if (rt.running && rt.source === 'dj' && goAt) goAt.beat += beats;
  else seek(rt.cursor + beats);
}
