<script lang="ts">
  import { invoke, Channel } from '@tauri-apps/api/core';
  import { emitTo, listen as onEvent } from '@tauri-apps/api/event';
  import Analyzer from './Analyzer.svelte';
  import Slider from './Slider.svelte';
  import { Renderer } from '../render/renderer';
  import { VISUAL, loadVisual, saveVisual } from '../lib/settings';
  import { assetSync, setAsset } from '../lib/assets';
  import type { Frame, Msg } from '../lib/types';

  const RANGES: Record<string, [number, number]> = {
    Psy: [135, 150],
    'Dark/Forest': [145, 185],
    'Hi-tech': [175, 220],
    Auto: [80, 220],
  };
  const DEFAULTS = { device: '', channel: 0, gain: 1, gate: 0.003, sens: 1.4, range: 'Psy', lock: false, needClick: true, monitor: 1 };
  const KEY = 'doublek.settings';
  const TABS = ['Áudio', 'Logo', 'Fundo', 'Efeitos', 'Saída'] as const;

  function load() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
  }

  let s = $state(load());
  let vs = $state(loadVisual());
  let tab = $state<(typeof TABS)[number]>('Áudio');
  let devices = $state<string[]>([]);
  let monitors = $state<{ name: string; width: number; height: number }[]>([]);
  let status = $state('Escolha a entrada de áudio e clique em Ouvir.');
  let frame = $state.raw<Frame | null>(null);
  let frameAt = 0;
  let kickAt = $state(-1e9);
  let beatNow = $state({ idx: 0, phase: 0 });
  let calUntil = $state(0);
  let calMax = 0;
  let fps = $state(0);
  let fpsAt = 0;
  let previewCanvas: HTMLCanvasElement;
  let preview: Renderer | null = null;
  let sync: ReturnType<typeof assetSync> | null = null;

  // ajustes de áudio → motor (e salvos)
  $effect(() => {
    const v = $state.snapshot(s);
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
    const [bpmMin, bpmMax] = RANGES[v.range] ?? RANGES.Auto;
    invoke('set_params', {
      params: { gain: v.gain, gate: v.gate, sens: v.sens, bpmMin, bpmMax, lock: v.lock, needClick: v.needClick },
    });
  });

  // ajustes visuais → telão + preview (e salvos)
  $effect(() => {
    const v = $state.snapshot(vs);
    saveVisual(v);
    emitTo('output', 'visual', v);
    preview?.setVisual({ ...v, renderScale: 0.5 });
    sync?.(v);
  });

  // preview: o mesmo renderer do telão, a 30 fps e meia resolução
  $effect(() => {
    preview = new Renderer(previewCanvas, { ...$state.snapshot(vs), renderScale: 0.5 });
    sync = assetSync(preview);
    sync($state.snapshot(vs), true);
    let raf = 0, odd = false;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if ((odd = !odd)) preview!.render(now);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  function onFrame(f: Frame) {
    frame = f;
    frameAt = performance.now();
    preview?.setFrame(f);
    if (f.kick > 0) kickAt = frameAt;
    if (calUntil) {
      if (frameAt < calUntil) calMax = Math.max(calMax, f.peak);
      else {
        calUntil = 0;
        s.gate = Math.min(0.2, +(calMax * 1.3).toFixed(4));
        status = `Ruído calibrado: corte em ${s.gate}. Pode soltar o som.`;
      }
    }
  }

  const ch = new Channel<Msg>();
  ch.onmessage = (m) => (m.t === 'frame' ? onFrame(m.v) : (status = m.v));
  invoke('subscribe', { onMsg: ch });

  const listen = () => invoke('start_input', { device: s.device || null, channel: +s.channel });
  const beat = (cmd: unknown) => invoke('beat', { cmd });

  invoke<string[]>('list_inputs').then((d) => {
    devices = d;
    if (s.device && d.includes(s.device)) listen();
  });
  invoke<typeof monitors>('list_monitors').then((m) => {
    monitors = m;
    if (s.monitor >= m.length) s.monitor = m.length - 1;
  });
  onEvent<number>('fps', (e) => { fps = e.payload; fpsAt = performance.now(); });

  async function project() {
    try { await invoke('open_output', { monitor: +s.monitor }); status = 'Projetando no ' + (monitors[s.monitor]?.name || 'monitor ' + (s.monitor + 1)); }
    catch (e) { status = 'Não consegui abrir a saída: ' + e; }
  }

  function calibrate() {
    calMax = 0;
    calUntil = performance.now() + 2500;
    status = 'Calibrando… deixe em silêncio por 2 segundos.';
  }

  async function pick(kind: 'logo' | 'bg', file: File | undefined | null) {
    if (!file || !file.type.startsWith('image/')) return;
    await setAsset(kind, file);
    sync?.($state.snapshot(vs), true);
    emitTo('output', 'assets');
  }

  async function clearBg() {
    await setAsset('bg', null);
    sync?.($state.snapshot(vs), true);
    emitTo('output', 'assets');
  }

  // fase do beat extrapolada entre frames → bolinhas do compasso suaves; fps some se a saída fechar
  $effect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (fps && performance.now() - fpsAt > 2500) fps = 0;
      const f = frame;
      if (!f || !f.bpm) return;
      const x = f.beatPhase + ((performance.now() - frameAt) / 1000) * (f.bpm / 60);
      beatNow = { idx: (((f.beat + Math.floor(x)) % 4) + 4) % 4, phase: x - Math.floor(x) };
    };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'SELECT' || (tag === 'INPUT' && (e.target as HTMLInputElement).type !== 'range' && (e.target as HTMLInputElement).type !== 'checkbox')) return;
    if (e.code === 'Space') { e.preventDefault(); beat('tap'); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); beat({ nudge: -0.005 }); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); beat({ nudge: 0.005 }); }
    else if (e.code === 'KeyB') vs.blackout = !vs.blackout;
  }

  const db = $derived(frame ? 20 * Math.log10(Math.max(frame.peak, 1e-5)) : -90);
  const clip = $derived(!!frame && frame.peak > 0.97);
  const tempoState = $derived(!frame?.bpm ? 'procurando' : frame.holding ? 'segurando (sem kick)' : frame.locked ? 'travado' : 'ajustando');
  const f2 = (v: number) => v.toFixed(2);
  const pct = (v: number) => Math.round(v * 100) + '%';
</script>

<svelte:window
  onkeydown={onKey}
  ondragover={(e) => e.preventDefault()}
  ondrop={(e) => { e.preventDefault(); pick('bg', e.dataTransfer?.files[0]); }}
/>

<main>
  <header class="panel bar">
    <div class="brand">DOUBLEK<span>visuals</span></div>

    <div class="group">
      <select bind:value={s.device} title="Entrada de áudio">
        <option value="">Entrada padrão do Windows</option>
        {#each devices as d}<option value={d}>{d}</option>{/each}
      </select>
      <select bind:value={s.channel} title="Canal">
        <option value={0}>L+R</option>
        {#each [1, 2, 3, 4, 5, 6, 7, 8] as c}<option value={c}>Canal {c}</option>{/each}
      </select>
      <button class="primary" onclick={listen}>Ouvir</button>
    </div>

    <div class="meter" class:clip title="Nível de entrada">
      <div class="fill" style:width="{Math.max(0, (db + 60) / 60) * 100}%"></div>
      <span>{clip ? 'CLIP' : db > -60 ? db.toFixed(0) + ' dB' : '—'}</span>
    </div>

    <div class="tempo">
      <div class="bpm" class:locked={frame?.locked}>{frame?.bpm ? frame.bpm.toFixed(1) : '---.-'}</div>
      <div class="tstate">
        <span>BPM · {tempoState}</span>
        <div class="dots">
          {#each [0, 1, 2, 3] as i}
            <i class:on={frame?.bpm && beatNow.idx === i} style:opacity={frame?.bpm && beatNow.idx === i ? 1 - beatNow.phase * 0.7 : 1}></i>
          {/each}
        </div>
      </div>
    </div>

    <div class="group">
      <button onclick={() => beat('tap')} title="Espaço">TAP</button>
      <button onclick={() => beat('half')} title="Metade do BPM">½</button>
      <button onclick={() => beat('double')} title="Dobro do BPM">×2</button>
      <button onclick={() => beat({ nudge: -0.005 })} title="Adiantar 5 ms (←)">◀</button>
      <button onclick={() => beat({ nudge: 0.005 })} title="Atrasar 5 ms (→)">▶</button>
    </div>

    <div class="group">
      <span class="fps" class:live={fps > 0}>{fps ? `TELÃO ${fps} fps` : 'telão fechado'}</span>
      <button class="black" class:on={vs.blackout} onclick={() => (vs.blackout = !vs.blackout)} title="B">BLACKOUT</button>
    </div>
  </header>

  <section class="left">
    <div class="panel previewBox">
      <canvas bind:this={previewCanvas}></canvas>
      <span class="tag">PREVIEW</span>
    </div>
    <div class="panel analyzer">
      <Analyzer {frame} {kickAt} />
    </div>
  </section>

  <aside class="panel side">
    <nav class="tabs">
      {#each TABS as t}<button class:on={tab === t} onclick={() => (tab = t)}>{t}</button>{/each}
    </nav>

    <div class="tabBody">
      {#if tab === 'Áudio'}
        <h2>Entrada</h2>
        <Slider label="Ganho" bind:value={s.gain} min={0.25} max={40} step={0.25} def={1} fmt={(v) => v.toFixed(2) + '×'} />
        <Slider label="Corte de ruído" bind:value={s.gate} min={0} max={0.2} step={0.001} def={0.003} fmt={(v) => v.toFixed(3)} />
        <button class="wide" onclick={calibrate} disabled={!!calUntil}>
          {calUntil ? 'Calibrando…' : 'Calibrar ruído (2 s de silêncio)'}
        </button>

        <h2>Detecção de kick</h2>
        <Slider label="Sensibilidade" bind:value={s.sens} min={0.5} max={3} step={0.05} def={1.4} fmt={(v) => v.toFixed(2) + '×'} />
        <label class="check">
          <input type="checkbox" bind:checked={s.needClick} />
          <span>Exigir o "click" do kick <small>ignora o baixo rolante; desligue se usar microfone longe da caixa</small></span>
        </label>

        <h2>Andamento</h2>
        <div class="seg">
          {#each Object.entries(RANGES) as [name, [lo, hi]]}
            <button class:on={s.range === name} onclick={() => (s.range = name)}>{name}<small>{lo}–{hi}</small></button>
          {/each}
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={s.lock} />
          <span>Travar BPM <small>só a fase se ajusta aos kicks</small></span>
        </label>
        <p class="keys">Espaço = tap · ← → = ajuste fino da fase · B = blackout</p>

      {:else if tab === 'Logo'}
        <div class="files">
          <label class="btn">Escolher logo<input type="file" accept="image/*" onchange={(e) => pick('logo', e.currentTarget.files?.[0])} /></label>
          <label class="color">Cor do brilho <input type="color" bind:value={vs.color} /></label>
        </div>
        <Slider label="Tamanho" bind:value={vs.size} min={10} max={150} step={1} def={VISUAL.size} fmt={(v) => v + '%'} />
        <Slider label="Pulso no kick" bind:value={vs.amount} min={0} max={1.5} step={0.01} def={VISUAL.amount} fmt={f2} />
        <Slider label="Brilho (glow)" bind:value={vs.glow} min={0} max={1} step={0.01} def={VISUAL.glow} fmt={f2} />
        <Slider label="Aberração cromática" bind:value={vs.chroma} min={0} max={40} step={0.5} def={VISUAL.chroma} fmt={(v) => v + ' px'} />
        <label class="check">
          <input type="checkbox" bind:checked={vs.rmWhite} />
          <span>Remover fundo branco da logo</span>
        </label>
        {#if vs.rmWhite}
          <Slider label="Tolerância do branco" bind:value={vs.white} min={200} max={254} step={1} def={VISUAL.white} />
        {/if}
        <h2>Reação</h2>
        <Slider label="Duração do pulso" bind:value={vs.rel} min={0.03} max={0.5} step={0.01} def={VISUAL.rel} fmt={(v) => v.toFixed(2) + ' s'} />
        <Slider label="Seguir a música sem kick" bind:value={vs.wave} min={0} max={1} step={0.01} def={VISUAL.wave} fmt={f2} />

      {:else if tab === 'Fundo'}
        <div class="files">
          <label class="btn">Foto de fundo<input type="file" accept="image/*" onchange={(e) => pick('bg', e.currentTarget.files?.[0])} /></label>
          <button onclick={clearBg}>Remover foto</button>
        </div>
        <div class="files">
          <label class="color">Cor 1 <input type="color" bind:value={vs.bgc1} /></label>
          <label class="color">Cor 2 <input type="color" bind:value={vs.bgc2} /></label>
          <label class="check inline"><input type="checkbox" bind:checked={vs.bgGrad} /> Degradê</label>
        </div>
        {#if vs.bgGrad}
          <Slider label="Ângulo do degradê" bind:value={vs.bgAngle} min={0} max={360} step={1} def={VISUAL.bgAngle} fmt={(v) => v + '°'} />
        {/if}
        <div class="seg two">
          <button class:on={vs.bgFit === 'cover'} onclick={() => (vs.bgFit = 'cover')}>Preencher</button>
          <button class:on={vs.bgFit === 'contain'} onclick={() => (vs.bgFit = 'contain')}>Caber inteira</button>
        </div>
        <Slider label="Opacidade da foto" bind:value={vs.bgOpacity} min={0} max={1} step={0.01} def={1} fmt={pct} />
        <Slider label="Desfoque da foto" bind:value={vs.bgBlur} min={0} max={40} step={1} def={0} fmt={(v) => v + ' px'} />
        <Slider label="Brilho da foto" bind:value={vs.bgDim} min={0} max={150} step={1} def={100} fmt={(v) => v + '%'} />
        <Slider label="Girar matiz" bind:value={vs.bgHue} min={-180} max={180} step={1} def={0} fmt={(v) => v + '°/s'} />
        <Slider label="Zoom na batida" bind:value={vs.bgPulse} min={0} max={0.4} step={0.01} def={VISUAL.bgPulse} fmt={f2} />
        <Slider label="Brilho na batida" bind:value={vs.bgFlash} min={0} max={1} step={0.01} def={VISUAL.bgFlash} fmt={f2} />

      {:else if tab === 'Efeitos'}
        <Slider label="Flash na batida" bind:value={vs.fxFlash} min={0} max={1} step={0.01} def={VISUAL.fxFlash} fmt={f2} />
        <Slider label="Anéis a cada kick" bind:value={vs.fxRings} min={0} max={1} step={0.01} def={VISUAL.fxRings} fmt={f2} />
        <Slider label="Espectro em barras" bind:value={vs.fxBars} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Espectro radial na logo" bind:value={vs.fxRadial} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <h2>Rastro / túnel</h2>
        <Slider label="Rastro" bind:value={vs.trail} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Zoom do rastro" bind:value={vs.trailZoom} min={-1} max={1} step={0.01} def={VISUAL.trailZoom} fmt={f2} />
        <Slider label="Giro do rastro" bind:value={vs.trailRot} min={-1} max={1} step={0.01} def={0} fmt={f2} />
        <h2>Strobe</h2>
        <Slider label="Intensidade" bind:value={vs.strobe} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <div class="seg four">
          {#each [[1, '1/1'], [2, '1/2'], [4, '1/4']] as [d, l]}
            <button class:on={vs.strobeDiv === d} onclick={() => (vs.strobeDiv = d as number)}>{l}</button>
          {/each}
        </div>
        <h2>Tela</h2>
        <Slider label="Vinheta" bind:value={vs.fxVig} min={0} max={1} step={0.01} def={VISUAL.fxVig} fmt={f2} />
        <Slider label="Linhas de TV" bind:value={vs.fxScan} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Granulado" bind:value={vs.fxGrain} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Tremor no kick" bind:value={vs.fxShake} min={0} max={30} step={1} def={0} fmt={(v) => v + ' px'} />

      {:else}
        <h2>Telão</h2>
        <select class="wide" bind:value={s.monitor}>
          {#each monitors as m, i}<option value={i}>{i + 1}. {m.name || 'Monitor'} — {m.width}×{m.height}</option>{/each}
        </select>
        <div class="files">
          <button class="primary" onclick={project}>Projetar</button>
          <button onclick={() => invoke('close_output')}>Fechar telão</button>
        </div>
        <p class="keys">No telão: Esc fecha.</p>
        <h2>Sincronia</h2>
        <label class="check">
          <input type="checkbox" bind:checked={vs.predict} />
          <span>Pulsar pelo relógio do beat <small>com o BPM travado, o pulso é previsto e pode ser adiantado</small></span>
        </label>
        <Slider label="Offset visual" bind:value={vs.offset} min={-150} max={50} step={1} def={VISUAL.offset} fmt={(v) => v + ' ms'} />
        <p class="keys">Negativo = adianta o pulso para compensar o atraso do projetor. Ajuste até o pulso cair junto com o kick que você ouve.</p>
        <h2>Desempenho</h2>
        <Slider label="Resolução de render" bind:value={vs.renderScale} min={0.4} max={1} step={0.05} def={1} fmt={pct} />
        <p class="keys">Abaixe se o telão cair de 60 fps.</p>
      {/if}
    </div>
  </aside>

  <footer class="status">{status}</footer>
</main>

<style>
  main {
    height: 100vh;
    display: grid;
    grid-template-columns: 1fr 320px;
    grid-template-rows: auto 1fr auto;
    gap: 12px;
    padding: 12px;
  }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    backdrop-filter: blur(20px);
  }
  .bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 10px 14px; flex-wrap: wrap; }
  .brand { font-weight: 800; letter-spacing: 0.18em; font-size: 14px; }
  .brand span { font-weight: 400; letter-spacing: 0.05em; color: var(--muted); margin-left: 6px; }
  .group { display: flex; gap: 6px; align-items: center; }
  .group select:first-child { max-width: 240px; }
  .primary { background: var(--accent); border-color: var(--accent); font-weight: 600; }
  .black { font-weight: 700; letter-spacing: .06em; }
  .black.on { background: var(--clip); border-color: var(--clip); }
  .fps { font-size: 11px; color: var(--muted); }
  .fps.live { color: var(--ok); }

  .meter { position: relative; width: 140px; height: 26px; border-radius: 8px; background: rgba(255,255,255,.06); overflow: hidden; }
  .meter .fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, var(--ok), #c6f24e); transition: width 60ms linear; }
  .meter.clip .fill { background: var(--clip); }
  .meter span { position: relative; display: block; text-align: center; line-height: 26px; font-size: 12px; font-weight: 600; text-shadow: 0 1px 2px #000; }

  .tempo { display: flex; align-items: center; gap: 10px; margin-left: auto; }
  .bpm { font-size: 30px; font-weight: 700; line-height: 1; color: var(--muted); transition: color .2s; min-width: 92px; text-align: right; }
  .bpm.locked { color: var(--text); text-shadow: 0 0 18px rgba(124,92,255,.6); }
  .tstate { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--muted); }
  .dots { display: flex; gap: 6px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; background: rgba(255,255,255,.1); }
  .dots i.on { background: var(--kick); box-shadow: 0 0 10px var(--kick); }
  .dots i:first-child { border: 1px solid rgba(255,255,255,.3); }

  .left { display: grid; grid-template-rows: auto 1fr; gap: 12px; min-height: 0; }
  .previewBox { position: relative; aspect-ratio: 16 / 9; max-height: 52vh; overflow: hidden; justify-self: center; width: 100%; max-width: calc(52vh * 16 / 9); }
  .previewBox canvas { width: 100%; height: 100%; display: block; border-radius: var(--radius); }
  .tag { position: absolute; top: 10px; left: 12px; font-size: 10px; letter-spacing: .14em; color: rgba(255,255,255,.55); }
  .analyzer { padding: 12px; min-height: 160px; }

  .side { display: flex; flex-direction: column; min-height: 0; }
  .tabs { display: flex; gap: 2px; padding: 8px; border-bottom: 1px solid var(--line); }
  .tabs button { flex: 1; padding: 6px 0; font-size: 12px; background: transparent; border-color: transparent; color: var(--muted); }
  .tabs button.on { background: rgba(255,255,255,.08); color: var(--text); border-color: var(--line); }
  .tabBody { padding: 4px 16px 16px; overflow: auto; }
  h2 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); margin: 18px 0 2px; font-weight: 600; }
  .wide { width: 100%; margin-top: 6px; }
  .wide:disabled { opacity: .6; cursor: default; }
  .check { display: flex; gap: 10px; align-items: flex-start; margin: 12px 0 4px; cursor: pointer; }
  .check.inline { margin: 0; align-items: center; gap: 6px; }
  .check input { accent-color: var(--accent); margin-top: 3px; }
  .check small, .seg small { display: block; color: var(--muted); font-size: 11px; }
  .seg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
  .seg.four { grid-template-columns: repeat(3, 1fr); }
  .seg button { text-align: left; }
  .seg.two button, .seg.four button { text-align: center; }
  .files { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
  .btn { background: rgba(255,255,255,.06); border: 1px solid var(--line); border-radius: 10px; padding: 7px 12px; cursor: pointer; }
  .btn:hover { background: rgba(255,255,255,.1); }
  .btn input { display: none; }
  .color { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .color input { width: 34px; height: 26px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; cursor: pointer; }
  .keys { color: var(--muted); font-size: 11px; margin-top: 12px; }
  .status { grid-column: 1 / -1; color: var(--muted); font-size: 12px; padding: 0 4px; }
</style>
