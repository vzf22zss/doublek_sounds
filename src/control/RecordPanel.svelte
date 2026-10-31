<script lang="ts">
  // Gravação da saída visual (DK-072), na aba Saída: grava o que o telão mostra, sem áudio.
  import { QUALITY_NAMES, recLabel, type Quality } from '../lib/recorder';
  import { openRecDir, rec, startRec, stopRec } from './rec.svelte';

  let { outputOpen, p95 }: { outputOpen: boolean; p95: number } = $props();
  const busy = $derived(rec.s.phase !== 'idle');
</script>

<h2>Gravação</h2>
<div class="files">
  <label class="field">Qualidade
    <select bind:value={rec.quality} disabled={busy}>
      {#each Object.entries(QUALITY_NAMES) as [q, n]}<option value={q as Quality}>{n}</option>{/each}
    </select>
  </label>
  <label class="field">FPS
    <select bind:value={rec.fps} disabled={busy}>
      <option value={30}>30</option>
      <option value={60}>60</option>
    </select>
  </label>
</div>
<div class="files">
  {#if busy}
    <button class="stop" onclick={stopRec} disabled={rec.s.phase === 'stopping'}>{rec.s.phase === 'stopping' ? 'Finalizando…' : 'Parar'}</button>
    <span class="rec" title="Gravando a saída do telão"><i>●</i> REC {recLabel(rec.s)}</span>
  {:else}
    <button class="primary" onclick={() => startRec(outputOpen, p95)} disabled={!outputOpen} title={outputOpen ? 'Grava o que o telão mostra (sem áudio)' : 'Abra o telão para gravar'}>Gravar</button>
  {/if}
  <button onclick={openRecDir}>Abrir pasta das gravações</button>
</div>
<p class="keys">Grava só a imagem do telão (sem áudio), em MP4 (H.264) quando o WebView tem, senão WebM. Para sozinha a 4 GiB ou com menos de 1 GiB livre no disco.{#if rec.s.path} Última: {rec.s.path}{/if}</p>

<style>
  .rec { color: #ff3b3b; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rec i { font-style: normal; animation: blink 1s steps(2, start) infinite; } /* só a bolinha pisca; tempo e MB ficam legíveis */
  @keyframes blink { to { visibility: hidden; } }
  .stop { border-color: #ff3b3b; color: #ff3b3b; }
  .field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
</style>
