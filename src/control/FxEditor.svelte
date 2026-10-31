<script lang="ts">
  // Editor de efeitos da comunidade (DK-122): GLSL do autor sobre uma imagem de teste, num contexto WebGL2 PRÓPRIO
  // (não o do renderer; o telão nem conhece estes efeitos ainda — a ligação como camada é a DK-123).
  // Compila 500 ms depois de parar de digitar, no máximo 2×/s; contexto perdido ou 1ª renderização > 2 s = suspeito
  // (não recompila sozinho); 3 falhas = desabilitado até reativar.
  import Slider from './Slider.svelte';
  import { load, save } from '../lib/store';
  import { getAsset, setAsset } from '../lib/assets';
  import type { Frame } from '../lib/types';
  import {
    compileAt, FX_ENTRY, FX_EXT, FX_FORMAT, FX_VERSION, fullSource, HEALTHY, mapErrors, nextHealth, readFxPack,
    validateShader, validFxList, writeFxPack, type FxEntry, type FxManifest,
  } from '../lib/shaders/manifest';

  let { getFrame, onstatus }: { getFrame: () => Frame | null; onstatus: (m: string) => void } = $props();

  // o código fica no IndexedDB ao lado da mídia (chave fx:<id>)
  const codeKey = (id: string) => `fx:${id}` as const;

  const saved = load('doublek.fx', validFxList, () => [] as FxEntry[]);
  let list = $state<FxEntry[]>(saved);
  $effect(() => save('doublek.fx', $state.snapshot(list)));
  let sel = $state(saved[0]?.manifest.id ?? '');
  const cur = $derived(list.find((e) => e.manifest.id === sel));
  let code = $state('');
  let lastValid = $state('');
  let errors = $state<{ line: number | null; message: string }[]>([]);
  let open = $state(false);
  let canvasKey = $state(0); // trocar = canvas e contexto novos (depois de perder o contexto)
  let canvas = $state<HTMLCanvasElement>();

  const TEMPLATE: { manifest: FxManifest; code: string } = {
    manifest: { format: FX_FORMAT, v: FX_VERSION, id: 'meu-efeito', name: 'Meu efeito', version: '1.0.0', entry: FX_ENTRY,
      params: [{ key: 'amount', label: 'Força', min: 0, max: 1, default: 0.5, step: 0.01 }] },
    code: '// Leia a imagem em uInput (coordenada vUv) e escreva a cor em o.\n// uKick vai a 1 na batida; uP[0] e o primeiro parametro do manifesto.\nvoid main() {\n  vec4 c = texture(uInput, vUv);\n  o = vec4(mix(c.rgb, 1.0 - c.rgb, uP[0] * uKick), c.a);\n}\n',
  };

  async function select(id: string) {
    sel = id;
    errors = [];
    const blob = id ? await getAsset(codeKey(id)) : undefined;
    code = lastValid = blob ? await blob.text() : '';
    lastEdit = performance.now();
    if (gl) schedule();
  }
  $effect(() => { if (open && sel && !code && !lastValid) select(sel); });

  async function install(m: FxManifest, src: string, ask = true) {
    const exists = list.some((e) => e.manifest.id === m.id);
    if (exists && ask && !confirm(`Já existe um efeito "${m.id}". Substituir pelo importado?`)) return false;
    await setAsset(codeKey(m.id), new Blob([src], { type: 'text/plain' }));
    const entry: FxEntry = { manifest: m, values: m.params.map((p) => p.default), health: HEALTHY };
    list = exists ? list.map((e) => (e.manifest.id === m.id ? entry : e)) : [...list, entry];
    await select(m.id);
    return true;
  }

  async function novo() {
    let id = TEMPLATE.manifest.id, n = 2;
    while (list.some((e) => e.manifest.id === id)) id = `${TEMPLATE.manifest.id}-${n++}`;
    await install({ ...TEMPLATE.manifest, id }, TEMPLATE.code, false);
    onstatus(`Efeito "${id}" criado a partir do modelo.`);
  }

  async function importFx(f: File | undefined) {
    if (!f) return;
    try {
      const p = readFxPack(new Uint8Array(await f.arrayBuffer()));
      if (await install(p.manifest, p.code)) onstatus(`Efeito importado: "${p.manifest.name}" (${p.manifest.id}).`);
    } catch (e) {
      onstatus('Não importei o efeito: ' + (e as Error).message);
    }
  }

  function exportFx() {
    if (!cur) return;
    try {
      const bytes = writeFxPack({ manifest: $state.snapshot(cur.manifest) as FxManifest, code: lastValid || code });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      a.download = cur.manifest.id + FX_EXT;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      onstatus(`Efeito exportado: ${a.download}.`);
    } catch (e) {
      onstatus('Não exportei o efeito: ' + (e as Error).message);
    }
  }

  async function remove() {
    if (!cur || !confirm(`Apagar o efeito "${cur.manifest.name}"?`)) return;
    const id = cur.manifest.id;
    await setAsset(codeKey(id), null);
    list = list.filter((e) => e.manifest.id !== id);
    await select(list[0]?.manifest.id ?? '');
  }

  const setHealth = (ev: Parameters<typeof nextHealth>[1]) => {
    if (!cur) return;
    const h = nextHealth(cur.health, ev);
    list = list.map((e) => (e.manifest.id === sel ? { ...e, health: h } : e));
    if (ev === 'lost' || ev === 'slow')
      onstatus(h.status === 'desabilitado' ? `Efeito "${sel}" desabilitado depois de ${h.fails} falhas. Reative se confiar nele.` : `Efeito "${sel}" suspeito (${ev === 'lost' ? 'a placa de vídeo perdeu o contexto' : 'demorou mais de 2 s'}): não vou recompilar sozinho.`);
  };

  // ---------- pré-visualização: contexto próprio ----------
  let gl: WebGL2RenderingContext | null = null, prog: WebGLProgram | null = null, tex: WebGLTexture | null = null;
  let lastEdit = 0, lastCompile = 0, timer = 0, raf = 0, kickAt = -1e9, firstDraw = false;
  const VS = '#version 300 es\nin vec2 p;\nout vec2 vUv;\nvoid main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';

  async function testImage(): Promise<TexImageSource> {
    const logo = await getAsset('logo').catch(() => undefined);
    if (logo) { try { return await createImageBitmap(logo); } catch {} }
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d')!, grad = g.createLinearGradient(0, 0, 320, 180);
    grad.addColorStop(0, '#2a1060'); grad.addColorStop(0.5, '#7c5cff'); grad.addColorStop(1, '#22d3ee');
    g.fillStyle = grad; g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(160, 90, 40, 0, Math.PI * 2); g.fill();
    return c;
  }

  let setupToken = 0;
  async function setupGl(c: HTMLCanvasElement) {
    const my = ++setupToken;
    const img = await testImage(); // pode demorar (IndexedDB): se o painel fechou/trocou de aba no meio, desiste
    if (my !== setupToken) return;
    gl = c.getContext('webgl2');
    if (!gl) { errors = [{ line: null, message: 'Este WebView não tem WebGL2 para a pré-visualização.' }]; return; }
    c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; prog = null; cancelAnimationFrame(raf); setHealth('lost'); });
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    schedule();
    loop();
  }

  function schedule() {
    clearTimeout(timer);
    if (!cur || cur.health.status !== 'ok') return; // suspeito/desabilitado: só por pedido do usuário
    timer = window.setTimeout(compile, Math.max(0, compileAt(lastEdit, lastCompile) - performance.now()));
  }

  function compile() {
    if (!gl || !cur || cur.health.status !== 'ok') return;
    lastCompile = performance.now();
    try { validateShader(code); } catch (e) { errors = [{ line: null, message: (e as Error).message }]; return; }
    const t0 = performance.now();
    const sh = (type: number, src: string) => { const s = gl!.createShader(type)!; gl!.shaderSource(s, src); gl!.compileShader(s); return s; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, fullSource(code));
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { errors = mapErrors(gl.getShaderInfoLog(fs) ?? 'erro de compilação'); gl.deleteShader(fs); return; }
    const p = gl.createProgram()!;
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { errors = mapErrors(gl.getProgramInfoLog(p) ?? 'erro de ligação'); return; }
    if (performance.now() - t0 > 2000) { setHealth('slow'); return; }
    if (prog) gl.deleteProgram(prog);
    prog = p;
    errors = [];
    firstDraw = true;
    if (code !== lastValid) { lastValid = code; setAsset(codeKey(sel), new Blob([code], { type: 'text/plain' })); } // só o válido é guardado
  }

  function draw(now: number) {
    if (!gl || !prog || !cur) return;
    const f = getFrame();
    if (f?.kick) kickAt = now;
    const kick = Math.exp(-(now - kickAt) / 150);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(prog);
    const u = (n: string) => gl!.getUniformLocation(prog!, n);
    gl.uniform1i(u('uInput'), 0);
    gl.uniform2f(u('uRes'), gl.canvas.width, gl.canvas.height);
    gl.uniform1f(u('uTime'), now / 1000);
    gl.uniform1f(u('uBeat'), (f?.beat ?? 0) + (f?.beatPhase ?? 0));
    gl.uniform1f(u('uPhase'), f?.beatPhase ?? 0);
    gl.uniform1f(u('uKick'), kick);
    gl.uniform1f(u('uLow'), f?.low ?? 1);
    gl.uniform1fv(u('uBands'), new Float32Array(f?.bands ?? [0.5, 0.5, 0.4, 0.3, 0.3]));
    const pv = new Float32Array(8); cur.values.forEach((v, i) => (pv[i] = v));
    gl.uniform1fv(u('uP'), pv);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const t0 = performance.now();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (firstDraw) {
      gl.finish(); // só na 1ª: mede se o shader trava a GPU
      firstDraw = false;
      if (performance.now() - t0 > 2000) { prog = null; setHealth('slow'); return; }
      setHealth('ok');
    }
  }

  let odd = false;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (open && (odd = !odd)) draw(performance.now()); // ~30 fps e só com o painel aberto
  }

  $effect(() => {
    const c = canvas;
    void canvasKey;
    if (c) setupGl(c);
    return () => { setupToken++; cancelAnimationFrame(raf); clearTimeout(timer); gl = null; prog = null; };
  });

  function edit(v: string) { code = v; lastEdit = performance.now(); schedule(); }
  function retry() { setHealth('retry'); canvasKey++; }
  function reactivate() { setHealth('reactivate'); canvasKey++; }
</script>

<details class="fx" bind:open data-automation>
  <summary>Efeitos da comunidade (FX)</summary>
  <p class="warn">⚠ Shader de terceiros pode travar a placa de vídeo. Use só de quem você confia.</p>
  <div class="bar">
    <select value={sel} onchange={(e) => select(e.currentTarget.value)} disabled={!list.length}>
      {#if !list.length}<option value="">nenhum instalado</option>{/if}
      {#each list as e}<option value={e.manifest.id}>{e.manifest.name}{e.health.status !== 'ok' ? ` (${e.health.status})` : ''}</option>{/each}
    </select>
    <button onclick={novo}>Novo</button>
    <label class="btn">Importar<input type="file" accept={FX_EXT + ',application/zip'} onchange={(e) => { importFx(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} /></label>
    <button onclick={exportFx} disabled={!cur}>Exportar</button>
    <button onclick={remove} disabled={!cur}>Apagar</button>
  </div>
  {#if cur}
    <p class="meta">{cur.manifest.id} v{cur.manifest.version}{cur.manifest.author ? ` · ${cur.manifest.author}` : ''} · só pré-visualização (o telão ainda não usa)</p>
    {#if cur.health.status === 'suspeito'}
      <p class="bad">Suspeito ({cur.health.fails} falha(s)): não recompila sozinho. <button onclick={retry}>Tentar de novo</button></p>
    {:else if cur.health.status === 'desabilitado'}
      <p class="bad">Desabilitado depois de {cur.health.fails} falhas. <button onclick={reactivate}>Reativar</button></p>
    {/if}
    {#key canvasKey}<canvas bind:this={canvas} width="320" height="180"></canvas>{/key}
    {#each cur.manifest.params as p, i}
      <Slider label={p.label} bind:value={cur.values[i]} min={p.min} max={p.max} step={p.step} def={p.default} fmt={(v) => v.toFixed(2)} />
    {/each}
    <textarea spellcheck="false" value={code} oninput={(e) => edit(e.currentTarget.value)} rows="12" aria-label="Código GLSL do efeito"></textarea>
    {#if errors.length}
      <ul class="errs">{#each errors as er}<li>{er.line ? `linha ${er.line}: ` : ''}{er.message}</li>{/each}</ul>
    {/if}
    <button onclick={() => edit(lastValid)} disabled={!lastValid || code === lastValid}>Reverter para o último válido</button>
  {/if}
</details>

<style>
  .fx { margin: 0 0 12px; border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; }
  .fx summary { cursor: pointer; font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  .warn { font-size: 11px; color: #ffb020; margin: 6px 0; }
  .bar { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .bar select { flex: 1; min-width: 0; font-size: 12px; }
  .bar button, .btn { padding: 3px 8px; font-size: 12px; }
  .btn { background: rgba(255,255,255,.06); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
  .btn input { display: none; }
  .meta { font-size: 11px; color: var(--muted); margin: 6px 0 4px; }
  .bad { font-size: 12px; color: #ff6b6b; margin: 4px 0; }
  canvas { width: 100%; aspect-ratio: 16 / 9; border-radius: 6px; background: #000; display: block; margin: 4px 0; }
  textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.4; background: rgba(0,0,0,.35); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px; resize: vertical; tab-size: 2; }
  .errs { margin: 4px 0; padding-left: 16px; font: 11px ui-monospace, Consolas, monospace; color: #ff6b6b; }
</style>
