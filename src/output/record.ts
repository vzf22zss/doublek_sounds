// Gravação no telão (DK-072): captura o próprio canvas (é o que o público vê) com MediaRecorder e manda pedaços de
// 1 s para o Rust (`rec_chunk`), em ordem, sem guardar o vídeo na memória. Comandado pela janela de controle por
// evento ('rec-start' / 'rec-stop'); responde com 'rec-started', 'rec-progress', 'rec-done', 'rec-error'.
// Qualquer falha aqui para só a gravação: o desenho do telão não passa por este arquivo.
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';

export type RecStart = { id: string; mime: string; fps: number; bitrate: number };
type Chunk = { total: number; stop: string | null };

export function initRecording(canvas: HTMLCanvasElement, log: (level: 'warn' | 'error', msg: string) => void) {
  let mr: MediaRecorder | null = null, id = '', t0 = 0, reason = '', failed = false, bytesSoFar = 0;
  let chain: Promise<unknown> = Promise.resolve(); // pedaços saem na ordem em que chegaram

  const cleanup = () => {
    mr?.stream.getTracks().forEach((t) => t.stop());
    mr = null; id = ''; reason = '';
  };
  const fail = (err: unknown) => {
    if (failed) return;
    failed = true;
    const msg = err instanceof Error ? err.message : String(err);
    const rid = id;
    try { if (mr?.state === 'recording') mr.stop(); } catch {}
    cleanup();
    if (rid) invoke('rec_abort', { id: rid }).catch(() => {}); // apaga o parcial: arquivo com erro no meio não serve
    log('warn', 'Gravação: ' + msg);
    emitTo('control', 'rec-error', msg).catch(() => {});
  };

  listen<RecStart>('rec-start', async (e) => {
    if (mr) return;
    const o = e.payload;
    failed = false; reason = ''; bytesSoFar = 0;
    try {
      await invoke('rec_start', { id: o.id });
      id = o.id;
      // keyframe a cada 1 s: sem isso o MP4 do Chromium só entrega o vídeo no fim (tudo na memória) — medido no DK-071
      const opts = { mimeType: o.mime, videoBitsPerSecond: o.bitrate, videoKeyFrameIntervalDuration: 1000 } as MediaRecorderOptions;
      const rec = new MediaRecorder(canvas.captureStream(o.fps), opts);
      const mp4 = o.mime.startsWith('video/mp4');
      mr = rec;
      rec.ondataavailable = (ev) => {
        if (!ev.data.size) {
          // WebView que ignora o keyframe por tempo: MP4 sem pedaço nenhum = o vídeo iria inteiro para a memória
          if (mp4 && !bytesSoFar && performance.now() - t0 > 3500) fail(new Error('o MP4 não está saindo em pedaços neste WebView; a próxima gravação usa WebM'));
          return;
        }
        const rid = id;
        chain = chain.then(async () => {
          if (failed || !rid) return;
          const r = await invoke<Chunk>('rec_chunk', new Uint8Array(await ev.data.arrayBuffer()), { headers: { 'x-id': rid } });
          bytesSoFar = r.total;
          emitTo('control', 'rec-progress', { bytes: r.total }).catch(() => {});
          if (r.stop && !reason) { reason = r.stop; if (rec.state === 'recording') rec.stop(); }
        }).catch(fail);
      };
      rec.onstop = () => {
        const rid = id, why = reason;
        chain = chain.then(async () => {
          if (failed || !rid) return;
          const d = await invoke<{ path: string; bytes: number }>('rec_stop', { id: rid });
          cleanup();
          emitTo('control', 'rec-done', { ...d, reason: why || undefined }).catch(() => {});
        }).catch(fail);
      };
      rec.onerror = (ev) => fail((ev as unknown as { error?: Error }).error ?? new Error('erro do codificador'));
      rec.start(1000);
      t0 = performance.now();
      emitTo('control', 'rec-started', { id: o.id }).catch(() => {});
    } catch (err) {
      fail(err);
    }
  });

  listen('rec-stop', () => {
    try { if (mr?.state === 'recording') mr.stop(); } catch (err) { fail(err); }
  });

  // janela fechando no meio: fecha o arquivo com o que já foi escrito
  addEventListener('pagehide', () => { if (id && !failed) invoke('rec_stop', { id }).catch(() => {}); });
}
