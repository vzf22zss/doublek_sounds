<script lang="ts">
  // Fader com rótulo e valor. Duplo clique volta ao padrão.
  let { label, value = $bindable(), min, max, step, def, fmt = (v: number) => String(v) }: {
    label: string; value: number; min: number; max: number; step: number; def: number; fmt?: (v: number) => string;
  } = $props();
  const fill = $derived(((value - min) / (max - min)) * 100);
</script>

<label class="row" ondblclick={() => (value = def)} title="Duplo clique: valor padrão">
  <span class="top"><span>{label}</span><b>{fmt(value)}</b></span>
  <input type="range" {min} {max} {step} bind:value style:--fill="{fill}%" />
</label>

<style>
  .row { display: block; margin: 10px 0 4px; }
  .top { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; }
  b { color: var(--text); font-weight: 600; }
</style>
