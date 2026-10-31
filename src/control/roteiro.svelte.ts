// Motor do roteiro: cursor em beats, disparo dos pontos, efeitos com duração e rampas de knob.
// App toca: cursor = posição do arquivo na grade analisada. DJ toca: no GO, o beat ao vivo vira o
// beat `goBeat` do roteiro e o cursor anda junto com o relógio do beat ao vivo (segue o pitch).
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { preloadVideo } from '../lib/assets';
import { nextVideo } from '../lib/videoloop';
import { checkFile, ext } from '../lib/limits';
import { lookOf, type Look, type Visual } from '../lib/settings';
import type { Frame } from '../lib/types';
import { beatAt, due, loadRoteiros, newCue, rampAt, sanitizeRoteiro, stateAt, timeAt, uid, type Cue, type CueKind, type Roteiro } from '../lib/roteiro';
import type { ShowCommand } from '../lib/commands';
import { clear as clearFx, EMPTY, startBurst, startRamp, step as stepFx, type FxKind, type Running, type Values } from '../lib/roteiro-fx';

export type TrackInfo = { duration: number; bpm: number; anchor: number; peaks: number[]; lows: number[] };

export const rt = $state({
  list: loadRoteiros(),
  cur: '',
  info: null as TrackInfo | null, // forma de onda da música carregada
  loaded: '',                     // id da música pronta no motor
  busy: '',
  source: 'app' as 'app' | 'dj',
  mode: 'live' as 'live' | 'only' | 'sound', // sound = toca sem os pontos (só a reação ao som)
  back: 'live' as 'live' | 'only',            // modo do roteiro para onde o A/B volta
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
  /** Tudo o que o roteiro faz no visual passa pelo dispatcher, com fonte 'roteiro' (DK-143). */
  cmd(c: ShowCommand): void;
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
  const bad = checkFile('audio', file);
  if (bad) throw new Error(bad);
  rt.busy = 'Guardando a música…';
  return invoke<string>('add_track', new Uint8Array(await file.arrayBuffer()), { headers: { 'x-ext': ext(file.name) } });
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
    const bad = checkFile('json', f);
    if (bad) throw new Error(bad);
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
// efeitos com duração e rampas em andamento (lib/roteiro-fx); `firing` = beat do ponto que está disparando
let fx: Running = EMPTY;
let firing: number | null = null;

const liveBeat = (f: Frame, at: number) => f.beat + f.beatPhase + ((performance.now() - at) / 1000) * (f.bpm / 60);
const write = (set: Values) => { if (Object.keys(set).length) Object.assign(ctx.vs(), set); };
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Ponto do roteiro → comando. Valores fora do que o editor permite são trazidos para dentro (nunca recusa no show). */
function fire(c: Cue) {
  firing = c.beat;
  try {
    if (c.kind === 'scene') ctx.cmd({ type: 'SCENE_RECALL', index: c.scene ?? 0, fade: clamp(c.fade ?? 0, 0, 32), now: true, ...(c.bank !== undefined ? { bank: c.bank } : {}) });
    else if (c.kind === 'video') ctx.cmd({ type: 'VIDEO_SET', id: c.video ?? '' });
    else if (c.kind === 'knob') { if (c.key) ctx.cmd({ type: 'PARAM_RAMP', key: c.key, to: c.to ?? 0, beats: clamp(c.ramp ?? 0, 0, 64) }); }
    else ctx.cmd({ type: 'FX_BURST', fx: c.fx ?? 'strobe', beats: clamp(c.beats ?? 1, 1, 64), div: [1, 2, 4].includes(c.div ?? 1) ? c.div ?? 1 : 1 });
  } finally {
    firing = null;
  }
}

/** FX_BURST (handler no App): liga o efeito agora e desfaz sozinho depois de `beats` beats do roteiro. */
export function burst(kind: FxKind, beats: number, div?: number) {
  if (!rt.running) throw new Error('efeito com duração só com o roteiro tocando');
  const r = startBurst(fx, ctx.vs() as unknown as Values, kind, firing ?? rt.cursor, beats, div);
  fx = r.run;
  write(r.set);
}

/** PARAM_RAMP (handler no App): leva `key` até `to` em `beats` beats do roteiro (0 = salto). */
export function ramp(key: string, to: number, beats: number) {
  if (!rt.running) throw new Error('rampa só com o roteiro tocando');
  fx = startRamp(fx, ctx.vs() as unknown as Values, key, to, firing ?? rt.cursor, beats);
  write(stepFx(fx, firing ?? rt.cursor).set);
}

/** Desfaz os efeitos em andamento e abandona as rampas (pausa, Só o som, pulo, PÂNICO, RESET). */
export function cancelFx() {
  const r = clearFx(fx);
  fx = r.run;
  write(r.set);
}

/** Começo ou pulo no meio: aplica o que já devia estar valendo, sem disparar tudo de novo. */
function chase(r: Roteiro, beat: number) {
  cancelFx();
  const st = stateAt(r.cues, beat), vs = ctx.vs() as any;
  if (st.scene) ctx.cmd({ type: 'SCENE_RECALL', index: st.scene.scene ?? 0, fade: 0, now: true, ...(st.scene.bank !== undefined ? { bank: st.scene.bank } : {}) });
  if (st.video) ctx.cmd({ type: 'VIDEO_SET', id: st.video.video ?? '' });
  const knobs: Record<string, number> = {};
  r.cues.filter((c) => c.kind === 'knob' && c.beat <= beat && c.key && typeof vs[c.key] === 'number')
    .sort((a, b) => a.beat - b.beat)
    .forEach((c) => (knobs[c.key!] = rampAt(c, knobs[c.key!] ?? vs[c.key!], beat)));
  for (const [key, value] of Object.entries(knobs)) ctx.cmd({ type: 'SET_PARAMETER', key, value });
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
  if (rt.mode !== 'sound') {
    if (cur < last || cur - last > 8) chase(r, cur);
    else due(r.cues, last, cur).forEach(fire);
  }
  last = cur;
  rt.cursor = cur;
  preloadNext(r, cur);
  const r2 = stepFx(fx, cur);
  fx = r2.run;
  write(r2.set);
}

// DK-062: só o próximo vídeo do roteiro fica pré-carregado (1 tocando + 1 pronto); avisa o telão só quando muda
let lastPre: string | null = null;
function preloadNext(r: Roteiro, beat: number) {
  const id = nextVideo(r.cues, beat, ctx.vs().bgVideo ?? '');
  if (id === lastPre) return;
  lastPre = id;
  preloadVideo(id);
  emitTo('output', 'preload', id ? [id] : []);
}

function begin(r: Roteiro, at: number) {
  ctx.vs().react = rt.mode !== 'only';
  if (rt.mode !== 'sound') chase(r, at - 0.001);
  last = at - 0.001; // pontos exatamente no começo também disparam
  lastPre = null;
  preloadNext(r, last);
  rt.running = true;
}

// visual de antes do roteiro começar: é o que "Só o som" mostra (como ficaria ao vivo, sem os pontos)
let base: Look | null = null;

/** Troca o modo, inclusive com a música tocando: dá para comparar na hora com roteiro × só o som. */
export function setMode(m: typeof rt.mode) {
  const prev = rt.mode;
  if (m !== 'sound') rt.back = m;
  rt.mode = m;
  if (!rt.running || prev === m) return;
  const vs = ctx.vs();
  vs.react = m !== 'only';
  if (m === 'sound') {
    cancelFx();
    if (base) Object.assign(vs, base);
  } else if (prev === 'sound') chase(current()!, rt.cursor);
}

/** A/B: alterna entre o roteiro (no modo que estava) e só o som. */
export const toggleSound = () => setMode(rt.mode === 'sound' ? rt.back : 'sound');

/** App toca: toca do cursor. DJ toca: GO (o beat ao vivo mais próximo vira o `goBeat`). */
export async function play() {
  const r = current();
  if (!r) return ctx.status('Crie ou escolha um roteiro primeiro.');
  if (!r.bpm) return ctx.status('Este roteiro ainda não tem BPM.');
  if (!rt.running) base = lookOf($state.snapshot(ctx.vs()) as Visual);
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
  cancelFx();
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
