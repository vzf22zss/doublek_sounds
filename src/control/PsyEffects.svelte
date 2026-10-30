<script lang="ts">
  // Psy Engine (DK-022/023/024): seis módulos visuais. Intensidade 0 = módulo desligado, sem custo.
  // O custo medido e os avisos do ajuste automático chegam do telão pelos eventos 'psy-costs' e 'psy-budget'.
  import { listen } from '@tauri-apps/api/event';
  import Slider from './Slider.svelte';
  import { VISUAL, type Visual } from '../lib/settings';
  import type { BudgetInfo, Cost } from '../render/renderer';
  import { BLEND_NAMES, BLENDS, LAYER_NAMES, moveLayer, sanitizeLayers, setLayer, type Blend, type LayerId } from '../render/layers';

  let { vs = $bindable() }: { vs: Visual } = $props();
  const f2 = (v: number) => v.toFixed(2);
  const int = (v: number) => String(Math.round(v));

  let costs = $state<Record<string, Cost>>({});
  let budget = $state<BudgetInfo | null>(null);
  $effect(() => {
    const un = [
      listen<Cost[]>('psy-costs', (e) => (costs = Object.fromEntries(e.payload.map((c) => [c.id, c])))),
      listen<BudgetInfo>('psy-budget', (e) => (budget = e.payload)),
    ];
    return () => un.forEach((p) => p.then((f) => f()).catch(() => {}));
  });
  // camadas (DK-051): sempre a lista validada; cada mudança grava uma lista nova no visual
  const layers = $derived(sanitizeLayers(vs.layers));
  const name = (id: string) => LAYER_NAMES[id as LayerId] ?? id;

  /** "GPU 0,42 ms" com timer de GPU; senão só o CPU, que não mostra o peso real do shader. */
  const ms = (id: string) => {
    const c = costs[id];
    if (!c) return '';
    const f = (x: number) => x.toFixed(2).replace('.', ',');
    return c.gpuMs !== null ? `GPU ${f(c.gpuMs)} ms` : `CPU ${f(c.cpuMs)} ms · sem timer de GPU`;
  };
</script>

<h2>Psy Engine</h2>
<button class="power" class:on={!vs.psySafe} onclick={() => (vs.psySafe = !vs.psySafe)}
  title="Desligado: os seis módulos param de desenhar na hora, sem mexer nos valores nem nas cenas">
  Psy Engine: {vs.psySafe ? 'desligado' : 'ligado'}
</button>
{#if vs.psySafe}<p class="keys">Os valores abaixo ficam guardados; voltam a valer quando você religar.</p>{/if}

<Slider label="Caleidoscópio" bind:value={vs.kaleido} learn="kaleido" bind:mod={vs.mod.kaleido} bind:drop={vs.drop.kaleido} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.kaleido > 0}
  {#if ms('kaleido')}<small class="cost">{ms('kaleido')}</small>{/if}
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
  {#if ms('tunnel')}<small class="cost">{ms('tunnel')}</small>{/if}
  <Slider label="Velocidade" bind:value={vs.tunnelSpeed} learn="tunnelSpeed" min={0} max={2} step={0.01} def={VISUAL.tunnelSpeed} fmt={f2} />
  <Slider label="Densidade" bind:value={vs.tunnelDensity} learn="tunnelDensity" min={0} max={1} step={0.01} def={VISUAL.tunnelDensity} fmt={f2} />
  <p class="keys">Passa por baixo da logo e dos anéis. A fonte escolhida acelera o túnel.</p>
{/if}

<Slider label="Mandala" bind:value={vs.mandala} learn="mandala" bind:mod={vs.mod.mandala} bind:drop={vs.drop.mandala} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.mandala > 0}
  {#if ms('mandala')}<small class="cost">{ms('mandala')}</small>{/if}
  <Slider label="Pétalas" bind:value={vs.mandalaPetals} learn="mandalaPetals" min={4} max={16} step={2} def={VISUAL.mandalaPetals} fmt={int} />
  <p class="keys">Anéis em volta da logo que abrem a cada compasso. A fonte escolhida acende o brilho.</p>
{/if}

<Slider label="Partículas" bind:value={vs.particles} learn="particles" bind:mod={vs.mod.particles} bind:drop={vs.drop.particles} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.particles > 0}
  {#if ms('particles')}<small class="cost">{ms('particles')}</small>{/if}
  <Slider label="Quantidade" bind:value={vs.particlesDensity} learn="particlesDensity" min={0} max={1} step={0.01} def={VISUAL.particlesDensity} fmt={f2} />
  <Slider label="Direção" bind:value={vs.particlesDir} learn="particlesDir" min={0} max={360} step={1} def={VISUAL.particlesDir} fmt={(v) => Math.round(v) + '°'} />
  <Slider label="Turbulência" bind:value={vs.particlesTurb} learn="particlesTurb" min={0} max={1} step={0.01} def={VISUAL.particlesTurb} fmt={f2} />
  <p class="keys">Passam por baixo da logo. A fonte escolhida dá o empurrão e o brilho. 90° = sobem.</p>
{/if}

<Slider label="Orgânico" bind:value={vs.organic} learn="organic" bind:mod={vs.mod.organic} bind:drop={vs.drop.organic} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.organic > 0}
  {#if ms('organic')}<small class="cost">{ms('organic')}</small>{/if}
  <Slider label="Escala" bind:value={vs.organicScale} learn="organicScale" min={0.3} max={3} step={0.01} def={VISUAL.organicScale} fmt={f2} />
  <p class="keys">Textura viva com as cores do fundo; gira com a Matiz do fundo. A fonte escolhida acende a cor.</p>
{/if}

<Slider label="Glitch" bind:value={vs.glitch} learn="glitch" bind:mod={vs.mod.glitch} bind:drop={vs.drop.glitch} min={0} max={1} step={0.01} def={0} fmt={f2} />
{#if vs.glitch > 0}
  {#if ms('glitch')}<small class="cost">{ms('glitch')}</small>{/if}
  <p class="keys">Rajadas de 120 ms quando a fonte bate: no máximo {vs.safeFlash ? 3 : 6} por segundo{vs.safeFlash ? '' : ' (limite de flashes desligado)'}.</p>
{/if}

<span class="lbl">Qualidade do Psy Engine</span>
<div class="seg">
  {#each ['Baixa', 'Média', 'Alta'] as l, i}
    <button class:on={Math.round(vs.psyQuality) === i} onclick={() => (vs.psyQuality = i)}>{l}</button>
  {/each}
</div>
<label class="check">
  <input type="checkbox" bind:checked={vs.psyAuto} />
  <span>Ajuste automático <small>se o telão engasgar, baixa a qualidade e depois desliga o módulo mais pesado; religa aos poucos</small></span>
</label>
{#if vs.psyAuto}
  <Slider label="Teto do quadro (p95)" bind:value={vs.psyBudgetMs} learn="psyBudgetMs" min={12} max={40} step={1} def={VISUAL.psyBudgetMs} fmt={(v) => v + ' ms'} />
{/if}
{#if budget}<p class="keys" class:warn={budget.action === 'down'}>{budget.msg}</p>{/if}

<h2>Camadas</h2>
<div class="layers">
  {#each layers as l, i (l.id)}
    <div class="layer" class:off={!l.enabled}>
      <input type="checkbox" checked={l.enabled} title="Liga/desliga a camada" aria-label="Ligar {name(l.id)}"
        onchange={(e) => (vs.layers = setLayer(vs.layers, l.id, { enabled: e.currentTarget.checked }))} />
      <span class="name">{name(l.id)}</span>
      <select value={l.blend} title="Como esta camada se mistura com a de baixo" aria-label="Mistura {name(l.id)}"
        onchange={(e) => (vs.layers = setLayer(vs.layers, l.id, { blend: e.currentTarget.value as Blend }))}>
        {#each BLENDS as b}<option value={b}>{BLEND_NAMES[b]}</option>{/each}
      </select>
      <input class="op" type="range" min="0" max="1" step="0.05" value={l.opacity} title="Opacidade {Math.round(l.opacity * 100)}%"
        aria-label="Opacidade {name(l.id)}" oninput={(e) => (vs.layers = setLayer(vs.layers, l.id, { opacity: +e.currentTarget.value }))} />
      <button class="mv" disabled={i === 0} title="Subir (desenha antes)" aria-label="Subir {name(l.id)}"
        onclick={() => (vs.layers = moveLayer(vs.layers, l.id, -1))}>▲</button>
      <button class="mv" disabled={i === layers.length - 1} title="Descer (desenha depois)" aria-label="Descer {name(l.id)}"
        onclick={() => (vs.layers = moveLayer(vs.layers, l.id, 1))}>▼</button>
    </div>
  {/each}
</div>
<p class="keys">De cima para baixo = ordem em que desenham. O fundo e a logo vêm sempre antes; vinheta, strobe e blackout sempre por último. Normal a 100% não custa nada a mais; os outros modos gastam 1 passe.</p>

<style>
  h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 18px 0 2px; font-weight: 600; }
  .power { width: 100%; margin-top: 6px; }
  .check { display: flex; gap: 10px; align-items: flex-start; margin: 12px 0 4px; cursor: pointer; }
  .check input { accent-color: var(--accent); margin-top: 3px; }
  .check small { display: block; color: var(--muted); font-size: 11px; }
  .keys { color: var(--muted); font-size: 11px; margin-top: 8px; }
  .keys.warn { color: var(--kick); }
  .cost { display: block; color: var(--muted); font-size: 10px; text-align: right; margin-top: -2px; }
  .lbl { display: block; margin-top: 12px; color: var(--muted); font-size: 12px; }
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 6px; }
  .seg button { text-align: center; }
  .layers { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .layer { display: grid; grid-template-columns: 14px 78px 1fr 44px 20px 20px; gap: 4px; align-items: center; font-size: 12px; }
  .layer .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layer.off .name { color: var(--muted); text-decoration: line-through; }
  .layer input[type='checkbox'] { accent-color: var(--accent); }
  .layer select { font-size: 11px; padding: 1px 3px; width: 100%; min-width: 0; }
  .layer .op { width: 44px; }
  .mv { padding: 1px 0; font-size: 10px; }
  .mv:disabled { opacity: .3; }
</style>
