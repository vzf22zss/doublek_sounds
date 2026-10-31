<script lang="ts">
  // Mapa de automação (DK-035): o que o Intelligent Show faz em cada estado, editável durante o show.
  // Só vale com o modo Assistido/Automático (seletor na barra de performance); cenas só no Automático.
  import Slider from './Slider.svelte';
  import { DEFAULT_LIMITS, LIMIT_KEYS, RULE_IDS, RULE_NAMES, type AutomationConfig, type LimitKey, type LimitState, type SceneRef } from '../lib/show-engine/config';

  let { cfg = $bindable(), bankNames, sceneNames }: {
    cfg: AutomationConfig;
    bankNames: () => string[];
    sceneNames: (bank: number) => string[];
  } = $props();

  const STATES: [LimitState, string][] = [['BREAKDOWN', 'Breakdown (teto)'], ['BUILD_UP', 'Build-up (teto)']];
  const keyOf = (s: SceneRef) => (s ? `${s.bank}:${s.index}` : '');
  const refOf = (k: string): SceneRef => (k ? { bank: +k.split(':')[0], index: +k.split(':')[1] } : null);
  const fmt = (k: LimitKey) => (v: number) => (LIMIT_KEYS[k].step < 0.1 ? v.toFixed(2) : v.toFixed(1));
</script>

<details class="auto" data-automation>  <!-- editar o mapa não pausa a automação -->
  <summary>Mapa de automação</summary>
  <p class="hint">Vale no modo <b>Assistido</b> ou <b>Automático</b> (seletor ao lado das macros). Qualquer comando seu pausa a automação por 8 s.</p>

  <div class="rules">
    {#each RULE_IDS as id}
      <label><input type="checkbox" bind:checked={cfg.enabled[id]} /> {RULE_NAMES[id]}</label>
    {/each}
  </div>

  {#each STATES as [st, title]}
    <h3>{title}</h3>
    {#each Object.entries(LIMIT_KEYS) as [k, l]}
      <Slider label={l.label} bind:value={cfg.limits[st][k as LimitKey]} min={0} max={l.max} step={l.step} def={DEFAULT_LIMITS[st][k as LimitKey]} fmt={fmt(k as LimitKey)} />
    {/each}
  {/each}

  <h3>Cenas (só no Automático)</h3>
  {#each [['dropScene', 'No drop'], ['grooveScene', 'No groove']] as [field, label]}
    <label class="scene">{label}
      <select value={keyOf(cfg[field as 'dropScene' | 'grooveScene'])} onchange={(e) => (cfg[field as 'dropScene' | 'grooveScene'] = refOf(e.currentTarget.value))}>
        <option value="">nenhuma (só a macro)</option>
        {#each bankNames() as bn, b}
          <optgroup label={`Banco ${b + 1}: ${bn}`}>
            {#each sceneNames(b) as sn, i}<option value={`${b}:${i}`}>{i + 1}. {sn}</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
  {/each}
</details>

<style>
  .auto { margin: 0 0 12px; border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; }
  .auto summary { cursor: pointer; font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .auto[open] summary { margin-bottom: 6px; }
  .hint { font-size: 11px; color: var(--muted); margin: 0 0 8px; }
  .rules { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: 12px; margin-bottom: 6px; }
  h3 { font-size: 11px; color: var(--muted); margin: 10px 0 2px; font-weight: 600; }
  .scene { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; margin: 4px 0; }
  .scene select { max-width: 60%; font-size: 12px; }
</style>
