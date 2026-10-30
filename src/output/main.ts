// Janela do telão: só desenha. Recebe features do motor e ajustes da janela de controle.
import { Channel, invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { Renderer } from '../render/renderer';
import { loadVisual, type Visual } from '../lib/settings';
import { assetSync } from '../lib/assets';
import type { Msg } from '../lib/types';

let v = loadVisual();
const r = new Renderer(document.querySelector('canvas')!, v);
const sync = assetSync(r);
sync(v, true);

listen<Visual>('visual', (e) => { v = e.payload; r.setVisual(v); sync(v); });
listen('assets', () => sync(v, true));

const ch = new Channel<Msg>();
ch.onmessage = (m) => { if (m.t === 'frame') r.setFrame(m.v); };
invoke('subscribe', { onMsg: ch });

// não deixar o Windows apagar a tela durante o set
const wake = () => (navigator as any).wakeLock?.request('screen').catch(() => {});
wake();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());

addEventListener('keydown', (e) => { if (e.key === 'Escape') invoke('close_output'); });

let frames = 0, last = performance.now();
const loop = (now: number) => {
  requestAnimationFrame(loop);
  r.render(now);
  frames++;
  if (now - last >= 1000) {
    emitTo('control', 'fps', Math.round((frames * 1000) / (now - last)));
    frames = 0; last = now;
  }
};
requestAnimationFrame(loop);
