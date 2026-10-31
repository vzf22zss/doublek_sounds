// Gravação vista da janela de controle (DK-072): estado sempre vivo (trocar de aba não perde a gravação), comandos
// para o telão por evento e a máquina de estados de lib/recorder. O telão grava; o Rust escreve o arquivo.
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { BITRATE, IDLE, pickMime, recName, reduce, type Fps, type Quality, type RecEvent } from '../lib/recorder';

export const rec = $state({ s: IDLE, quality: 'MEDIA' as Quality, fps: 30 as Fps });
let say: (m: string) => void = () => {};
let lastProgress = 0;
let noMp4 = false; // este WebView não fragmenta MP4: grava em WebM daqui em diante

const send = (e: RecEvent) => {
  rec.s = reduce(rec.s, e);
  if (rec.s.message) say(rec.s.message);
};

/** Liga os eventos do telão uma vez (App). `status` recebe as mensagens para a linha de status. */
export function initRec(status: (m: string) => void) {
  say = status;
  listen<{ id: string }>('rec-started', () => { lastProgress = performance.now(); send({ t: 'started', at: performance.now() }); });
  listen<{ bytes: number }>('rec-progress', (e) => { lastProgress = performance.now(); send({ t: 'progress', bytes: e.payload.bytes, at: performance.now() }); });
  listen<{ path: string; bytes: number; reason?: string }>('rec-done', (e) => send({ t: 'done', ...e.payload }));
  listen<string>('rec-error', (e) => { if (/MP4/.test(e.payload)) noMp4 = true; send({ t: 'error', message: e.payload }); });
  // vigia: o telão manda um pedaço por segundo; 5 s sem nada = telão fechado ou travado
  setInterval(() => {
    const p = rec.s.phase;
    if ((p === 'recording' || p === 'stopping') && performance.now() - lastProgress > 5000)
      send({ t: 'error', message: 'o telão parou de mandar a gravação (fechado ou travado); o que já foi gravado ficou no arquivo' });
    if (p === 'starting' && performance.now() - rec.s.startedAt > 5000) send({ t: 'error', message: 'o telão não respondeu (está aberto?)' });
  }, 1000);
}

/** Gravar: precisa do telão aberto (grava o que ele mostra). `p95` = frametime do telão agora, para o aviso. */
export async function startRec(outputOpen: boolean, p95: number) {
  if (rec.s.phase !== 'idle') return;
  if (!outputOpen) return say('Abra o telão (Projetar ou F) para gravar: a gravação é o que ele mostra.');
  const pick = typeof MediaRecorder !== 'undefined' ? pickMime(rec.fps, (m) => MediaRecorder.isTypeSupported(m), noMp4) : null;
  if (!pick) return say('Este WebView não tem codificador de vídeo para gravar.');
  const id = recName(new Date(), pick.ext);
  send({ t: 'start', id, mime: pick.mime, at: performance.now(), p95 });
  try {
    await emitTo('output', 'rec-start', { id, mime: pick.mime, fps: rec.fps, bitrate: BITRATE[rec.quality] });
  } catch (e) {
    send({ t: 'error', message: String(e) });
  }
}

export function stopRec() {
  if (rec.s.phase !== 'recording' && rec.s.phase !== 'starting') return;
  lastProgress = performance.now();
  send({ t: 'stop' });
  emitTo('output', 'rec-stop').catch((e) => send({ t: 'error', message: String(e) }));
}

export const recTelemetry = (p95: number) => send({ t: 'telemetry', p95, at: performance.now() });
export const openRecDir = () => invoke('rec_open_dir').catch((e) => say('Não consegui abrir a pasta das gravações: ' + e));
