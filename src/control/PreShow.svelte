<script module lang="ts">
  import type { Item } from '../lib/preshow';
  let last: { when: string; items: Item[] } | null = null;
  /** Último "Testar tudo", para o JSON do Diagnóstico. */
  export const preshowLast = () => last;
</script>

<script lang="ts">
  // "Testar tudo" (DK-145): coleta por 10 s e mostra o checklist do dia do show; a regra fica em lib/preshow.ts.
  import { invoke } from '@tauri-apps/api/core';
  import { availableMonitors, Window } from '@tauri-apps/api/window';
  import { evaluate, worst } from '../lib/preshow';
  import { load } from '../lib/store';
  import { validFxList, type FxEntry } from '../lib/shaders/manifest';
  import type { Frame } from '../lib/types';
  import type { Telemetry } from '../lib/telemetry';
  import { midi } from './midi.svelte';
  import { mappedByDevice } from '../lib/midimap';
  import { rec } from './rec.svelte';

  type Net = { osc: boolean; oscLan: boolean; remote: boolean; remoteLan: boolean; spout: boolean };
  let { frame, gate, tel, monitor, safeFlash, fxSafe, update, net }: {
    frame: Frame | null; gate: number; tel: Telemetry; monitor: number;
    safeFlash: boolean; fxSafe: boolean; update: string | null; net: Net;
  } = $props();

  let running = $state(false), left = $state(0);
  let items = $state<Item[]>([]);

  /** Telão aberto? Em tela cheia? No monitor escolhido? null = não deu para perguntar à janela. */
  async function outputWindow() {
    try {
      const w = await Window.getByLabel('output');
      if (!w) return { open: false, fullscreen: null, monitorOk: null };
      // mesma ordem do list_monitors (os dois vêm de available_monitors); em tela cheia a janela começa no canto do monitor
      const [fullscreen, pos, mons] = await Promise.all([w.isFullscreen(), w.outerPosition(), availableMonitors()]);
      const m = mons[monitor];
      return { open: true, fullscreen, monitorOk: m ? pos.x === m.position.x && pos.y === m.position.y : null };
    } catch { return { open: tel.fps > 0, fullscreen: null, monitorOk: null }; }
  }

  async function run() {
    running = true;
    const rms: number[] = [], p95: number[] = [];
    let lockedAtS: number | null = frame?.locked ? 0 : null, lost = false, prev: Frame | null = null, prevTel: Telemetry | null = null;
    const diskP = invoke<number | null>('disk_free').catch(() => null);
    const t0 = Date.now(); // relógio de parede: janela em segundo plano espaça o setTimeout, mas são sempre 10 s
    for (let s = 0; s < 10; s = (Date.now() - t0) / 1000) {
      left = Math.ceil(10 - s);
      await new Promise((r) => setTimeout(r, 100));
      const f = frame, fresh = f && f !== prev; // mesmo objeto = não chegou quadro novo
      rms.push(fresh ? f.rms : 0);
      if (fresh && f.locked && lockedAtS === null) lockedAtS = (Date.now() - t0) / 1000;
      prev = f;
      if (tel !== prevTel && tel.fps > 0) { p95.push(tel.p95); lost ||= tel.lost; } // telemetria chega 1×/s
      prevTel = tel;
    }
    const w = await outputWindow();
    const fx = load('doublek.fx', validFxList, () => [] as FxEntry[]);
    items = evaluate({
      rms, gate, lockedAtS,
      output: { ...w, p95, lost },
      midi: { devices: [...midi.devices], mapped: Object.keys(midi.map).length, mappedBy: mappedByDevice(midi.map) },
      diskFree: await diskP, recording: rec.s.phase !== 'idle',
      safeFlash, fx: { safe: fxSafe, suspect: fx.filter((x) => x.health.status === 'suspeito').map((x) => x.manifest.name) },
      update, net,
    });
    last = { when: new Date().toISOString(), items: $state.snapshot(items) };
    running = false;
  }
  const sum = $derived(items.length ? worst(items) : null);
</script>

<h2>Antes do show</h2>
<button class="wide" class:primary={!running} disabled={running} onclick={run} title="Confere áudio, BPM, telão, MIDI, disco, flashes, efeitos, versão e rede em ~10 s. Deixe a música tocando.">
  {running ? `Testando… ${left} s` : 'Testar tudo'}
</button>
{#if items.length && !running}
  <ul class="preshow" aria-label="Resultado do Testar tudo: {sum}">
    {#each items as x (x.id)}
      <li class={x.color}><i aria-hidden="true"></i><b>{x.label}</b> <span>{x.msg}</span></li>
    {/each}
  </ul>
{/if}

<style>
  .preshow { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; font-size: 12px; }
  .preshow li { display: flex; gap: 6px; align-items: baseline; line-height: 1.35; }
  .preshow i { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--clip); }
  .preshow .amarelo i { background: #ffb84d; }
  .preshow .verde i { background: var(--ok); }
  .preshow b { flex: none; }
  .preshow span { color: var(--muted); }
  .preshow .vermelho span { color: var(--text); }
</style>
