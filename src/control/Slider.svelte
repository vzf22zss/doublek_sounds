<script module lang="ts">
  import { SOURCES, type Source } from '../lib/settings';
  // Régua: nível ao vivo das fontes. O laço do preview (App) publica só enquanto alguma régua está aberta.
  class Live { S = $state.raw<Record<Source, number> | null>(null); open = 0; }
  export const live = new Live();
</script>

<script lang="ts">
  // Fader com rótulo e valor. Duplo clique volta ao padrão.
  // Com `mod`, mostra a fonte que move o efeito (matriz de modulação) e o botão da régua: [mín, máx] do nível da
  // fonte (abaixo do mínimo o efeito fica parado, no máximo chega a 100%), com o nível ao vivo. Com `drop`, o chip
  // "drop": ligado, o efeito some no breakdown sem grave e entra quando o grave volta.
  import { learnable } from './midi.svelte';

  let { label, value = $bindable(), mod = $bindable(), range = $bindable(), drop = $bindable(), min, max, step, def, fmt = (v: number) => String(v), learn }: {
    label: string; value: number; mod?: Source; range?: [number, number]; drop?: boolean; min: number; max: number; step: number; def: number; fmt?: (v: number) => string; learn?: string;
  } = $props();
  const fill = $derived(((value - min) / (max - min)) * 100);

  let open = $state(false);
  $effect(() => {
    if (!open) return;
    live.open++;
    return () => { if (!--live.open) live.S = null; };
  });
  const lo = $derived(range?.[0] ?? 0), hi = $derived(range?.[1] ?? 1);
  const now = $derived(Math.min(1, Math.max(0, (mod && live.S?.[mod]) || 0)));
  const pc = (x: number) => Math.round(x * 100);
  const GAP = 0.02;
  /** Faixa inteira = sem régua (não grava nada). */
  const set = (a: number, b: number) => (range = a <= 0 && b >= 1 ? undefined : [+a.toFixed(2), +b.toFixed(2)]);
  function drag(e: Event & { currentTarget: HTMLInputElement }, which: 0 | 1) {
    const x = +e.currentTarget.value;
    const a = which ? lo : Math.min(x, hi - GAP), b = which ? Math.max(x, lo + GAP) : hi;
    e.currentTarget.value = String(which ? b : a); // trava o polegar no limite
    set(a, b);
  }
</script>

<div class="row" use:learnable={learn ? { id: 'v:' + learn, label, min, max, step } : null}>
  <span class="top">
    <span>{label}</span>
    {#if mod !== undefined}
      <select class="mod" bind:value={mod} title="O que no som move este efeito">
        {#each Object.entries(SOURCES) as [k, name]}<option value={k}>{name}</option>{/each}
      </select>
      <button class="rg" class:on={!!range} class:open onclick={() => (open = !open)} aria-expanded={open}
        title="Régua: em que nível da fonte o efeito começa a mexer e em que nível chega ao máximo">{range ? `${pc(lo)}–${pc(hi)}` : 'faixa'}</button>
    {/if}
    {#if drop !== undefined}
      <button class="drop" class:on={drop} onclick={() => (drop = !drop)} title="Só no drop: some no breakdown sem grave e entra quando o grave volta">drop</button>
    {/if}
    <b>{fmt(value)}</b>
  </span>
  <input type="range" {min} {max} {step} bind:value style:--fill="{fill}%" ondblclick={() => (value = def)} title="Duplo clique: valor padrão" aria-label={label} />
  {#if open && mod !== undefined}
    <div class="regua" ondblclick={() => set(0, 1)} title="Arraste o mínimo e o máximo. A marca é o nível de {SOURCES[mod]} agora. Duplo clique: faixa inteira" role="group" aria-label="{label}: régua">
      <span class="rail">
        <i class="band" style:left="{lo * 100}%" style:width="{(hi - lo) * 100}%"></i>
        <i class="now" class:hot={now > lo} style:left="{now * 100}%"></i>
      </span>
      <input type="range" min="0" max="1" step="0.01" value={lo} oninput={(e) => drag(e, 0)} aria-label="{label}: mínimo da régua" />
      <input type="range" min="0" max="1" step="0.01" value={hi} oninput={(e) => drag(e, 1)} aria-label="{label}: máximo da régua" />
    </div>
  {/if}
</div>

<style>
  .row { display: block; margin: 10px 0 4px; }
  .top { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .top > span { flex: 1; }
  b { color: var(--text); font-weight: 600; }
  .drop { font-size: 10px; padding: 1px 6px; border-radius: 6px; color: var(--muted); background: transparent; border: 1px dashed var(--line); }
  .drop.on { color: #111; background: var(--kick); border: 1px solid var(--kick); font-weight: 700; }
  .mod { font-size: 10px; padding: 1px 4px; border-radius: 6px; color: var(--accent); border-color: rgba(124, 92, 255, 0.35); background: rgba(124, 92, 255, 0.08); }
  .rg { font-size: 10px; padding: 1px 6px; border-radius: 6px; color: var(--muted); background: transparent; border: 1px dashed var(--line); font-variant-numeric: tabular-nums; }
  .rg.on { color: var(--accent); background: rgba(124, 92, 255, 0.08); border: 1px solid rgba(124, 92, 255, 0.35); }
  .rg.open { border-style: solid; border-color: var(--accent); }
  /* dois faders nativos sobrepostos: só os polegares pegam o mouse */
  .regua { position: relative; height: 22px; margin: 2px 0 0; }
  /* trilho com 6 px de cada lado = meio polegar: 0% e 100% caem no centro do polegar */
  .rail { position: absolute; inset: 0 6px; }
  .rail::before { content: ''; position: absolute; left: 0; right: 0; top: 9px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.1); }
  .band { position: absolute; top: 9px; height: 4px; border-radius: 2px; background: rgba(124, 92, 255, 0.55); }
  .now { position: absolute; top: 4px; width: 2px; height: 14px; margin-left: -1px; border-radius: 1px; background: var(--muted); }
  .now.hot { background: var(--kick); }
  .regua input { position: absolute; inset: 0; pointer-events: none; }
  .regua input::-webkit-slider-runnable-track { background: transparent; }
  .regua input::-webkit-slider-thumb { pointer-events: auto; width: 12px; height: 12px; margin-top: -4px; }
</style>
