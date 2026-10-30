<script lang="ts">
  // Espectro ao vivo + nível por banda + histórico da subida do sub contra o limiar.
  // É aqui que se regula a sensibilidade: cada linha rosa embaixo é um kick aceito.
  import type { Frame } from '../lib/types';

  let { frame, kickAt }: { frame: Frame | null; kickAt: number } = $props();

  let canvas: HTMLCanvasElement;
  const HIST = 560; // ~6 s de frames
  const flux: number[] = [], thr: number[] = [], kicks: number[] = [];
  const BANDS = [['SUB', 35, 100], ['BASS', 100, 250], ['MID', 250, 2000], ['CLICK', 2000, 6000], ['AIR', 6000, 16000]] as const;
  const xOf = (hz: number, w: number) => (Math.log(hz / 30) / Math.log(16000 / 30)) * w;

  $effect(() => {
    const f = frame;
    if (!f) return;
    flux.push(f.flux); thr.push(f.thr); kicks.push(f.kick);
    if (flux.length > HIST) { flux.shift(); thr.shift(); kicks.shift(); }
  });

  $effect(() => {
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(canvas);
    const col = { accent: css.getPropertyValue('--accent'), kick: css.getPropertyValue('--kick'), muted: css.getPropertyValue('--muted') };
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); paint(ctx, col); };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  function paint(ctx: CanvasRenderingContext2D, col: { accent: string; kick: string; muted: string }) {
    const dpr = devicePixelRatio, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px "Segoe UI", system-ui';

    const meterW = 150, sw = W - meterW - 20, sh = Math.round(H * 0.6), hy = sh + 34, hh = H - hy - 8;
    const f = frame;
    const k = Math.max(0, 1 - (performance.now() - kickAt) / 220);

    // faixas das bandas
    BANDS.forEach(([name, a, b], i) => {
      const x0 = xOf(a, sw), x1 = xOf(b, sw);
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,.025)'; ctx.fillRect(x0, 0, x1 - x0, sh); }
      ctx.fillStyle = col.muted; ctx.fillText(name, x0 + 6, 14);
    });
    ctx.fillStyle = col.muted;
    for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      ctx.fillText(hz >= 1000 ? hz / 1000 + 'k' : String(hz), xOf(hz, sw) - 8, sh + 14);
    }

    // espectro
    if (f) {
      const n = f.spectrum.length, bw = sw / n;
      const g = ctx.createLinearGradient(0, sh, 0, 20);
      g.addColorStop(0, col.accent); g.addColorStop(1, col.kick);
      ctx.fillStyle = g;
      for (let i = 0; i < n; i++) {
        const h = f.spectrum[i] * (sh - 24);
        ctx.fillRect(i * bw + 1, sh - h, Math.max(1, bw - 2), h);
      }
    }

    // medidores por banda
    const mw = meterW / 5;
    BANDS.forEach(([name], i) => {
      const x = sw + 20 + i * mw, v = f ? f.bands[i] : 0, h = v * (sh - 24);
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(x + 4, 20, mw - 8, sh - 24);
      ctx.fillStyle = i === 0 && k > 0 ? col.kick : col.accent; ctx.fillRect(x + 4, sh - h, mw - 8, h);
      ctx.fillStyle = col.muted; ctx.fillText(name.slice(0, 3), x + 4, sh + 14);
    });

    // histórico: subida do sub × limiar, kicks aceitos
    ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(0, hy, W, hh);
    ctx.fillStyle = col.muted; ctx.fillText('SUBIDA DO SUB  ·  limiar (tracejado)  ·  kick aceito (rosa)', 6, hy - 8);
    const max = Math.max(3, ...thr) * 1.4, step = W / HIST, y = (v: number) => hy + hh - (v / max) * hh;
    ctx.strokeStyle = col.kick; ctx.lineWidth = 2;
    kicks.forEach((kv, i) => { if (kv > 0) { ctx.beginPath(); ctx.moveTo(i * step, hy); ctx.lineTo(i * step, hy + hh); ctx.stroke(); } });
    ctx.lineWidth = 1.5; ctx.strokeStyle = col.accent; ctx.beginPath();
    flux.forEach((v, i) => (i ? ctx.lineTo(i * step, y(v)) : ctx.moveTo(0, y(v)))); ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = col.muted; ctx.beginPath();
    thr.forEach((v, i) => (i ? ctx.lineTo(i * step, y(v)) : ctx.moveTo(0, y(v)))); ctx.stroke();
    ctx.setLineDash([]);

    if (k > 0) {
      ctx.strokeStyle = col.kick; ctx.globalAlpha = k; ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, W - 3, H - 3); ctx.globalAlpha = 1;
    }
  }
</script>

<canvas bind:this={canvas}></canvas>

<style>
  canvas { width: 100%; height: 100%; display: block; }
</style>
