<script lang="ts">
  // Psy Engine (DK-022): caleidoscópio, túnel fractal e mandala. Intensidade 0 = módulo desligado, sem custo.
  import Slider from './Slider.svelte';
  import { VISUAL, type Visual } from '../lib/settings';

  let { vs = $bindable() }: { vs: Visual } = $props();
  const f2 = (v: number) => v.toFixed(2);
  const int = (v: number) => String(Math.round(v));
</script>

<h2>Psy Engine</h2>
<Slider label="Caleidoscópio" bind:value={vs.kaleido} learn="kaleido" bind:mod={vs.mod.kaleido} bind:drop={vs.drop.kaleido} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.kaleido > 0}
  <Slider label="Fatias" bind:value={vs.kaleidoN} learn="kaleidoN" min={3} max={12} step={1} def={VISUAL.kaleidoN} fmt={int} />
  <Slider label="Giro" bind:value={vs.kaleidoSpin} learn="kaleidoSpin" min={-1} max={1} step={0.01} def={VISUAL.kaleidoSpin} fmt={f2} />
  <Slider label="Zoom" bind:value={vs.kaleidoZoom} learn="kaleidoZoom" min={0.5} max={2} step={0.01} def={VISUAL.kaleidoZoom} fmt={f2} />
  <label class="check">
    <input type="checkbox" bind:checked={vs.kaleidoMirror} />
    <span>Espelhar as fatias <small>sem emenda entre uma fatia e outra</small></span>
  </label>
  <p class="keys">O caleidoscópio dobra o quadro inteiro, com a logo junto. A fonte escolhida empurra o giro.</p>
{/if}

<Slider label="Túnel fractal" bind:value={vs.tunnel} learn="tunnel" bind:mod={vs.mod.tunnel} bind:drop={vs.drop.tunnel} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.tunnel > 0}
  <Slider label="Velocidade" bind:value={vs.tunnelSpeed} learn="tunnelSpeed" min={0} max={2} step={0.01} def={VISUAL.tunnelSpeed} fmt={f2} />
  <Slider label="Densidade" bind:value={vs.tunnelDensity} learn="tunnelDensity" min={0} max={1} step={0.01} def={VISUAL.tunnelDensity} fmt={f2} />
  <p class="keys">Passa por baixo da logo e dos anéis. A fonte escolhida acelera o túnel.</p>
{/if}

<Slider label="Mandala" bind:value={vs.mandala} learn="mandala" bind:mod={vs.mod.mandala} bind:drop={vs.drop.mandala} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.mandala > 0}
  <Slider label="Pétalas" bind:value={vs.mandalaPetals} learn="mandalaPetals" min={4} max={16} step={2} def={VISUAL.mandalaPetals} fmt={int} />
  <p class="keys">Anéis em volta da logo que abrem a cada compasso. A fonte escolhida acende o brilho.</p>
{/if}

<Slider label="Partículas" bind:value={vs.particles} learn="particles" bind:mod={vs.mod.particles} bind:drop={vs.drop.particles} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.particles > 0}
  <Slider label="Quantidade" bind:value={vs.particlesDensity} learn="particlesDensity" min={0} max={1} step={0.01} def={VISUAL.particlesDensity} fmt={f2} />
  <Slider label="Direção" bind:value={vs.particlesDir} learn="particlesDir" min={0} max={360} step={1} def={VISUAL.particlesDir} fmt={(v) => Math.round(v) + '°'} />
  <Slider label="Turbulência" bind:value={vs.particlesTurb} learn="particlesTurb" min={0} max={1} step={0.01} def={VISUAL.particlesTurb} fmt={f2} />
  <p class="keys">Passam por baixo da logo. A fonte escolhida dá o empurrão e o brilho. 90° = sobem.</p>
{/if}

<Slider label="Orgânico" bind:value={vs.organic} learn="organic" bind:mod={vs.mod.organic} bind:drop={vs.drop.organic} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.organic > 0}
  <Slider label="Escala" bind:value={vs.organicScale} learn="organicScale" min={0.3} max={3} step={0.01} def={VISUAL.organicScale} fmt={f2} />
  <p class="keys">Textura viva com as cores do fundo; gira com a Matiz do fundo. A fonte escolhida acende a cor.</p>
{/if}

<Slider label="Glitch" bind:value={vs.glitch} learn="glitch" bind:mod={vs.mod.glitch} bind:drop={vs.drop.glitch} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.glitch > 0}
  <p class="keys">Rajadas de 120 ms quando a fonte bate: no máximo {vs.safeFlash ? 3 : 6} por segundo{vs.safeFlash ? '' : ' (limite de flashes desligado)'}.</p>
{/if}

<span class="lbl">Qualidade do Psy Engine</span>
<div class="seg">
  {#each ['Baixa', 'Média', 'Alta'] as l, i}
    <button class:on={Math.round(vs.psyQuality) === i} onclick={() => (vs.psyQuality = i)}>{l}</button>
  {/each}
</div>

<style>
  h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 18px 0 2px; font-weight: 600; }
  .check { display: flex; gap: 10px; align-items: flex-start; margin: 12px 0 4px; cursor: pointer; }
  .check input { accent-color: var(--accent); margin-top: 3px; }
  .check small { display: block; color: var(--muted); font-size: 11px; }
  .keys { color: var(--muted); font-size: 11px; margin-top: 8px; }
  .lbl { display: block; margin-top: 12px; color: var(--muted); font-size: 12px; }
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
  .seg button { text-align: center; }
</style>
