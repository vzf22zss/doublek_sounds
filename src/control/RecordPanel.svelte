<script lang="ts">
  // Gravação da saída visual (DK-072), na aba Saída: grava o que o telão mostra, sem áudio.
  import Slider from './Slider.svelte';
  import { FORMAT_NAMES, outputSize, QUALITY_NAMES, recLabel, SIZE_NAMES, ZOOM_MAX, ZOOM_MIN, type Format, type Quality, type Size } from '../lib/recorder';
  import { openRecDir, rec, sendFraming, startRec, stopRec } from './rec.svelte';

  // src = canvas do telão (monitor × resolução de render); size = Tamanho, salvo em doublek.settings (D-15a)
  let { outputOpen, p95, src, size = $bindable() }: { outputOpen: boolean; p95: number; src: { w: number; h: number }; size: Size } = $props();
  const busy = $derived(rec.s.phase !== 'idle');
  // enquadramento do vertical pode mudar gravando: o telão aplica na hora
  $effect(() => { void rec.zoom; void rec.offset; sendFraming(); });
  const out = $derived(outputSize(src.w, src.h, rec.format, size, rec.quality));
</script>

<h2>Gravação</h2>
<div class="files">
  <label class="field">Formato
    <select bind:value={rec.format} disabled={busy}>
      {#each Object.entries(FORMAT_NAMES) as [f, n]}<option value={f as Format}>{n}</option>{/each}
    </select>
  </label>
  <label class="field">Tamanho
    <select bind:value={size} disabled={busy}>
      {#each Object.entries(SIZE_NAMES[rec.format]) as [z, n]}<option value={z as Size}>{n}</option>{/each}
    </select>
  </label>
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
{#if rec.format === 'VERTICAL'}
  <Slider label="Zoom do recorte" bind:value={rec.zoom} min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} def={1} fmt={(v) => v.toFixed(2) + '×'} />
  <Slider label="Posição horizontal" bind:value={rec.offset} min={-1} max={1} step={0.05} def={0} fmt={(v) => (v === 0 ? 'centro' : v < 0 ? `${(-v * 100).toFixed(0)}% esq.` : `${(v * 100).toFixed(0)}% dir.`)} />
  <p class="keys">Vertical para Reels/TikTok: o retângulo no PREVIEW mostra o recorte (o telão não muda). Dá para ajustar gravando. O vertical copia cada quadro e pesa mais no telão: prefira Leve ou 30 fps.</p>
{/if}
<p class="keys" class:warnTxt={out.warn}>Grava em {out.w}×{out.h}{out.copy ? '' : ' (o tamanho do telão, sem cópia)'}.{out.warn ? ' ⚠ ' + out.warn : ''}</p>
<div class="files">
  {#if busy}
    <button class="stop" onclick={stopRec} disabled={rec.s.phase === 'stopping'}>{rec.s.phase === 'stopping' ? 'Finalizando…' : 'Parar'}</button>
    <span class="rec" title="Gravando a saída do telão"><i>●</i> REC {recLabel(rec.s)}</span>
  {:else}
    <button class="primary" onclick={() => startRec(outputOpen, p95, src, size)} disabled={!outputOpen} title={outputOpen ? 'Grava o que o telão mostra (sem áudio)' : 'Abra o telão para gravar'}>Gravar</button>
  {/if}
  <button onclick={openRecDir}>Abrir pasta das gravações</button>
</div>
<p class="keys">Grava só a imagem do telão (sem áudio), em MP4 (H.264) quando o WebView tem, senão WebM. Para sozinha a 4 GiB ou com menos de 1 GiB livre no disco.{#if rec.s.path} Última: {rec.s.path}{/if}</p>

<style>
  .rec { color: #ff3b3b; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rec i { font-style: normal; animation: blink 1s steps(2, start) infinite; } /* só a bolinha pisca; tempo e MB ficam legíveis */
  @keyframes blink { to { visibility: hidden; } }
  .stop { border-color: #ff3b3b; color: #ff3b3b; }
  .warnTxt { color: #ffb84d; }
  .field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
</style>
