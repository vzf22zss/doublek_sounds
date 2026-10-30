<script lang="ts">
  // Barra de performance: knobs dos efeitos mais mexidos ao vivo + 8 cenas com crossfade no beat.
  import Knob from './Knob.svelte';
  import { load as storeLoad, save as storeSave } from '../lib/store';
  import { checkFile } from '../lib/limits';
  import { learnable, midi } from './midi.svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { emitTo } from '@tauri-apps/api/event';
  import { fmtMB } from '../lib/limits';
  import { collectShowPack, downloadShowPack, importDeps } from '../lib/showpack/collect';
  import { showPackFileName } from '../lib/showpack/export';
  import { applyShowPack, inspectShowPack, type ApplyMode } from '../lib/showpack/import';
  import { blend, lookOf, sanitizeLook, VISUAL, type Look, type Scene, type Visual } from '../lib/settings';
  import { addBank, loadBanks, MAX_BANKS, removeBank, renameBank, saveBanks, stepBank, usedScenes, type Banks } from '../lib/banks';
  import { FACTORY_PRESETS, presetLook, presetsByStyle, STYLES } from '../lib/presets';

  let { vs = $bindable(), beatInfo, onstatus }: {
    vs: Visual;
    beatInfo: () => { bpm: number; ph: number } | null;
    onstatus: (s: string) => void;
  } = $props();

  // Bancos (DK-041): os 8 pads mostram o banco ativo; recall, gravar, renomear, MIDI c:0..7 e o roteiro agem nele.
  let bk = $state<Banks>(loadBanks());
  const scenes = $derived(bk.banks[bk.active].scenes);
  const bank = $derived(bk.banks[bk.active]);
  let editingBank = $state(false);
  let active = $state(-1);
  let fade = $state(0);
  let editing = $state(-1);
  let trans = $state(storeLoad('doublek.trans', (r) => { if (![0, 1, 2, 4, 8].includes(r as number)) throw new Error('transição'); return r as number; }, () => 4));
  let token = 0;

  $effect(() => saveBanks($state.snapshot(bk)));
  $effect(() => storeSave('doublek.trans', trans));

  /** Chama a cena i: começa no próximo beat e dura `fade` beats. O roteiro já dispara no beat (`now`). */
  export function recall(i: number, fade = trans, now = false) {
    const sc = scenes[i];
    if (!sc) return;
    active = i;
    const b = beatInfo();
    const beatMs = b?.bpm ? 60000 / b.bpm : 500;
    const wait = b?.bpm && fade && !now ? (1 - b.ph) * beatMs : 0;
    const dur = fade * beatMs, id = ++token;
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

  export const sceneNames = () => scenes.map((s, i) => s?.name ?? `Cena ${i + 1}`);

  function setBanks(b: Banks, msg: string) {
    bk = b;
    active = -1;
    editing = -1;
    onstatus(msg);
  }
  /** Banco anterior/seguinte (‹ ›, teclas [ ], MIDI a:bank-/a:bank+). Dá a volta. */
  export function stepBankBy(d: number) {
    if (bk.banks.length < 2) return onstatus('Só há um banco. Crie outro com "+".');
    const b = stepBank($state.snapshot(bk), d);
    setBanks(b, `Banco ${b.active + 1}/${b.banks.length}: ${b.banks[b.active].name}`);
  }
  function newBank() {
    const b = addBank($state.snapshot(bk));
    if (b !== bk) setBanks(b, `Banco ${b.active + 1} criado, vazio: grave cenas nos pads.`);
  }
  function dropBank() {
    const n = usedScenes(bank);
    if (n && !confirm(`Apagar o banco "${bank.name}" e as ${n} cena(s) gravadas nele?`)) return;
    const name = bank.name;
    setBanks(removeBank($state.snapshot(bk), bk.active), `Banco "${name}" apagado.`);
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
      const bad = checkFile('json', f);
      if (bad) throw new Error(bad);
      const d = JSON.parse(await f.text());
      if (d?.app !== 'doublek') throw new Error('não é um preset do DoubleK');
      const base = lookOf(VISUAL);
      if (Array.isArray(d.scenes) && d.scenes.length === 8) {
        bk.banks[bk.active].scenes = d.scenes.map((s: any, i: number): Scene =>
          s && typeof s === 'object' ? { name: String(s.name ?? `Cena ${i + 1}`).slice(0, 24), look: { ...base, ...sanitizeLook(s.look) } as Look } : null);
      }
      Object.assign(vs, sanitizeLook(d.look));
      onstatus('Preset carregado: ' + f.name);
    } catch (e) {
      onstatus('Não consegui ler o preset: ' + (e as Error).message);
    }
  }

  // Show Pack (DK-014): um arquivo .doublekshow com visual, cenas, roteiros, logo, foto, vídeos e (opcional) MIDI.
  let busy = $state(false);
  const appVersion = async () => (await getVersion().catch(() => null)) || 'desconhecida';
  const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function saveShow() {
    const name = prompt('Nome do show:', `Show ${new Date().toLocaleDateString('pt-BR')}`)?.trim();
    if (!name) return;
    const withMidi = Object.keys(midi.map).length > 0 && confirm('Incluir o mapeamento MIDI no arquivo?');
    busy = true;
    onstatus('Salvando o show…');
    try {
      const { bytes, manifest } = await collectShowPack({ name, appVersion: await appVersion(), midi: withMidi ? $state.snapshot(midi.map) : null });
      downloadShowPack(bytes, name);
      onstatus(`Show salvo: ${showPackFileName(name)} (${manifest.assets.length} arquivo(s) de mídia, ${bytes.length < 1 << 20 ? Math.ceil(bytes.length / 1024) + ' KB' : fmtMB(bytes.length) + ' MB'}). Músicas dos roteiros não vão no arquivo.`);
    } catch (e) {
      onstatus('Não consegui salvar o show: ' + err(e));
    } finally {
      busy = false;
    }
  }

  async function openShow(f: File | undefined) {
    if (!f) return;
    if (!/\.doublekshow$/i.test(f.name)) return onstatus(`"${f.name}" não é um show do DoubleK (.doublekshow).`);
    busy = true;
    onstatus('Conferindo o show…');
    try {
      const r = await inspectShowPack(new Uint8Array(await f.arrayBuffer()));
      if (!r.ok) return onstatus('Show não aberto: ' + r.error);
      const plan = r.plan, m = plan.manifest;
      const warn = plan.warnings.length ? '\n\nAvisos:\n• ' + plan.warnings.join('\n• ') : '';
      const head = `Abrir "${m.name}" (${m.assets.length} arquivo(s) de mídia, salvo no DoubleK ${m.appVersion}).${warn}`;
      let mode: ApplyMode;
      if (confirm(`${head}\n\nOK = SUBSTITUIR o show atual (um backup dele é salvo antes).\nCancelar = outras opções.`)) mode = 'replace';
      else if (confirm(`Importar "${m.name}" como NOVO?\n\nVídeos e roteiros do arquivo são somados aos atuais. Visual, transição e bancos de cenas são trocados (os atuais vão para o backup).\n\nCancelar = não abrir.`)) mode = 'new';
      else return onstatus('Abertura cancelada; nada mudou.');
      if (mode === 'new' && plan.assets.some((a) => a.entry.kind === 'logo' || a.entry.kind === 'bg')) plan.replaceLogoBg = confirm('Trocar a logo e a foto de fundo atuais pelas do arquivo?');
      if (plan.midi) plan.applyMidi = confirm('Aplicar o mapeamento MIDI do arquivo? Os controladores desta máquina podem ser diferentes.');

      let backup = '';
      const rep = await applyShowPack(plan, mode, importDeps({ name: '', appVersion: await appVersion(), midi: $state.snapshot(midi.map), onBackup: (p) => (backup = p) }));
      const text = `Show "${m.name}" aberto (${mode === 'replace' ? 'substituiu o anterior' : 'importado como novo'}: ${rep.videos} vídeo(s), ${rep.roteiros} roteiro(s)).`
        + (backup ? ` Backup do anterior: ${backup}.` : '') + (rep.warnings.length ? ' Avisos: ' + rep.warnings.join(' · ') : '');
      // O estado do controle (cenas, roteiros, vídeos, MIDI) foi carregado na abertura da janela: recarregar é o
      // jeito seguro de pegar tudo. O telão recarrega a logo/foto agora; o visual novo ele recebe quando o controle volta.
      try { sessionStorage.setItem('doublek.status', text); } catch {}
      await emitTo('output', 'assets').catch(() => {});
      location.reload();
    } catch (e) {
      onstatus('Show não aberto: ' + err(e)); // applyShowPack já desfez o que tinha gravado ("importação desfeita: …")
    } finally {
      busy = false;
    }
  }

  // Catálogo de fábrica (DK-131): nunca edita o preset; grava uma cópia num pad ou aplica no visual.
  let catalog = $state(false);
  let pick = $state(FACTORY_PRESETS[0].id);
  const byStyle = presetsByStyle();
  const picked = $derived(FACTORY_PRESETS.find((p) => p.id === pick)!);

  function applyPreset() {
    Object.assign(vs, presetLook(pick));
    onstatus('Preset aplicado: ' + picked.name);
  }

  /** Grava no pad ativo, senão no primeiro vazio; pad ocupado só com confirmação. */
  function savePreset() {
    let i = active >= 0 ? active : scenes.findIndex((s) => !s);
    if (i < 0) i = 0;
    if (scenes[i] && !confirm(`Gravar "${picked.name}" por cima da cena ${i + 1} (${scenes[i]!.name})?`)) return;
    scenes[i] = { name: picked.name.slice(0, 24), look: presetLook(pick) };
    active = i;
    onstatus(`Preset "${picked.name}" gravado na cena ${i + 1}.`);
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
    <div class="bankrow">
    <div class="bank" title="Banco de cenas · duplo clique no nome: renomear · [ e ]: trocar de banco">
      <small>Banco {bk.active + 1}/{bk.banks.length}</small>
      {#if editingBank}
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={bk.banks[bk.active].name} maxlength="24" autofocus
          onblur={() => { bk = renameBank($state.snapshot(bk), bk.active, bank.name); editingBank = false; }}
          onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span ondblclick={() => (editingBank = true)}>{bank.name}</span>
      {/if}
      <div class="bk">
        <button onclick={() => stepBankBy(-1)} title="Banco anterior ([)" use:learnable={{ id: 'a:bank-', label: 'Banco anterior' }}>‹</button>
        <button onclick={() => stepBankBy(1)} title="Banco seguinte (])" use:learnable={{ id: 'a:bank+', label: 'Banco seguinte' }}>›</button>
        <button onclick={newBank} disabled={bk.banks.length >= MAX_BANKS} title="Novo banco vazio (até {MAX_BANKS})">+</button>
        <button onclick={dropBank} disabled={bk.banks.length < 2} title="Apagar este banco">×</button>
      </div>
    </div>
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
      <button class:on={catalog} onclick={() => (catalog = !catalog)} title="Presets de fábrica por estilo">Catálogo</button>
      <button onclick={saveShow} disabled={busy} title="Salva o show inteiro num arquivo .doublekshow: visual, cenas, roteiros, logo, foto, vídeos e, se quiser, o MIDI">Salvar show</button>
      <label class="btn" class:disabled={busy} title="Abre um .doublekshow: confere tudo antes e faz backup do show atual">Abrir show<input type="file" accept=".doublekshow" disabled={busy} onchange={(e) => { openShow(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label>
    </div>
    {#if catalog}
      <div class="row">
        <select bind:value={pick} title={picked.description}>
          {#each Object.entries(byStyle) as [style, list]}
            {#if list.length}
              <optgroup label={STYLES[style as keyof typeof STYLES]}>
                {#each list as pr}<option value={pr.id}>{pr.name}</option>{/each}
              </optgroup>
            {/if}
          {/each}
        </select>
        <span class="desc">{picked.description}</span>
        <button onclick={applyPreset} title="Troca o visual atual, sem gravar em cena">Aplicar agora</button>
        <button onclick={savePreset} title="Grava uma cópia na cena ativa ou na primeira vazia">Gravar no pad</button>
      </div>
    {/if}
  </div>
</section>

<style>
  .perf { grid-column: 1 / -1; display: flex; gap: 18px; padding: 10px 14px; align-items: center; flex-wrap: wrap; }
  .knobs { display: flex; gap: 2px; flex-wrap: wrap; }
  .scenes { flex: 1; min-width: 420px; display: flex; flex-direction: column; gap: 8px; }
  .pads { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; flex: 1; min-width: 0; }
  .bankrow { display: flex; gap: 6px; }
  .bank { flex: none; width: 92px; height: 54px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 10px; display: flex; flex-direction: column; justify-content: space-between; background: rgba(124, 92, 255, .08); }
  .bank small { font-size: 10px; color: var(--muted); }
  .bank span { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
  .bank input { width: 100%; font-size: 12px; background: rgba(0,0,0,.4); border: 1px solid var(--accent); border-radius: 4px; padding: 0 4px; }
  .bk { display: flex; gap: 2px; }
  .bk button { flex: 1; min-width: 0; padding: 0 2px; font-size: 11px; line-height: 14px; border-radius: 5px; }
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
  .btn.disabled { opacity: .5; pointer-events: none; }
  .row select { padding: 4px 8px; font-size: 12px; }
  .desc { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
