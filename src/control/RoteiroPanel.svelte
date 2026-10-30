<script lang="ts">
  // Aba Roteiro: escolher/criar roteiro, grade (BPM, 1º tempo), quem toca, modo e o ponto selecionado.
  import { invoke } from '@tauri-apps/api/core';
  import { rt, current, selectedCue, create, open, remove, load, replaceTrack, exportFile, importFile, addCue, deleteCue, setMode } from './roteiro.svelte';
  import { barLabel, FX_NAMES, KIND_NAMES, KNOBS, newCue, type CueKind } from '../lib/roteiro';
  import { listVideos } from '../lib/assets';

  let { sceneNames, bankNames }: { sceneNames: (bank?: number) => string[]; bankNames: () => string[] } = $props();

  let outputs = $state<string[]>([]);
  invoke<string[]>('list_outputs').then((o) => (outputs = o)).catch(() => {});

  const r = $derived(current());
  const cue = $derived(selectedCue());
  const videos = $derived(listVideos());

  function setKind(k: CueKind) {
    const c = cue;
    if (!c || c.kind === k) return;
    Object.assign(c, { ...newCue(k, c.beat), id: c.id });
    rt.kind = k;
  }
</script>

<div class="rp">
  {#if rt.busy}<p class="busy">{rt.busy}</p>{/if}

  <div class="row">
    <select bind:value={() => rt.cur, (id) => open(id)} title="Roteiro">
      <option value="" disabled>— escolha um roteiro —</option>
      {#each rt.list as x (x.id)}<option value={x.id}>{x.name}</option>{/each}
    </select>
    <label class="btn primary" title="Escolha a música (mp3, wav, flac, m4a…): ela é analisada e vira um roteiro novo">Nova música<input type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg" onchange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) create(f); }} /></label>
  </div>

  {#if r}
    <input class="name" bind:value={r.name} maxlength="40" title="Nome do roteiro" />
    <p class="track">{r.trackName}{rt.info ? ` · ${Math.floor(rt.info.duration / 60)}:${String(Math.floor(rt.info.duration % 60)).padStart(2, '0')}` : ''}</p>

    <h2>Grade</h2>
    <div class="grid2">
      <label>BPM <input type="number" step="0.01" min="60" max="240" bind:value={r.bpm} /></label>
      <div class="pair" title="Em qual beat começa o compasso (o 1 da contagem)">
        <span>1º tempo</span>
        <button onclick={() => (r.barShift = (r.barShift + 3) % 4)}>−</button>
        <button onclick={() => (r.barShift = (r.barShift + 1) % 4)}>+</button>
      </div>
      <div class="pair" title="Arrasta a grade inteira 5 ms para alinhar com o kick">
        <span>Alinhar</span>
        <button onclick={() => (r.anchor -= 0.005)}>−5ms</button>
        <button onclick={() => (r.anchor += 0.005)}>+5ms</button>
      </div>
      <button onclick={() => { r.bpm = 0; load(r); }} title="Refaz a análise do BPM com a faixa de andamento da aba Áudio">Analisar de novo</button>
    </div>

    <h2>Quem toca a música</h2>
    <div class="seg">
      <button class:on={rt.source === 'app'} onclick={() => (rt.source = 'app')} disabled={rt.running}>O app<small>toca o arquivo</small></button>
      <button class:on={rt.source === 'dj'} onclick={() => (rt.source = 'dj')} disabled={rt.running}>O DJ (GO)<small>segue o BPM ao vivo</small></button>
    </div>
    {#if rt.source === 'app'}
      <select class="wide" bind:value={() => rt.output, (o) => { rt.output = o; if (r) load(r); }} title="Saída de áudio do app" disabled={rt.running}>
        <option value="">Saída padrão do Windows</option>
        {#each outputs as o}<option value={o}>{o}</option>{/each}
      </select>
    {:else}
      <div class="pair go">
        <span>GO no compasso <b>{barLabel(r, r.goBeat)}</b></span>
        <button onclick={() => (r.goBeat = Math.max(0, Math.round(rt.cursor)))} title="O GO passa a ser no cursor">usar cursor</button>
      </div>
      <p class="keys">Aperte GO (G ou pad MIDI) no beat em que a música estiver no compasso do GO. Errou? « ‹ › » corrigem 1 compasso / 1 beat.</p>
    {/if}

    <h2>Modo</h2>
    <div class="seg three">
      <button class:on={rt.mode === 'live'} onclick={() => setMode('live')}>Roteiro + ao vivo<small>pontos + reage ao som</small></button>
      <button class:on={rt.mode === 'only'} onclick={() => setMode('only')}>Só roteiro<small>muda só nos pontos</small></button>
      <button class:on={rt.mode === 'sound'} onclick={() => setMode('sound')}>Só o som<small>sem os pontos</small></button>
    </div>
    <p class="keys">Dá para trocar com a música tocando: aperte <b>R</b> (ou o botão A/B na timeline) e compare na hora como fica <b>com o roteiro</b> e como fica <b>só reagindo ao som</b>.</p>

    <h2>Pontos</h2>
    <div class="row">
      <select bind:value={rt.kind} title="Tipo do próximo ponto">
        {#each Object.entries(KIND_NAMES) as [k, n]}<option value={k}>{n}</option>{/each}
      </select>
      <button onclick={() => addCue(Math.max(0, Math.round(rt.cursor)))}>+ no cursor</button>
    </div>
    <p class="keys">Na timeline: duplo clique cria um ponto (Shift = no compasso), arrastar move, Delete apaga.</p>

    {#if cue}
      <div class="cue">
        <div class="seg four">
          {#each Object.entries(KIND_NAMES) as [k, n]}<button class:on={cue.kind === k} onclick={() => setKind(k as CueKind)}>{n}</button>{/each}
        </div>
        <p class="at">Compasso <b>{barLabel(r, cue.beat)}</b> (beat {cue.beat})</p>
        {#if cue.kind === 'scene'}
          <select class="wide" bind:value={cue.bank} title="De que banco é a cena. 'Banco aberto' = o que estiver aberto na hora do ponto">
            <option value={undefined}>Banco aberto na hora</option>
            {#each bankNames() as n, i}<option value={i}>Banco {i + 1}: {n}</option>{/each}
          </select>
          <select class="wide" bind:value={cue.scene}>
            {#each sceneNames(cue.bank) as n, i}<option value={i}>{i + 1}. {n}</option>{/each}
          </select>
          <label class="num">Crossfade <input type="number" min="0" max="32" step="1" bind:value={cue.fade} /> beats</label>
        {:else if cue.kind === 'fx'}
          <select class="wide" bind:value={cue.fx}>
            {#each Object.entries(FX_NAMES) as [k, n]}<option value={k}>{n}</option>{/each}
          </select>
          {#if cue.fx !== 'flash'}<label class="num">Duração <input type="number" min="1" max="64" step="1" bind:value={cue.beats} /> beats</label>{/if}
          {#if cue.fx === 'strobe'}
            <div class="seg four">
              {#each [1, 2, 4] as d}<button class:on={cue.div === d} onclick={() => (cue.div = d)}>1/{d}</button>{/each}
            </div>
          {/if}
        {:else if cue.kind === 'video'}
          <select class="wide" bind:value={cue.video}>
            <option value="">Sem vídeo (foto/cor)</option>
            {#each videos as v}<option value={v.id}>{v.name}</option>{/each}
          </select>
          {#if !videos.length}<p class="keys">Adicione vídeos na aba Fundo.</p>{/if}
        {:else}
          <select class="wide" bind:value={cue.key}>
            {#each Object.entries(KNOBS) as [k, [n]]}<option value={k}>{n}</option>{/each}
          </select>
          {#if cue.key && KNOBS[cue.key]}
            <label class="num">Até <input type="range" min={KNOBS[cue.key][1]} max={KNOBS[cue.key][2]} step={(KNOBS[cue.key][2] - KNOBS[cue.key][1]) / 100} bind:value={cue.to} /> <b>{(+(cue.to ?? 0)).toFixed(2)}</b></label>
          {/if}
          <label class="num">Em <input type="number" min="0" max="64" step="1" bind:value={cue.ramp} /> beats</label>
        {/if}
        <button class="del" onclick={() => deleteCue()}>Apagar ponto</button>
      </div>
    {/if}

    <h2>Arquivo</h2>
    <div class="row">
      <button onclick={exportFile} title="Salva o roteiro (sem a música) num arquivo">Exportar</button>
      <label class="btn">Importar<input type="file" accept=".json,application/json" onchange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) importFile(f); }} /></label>
      <label class="btn" title="Troca a música mantendo os pontos (ex.: roteiro importado)">Trocar música<input type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg" onchange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) replaceTrack(f); }} /></label>
      <button class="del" onclick={() => confirm(`Apagar o roteiro "${r.name}"?`) && remove(r.id)}>Apagar</button>
    </div>
  {:else}
    <p class="keys">Suba uma música para criar um roteiro: o app acha o BPM e mostra a música na timeline, onde você marca os pontos (trocar cena, strobe, vídeo, knob…).</p>
  {/if}
  <p class="keys">G = tocar/GO · Shift+G = parar · , . = ±1 beat · ; ' = ±1 compasso</p>
</div>

<style>
  .rp { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; }
  .busy { color: var(--accent); font-size: 12px; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .row select { flex: 1; min-width: 0; }
  .name { background: rgba(255,255,255,.05); border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px; color: var(--text); font-weight: 600; }
  .track { font-size: 11px; color: var(--muted); }
  h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 12px 0 0; font-weight: 600; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 12px; color: var(--muted); }
  .grid2 input { width: 70px; margin-left: 4px; }
  .pair { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
  .pair span { margin-right: auto; }
  .pair button, .grid2 button, .row button, .btn { padding: 4px 8px; font-size: 12px; }
  .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .seg.four { grid-template-columns: repeat(4, 1fr); }
  .seg.three { grid-template-columns: repeat(3, 1fr); }
  .seg.three button { padding: 5px 6px; }
  .seg button { text-align: left; font-size: 12px; }
  .seg.four button { text-align: center; padding: 4px 0; }
  .seg small { display: block; color: var(--muted); font-size: 10px; }
  .seg button.on small { color: inherit; opacity: .8; }
  .wide { width: 100%; }
  .keys { color: var(--muted); font-size: 11px; }
  .cue { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: rgba(255,255,255,.03); }
  .at { font-size: 12px; color: var(--muted); }
  .at b { color: var(--text); }
  .num { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .num input[type='number'] { width: 60px; }
  .num input[type='range'] { flex: 1; }
  .go b { color: #3ee08f; }
  .btn { background: rgba(255,255,255,.06); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; color: var(--text); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink, #fff); font-weight: 600; }
  .btn input { display: none; }
  .del { color: var(--clip); }
  input[type='number'] { background: rgba(255,255,255,.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 2px 4px; }
</style>
