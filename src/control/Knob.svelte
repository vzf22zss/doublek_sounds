<script lang="ts">
  // Knob: arrastar para cima/baixo, Shift = ajuste fino, roda do mouse, duplo clique = padrão.
  import { learnable } from './midi.svelte';

  // `learn` = chave do ajuste visual, para o MIDI learn
  let { label, value = $bindable(), min, max, step, def, fmt = (v: number) => v.toFixed(2), learn }: {
    label: string; value: number; min: number; max: number; step: number; def: number; fmt?: (v: number) => string; learn?: string;
  } = $props();

  const norm = $derived((value - min) / (max - min));
  const R = 22, C = 2 * Math.PI * R, SWEEP = 0.75; // 270°
  let drag: { y: number; v: number } | null = null;

  const set = (x: number) => (value = Math.min(max, Math.max(min, Math.round(x / step) * step)));

  function down(e: PointerEvent) {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { y: e.clientY, v: value };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    set(drag.v + ((drag.y - e.clientY) / 160) * (max - min) * (e.shiftKey ? 0.1 : 1));
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    set(value - Math.sign(e.deltaY) * step * (e.shiftKey ? 1 : 5));
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); set(value + step); }
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); set(value - step); }
  }
</script>

<div
  class="knob"
  use:learnable={learn ? { id: 'v:' + learn, label, min, max, step } : null}
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  title="{label} — arraste (Shift = fino), roda do mouse, duplo clique = padrão"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (drag = null)}
  onwheel={wheel}
  onkeydown={key}
  ondblclick={() => (value = def)}
>
  <svg viewBox="0 0 56 56">
    <circle cx="28" cy="28" r={R} transform="rotate(135 28 28)" class="track" stroke-dasharray="{C * SWEEP} {C}" />
    <circle cx="28" cy="28" r={R} transform="rotate(135 28 28)" class="val" class:hot={norm > 0.001} stroke-dasharray="{C * SWEEP * norm} {C}" />
    <line x1="28" y1="28" x2="28" y2="12" transform="rotate({-135 + 270 * norm} 28 28)" />
  </svg>
  <b>{fmt(value)}</b>
  <span>{label}</span>
</div>

<style>
  .knob { display: flex; flex-direction: column; align-items: center; width: 64px; cursor: ns-resize; touch-action: none; border-radius: 10px; padding: 2px 0; }
  .knob:focus-visible { outline: 2px solid var(--accent); }
  svg { width: 46px; height: 46px; overflow: visible; }
  circle { fill: none; stroke-width: 5; stroke-linecap: round; }
  .track { stroke: rgba(255, 255, 255, 0.1); }
  .val { stroke: var(--accent); transition: stroke-dasharray 60ms linear; }
  .val.hot { filter: drop-shadow(0 0 4px rgba(124, 92, 255, 0.7)); }
  line { stroke: #fff; stroke-width: 3; stroke-linecap: round; }
  b { font-size: 11px; font-weight: 600; margin-top: -2px; }
  span { font-size: 10px; color: var(--muted); letter-spacing: 0.04em; text-align: center; line-height: 1.15; }
</style>
