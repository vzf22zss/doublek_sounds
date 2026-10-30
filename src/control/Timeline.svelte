<script lang="ts">
  // Timeline do roteiro: forma de onda (rosa = grave), grade de compassos, pontos e cursor.
  // Clique = posiciona · duplo clique = novo ponto (no beat; Shift = no compasso) · arrastar ponto = move
  // · arrastar o fundo = rola · roda = zoom · Delete = apaga o ponto selecionado.
  import { rt, current, addCue, deleteCue, seek, play, pause, stop, nudge, setMode } from './roteiro.svelte';
  import { barLabel, beatAt, cueLabel, snap, timeAt, type Cue } from '../lib/roteiro';
  import { listVideos } from '../lib/assets';
  import { learnable } from './midi.svelte';

  let { sceneNames }: { sceneNames: (bank?: number) => string[] } = $props();
  const namesFor = (c: Cue) => sceneNames(c.bank).map((name) => ({ name })); // cena do banco do ponto (DK-143)

  let canvas: HTMLCanvasElement;
  let ppb = 8; // pixels por beat
  let view0 = -2; // beat na borda esquerda
  const KIND_COLOR: Record<Cue['kind'], string> = { scene: '#7c5cff', fx: '#ff4d8d', video: '#22d3ee', knob: '#c6f24e' };
  const LABEL_H = 18;

  const r = $derived(current());
  const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const next = $derived.by(() => {
    const ro = r;
    if (!ro) return null;
    const c = ro.cues.filter((c) => c.beat > rt.cursor + 1e-6).sort((a, b) => a.beat - b.beat)[0];
    return c ? { c, in: Math.ceil(c.beat - rt.cursor) } : null;
  });

  $effect(() => {
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); draw(ctx); };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  const xOf = (beat: number) => (beat - view0) * ppb;
  const beatOf = (x: number) => view0 + x / ppb;

  function draw(ctx: CanvasRenderingContext2D) {
    const dpr = devicePixelRatio, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px "Segoe UI", system-ui';
    const ro = r, info = rt.info;
    if (!ro || !ro.bpm) {
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillText(rt.busy || (ro ? 'Sem BPM: confira a aba Roteiro.' : 'Crie um roteiro na aba Roteiro (subir música).'), 12, H / 2);
      return;
    }
    // segue o cursor enquanto toca
    if (rt.running && (xOf(rt.cursor) > W * 0.8 || xOf(rt.cursor) < 0)) view0 = rt.cursor - (W * 0.2) / ppb;
    const top = LABEL_H + 4, mid = top + (H - top) / 2, amp = (H - top) / 2 - 2;

    // forma de onda
    if (info) {
      for (let x = 0; x < W; x++) {
        const i = Math.floor(timeAt(ro, beatOf(x)) / 0.02);
        if (i < 0 || i >= info.peaks.length) continue;
        const h = (info.peaks[i] / 255) * amp, low = info.lows[i] / 255;
        ctx.fillStyle = low > 0.5 ? `rgba(255,77,141,${0.35 + low * 0.5})` : 'rgba(124,92,255,.55)';
        ctx.fillRect(x, mid - h, 1, h * 2);
      }
    }
    // grade
    const b0 = Math.ceil(beatOf(0)), b1 = beatOf(W), every = ppb * 4 >= 34 ? 1 : ppb * 16 >= 34 ? 4 : 16;
    for (let b = b0; b <= b1; b++) {
      const rel = b - ro.barShift, isBar = ((rel % 4) + 4) % 4 === 0, bar = Math.floor(rel / 4);
      if (!isBar && ppb < 6) continue;
      const strong = isBar && (bar % 16 === 0 ? 0.35 : bar % 8 === 0 ? 0.22 : 0.12);
      ctx.fillStyle = `rgba(255,255,255,${strong || 0.05})`;
      ctx.fillRect(Math.round(xOf(b)), top, 1, H - top);
      if (isBar && bar % every === 0) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillText(String(bar + 1), xOf(b) + 3, H - 4); }
    }
    // GO (modo DJ)
    if (rt.source === 'dj') {
      const x = xOf(ro.goBeat);
      ctx.fillStyle = '#3ee08f';
      ctx.fillRect(x, top, 2, H - top);
      ctx.fillText('GO', x + 4, top + 11);
    }
    // pontos
    const vids = listVideos();
    for (const c of ro.cues) {
      const x = xOf(c.beat), col = KIND_COLOR[c.kind], sel = c.id === rt.selected;
      const len = c.kind === 'fx' ? (c.fx === 'flash' ? 1 : c.beats ?? 1) : c.kind === 'knob' ? c.ramp ?? 0 : c.kind === 'scene' ? c.fade ?? 0 : 0;
      if (x + len * ppb < 0 || x > W) continue;
      ctx.fillStyle = col + '33';
      if (len) ctx.fillRect(x, top, len * ppb, H - top);
      ctx.fillStyle = col;
      ctx.fillRect(x, 0, sel ? 2 : 1, H);
      const label = cueLabel(c, namesFor(c), vids), w = ctx.measureText(label).width + 8;
      ctx.fillRect(x, 0, w, LABEL_H - 2);
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, 0.5, w - 1, LABEL_H - 3); }
      ctx.fillStyle = '#0b0b10';
      ctx.fillText(label, x + 4, 11);
    }
    // cursor
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(xOf(rt.cursor)) - 1, 0, 2, H);
  }

  // ---------- mouse ----------
  let drag: { cue?: Cue; x: number; view0: number; moved: boolean } | null = null;

  function hitCue(x: number, y: number) {
    const ro = r;
    if (!ro || y > LABEL_H) return undefined;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '10px "Segoe UI", system-ui';
    const vids = listVideos();
    return [...ro.cues].reverse().find((c) => x >= xOf(c.beat) && x <= xOf(c.beat) + ctx.measureText(cueLabel(c, namesFor(c), vids)).width + 8);
  }

  function down(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId);
    canvas.focus();
    const cue = hitCue(e.offsetX, e.offsetY);
    if (cue) rt.selected = cue.id;
    drag = { cue, x: e.offsetX, view0, moved: false };
  }
  function move(e: PointerEvent) {
    if (!drag || !r) return;
    if (Math.abs(e.offsetX - drag.x) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.cue) drag.cue.beat = Math.max(0, snap(r, beatOf(e.offsetX), e.shiftKey));
    else view0 = drag.view0 - (e.offsetX - drag.x) / ppb;
  }
  function up(e: PointerEvent) {
    if (drag && !drag.moved && !drag.cue && r) {
      rt.selected = '';
      seek(Math.max(0, beatOf(e.offsetX)));
    }
    drag = null;
  }
  function dbl(e: MouseEvent) {
    if (!r || hitCue(e.offsetX, e.offsetY)) return;
    addCue(Math.max(0, snap(r, beatOf(e.offsetX), e.shiftKey)));
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const b = beatOf(e.offsetX);
    ppb = Math.min(80, Math.max(0.5, ppb * Math.exp(-e.deltaY * 0.0015)));
    view0 = b - e.offsetX / ppb;
  }
  function key(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && rt.selected) { e.preventDefault(); e.stopPropagation(); deleteCue(); }
  }
</script>

<div class="tl">
  <div class="bar">
    {#if rt.source === 'app'}
      <button class="primary" onclick={() => (rt.running ? pause() : play())} title="G" use:learnable={{ id: 'a:go', label: 'Roteiro: tocar/GO' }}>{rt.running ? '⏸ Pausar' : '▶ Tocar'}</button>
    {:else}
      <button class="primary go" onclick={play} title="G: aperte no beat em que a música está no ponto GO" use:learnable={{ id: 'a:go', label: 'Roteiro: tocar/GO' }}>GO</button>
    {/if}
    <button onclick={stop} title="Shift+G" use:learnable={{ id: 'a:stop', label: 'Roteiro: parar' }}>■</button>
    <button onclick={() => nudge(-4)} title="; (−1 compasso)" use:learnable={{ id: 'a:bar-', label: 'Roteiro: −1 compasso' }}>«</button>
    <button onclick={() => nudge(-1)} title=", (−1 beat)" use:learnable={{ id: 'a:beat-', label: 'Roteiro: −1 beat' }}>‹</button>
    <button onclick={() => nudge(1)} title=". (+1 beat)" use:learnable={{ id: 'a:beat+', label: 'Roteiro: +1 beat' }}>›</button>
    <button onclick={() => nudge(4)} title="' (+1 compasso)" use:learnable={{ id: 'a:bar+', label: 'Roteiro: +1 compasso' }}>»</button>
    <div class="ab" title="R: compara na hora como fica com o roteiro e só com o som" use:learnable={{ id: 'a:ab', label: 'Roteiro: A/B com × sem pontos' }}>
      <button class:on={rt.mode !== 'sound'} onclick={() => setMode(rt.back)}>Com roteiro</button>
      <button class:on={rt.mode === 'sound'} onclick={() => setMode('sound')}>Só o som</button>
    </div>
    {#if r?.bpm}
      <span class="pos">
        <b>compasso {barLabel(r, rt.cursor)}</b> · {mmss(timeAt(r, rt.cursor))}
        {#if next} · próximo: {next.c.kind === 'scene' ? 'cena' : next.c.kind === 'fx' ? next.c.fx : next.c.kind} em {next.in} beat{next.in === 1 ? '' : 's'}{/if}
      </span>
      {#if rt.running}<span class="live" class:sound={rt.mode === 'sound'}>{rt.mode === 'only' ? 'SÓ ROTEIRO' : rt.mode === 'sound' ? 'SÓ O SOM' : 'ROTEIRO + AO VIVO'}</span>{/if}
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <canvas bind:this={canvas} tabindex="0" onpointerdown={down} onpointermove={move} onpointerup={up} ondblclick={dbl} onwheel={wheel} onkeydown={key}
    title="Clique: posicionar · duplo clique: novo ponto (Shift: no compasso) · arrastar: mover/rolar · roda: zoom · Delete: apagar"></canvas>
</div>

<style>
  .tl { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
  .bar { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
  .bar button { padding: 4px 10px; font-size: 12px; }
  .primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink, #fff); font-weight: 700; min-width: 86px; }
  .go { background: #3ee08f; border-color: #3ee08f; color: #0b0b10; letter-spacing: .1em; }
  .pos { margin-left: 6px; }
  .pos b { color: var(--text); }
  .ab { display: flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin-left: 4px; }
  .ab button { border: 0; border-radius: 0; padding: 4px 9px; background: transparent; color: var(--muted); }
  .ab button.on { background: var(--accent); color: var(--accent-ink, #fff); font-weight: 700; }
  .live.sound { background: var(--kick); }
  .live { margin-left: auto; font-size: 10px; font-weight: 800; letter-spacing: .1em; color: #0b0b10; background: #3ee08f; padding: 2px 6px; border-radius: 6px; }
  canvas { flex: 1; width: 100%; min-height: 90px; display: block; border-radius: 8px; background: rgba(0,0,0,.25); cursor: crosshair; outline: none; }
  canvas:focus-visible { box-shadow: 0 0 0 1px var(--accent); }
</style>
