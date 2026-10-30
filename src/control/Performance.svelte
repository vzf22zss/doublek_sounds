<script lang="ts">
  // Barra de performance: knobs dos efeitos mais mexidos ao vivo + 8 cenas com crossfade no beat.
  import Knob from './Knob.svelte';
  import { learnable } from './midi.svelte';
  import { blend, loadScenes, lookOf, saveScenes, sanitizeLook, VISUAL, type Look, type Scene, type Visual } from '../lib/settings';

  let { vs = $bindable(), beatInfo, onstatus }: {
    vs: Visual;
    beatInfo: () => { bpm: number; ph: number } | null;
    onstatus: (s: string) => void;
  } = $props();

  let scenes = $state<Scene[]>(loadScenes());
  let active = $state(-1);
  let fade = $state(0);
  let editing = $state(-1);
  let trans = $state(4);
  try { trans = +(localStorage.getItem('doublek.trans') ?? 4); } catch {}
  let token = 0;

  $effect(() => saveScenes($state.snapshot(scenes)));
  $effect(() => { try { localStorage.setItem('doublek.trans', String(trans)); } catch {} });

  /** Chama a cena i: começa no próximo beat e dura `trans` beats. */
  export function recall(i: number) {
    const sc = scenes[i];
    if (!sc) return;
    active = i;
    const b = beatInfo();
    const beatMs = b?.bpm ? 60000 / b.bpm : 500;
    const wait = b?.bpm && trans ? (1 - b.ph) * beatMs : 0;
    const dur = trans * beatMs, id = ++token;
    setTimeout(() => {
      if (id !== token) return;
      // snapshot: sc.look é um proxy do $state e o blend clona o `mod` (structuredClone não aceita proxy)
      const from = $state.snapshot(vs) as Visual, to = $state.snapshot(sc.look) as Look;
      if (!dur) { Object.assign(vs, blend(from, to, 1)); return; }
      const t0 = performance.now();
      const step = (now: number) => {
        if (id !== token) return;
        const t = Math.min(1, (now - t0) / dur), e = t * t * (3 - 2 * t);
        Object.assign(vs, blend(from, to, e));
        fade = t < 1 ? t : 0;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, wait);
  }

  function save(i: number) {
    scenes[i] = { name: scenes[i]?.name ?? `Cena ${i + 1}`, look: lookOf($state.snapshot(vs) as Visual) };
    active = i;
    onstatus(`Cena ${i + 1} gravada.`);
  }

  function pad(e: MouseEvent, i: number) {
    if (e.shiftKey || !scenes[i]) save(i);
    else recall(i);
  }

  function exportFile() {
    const data = { app: 'doublek', version: 1, look: lookOf($state.snapshot(vs) as Visual), scenes: $state.snapshot(scenes) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'doublek-preset.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function importFile(f: File | undefined) {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d?.app !== 'doublek') throw new Error('não é um preset do DoubleK');
      const base = lookOf(VISUAL);
      if (Array.isArray(d.scenes) && d.scenes.length === 8) {
        scenes = d.scenes.map((s: any, i: number): Scene =>
          s && typeof s === 'object' ? { name: String(s.name ?? `Cena ${i + 1}`).slice(0, 24), look: { ...base, ...sanitizeLook(s.look) } as Look } : null);
      }
      Object.assign(vs, sanitizeLook(d.look));
      onstatus('Preset carregado: ' + f.name);
    } catch (e) {
      onstatus('Não consegui ler o preset: ' + (e as Error).message);
    }
  }

  const f2 = (v: number) => v.toFixed(2);
</script>

<section class="panel perf">
  <div class="knobs">
    <Knob label="Pulso" bind:value={vs.amount} learn="amount" min={0} max={1.5} step={0.01} def={VISUAL.amount} fmt={f2} />
    <Knob label="Glow" bind:value={vs.glow} learn="glow" min={0} max={1} step={0.01} def={VISUAL.glow} fmt={f2} />
    <Knob label="Flash" bind:value={vs.fxFlash} learn="fxFlash" min={0} max={1} step={0.01} def={VISUAL.fxFlash} fmt={f2} />
    <Knob label="Anéis" bind:value={vs.fxRings} learn="fxRings" min={0} max={1} step={0.01} def={VISUAL.fxRings} fmt={f2} />
    <Knob label="Rastro" bind:value={vs.trail} learn="trail" min={0} max={1} step={0.01} def={0} fmt={f2} />
    <Knob label="Strobe" bind:value={vs.strobe} learn="strobe" min={0} max={1} step={0.01} def={0} fmt={f2} />
    <Knob label="Cromática" bind:value={vs.chroma} learn="chroma" min={0} max={40} step={0.5} def={0} fmt={(v) => v.toFixed(0)} />
    <Knob label="Zoom fundo" bind:value={vs.bgPulse} learn="bgPulse" min={0} max={0.4} step={0.01} def={VISUAL.bgPulse} fmt={f2} />
    <Knob label="Tremor" bind:value={vs.fxShake} learn="fxShake" min={0} max={30} step={1} def={0} fmt={(v) => v.toFixed(0)} />
    <Knob label="Matiz" bind:value={vs.bgHue} learn="bgHue" min={-180} max={180} step={1} def={0} fmt={(v) => v.toFixed(0) + '°'} />
  </div>

  <div class="scenes">
    <div class="pads">
      {#each scenes as sc, i}
        <button
          class="pad"
          use:learnable={{ id: 'c:' + i, label: sc ? sc.name : `Cena ${i + 1}` }}
          class:empty={!sc}
          class:active={active === i}
          onclick={(e) => pad(e, i)}
          ondblclick={() => sc && (editing = i)}
          title={sc ? 'Clique: chamar · Shift+clique: gravar por cima · duplo clique: renomear' : 'Clique: gravar o visual atual aqui'}
        >
          <small>{i + 1}</small>
          {#if editing === i && sc}
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={sc.name} maxlength="24" autofocus onblur={() => (editing = -1)}
              onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') editing = -1; }}
              onclick={(e) => e.stopPropagation()} />
          {:else}
            <span>{sc ? sc.name : '+ gravar'}</span>
          {/if}
          {#if active === i && fade > 0}<i style:width="{fade * 100}%"></i>{/if}
        </button>
      {/each}
    </div>
    <div class="row">
      <span>Transição</span>
      <div class="seg">
        {#each [0, 1, 2, 4, 8] as b}
          <button class:on={trans === b} onclick={() => (trans = b)}>{b ? b + ' beat' + (b > 1 ? 's' : '') : 'corte'}</button>
        {/each}
      </div>
      <button class:on={vs.logoOnly} onclick={() => (vs.logoOnly = !vs.logoOnly)} title="L" use:learnable={{ id: 'a:logoOnly', label: 'Só logo' }}>Só logo</button>
      <button onclick={exportFile} title="Salva visual e cenas num arquivo">Exportar</button>
      <label class="btn" title="Carrega visual e cenas de um arquivo">Importar<input type="file" accept=".json,application/json" onchange={(e) => { importFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label>
    </div>
  </div>
</section>

<style>
  .perf { grid-column: 1 / -1; display: flex; gap: 18px; padding: 10px 14px; align-items: center; flex-wrap: wrap; }
  .knobs { display: flex; gap: 2px; flex-wrap: wrap; }
  .scenes { flex: 1; min-width: 420px; display: flex; flex-direction: column; gap: 8px; }
  .pads { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; }
  .pad { position: relative; height: 54px; padding: 6px 8px; text-align: left; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; background: rgba(255,255,255,.05); }
  .pad small { font-size: 10px; color: var(--muted); }
  .pad span { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pad.empty { border-style: dashed; background: transparent; }
  .pad.empty span { color: var(--muted); font-weight: 400; }
  .pad.active { border-color: var(--accent); background: rgba(124, 92, 255, .22); box-shadow: 0 0 16px rgba(124, 92, 255, .35); }
  .pad i { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--kick); }
  .pad input { width: 100%; font-size: 12px; background: rgba(0,0,0,.4); border: 1px solid var(--accent); border-radius: 4px; padding: 1px 4px; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
  .seg { display: flex; gap: 4px; margin-right: auto; }
  .seg button, .row > button, .btn { padding: 4px 9px; font-size: 12px; }
  .btn { background: rgba(255,255,255,.06); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; color: var(--text); }
  .btn input { display: none; }
</style>
