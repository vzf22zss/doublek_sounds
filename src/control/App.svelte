<script lang="ts">
  import { invoke, Channel } from '@tauri-apps/api/core';
  import { emitTo, listen as onEvent } from '@tauri-apps/api/event';
  import Analyzer from './Analyzer.svelte';
  import Slider from './Slider.svelte';
  import PsyEffects from './PsyEffects.svelte';
  import Performance from './Performance.svelte';
  import Timeline from './Timeline.svelte';
  import RoteiroPanel from './RoteiroPanel.svelte';
  import { rt, toggleSound, attach as attachRoteiro, tick as roteiroTick, play as roteiroPlay, stop as roteiroStop, pause as roteiroPause, nudge as roteiroNudge } from './roteiro.svelte';
  import { saveRoteiros } from '../lib/roteiro';
  import { midi, keyOf, bindArmed, clearArmed, keyLabel, learnable, type MidiMsg } from './midi.svelte';
  import { Renderer } from '../render/renderer';
  import { VISUAL, loadVisual, saveVisual } from '../lib/settings';
  import { SAFE_LOOK, strobeRate } from '../lib/safety';
  import { createDispatcher, fromTarget, startMacro, type Handlers, type MacroId, type MacroRun, type ShowCommand, type Source } from '../lib/commands';
  import { addVideo, assetSync, imageColors, listVideos, removeVideo, setAsset, videoColors } from '../lib/assets';
  import { load as storeLoad, save as storeSave, shaped } from '../lib/store';
  import { getVersion } from '@tauri-apps/api/app';
  import { captureErrors, log, logEntries, NO_TELEMETRY, type Telemetry } from '../lib/telemetry';
  import { checkFile, EXT, ext } from '../lib/limits';
  import type { Frame, Msg } from '../lib/types';
  import { check, type Update } from '@tauri-apps/plugin-updater';
  import { relaunch } from '@tauri-apps/plugin-process';

  const RANGES: Record<string, [number, number]> = {
    Psy: [135, 150],
    'Dark/Forest': [145, 185],
    'Hi-tech': [175, 220],
    Auto: [80, 220],
  };
  const DEFAULTS = { device: '', channel: 0, gain: 1, gate: 0.003, sens: 1.4, range: 'Psy', lock: false, needClick: true, monitor: 1, dropThr: 0.35 };
  const TABS = ['Áudio', 'Logo', 'Fundo', 'Efeitos', 'Saída', 'Roteiro'] as const;

  const load = () => storeLoad('doublek.settings', (r) => shaped(r, DEFAULTS), () => ({ ...DEFAULTS }));

  let s = $state(load());
  let vs = $state(loadVisual());
  let tab = $state<(typeof TABS)[number]>('Áudio');
  let devices = $state<string[]>([]);
  let monitors = $state<{ name: string; width: number; height: number }[]>([]);
  // resultado de "Abrir show" (DK-014): a janela recarrega depois de importar; a mensagem atravessa o reload
  let carried: string | null = null;
  try { carried = sessionStorage.getItem('doublek.status'); sessionStorage.removeItem('doublek.status'); } catch {}
  let status = $state(carried ?? 'Escolha a entrada de áudio e clique em Ouvir.');
  let frame = $state.raw<Frame | null>(null);
  let frameAt = 0;
  let kickAt = $state(-1e9);
  let beatNow = $state({ idx: 0, phase: 0 });
  let calUntil = $state(0);
  let calMax = 0;
  let fps = $state(0);
  let fpsAt = 0;
  // saúde do show (DK-003): o que o operador precisa ver sem abrir nada
  let tel = $state<Telemetry>(NO_TELEMETRY);
  let audioLost = $state(false); // o motor avisou que a entrada/saída caiu
  let audioOk = $state(false);   // frames chegando há menos de 1,5 s (recalculado a cada quadro)
  let uiGap = 0;                 // maior intervalo entre quadros da janela de controle no último segundo (ms)
  let uiGapMax = 0, uiGapAt = 0;
  captureErrors();
  let previewCanvas: HTMLCanvasElement;
  let preview: Renderer | null = null;
  let sync: ReturnType<typeof assetSync> | null = null;
  let perf: ReturnType<typeof Performance>;
  let midiLit = $state(false);

  // ---------- atualização (Releases do GitHub) ----------
  // Só avisa ao abrir; instalar é sempre um clique, e nunca com o telão aberto (o app reinicia).
  let upd = $state.raw<Update | null>(null);
  let updPct = $state(-1);
  check().then((u) => (upd = u)).catch(() => {}); // sem internet ou sem release: segue a vida

  async function installUpdate() {
    if (!upd || fps) return;
    let total = 0, got = 0;
    updPct = 0;
    try {
      await upd.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress') { got += e.data.chunkLength; updPct = total ? Math.round((got / total) * 100) : 0; }
      });
      await relaunch();
    } catch (e) {
      updPct = -1;
      status = 'Não consegui atualizar: ' + e;
    }
  }

  // ajustes de áudio → motor (e salvos)
  $effect(() => {
    const v = $state.snapshot(s);
    storeSave('doublek.settings', v);
    const [bpmMin, bpmMax] = RANGES[v.range] ?? RANGES.Auto;
    invoke('set_params', {
      params: { gain: v.gain, gate: v.gate, sens: v.sens, bpmMin, bpmMax, lock: v.lock, needClick: v.needClick, dropThr: v.dropThr },
    });
  });

  // ajustes visuais → telão + preview (e salvos)
  $effect(() => {
    const v = $state.snapshot(vs);
    saveVisual(v);
    document.documentElement.style.setProperty('--accent', v.color);
    // texto em cima da cor de destaque: escuro se ela for clara (ex.: lima), branco se for escura
    const n = parseInt(v.color.slice(1), 16), lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    document.documentElement.style.setProperty('--accent-ink', lum > 160 ? '#111' : '#fff');
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
  ch.onmessage = (m) => {
    if (m.t === 'frame') { audioLost = false; return onFrame(m.v); }
    status = carried ? `${m.v} · ${carried}` : m.v; // o 1º status do motor não apaga o resultado do "Abrir show"
    carried = null;
    const lost = /perdida|não encontrada|Nenhuma (entrada|saída)|não suportado/i.test(m.v);
    audioLost = lost;
    log(lost ? 'warn' : 'info', 'motor: ' + m.v);
    if (m.v === 'Fim da faixa') roteiroPause();
  };
  invoke('subscribe', { onMsg: ch });

  const listen = () => invoke('start_input', { device: s.device || null, channel: +s.channel });
  const beat = (cmd: unknown) => invoke('beat', { cmd });

  // ---------- comandos (DK-042 / ADR 0003) ----------
  // Teclado, MIDI, botões e roteiro passam todos por `dispatch(cmd, fonte)`: validação, fontes de rede recusadas,
  // BLACKOUT/PÂNICO na frente, override manual (automação espera 8 s depois de o DJ mexer) e histórico no Diagnóstico.
  const handlers: Handlers = {
    TAP: () => beat('tap'),
    TEMPO_HALF: () => beat('half'),
    TEMPO_DOUBLE: () => beat('double'),
    NUDGE: (c) => beat({ nudge: c.ms / 1000 }),
    BLACKOUT: (c) => (vs.blackout = c.on ?? !vs.blackout),
    LOGO_ONLY: (c) => (vs.logoOnly = c.on ?? !vs.logoOnly),
    // PÂNICO: para o roteiro e as macros e volta a um visual calmo na hora; separado do BLACKOUT, que só apaga
    PANIC: () => {
      stopMacro();
      roteiroStop();
      Object.assign(vs, SAFE_LOOK, { blackout: false, logoOnly: false, react: true, safeFlash: true });
      status = 'PÂNICO: roteiro parado, strobe/flash/tremor/aberração/rastro zerados.';
      log('warn', status);
    },
    SCENE_RECALL: (c) => { stopMacro(); perf.recall(c.index, c.fade, c.now); },
    SCENE_SAVE: (c) => perf.saveScene(c.index),
    BANK_STEP: (c) => perf.stepBankBy(c.delta), // DK-041: os pads c:0..7 agem no banco ativo
    BANK_SET: (c) => perf.setBank(c.index),
    SET_PARAMETER: (c) => ((vs as any)[c.key] = c.value),
    ROTEIRO_GO: () => (rt.running && rt.source === 'app' ? roteiroPause() : roteiroPlay()),
    ROTEIRO_STOP: () => roteiroStop(),
    ROTEIRO_NUDGE: (c) => roteiroNudge(c.beats),
    ROTEIRO_AB: () => toggleSound(),
    MACRO: (c) => runMacro(c.id),
    // AUTOMATION_MODE: sem handler até existir automação (DK-030/040); o dispatcher responde "sem efeito"
  };
  const commands = createDispatcher(handlers);
  /** Entrada única de comandos. Recusa de quem está operando vai para a linha de status; do roteiro, para o diário. */
  function dispatch(c: ShowCommand, source: Source) {
    const r = commands.dispatch(c, source);
    if (!r.ok) {
      if (source === 'roteiro' || source === 'automation') log('warn', `comando ${c.type} (${source}) recusado: ${r.reason}`);
      else status = 'Comando recusado: ' + r.reason;
    }
    return r;
  }
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as any).__dispatch = dispatch; // testes no mock (só no `vite` de desenvolvimento)

  // ---------- macros: curvas puras em lib/commands; aqui só aplica a cada quadro, no tempo do BPM ----------
  let macroId = $state<MacroId | null>(null);
  let macroRun: MacroRun | null = null, macroT0 = 0, macroBpm = 120, macroRaf = 0;
  function stopMacro() {
    cancelAnimationFrame(macroRaf);
    macroRun = null;
    macroId = null;
  }
  function runMacro(id: MacroId) {
    stopMacro();
    if (id === 'RESET') { // = PÂNICO sem parar o roteiro
      Object.assign(vs, SAFE_LOOK, { blackout: false, logoOnly: false, safeFlash: true });
      status = 'RESET: strobe/flash/tremor/aberração/rastro zerados; o roteiro continua.';
      return;
    }
    macroRun = startMacro(id, $state.snapshot(vs) as unknown as Record<string, number>, vs.safeFlash);
    macroId = id;
    macroT0 = performance.now();
    macroBpm = frame?.bpm || 120; // sem BPM ao vivo: 120
    const step = () => {
      if (!macroRun) return;
      const r = macroRun.update(((performance.now() - macroT0) / 1000) * (macroBpm / 60));
      Object.assign(vs, r.set);
      if (r.done) stopMacro();
      else macroRaf = requestAnimationFrame(step);
    };
    step();
  }

  // ---------- roteiro ----------
  attachRoteiro({
    vs: () => vs,
    // cenas do roteiro passam pelo dispatcher (fonte 'roteiro'); efeitos, vídeo e knobs ainda escrevem em `vs` direto
    recall: (i, fade, now) => void dispatch({ type: 'SCENE_RECALL', index: i, fade: Math.min(32, Math.max(0, fade)), now }, 'roteiro'),
    status: (m) => (status = m),
    listen: () => listen(),
    range: () => RANGES[s.range] ?? RANGES.Auto,
  });
  $effect(() => saveRoteiros($state.snapshot(rt.list)));

  // ---------- MIDI ----------
  const lastVal = new Map<string, number>();

  function onMidi(m: MidiMsg) {
    const key = keyOf(m), prev = lastVal.get(key) ?? 0;
    lastVal.set(key, m.val);
    midi.activity = performance.now();
    if (midi.learning) {
      if (midi.armed && m.val > 0) {
        const t = bindArmed(key);
        status = `MIDI: ${keyLabel(key)} → ${t?.label}`;
      }
      return;
    }
    const t = midi.map[key];
    if (!t) return;
    // mapas salvos antes do dispatcher (a:<ação>, v:<ajuste>, c:<pad>) seguem valendo: fromTarget converte
    if (t.id.startsWith('v:')) {
      const c = m.kind === 'cc' ? fromTarget(t, m.val) : null;
      if (c) dispatch(c, 'midi');
      return;
    }
    // botões: nota = ao apertar; CC = quando passa de 63 (controladores mandam 127 ao apertar e 0 ao soltar)
    const press = m.kind === 'note' ? m.val > 0 : m.val > 63 && prev <= 63;
    const c = press ? fromTarget(t) : null;
    if (c) dispatch(c, 'midi');
  }

  invoke<string[]>('midi_devices').then((d) => (midi.devices = d));
  onEvent<string[]>('midi-devices', (e) => {
    midi.devices = e.payload;
    status = e.payload.length ? 'MIDI: ' + e.payload.join(' · ') : 'Nenhum controlador MIDI conectado.';
    log('info', status);
  });
  onEvent<MidiMsg>('midi', (e) => onMidi(e.payload));

  function toggleLearn() {
    midi.learning = !midi.learning;
    midi.armed = null;
  }

  invoke<string[]>('list_inputs').then((d) => {
    devices = d;
    if (s.device && d.includes(s.device)) listen();
  });
  invoke<typeof monitors>('list_monitors').then((m) => {
    monitors = m;
    if (s.monitor >= m.length) s.monitor = m.length - 1;
  });
  onEvent<Telemetry>('telemetry', (e) => {
    tel = e.payload;
    fps = e.payload.fps;
    fpsAt = performance.now();
    if (e.payload.lost) log('warn', 'telão: sem contexto WebGL');
    else if (e.payload.p95 > 25 && fpsAt - lastPerfWarn > 30000) { // no máximo 1 aviso a cada 30 s, senão o diário vira só isso
      lastPerfWarn = fpsAt;
      log('warn', `telão: p95 ${e.payload.p95} ms, ${e.payload.drops} quadros perdidos`);
    }
  });
  let lastPerfWarn = -1e9;
  onEvent<{ level: 'warn' | 'error'; msg: string }>('output-log', (e) => { log(e.payload.level, e.payload.msg); if (e.payload.level === 'error') status = e.payload.msg; });

  /** JSON com versões, ajustes, estatísticas e os últimos eventos. Sem áudio, sem arquivos. */
  async function diagnostics() {
    const mem = (performance as any).memory;
    const data = {
      app: await getVersion().catch(() => '?'), when: new Date().toISOString(), userAgent: navigator.userAgent,
      screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio }, monitors,
      audio: { ...$state.snapshot(s), lost: audioLost, lastFrameAgeMs: frame ? Math.round(performance.now() - frameAt) : null, bpm: frame?.bpm, locked: frame?.locked },
      midi: { devices: $state.snapshot(midi.devices), mapped: Object.keys(midi.map).length },
      output: { ...$state.snapshot(tel), open: fps > 0 },
      control: { maxFrameGapMs: Math.round(uiGap), jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null },
      visual: $state.snapshot(vs), roteiro: rt.cur ? { name: rt.list.find((r) => r.id === rt.cur)?.name, running: rt.running, mode: rt.mode, source: rt.source } : null,
      commands: commands.history(),
      log: logEntries(),
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `doublek-diagnostico-${data.when.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    status = 'Diagnóstico salvo (sem áudio).';
  }

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
    if (!file) return;
    const isVideo = kind === 'bg' && (file.type.startsWith('video/') || (EXT.video as readonly string[]).includes(ext(file.name)));
    const bad = checkFile(isVideo ? 'video' : 'image', file);
    if (bad) { status = `Não aceitei "${file.name}": ${bad}.`; log('warn', status); return; }
    if (isVideo) {
      status = 'Guardando o vídeo…';
      vs.bgVideo = await addVideo(file);
      videoList = listVideos();
      status = `Vídeo "${file.name}" no fundo.`;
      setTimeout(() => autoColors('bg'), 800); // espera o primeiro quadro
      return;
    }
    await setAsset(kind, file);
    sync?.($state.snapshot(vs), true);
    emitTo('output', 'assets');
    if (kind === 'bg') autoColors('bg');
  }

  /** Brilho/ondas/flash/espectro + cores do fundo tirados da foto ou da logo (na logo, liga o degradê). */
  async function autoColors(kind: 'logo' | 'bg') {
    const c = kind === 'bg' && vs.bgVideo ? await videoColors(vs.bgVideo) : await imageColors(kind);
    if (!c) { status = kind === 'bg' ? 'Escolha uma foto ou vídeo de fundo primeiro.' : 'Não achei cores na logo.'; return; }
    Object.assign(vs, c, kind === 'logo' ? { bgGrad: true } : {});
    status = `Cores ${kind === 'bg' ? 'do fundo' : 'da logo'}: brilho ${c.color}, fundo ${c.bgc1} → ${c.bgc2}.`;
  }

  let videoList = $state(listVideos());
  async function dropVideo(id: string) {
    if (vs.bgVideo === id) vs.bgVideo = '';
    await removeVideo(id);
    videoList = listVideos();
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
      const nowMs = performance.now();
      if (fps && nowMs - fpsAt > 2500) { fps = 0; tel = NO_TELEMETRY; }
      audioOk = !!frame && !audioLost && nowMs - frameAt < 1500;
      // engasgo da própria janela de controle (event loop): maior intervalo por segundo
      if (uiGapAt) uiGapMax = Math.max(uiGapMax, nowMs - uiGapAt);
      uiGapAt = nowMs;
      if (nowMs - fpsAt > 1000 && uiGapMax) { uiGap = uiGapMax; uiGapMax = 0; }
      midiLit = performance.now() - midi.activity < 120;
      const f = frame;
      roteiroTick(f, frameAt);
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
    if (e.code === 'Escape' && midi.learning) { toggleLearn(); return; }
    if (e.code === 'KeyF') { fps ? invoke('close_output') : project(); return; } // janela, não comando de show
    if (e.code === 'Space' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
    const c = keyCommand(e);
    if (c) dispatch(c, 'keyboard');
  }

  function keyCommand(e: KeyboardEvent): ShowCommand | null {
    if (e.code === 'Space') return { type: 'TAP' };
    if (e.code === 'ArrowLeft') return { type: 'NUDGE', ms: -5 };
    if (e.code === 'ArrowRight') return { type: 'NUDGE', ms: 5 };
    if (e.code === 'KeyB') return { type: 'BLACKOUT' };
    if (e.code === 'KeyL') return { type: 'LOGO_ONLY' };
    if (e.code === 'KeyP') return { type: 'PANIC' };
    if (/^Digit[1-8]$/.test(e.code)) return { type: 'SCENE_RECALL', index: +e.code.slice(5) - 1 };
    if (e.code === 'KeyG') return { type: e.shiftKey ? 'ROTEIRO_STOP' : 'ROTEIRO_GO' };
    if (e.code === 'KeyR') return { type: 'ROTEIRO_AB' };
    if (e.code === 'Comma') return { type: 'ROTEIRO_NUDGE', beats: -1 };
    if (e.code === 'Period') return { type: 'ROTEIRO_NUDGE', beats: 1 };
    if (e.code === 'Semicolon') return { type: 'ROTEIRO_NUDGE', beats: -4 };
    if (e.code === 'Quote') return { type: 'ROTEIRO_NUDGE', beats: 4 };
    // bancos: vale o caractere ([ e ] em qualquer layout, ex. ABNT2) e, se ele não for colchete, a posição física US
    if (e.key === '[' || (e.code === 'BracketLeft' && e.key !== ']')) return { type: 'BANK_STEP', delta: -1 };
    if (e.key === ']' || (e.code === 'BracketRight' && e.key !== '[')) return { type: 'BANK_STEP', delta: 1 };
    return null;
  }

  function beatInfo() {
    const f = frame;
    if (!f?.bpm) return null;
    const x = f.beatPhase + ((performance.now() - frameAt) / 1000) * (f.bpm / 60);
    return { bpm: f.bpm, ph: x - Math.floor(x) };
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
    <div class="brand">DOUBLEK</div>

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
          <span class="dropPill" class:on={!!frame?.low} title="Acende quando há grave (drop). Efeitos com o chip drop só aparecem com ela acesa.">DROP</span>
        </div>
      </div>
    </div>

    <div class="group">
      <button onclick={() => dispatch({ type: 'TAP' }, 'ui')} title="Espaço" use:learnable={{ id: 'a:tap', label: 'TAP' }}>TAP</button>
      <button onclick={() => dispatch({ type: 'TEMPO_HALF' }, 'ui')} title="Metade do BPM" use:learnable={{ id: 'a:half', label: '½ BPM' }}>½</button>
      <button onclick={() => dispatch({ type: 'TEMPO_DOUBLE' }, 'ui')} title="Dobro do BPM" use:learnable={{ id: 'a:double', label: '×2 BPM' }}>×2</button>
      <button onclick={() => dispatch({ type: 'NUDGE', ms: -5 }, 'ui')} title="Adiantar 5 ms (←)" use:learnable={{ id: 'a:nudge-', label: 'Adiantar fase' }}>◀</button>
      <button onclick={() => dispatch({ type: 'NUDGE', ms: 5 }, 'ui')} title="Atrasar 5 ms (→)" use:learnable={{ id: 'a:nudge+', label: 'Atrasar fase' }}>▶</button>
    </div>

    <div class="group">
      <div class="health" title="Saúde do show: áudio · BPM · MIDI · telão. Clique para salvar um diagnóstico (JSON, sem áudio).">
        <button onclick={diagnostics} aria-label="Saúde do show e diagnóstico">
          <i title="Áudio" class:ok={audioOk} class:bad={audioLost}></i>
          <i title="BPM" class:ok={frame?.locked} class:warn={!!frame?.bpm && !frame.locked}></i>
          <i title="MIDI" class:ok={midi.devices.length > 0}></i>
          <i title="Telão" class:ok={fps > 0 && tel.p95 < 25 && !tel.lost} class:warn={fps > 0 && tel.p95 >= 25} class:bad={tel.lost}></i>
          <b>{fps || '—'}</b>
        </button>
      </div>
      <button class="midiBtn" class:on={midi.learning} onclick={toggleLearn} title="MIDI learn: mapear controles do controlador">
        <i class:lit={midiLit}></i>MIDI
      </button>
      <button class="panic" onclick={() => dispatch({ type: 'PANIC' }, 'ui')} title="P: para o roteiro e zera strobe, flash, tremor, aberração e rastro (não apaga o telão)" use:learnable={{ id: 'a:panic', label: 'PÂNICO' }}>PÂNICO</button>
      <button class="black" class:on={vs.blackout} onclick={() => dispatch({ type: 'BLACKOUT' }, 'ui')} title="B" use:learnable={{ id: 'a:blackout', label: 'BLACKOUT' }}>BLACKOUT</button>
    </div>
  </header>

  {#if midi.learning}
    <div class="learnBar">
      <b>MIDI learn</b>
      <span>{midi.armed ? `“${midi.armed.label}” armado — mexa no knob ou aperte o pad do controlador` : 'Clique num controle da tela: knob, slider, cena, TAP, BLACKOUT…'}</span>
      <small>{midi.devices.length ? midi.devices.join(' · ') : 'nenhum controlador MIDI encontrado'}</small>
      {#if midi.armed}<button onclick={clearArmed}>Apagar mapeamento</button>{/if}
      <button class="primary" onclick={toggleLearn}>Concluir</button>
    </div>
  {/if}

  <section class="left">
    <div class="panel previewBox">
      <canvas bind:this={previewCanvas}></canvas>
      <span class="tag">PREVIEW</span>
      {#if vs.blackout}<span class="tag blackTag">BLACKOUT</span>{/if}
    </div>
    <div class="panel analyzer">
      {#if tab === 'Roteiro'}
        <Timeline sceneNames={() => perf?.sceneNames() ?? []} />
      {:else}
        <Analyzer {frame} {kickAt} />
      {/if}
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
        <h2>Drop (grave)</h2>
        <Slider label="Limiar do grave" bind:value={s.dropThr} min={0.1} max={0.8} step={0.01} def={0.35} fmt={pct} />
        <Slider label="Entrada/saída do drop" bind:value={vs.dropFade} learn="dropFade" min={0.25} max={8} step={0.25} def={VISUAL.dropFade} fmt={(v) => v + ' beat' + (v === 1 ? '' : 's')} />
        <p class="keys">Efeitos com o chip <b>drop</b> ligado somem no breakdown sem grave e entram quando o grave volta. A pílula DROP no topo acende quando o app ouve grave; se ela apaga com o grave tocando, baixe o limiar.</p>
        <p class="keys">Espaço = tap · ← → = fase · 1–8 = cenas · B = blackout · L = só logo · F = telão</p>

      {:else if tab === 'Logo'}
        <div class="files">
          <label class="btn">Escolher logo<input type="file" accept="image/*" onchange={(e) => pick('logo', e.currentTarget.files?.[0])} /></label>
          <button onclick={() => autoColors('logo')} title="Analisa a logo e ajusta brilho, ondas, flash, espectro e o degradê do fundo">Cores da logo</button>
          <label class="color">Cor do brilho <input type="color" bind:value={vs.color} /></label>
        </div>
        <Slider label="Tamanho" bind:value={vs.size} learn="size" min={10} max={150} step={1} def={VISUAL.size} fmt={(v) => v + '%'} />
        <Slider label="Pulso" bind:value={vs.amount} learn="amount" bind:mod={vs.mod.amount} min={0} max={1.5} step={0.01} def={VISUAL.amount} fmt={f2} />
        <Slider label="Brilho (glow)" bind:value={vs.glow} learn="glow" bind:mod={vs.mod.glow} min={0} max={1} step={0.01} def={VISUAL.glow} fmt={f2} />
        <Slider label="Aberração cromática" bind:value={vs.chroma} learn="chroma" bind:mod={vs.mod.chroma} bind:drop={vs.drop.chroma} min={0} max={40} step={0.5} def={VISUAL.chroma} fmt={(v) => v + ' px'} />
        <label class="check">
          <input type="checkbox" bind:checked={vs.rmWhite} />
          <span>Remover fundo branco da logo</span>
        </label>
        {#if vs.rmWhite}
          <Slider label="Tolerância do branco" bind:value={vs.white} learn="white" min={200} max={254} step={1} def={VISUAL.white} />
        {/if}
        <h2>Reação</h2>
        <p class="keys">O seletor ao lado de cada efeito escolhe o que no som o move: Auto (kick, ou a onda sem kick), Kick, Sub, Bass, Mid, Hats, Beat, Compasso ou LFO.</p>
        <Slider label="Duração do pulso" bind:value={vs.rel} learn="rel" min={0.03} max={0.5} step={0.01} def={VISUAL.rel} fmt={(v) => v.toFixed(2) + ' s'} />
        <Slider label="Seguir a música sem kick" bind:value={vs.wave} learn="wave" min={0} max={1} step={0.01} def={VISUAL.wave} fmt={f2} />

      {:else if tab === 'Fundo'}
        <div class="files">
          <label class="btn">Foto de fundo<input type="file" accept="image/*" onchange={(e) => pick('bg', e.currentTarget.files?.[0])} /></label>
          <button onclick={clearBg}>Remover foto</button>
          <button onclick={() => autoColors('bg')} title="Brilho e cores do fundo tirados da foto ou do vídeo (já acontece ao escolher)">Cores do fundo</button>
        </div>
        <h2>Vídeo em loop</h2>
        <div class="files">
          <label class="btn">Adicionar vídeo<input type="file" accept="video/*" onchange={(e) => pick('bg', e.currentTarget.files?.[0])} /></label>
          <button class:on={!vs.bgVideo} onclick={() => (vs.bgVideo = '')}>Sem vídeo</button>
        </div>
        {#if videoList.length}
          <div class="vids">
            {#each videoList as x (x.id)}
              <div class="vid" class:on={vs.bgVideo === x.id}>
                <button onclick={() => (vs.bgVideo = x.id)} title={x.name}>{x.name}</button>
                <button class="x" onclick={() => dropVideo(x.id)} title="Remover da biblioteca">×</button>
              </div>
            {/each}
          </div>
        {/if}
        {#if vs.bgVideo}
          <Slider label="Velocidade do vídeo" bind:value={vs.videoSpeed} learn="videoSpeed" min={0.25} max={2} step={0.05} def={1} fmt={(v) => v.toFixed(2) + '×'} />
        {/if}
        <h2>Cores e ajuste</h2>
        <div class="files">
          <label class="color">Cor 1 <input type="color" bind:value={vs.bgc1} /></label>
          <label class="color">Cor 2 <input type="color" bind:value={vs.bgc2} /></label>
          <label class="check inline"><input type="checkbox" bind:checked={vs.bgGrad} /> Degradê</label>
        </div>
        {#if vs.bgGrad}
          <Slider label="Ângulo do degradê" bind:value={vs.bgAngle} learn="bgAngle" min={0} max={360} step={1} def={VISUAL.bgAngle} fmt={(v) => v + '°'} />
        {/if}
        <div class="seg two">
          <button class:on={vs.bgFit === 'cover'} onclick={() => (vs.bgFit = 'cover')}>Preencher</button>
          <button class:on={vs.bgFit === 'contain'} onclick={() => (vs.bgFit = 'contain')}>Caber inteira</button>
        </div>
        <Slider label="Opacidade da foto/vídeo" bind:value={vs.bgOpacity} learn="bgOpacity" bind:drop={vs.drop.bgMedia} min={0} max={1} step={0.01} def={1} fmt={pct} />
        <Slider label="Desfoque da foto/vídeo" bind:value={vs.bgBlur} learn="bgBlur" min={0} max={40} step={1} def={0} fmt={(v) => v + ' px'} />
        <Slider label="Brilho da foto/vídeo" bind:value={vs.bgDim} learn="bgDim" min={0} max={150} step={1} def={100} fmt={(v) => v + '%'} />
        <Slider label="Girar matiz" bind:value={vs.bgHue} learn="bgHue" min={-180} max={180} step={1} def={0} fmt={(v) => v + '°/s'} />
        <Slider label="Zoom do fundo" bind:value={vs.bgPulse} learn="bgPulse" bind:mod={vs.mod.bgPulse} bind:drop={vs.drop.bgPulse} min={0} max={0.4} step={0.01} def={VISUAL.bgPulse} fmt={f2} />
        <Slider label="Brilho do fundo" bind:value={vs.bgFlash} learn="bgFlash" bind:mod={vs.mod.bgFlash} bind:drop={vs.drop.bgFlash} min={0} max={1} step={0.01} def={VISUAL.bgFlash} fmt={f2} />

      {:else if tab === 'Efeitos'}
        <PsyEffects bind:vs />
        <Slider label="Flash" bind:value={vs.fxFlash} learn="fxFlash" bind:mod={vs.mod.fxFlash} bind:drop={vs.drop.fxFlash} min={0} max={1} step={0.01} def={VISUAL.fxFlash} fmt={f2} />
        <Slider label="Anéis a cada kick" bind:value={vs.fxRings} learn="fxRings" bind:drop={vs.drop.fxRings} min={0} max={1} step={0.01} def={VISUAL.fxRings} fmt={f2} />
        <Slider label="Espectro em barras" bind:value={vs.fxBars} learn="fxBars" bind:drop={vs.drop.fxBars} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Espectro radial na logo" bind:value={vs.fxRadial} learn="fxRadial" bind:drop={vs.drop.fxRadial} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <h2>Rastro / túnel</h2>
        <Slider label="Rastro" bind:value={vs.trail} learn="trail" bind:drop={vs.drop.trail} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Zoom do rastro" bind:value={vs.trailZoom} learn="trailZoom" bind:mod={vs.mod.trailZoom} min={-1} max={1} step={0.01} def={VISUAL.trailZoom} fmt={f2} />
        <Slider label="Giro do rastro" bind:value={vs.trailRot} learn="trailRot" min={-1} max={1} step={0.01} def={0} fmt={f2} />
        <h2>Strobe</h2>
        {#if vs.safeFlash}
          <p class="keys">Limite de flashes ligado (aba Saída): 1/{vs.strobeDiv} a {frame?.bpm ? frame.bpm.toFixed(0) : '—'} BPM dá {frame?.bpm ? strobeRate(frame.bpm, vs.strobeDiv, true).toFixed(1) : '—'} flashes/s (teto 3).</p>
        {:else}
          <p class="keys warnTxt">⚠ Limite de flashes desligado: 1/{vs.strobeDiv} a {frame?.bpm ? frame.bpm.toFixed(0) : '—'} BPM = {frame?.bpm ? strobeRate(frame.bpm, vs.strobeDiv, false).toFixed(1) : '—'} flashes/s.</p>
        {/if}
        <Slider label="Intensidade" bind:value={vs.strobe} learn="strobe" bind:drop={vs.drop.strobe} min={0} max={1} step={0.01} def={0} fmt={f2} />
        <div class="seg four">
          {#each [[1, '1/1'], [2, '1/2'], [4, '1/4']] as [d, l]}
            <button class:on={vs.strobeDiv === d} onclick={() => (vs.strobeDiv = d as number)}>{l}</button>
          {/each}
        </div>
        <h2>Tela</h2>
        <Slider label="Vinheta" bind:value={vs.fxVig} learn="fxVig" min={0} max={1} step={0.01} def={VISUAL.fxVig} fmt={f2} />
        <Slider label="Linhas de TV" bind:value={vs.fxScan} learn="fxScan" min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Granulado" bind:value={vs.fxGrain} learn="fxGrain" min={0} max={1} step={0.01} def={0} fmt={f2} />
        <Slider label="Tremor" bind:value={vs.fxShake} learn="fxShake" bind:mod={vs.mod.fxShake} bind:drop={vs.drop.fxShake} min={0} max={30} step={1} def={0} fmt={(v) => v + ' px'} />

      {:else if tab === 'Roteiro'}
        <RoteiroPanel sceneNames={() => perf?.sceneNames() ?? []} />
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
        <Slider label="Offset visual" bind:value={vs.offset} learn="offset" min={-150} max={50} step={1} def={VISUAL.offset} fmt={(v) => v + ' ms'} />
        <p class="keys">Negativo = adianta o pulso para compensar o atraso do projetor. Ajuste até o pulso cair junto com o kick que você ouve.</p>
        <h2>Segurança visual</h2>
        <label class="check">
          <input type="checkbox" bind:checked={vs.safeFlash} />
          <span>Limitar flashes a 3 por segundo <small>strobe pula pulsos e o flash de tela fica em no máximo 50%. Referência: WCAG 2.3.1. Recomendado ligado.</small></span>
        </label>
        <p class="keys">Luz piscando rápido pode causar mal-estar e, em pessoas sensíveis, crises de epilepsia fotossensível. Avise na entrada quando usar strobe. <b>P</b> = PÂNICO (zera os efeitos agressivos e para o roteiro); <b>B</b> = BLACKOUT.</p>
        <h2>Desempenho</h2>
        <Slider label="Resolução de render" bind:value={vs.renderScale} learn="renderScale" min={0.4} max={1} step={0.05} def={1} fmt={pct} />
        <p class="keys">Abaixe se o telão cair de 60 fps.</p>
      {/if}
    </div>
  </aside>

  <Performance bind:this={perf} bind:vs {beatInfo} onstatus={(m) => (status = m)} cmd={(c) => dispatch(c, 'ui')} macro={macroId} />

  <footer class="status">
    <span>{status}</span>
    {#if upd}
      <button class="upd" onclick={installUpdate} disabled={fps > 0 || updPct >= 0}
        title={fps ? 'Feche o telão para atualizar (o app reinicia)' : upd.body || 'Baixa, instala e reinicia o app'}>
        {updPct >= 0 ? `Baixando ${updPct}%` : `Nova versão ${upd.version} — atualizar`}
      </button>
    {/if}
  </footer>
</main>

<style>
  main {
    height: 100vh;
    display: grid;
    grid-template-columns: 1fr 320px;
    grid-template-rows: auto 1fr auto auto;
    gap: 12px;
    padding: 12px;
  }
  .bar { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex-wrap: wrap; }
  .panic { font-weight: 700; letter-spacing: .04em; font-size: 11px; padding: 7px 8px; color: #ffb84d; border-color: rgba(255,184,77,.45); }
  .panic:hover { background: rgba(255,184,77,.15); }
  .blackTag { left: auto; right: 12px; color: #fff; background: var(--clip); padding: 2px 8px; border-radius: 6px; font-weight: 800; }
  .warnTxt { color: #ffb84d; }
  .brand { font-weight: 800; letter-spacing: 0.12em; font-size: 14px; }
  .group { display: flex; gap: 6px; align-items: center; }
  .group > button { padding: 7px 10px; }
  .group select:first-child { max-width: 112px; }
  .black { padding: 7px 9px; }
  .primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink, #fff); font-weight: 600; }
  .black { font-weight: 700; letter-spacing: .06em; }
  .black.on { background: var(--clip); border-color: var(--clip); }
  .health button { display: flex; align-items: center; gap: 4px; padding: 4px 7px; font-size: 10px; color: var(--muted); min-width: 0; }
  .health i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.15); transition: background .2s; flex: none; }
  .health b { margin-left: 2px; min-width: 14px; text-align: right; }
  .health i.ok { background: var(--ok); box-shadow: 0 0 5px var(--ok); }
  .health i.warn { background: #ffb84d; box-shadow: 0 0 5px #ffb84d; }
  .health i.bad { background: var(--clip); box-shadow: 0 0 6px var(--clip); animation: armed .7s ease-in-out infinite alternate; }
  .health b { font-weight: 600; letter-spacing: .04em; }
  .midiBtn { display: flex; align-items: center; gap: 6px; font-weight: 600; }
  .midiBtn i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.15); transition: background 60ms; }
  .midiBtn i.lit { background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .learnBar {
    position: fixed; top: 76px; left: 50%; translate: -50% 0; z-index: 20;
    display: flex; align-items: center; gap: 12px; padding: 10px 14px; max-width: calc(100vw - 32px);
    background: rgba(20, 16, 36, .92); border: 1px solid var(--accent); border-radius: var(--radius);
    box-shadow: 0 10px 40px rgba(0,0,0,.5); backdrop-filter: blur(20px);
  }
  .learnBar small { color: var(--muted); }

  .meter { position: relative; width: 92px; height: 26px; border-radius: 8px; background: rgba(255,255,255,.06); overflow: hidden; }
  .meter .fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, var(--ok), #c6f24e); transition: width 60ms linear; }
  .meter.clip .fill { background: var(--clip); }
  .meter span { position: relative; display: block; text-align: center; line-height: 26px; font-size: 12px; font-weight: 600; text-shadow: 0 1px 2px #000; }

  .dropPill { font-size: 9px; font-weight: 800; letter-spacing: .1em; padding: 0 5px; line-height: 12px; margin-left: 4px; border-radius: 6px; color: var(--muted); border: 1px solid var(--line); transition: all .15s; }
  .dropPill.on { color: #111; background: var(--kick); border-color: var(--kick); box-shadow: 0 0 12px var(--kick); }
  .tempo { display: flex; align-items: center; gap: 10px; margin-left: auto; }
  .bpm { font-size: 30px; font-weight: 700; line-height: 1; color: var(--muted); transition: color .2s; min-width: 84px; text-align: right; }
  .bpm.locked { color: var(--text); text-shadow: 0 0 18px rgba(124,92,255,.6); }
  .tstate { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--muted); }
  .dots { display: flex; gap: 6px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; background: rgba(255,255,255,.1); }
  .dots i.on { background: var(--kick); box-shadow: 0 0 10px var(--kick); }
  .dots i:first-child { border: 1px solid rgba(255,255,255,.3); }

  .left { display: grid; grid-template-rows: auto 1fr; gap: 12px; min-height: 0; }
  .previewBox { position: relative; aspect-ratio: 16 / 9; max-height: 42vh; overflow: hidden; justify-self: center; width: 100%; max-width: calc(42vh * 16 / 9); }
  .previewBox canvas { width: 100%; height: 100%; display: block; border-radius: var(--radius); }
  .tag { position: absolute; top: 10px; left: 12px; font-size: 10px; letter-spacing: .14em; color: rgba(255,255,255,.55); }
  .analyzer { padding: 12px; min-height: 160px; }

  .side { display: flex; flex-direction: column; min-height: 0; }
  .tabs { display: flex; gap: 2px; padding: 8px; border-bottom: 1px solid var(--line); }
  .tabs button { flex: 1; padding: 6px 0; font-size: 11.5px; background: transparent; border-color: transparent; color: var(--muted); }
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
  .vids { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
  .vid { display: flex; gap: 4px; }
  .vid button:first-child { flex: 1; text-align: left; padding: 5px 10px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vid.on button:first-child { background: var(--accent); border-color: var(--accent); color: var(--accent-ink, #fff); }
  .vid .x { padding: 5px 9px; }
  .keys { color: var(--muted); font-size: 11px; margin-top: 12px; }
  .status { grid-column: 1 / -1; color: var(--muted); font-size: 12px; padding: 0 4px; display: flex; align-items: center; gap: 12px; }
  .upd { margin-left: auto; padding: 2px 10px; font-size: 11px; font-weight: 600; background: var(--accent); border-color: var(--accent); color: var(--accent-ink, #fff); }
  .upd:disabled { opacity: .55; cursor: default; }
</style>
