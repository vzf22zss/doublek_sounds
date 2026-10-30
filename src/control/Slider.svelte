<script lang="ts">
  // Fader com rótulo e valor. Duplo clique volta ao padrão.
  // Com `mod`, mostra a fonte que move o efeito (matriz de modulação). Com `drop`, o chip "drop":
  // ligado, o efeito some no breakdown sem grave e entra quando o grave volta.
  import { SOURCES, type Source } from '../lib/settings';
  import { learnable } from './midi.svelte';

  let { label, value = $bindable(), mod = $bindable(), drop = $bindable(), min, max, step, def, fmt = (v: number) => String(v), learn }: {
    label: string; value: number; mod?: Source; drop?: boolean; min: number; max: number; step: number; def: number; fmt?: (v: number) => string; learn?: string;
  } = $props();
  const fill = $derived(((value - min) / (max - min)) * 100);
</script>

<div class="row" use:learnable={learn ? { id: 'v:' + learn, label, min, max, step } : null}>
  <span class="top">
    <span>{label}</span>
    {#if mod !== undefined}
      <select class="mod" bind:value={mod} title="O que no som move este efeito">
        {#each Object.entries(SOURCES) as [k, name]}<option value={k}>{name}</option>{/each}
      </select>
    {/if}
    {#if drop !== undefined}
      <button class="drop" class:on={drop} onclick={() => (drop = !drop)} title="Só no drop: some no breakdown sem grave e entra quando o grave volta">drop</button>
    {/if}
    <b>{fmt(value)}</b>
  </span>
  <input type="range" {min} {max} {step} bind:value style:--fill="{fill}%" ondblclick={() => (value = def)} title="Duplo clique: valor padrão" aria-label={label} />
</div>

<style>
  .row { display: block; margin: 10px 0 4px; }
  .top { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .top > span { flex: 1; }
  b { color: var(--text); font-weight: 600; }
  .drop { font-size: 10px; padding: 1px 6px; border-radius: 6px; color: var(--muted); background: transparent; border: 1px dashed var(--line); }
  .drop.on { color: #111; background: var(--kick); border: 1px solid var(--kick); font-weight: 700; }
  .mod { font-size: 10px; padding: 1px 4px; border-radius: 6px; color: var(--accent); border-color: rgba(124, 92, 255, 0.35); background: rgba(124, 92, 255, 0.08); }
</style>
