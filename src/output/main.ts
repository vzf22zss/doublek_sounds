// Janela do telão: só desenha. Recebe features do motor e ajustes da janela de controle.
// Fail-safe (DK-003): perda do contexto WebGL recria o renderer; shader que não compila deixa a tela
// preta e avisa o controle em vez de derrubar a janela. Telemetria (frametime) vai para o controle 1×/s.
import './output.css';
import { Channel, invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { Renderer } from '../render/renderer';
import { loadVisual, type Visual } from '../lib/settings';
import { assetSync, preloadVideo } from '../lib/assets';
import { FrameStats, type Telemetry } from '../lib/telemetry';
import type { Frame, Msg } from '../lib/types';
import { initRecording } from './record';

const canvas = document.querySelector('canvas')!;
let v = loadVisual();
let r: Renderer | null = null;
let sync: ReturnType<typeof assetSync> | null = null;
let lastFrame: Frame | null = null;
let lost = false;

const report = (level: 'warn' | 'error', msg: string) => emitTo('control', 'output-log', { level, msg });

function start() {
  try {
    r = new Renderer(canvas, v);
    // vídeo que não abre, dá erro ou trava: o fundo volta para a foto/cor e o controle fica sabendo (DK-062)
    sync = assetSync(r, { beat: () => lastFrame, onVideoFail: (msg) => report('warn', msg) });
    sync(v, true);
    r.onBudget = (i) => emitTo('control', 'psy-budget', i); // orçamento do Psy Engine só no telão (o preview roda a 30 fps)
    if (lastFrame) r.setFrame(lastFrame);
  } catch (e) {
    r = null;
    report('error', 'Telão sem WebGL: ' + (e as Error).message);
  }
}
start();

// contexto perdido (driver, GPU dormindo, troca de monitor): segura, e recria quando voltar
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  lost = true;
  r = null;
  report('warn', 'Telão: contexto WebGL perdido, aguardando voltar…');
});
canvas.addEventListener('webglcontextrestored', () => {
  lost = false;
  start();
  report('warn', 'Telão: contexto WebGL restaurado');
});

const blackout = () => document.body.classList.toggle('black', !!v.blackout);
blackout();
listen<Visual>('visual', (e) => { v = e.payload; blackout(); r?.setVisual(v); sync?.(v); });
listen('assets', () => sync?.(v, true));
listen<string[]>('preload', (e) => preloadVideo(e.payload[0] ?? '')); // próximo vídeo do roteiro: troca instantânea

const ch = new Channel<Msg>();
ch.onmessage = (m) => { if (m.t === 'frame') { lastFrame = m.v; r?.setFrame(m.v); } };
invoke('subscribe', { onMsg: ch });

// não deixar o Windows apagar a tela durante o set
const wake = () => (navigator as any).wakeLock?.request('screen').catch(() => {});
wake();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());

addEventListener('keydown', (e) => { if (e.key === 'Escape') invoke('close_output'); });

initRecording(canvas, report); // DK-072: grava este canvas quando o controle pedir

const stats = new FrameStats();
let prev = performance.now(), last = prev;
const loop = (now: number) => {
  requestAnimationFrame(loop);
  stats.push(now - prev);
  prev = now;
  if (r) {
    try { r.render(now); } catch (e) { r = null; report('error', 'Telão: erro ao desenhar: ' + (e as Error).message); }
  }
  if (now - last >= 1000) {
    const t: Telemetry = stats.flush(now - last, lost || !r);
    if (t.lost) t.fps = 0; // sem renderer, o rAF gira à toa: não é quadro desenhado
    emitTo('control', 'telemetry', t);
    if (r) emitTo('control', 'psy-costs', r.costs()); // custo por módulo (ms), 1×/s, para a aba Efeitos
    last = now;
  }
};
requestAnimationFrame(loop);
