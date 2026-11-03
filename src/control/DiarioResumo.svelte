<script lang="ts">
  // Resumo do diário de análise (DK-144) logo depois de Parar, na aba Áudio: o mesmo do `replay`, sem terminal.
  import { invoke } from '@tauri-apps/api/core';
  import { advice, duration, type AnalysisSummary } from '../lib/diario';

  let { path }: { path: string } = $props();
  let sum = $state<AnalysisSummary | null>(null), err = $state('');
  $effect(() => {
    const p = path;
    sum = null; err = '';
    invoke<AnalysisSummary>('analysis_summary', { path: p }).then((r) => { if (p === path) sum = r; }, (e) => { if (p === path) err = String(e); });
  });
  const tips = $derived(sum ? advice(sum) : []);
  const openDir = () => invoke('analysis_open_dir').catch((e) => (err = 'Não consegui abrir a pasta das análises: ' + e));
</script>

<div class="card">
  {#if sum}
    <dl>
      <dt>Duração</dt><dd>{duration(sum.secs)}</dd>
      <dt>BPM travado</dt><dd>{sum.lockedPct.toFixed(0)}% · {sum.unlocks} {sum.unlocks === 1 ? 'queda' : 'quedas'} de trava</dd>
      <dt>Drops marcados (M)</dt><dd>{sum.marks}</dd>
      <dt>… o app pegou</dt><dd>{sum.dropHits}{sum.dropDelayMean !== null ? ` (atraso médio ${sum.dropDelayMean >= 0 ? '+' : ''}${sum.dropDelayMean.toFixed(1)} s)` : ''}</dd>
      <dt>… o app perdeu</dt><dd>{sum.dropMissed}</dd>
      <dt>Drops sem marca</dt><dd>{sum.dropFalse}</dd>
    </dl>
    {#each tips as t}<p class="tip">{t}</p>{/each}
    {#if sum.cutLast}<p class="keys warnTxt">A última linha do arquivo estava cortada (o app fechou ou o disco encheu no meio) e foi ignorada.</p>{/if}
  {:else if err}
    <p class="keys warnTxt">{err}</p>
  {:else}
    <p class="keys">Resumindo a análise…</p>
  {/if}
  <button class="wide" onclick={openDir}>Abrir pasta das análises</button>
</div>

<style>
  .card { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin: 6px 0; background: var(--panel); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 0 6px; font-size: 12px; }
  dt { color: var(--muted); }
  dd { margin: 0; font-variant-numeric: tabular-nums; }
  .tip { margin: 4px 0; font-size: 12px; line-height: 1.35; }
  .warnTxt { color: #ffb84d; }
</style>
