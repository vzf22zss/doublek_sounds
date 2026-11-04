// Smoke de release no exe real (roteiro da 0.3.9): resposta da janela de controle, Spout, diário de análise, FX no
// telão + modo seguro, vídeo (loop início/fim e camada), gravação 16:9, OSC, celular, console sem CSP, fechar o telão.
// Imprime a tabela OK/FALHA/PULADO. Cada bloco roda num exe novo (pasta e porta próprias): uma falha que trave a
// janela não derruba os blocos seguintes, e cada um começa do zero.
// Uso: DOUBLEK_MOCK=<pasta com node_modules/puppeteer-core> node scripts/e2e/smoke.mjs [--only=celular,osc] [--exe=...] [--out=...]
// Pré-requisito: `npx tauri build --no-bundle` no worktree. Ver README.md (o que cada bloco prova e o que não).
import { execFileSync } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DATA, appDataFiles, freeTcpPort, freeUdpPort, launchApp, launchEdge, REPO, results, until, wait, within } from './lib.mjs';
import { media } from './media.mjs';

const BLOCKS = ['resposta', 'spout', 'diario', 'fx', 'video', 'gravacao', 'osc', 'celular'];
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const only = arg('only') ? new Set(arg('only').split(',')) : new Set(BLOCKS);
for (const b of only) if (!BLOCKS.includes(b)) { console.error(`bloco desconhecido: ${b} (use ${BLOCKS.join(', ')})`); process.exit(2); }
const OUT = path.resolve(arg('out') ?? path.join(os.tmpdir(), 'doublek-e2e-out'));
fs.mkdirSync(OUT, { recursive: true });

const R = results(), files = appDataFiles();
let app = null, finished = false;
async function finish(code) {
  if (finished) return;
  finished = true;
  const removed = files.cleanup();
  if (app) await app.close();
  const table = R.table();
  console.log('\n' + table + `\n\n${R.rows.filter((r) => r.status === 'OK').length} OK · ${R.failed()} FALHA · ${R.rows.filter((r) => r.status === 'PULADO').length} PULADO`);
  console.log(`apagados de %APPDATA%: ${removed.length ? removed.join(', ') : 'nada'}`);
  fs.writeFileSync(path.join(OUT, 'smoke-table.md'), table + '\n');
  fs.writeFileSync(path.join(OUT, 'smoke-result.json'), JSON.stringify({ when: new Date().toISOString(), exe: app?.exe, rows: R.rows, removed }, null, 1));
  console.log(`resultado em ${OUT}`);
  process.exit(code ?? (R.failed() ? 1 : 0));
}
setTimeout(() => { console.log('TEMPO ESGOTADO (40 min)'); R.ok('geral', 'smoke terminou no tempo', false); finish(2); }, 40 * 60000).unref();

/** Um exe novo para o bloco `current`: abre, roda, confere console e fechamento do telão. */
async function session(current, M) {
  const errs = { controle: [], 'telão': [], celular: [] };
  const hook = (p, n) => {
    p.on('pageerror', (e) => errs[n].push(e.message.slice(0, 200)));
    p.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy|Refused/.test(m.text())) errs[n].push(m.text().slice(0, 200)); });
  };
  console.log(`\n== ${current} ==`);
  app = await launchApp({ exe: arg('exe') });
  console.log(`exe: ${app.exe} · pasta isolada: ${app.dir} · porta ${app.port}`);
  const c = await app.pageFor('control.html');
  if (!c) throw new Error('janela de controle não apareceu');
  hook(c, 'controle');
  c.on('dialog', (d) => d.accept());

  // ---------- ajudantes da janela de controle ----------
  const inv = (cmd, a) => c.evaluate((cmd, a) => window.__TAURI_INTERNALS__.invoke(cmd, a).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e: String(e) })), cmd, a);
  const tab = async (t) => { await c.evaluate((t) => [...document.querySelectorAll('nav.tabs button')].find((x) => x.textContent.trim() === t)?.click(), t); await wait(400); };
  const click = (t, exact = false) => c.evaluate((t, exact) => { const el = [...document.querySelectorAll('button')].find((x) => (exact ? x.textContent.trim() === t : x.textContent.trim().startsWith(t))); el?.click(); return !!el; }, t, exact);
  const status = () => c.evaluate(() => document.querySelector('footer.status span')?.textContent ?? '');
  const body = () => c.evaluate(() => document.querySelector('.tabBody')?.innerText ?? '');
  const blackout = () => c.evaluate(() => document.querySelector('button.black').classList.contains('on'));
  const upload = async (sel, file) => (await c.$(sel)).uploadFile(file);
  /** Campo de número da seção cujo título casa com `re` (porta do OSC/celular). */
  const setPortOf = (re, v) => c.evaluate((re, v) => {
    const h = [...document.querySelectorAll('.tabBody h2')].find((x) => new RegExp(re, 'i').test(x.textContent));
    for (let el = h?.nextElementSibling; el; el = el.nextElementSibling) {
      const i = el.querySelector?.('input[type=number]');
      if (i) { i.value = String(v); i.dispatchEvent(new Event('input', { bubbles: true })); return true; }
    }
    return false;
  }, re, v);
  // valor de um knob da barra de performance, como aparece na tela (o Diagnóstico baixa um arquivo, e baixar no
  // WebView2 durante o smoke às vezes travava a janela)
  const knob = (label) => c.evaluate((label) => parseFloat(document.querySelector(`.knob[aria-label="${label}"] b`)?.textContent ?? 'NaN'), label);
  let o = null;
  const openTel = async () => {
    if (o && !o.isClosed()) return o;
    const mons = (await inv('list_monitors')).v ?? [];
    await inv('open_output', { monitor: mons.length > 1 ? mons.length - 1 : 0 });
    o = await app.pageFor('output.html');
    if (!o) throw new Error('telão não abriu');
    hook(o, 'telão');
    await wait(2000);
    return o;
  };
  const closeTel = async () => { await inv('close_output'); await wait(800); o = null; };
  const block = async (name, fn) => {
    if (name !== current) return;
    try { await within(fn(), 5 * 60000, name); } catch (e) { R.ok(name, 'bloco rodou até o fim', false, e.message); }
  };
  await wait(1000);

  // ---------- resposta: mudar um ajuste não pode recriar o renderer do PREVIEW ----------
  // (achado no smoke de 2026-11-02: cada mudança de `vs` recriava o PREVIEW — 11 programas WebGL e ~250 ms de thread
  // principal por mudança; arrastar um slider/knob MIDI/fader OSC travava a janela. Fica aqui como regressão.)
  await block('resposta', async () => {
    await c.evaluate(() => { if (window.__progs !== undefined) return; window.__progs = 0; const P = WebGL2RenderingContext.prototype, cp = P.createProgram; P.createProgram = function () { window.__progs++; return cp.call(this); }; });
    await tab('Logo');
    await c.evaluate(() => { window.__progs = 0; });
    const t0 = Date.now();
    await c.evaluate(async () => {
      const r = [...document.querySelectorAll('.tabBody input[type=range]')][1]; // Tamanho, Pulso, …
      for (let i = 1; i <= 10; i++) { r.value = String(i / 10); r.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((z) => setTimeout(z, 50)); }
    });
    await within(c.evaluate(() => 1), 60000, 'controle');
    const ms = Date.now() - t0 - 500; // tira os 10 × 50 ms de espera do próprio teste
    const progs = await c.evaluate(() => window.__progs);
    R.ok('resposta', 'mudar um ajuste não recria o renderer do PREVIEW (0 programas WebGL novos em 10 mudanças)', progs === 0, `${progs} createProgram`);
    R.ok('resposta', 'janela de controle responde em < 1 s depois de 10 mudanças de ajuste', ms < 1000, `${ms} ms`);
  });

  // ---------- Spout ----------
  await block('spout', async () => {
    await closeTel();
    await tab('Saída');
    await c.evaluate(() => { const i = document.querySelector('input[aria-label="Nome do sender Spout"]'); i.value = 'DoubleK e2e'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    const line = () => c.evaluate(() => [...document.querySelectorAll('.tabBody p.keys')].map((p) => p.textContent).find((t) => /Enviando "|Desligado\. Projete|⚠/.test(t)) ?? '');
    const parse = (t) => { const m = t.match(/Enviando "(.+?)" (\d+)×(\d+) · (\d+) fps · (\d+) quadros/); return m ? { name: m[1], w: +m[2], h: +m[3], frames: +m[5] } : null; };
    await click('Ligar', true); await wait(1500);
    const msg = `${await line()} | ${await status()}`;
    R.ok('spout', 'ligar sem telão → mensagem', /telão/i.test(msg) && !/Enviando/.test(msg), msg);
    await openTel(); await tab('Saída');
    await click('Ligar', true);
    const s1 = await until(async () => { const s = parse(await line()); return s?.frames > 0 ? s : null; }, 6000);
    await wait(2000);
    const s2 = parse(await line());
    R.ok('spout', 'ligado com o telão: W×H · fps · quadros subindo', !!s1 && !!s2 && s2.frames > s1.frames && s2.name === 'DoubleK e2e', JSON.stringify([s1, s2]));
    const mons = (await inv('list_monitors')).v ?? [];
    if (mons.length > 1) {
      const cur = mons.length - 1;
      await inv('open_output', { monitor: 0 }); await wait(3000);
      const a = parse(await line()); await wait(1500); const z = parse(await line());
      await inv('open_output', { monitor: cur }); await wait(2000);
      R.ok('spout', 'telão em outro monitor: continua, mesmo nome', !!a && !!z && z.frames > a.frames && z.name === 'DoubleK e2e', JSON.stringify([a, z]));
    } else R.skip('spout', 'telão em outro monitor', 'só 1 monitor');
    await click('Desligar', true); await wait(1500);
    R.ok('spout', 'desligar', /Desligado/.test(await line()) && !(await inv('spout_status')).v?.running);
    const saved = await c.evaluate(() => JSON.parse(localStorage.getItem('doublek.settings') || '{}')?.data?.spoutName);
    R.ok('spout', 'nome salvo em doublek.settings', saved === 'DoubleK e2e', String(saved));
    R.skip('spout', 'receptor Spout real', 'NÃO VERIFICADO (precisa do Resolume ou de um receptor)');
  });

  // ---------- diário de análise ----------
  await block('diario', async () => {
    await tab('Áudio');
    await click('Ouvir', true);
    await wait(2500);
    files.watchDir('analysis');
    await click('Gravar análise');
    await wait(3000);
    await c.evaluate(() => document.activeElement?.blur());
    await c.keyboard.press('KeyM'); await wait(1200);
    await c.keyboard.press('KeyM'); await wait(2000);
    await click('Parar gravação da análise');
    const st = await until(async () => { const s = await status(); return /Análise salva em /.test(s) ? s : null; }, 5000);
    const f = st ? files.add(st.match(/Análise salva em (.+)$/)[1].trim()) : null;
    const lines = f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split(/\r?\n/) : [];
    const marks = lines.filter((l) => /"mark":"drop"/.test(l)).length;
    R.ok('diario', '.jsonl com amostras e as 2 marcas do M', lines.length > 10 && marks === 2, `${f ? path.basename(f) : 'sem arquivo'} · ${lines.length} linhas · ${marks} marcas (entrada padrão do Windows, só números)`);
    let out = null;
    try {
      const PATH = `${process.env.PATH};${path.join(os.homedir(), '.cargo', 'bin')}`;
      out = f && execFileSync('cargo', ['run', '--release', '--quiet', '--example', 'replay', '--', f], { cwd: path.join(REPO, 'src-tauri'), encoding: 'utf8', timeout: 10 * 60000, env: { ...process.env, PATH }, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { out = null; }
    if (out === null) R.skip('diario', 'replay imprime o resumo', 'cargo indisponível ou falhou');
    else R.ok('diario', 'replay imprime o resumo com as 2 marcas', /Marcas "drop" do operador \| 2 \|/.test(out), out.split('\n').find((l) => /amostras/.test(l))?.trim());
  });

  // ---------- FX no telão ----------
  await block('fx', async () => {
    const tel = await openTel();
    await tel.evaluate(() => {
      if (window.__fxHook) return;
      window.__fxHook = true; window.__fxUse = {}; window.__fxCompile = [];
      const P = WebGL2RenderingContext.prototype, src = new WeakMap(), prog = new WeakMap(); let n = 0;
      const ss = P.shaderSource; P.shaderSource = function (sh, s) { src.set(sh, s); return ss.call(this, sh, s); };
      const at = P.attachShader; P.attachShader = function (pr, sh) { const s = src.get(sh) || ''; if (/uniform float uP\[/.test(s)) prog.set(pr, (/uBands\[1\]\) \* \(0\.5/.test(s) ? 'ondas' : /uKick\) \* 0\.02/.test(s) ? 'rgb' : 'fx') + '#' + ++n); return at.call(this, pr, sh); };
      const gp = P.getShaderParameter; P.getShaderParameter = function (sh, k) { const r = gp.call(this, sh, k); if (k === this.COMPILE_STATUS && /uniform float uP\[/.test(src.get(sh) || '')) window.__fxCompile.push(!!r); return r; };
      const up = P.useProgram; P.useProgram = function (pr) { const id = pr && prog.get(pr); if (id) window.__fxUse[id] = (window.__fxUse[id] || 0) + 1; return up.call(this, pr); };
    });
    const use = async (ms) => { await o.evaluate(() => { window.__fxUse = {}; }); await wait(ms); return o.evaluate(() => window.__fxUse); };
    await tab('Efeitos');
    await c.evaluate(() => { const d = document.querySelector('details.fx'); if (!d.open) d.querySelector('summary').click(); });
    await wait(400);
    const fxIds = () => c.evaluate(() => (JSON.parse(localStorage.getItem('doublek.fx') || '{}').data ?? []).map((e) => e.manifest.id));
    for (const [f, id] of [[M.rgb, 'rgb-split-kick'], [M.ondas, 'ondas-grave']]) {
      await upload('details.fx input[type=file]', f);
      R.ok('fx', `importar ${path.basename(f)}`, !!(await until(async () => (await fxIds()).includes(id), 8000)), (await fxIds()).join(', '));
    }
    const add = (v) => c.evaluate(async (v) => { const s = document.querySelector('select.addfx'); s.dispatchEvent(new Event('pointerdown', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await add('rgb-split-kick'); await wait(600);
    await add('ondas-grave'); await wait(3000);
    const u = await use(2000);
    R.ok('fx', '2 camadas FX compilam e desenham no telão', Object.keys(u).some((k) => k.startsWith('rgb')) && Object.keys(u).some((k) => k.startsWith('ondas')) && Object.values(u).every((v) => v > 20),
      `${JSON.stringify(u)} em 2 s · compilações ${JSON.stringify(await o.evaluate(() => window.__fxCompile))}`);
    await o.screenshot({ path: path.join(OUT, 'telao-fx.png') });
    await c.evaluate(() => document.querySelector('button.midiBtn').click()); await wait(300);
    await c.evaluate(() => [...document.querySelectorAll('.layer input.op')].find((i) => /RGB/i.test(i.getAttribute('aria-label') ?? ''))?.click()); await wait(400);
    const learn = await c.evaluate(() => document.querySelector('.learnBar')?.innerText ?? '');
    R.ok('fx', 'MIDI learn: opacidade da camada FX vira alvo', /Opacidade .*RGB/i.test(learn) && /armado/.test(learn), learn.replace(/\n/g, ' · ').slice(0, 120));
    await click('Concluir', true); await wait(300);
    await click('Abrir telão em modo seguro'); await wait(3000);
    o = (await app.pageFor('output.html')) ?? o;
    const safe = await use(2000);
    R.ok('fx', 'modo seguro: telão sem efeitos da comunidade', Object.keys(safe).length === 0 && (await c.evaluate(() => document.querySelector('details.fx')?.innerText.includes('Modo seguro') ?? false)), JSON.stringify(safe));
    await click('Sair do modo seguro'); await wait(3000);
    const back = await use(2000);
    R.ok('fx', 'sair do modo seguro: efeitos voltam', Object.keys(back).length === 2, JSON.stringify(back));
    for (let k = 0; k < 2; k++) await c.evaluate(() => [...document.querySelectorAll('.layer button.mv')].find((x) => /Tirar .*(RGB|Ondas)/i.test(x.getAttribute('aria-label') ?? ''))?.click());
    await wait(1000);
  });

  // ---------- vídeo: loop início/fim e camada ----------
  await block('video', async () => {
    const tel = await openTel();
    await tel.evaluate(() => {
      if (window.__vidHook) return;
      window.__vidHook = true; window.__vids = []; window.__seeks = 0;
      const orig = document.createElement.bind(document);
      document.createElement = (t, x) => { const e = orig(t, x); if (String(t).toLowerCase() === 'video') window.__vids.push(e); return e; };
      const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { get() { return d.get.call(this); }, set(v) { window.__seeks++; d.set.call(this, v); }, configurable: true });
    });
    await tab('Fundo');
    for (const f of [M.neon, M.loop]) {
      await upload('input[type=file][accept="video/*"]', f);
      R.ok('video', `importar ${path.basename(f)}`, !!(await until(async () => (await status()).includes(path.basename(f)) && /no fundo/.test(await status()), 15000)), await status());
    }
    // loop 1–3 s no vídeo com keyframe a cada 2 s (o caso que travava na 0.3.8)
    const setNum = (aria, v) => c.evaluate((aria, v) => { const i = document.querySelector(`input[aria-label="${aria}"]`); i.value = String(v); i.dispatchEvent(new Event('change', { bubbles: true })); }, aria, v);
    await setNum('Início do loop', 1); await setNum('Fim do loop', 3);
    await wait(1500);
    await o.evaluate(() => { window.__seeks = 0; });
    const ts = [];
    for (let i = 0; i < 40; i++) { ts.push(await o.evaluate(() => { const v = window.__vids.find((x) => x.src && !x.paused); return v ? +v.currentTime.toFixed(2) : null; })); await wait(200); }
    const seeks = await o.evaluate(() => window.__seeks), vals = ts.filter((x) => x !== null);
    const laps = vals.filter((x, i) => i > 0 && x < vals[i - 1] - 1).length;
    R.ok('video', 'loop 1–3 s: fica na janela, dá a volta, ~1 seek por volta', vals.length >= 35 && vals.every((x) => x >= 0.9 && x <= 3.25) && laps >= 2 && seeks <= laps + 3,
      `${vals.length}/40 amostras ${Math.min(...vals)}–${Math.max(...vals)} s, ${laps} voltas, ${seeks} seeks em 8 s`);
    // camada de vídeo: Normal cobre a logo, Tela deixa aparecer (capturas para conferir)
    await c.evaluate(() => [...document.querySelectorAll('.vid button:first-child')].find((x) => x.textContent.trim() === 'Anéis neon')?.click());
    await wait(1200);
    await tab('Efeitos');
    await c.evaluate(async () => { const s = document.querySelector('select.addfx'); s.dispatchEvent(new Event('pointerdown', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); s.value = 'video'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(1200);
    const names = await c.evaluate(() => [...document.querySelectorAll('.layer .name')].map((n) => n.textContent).join(' | '));
    R.ok('video', '"Vídeo do fundo como camada" entra na lista', /v[íi]deo/i.test(names), names);
    const blend = (v) => c.evaluate((v) => { const s = [...document.querySelectorAll('.layer select')].find((x) => /v[íi]deo/i.test(x.getAttribute('aria-label') ?? '')); if (!s) return null; s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; }, v);
    await blend('normal'); await wait(1500); await o.screenshot({ path: path.join(OUT, 'camada-video-normal.png') });
    const tela = await blend('screen'); await wait(1500); await o.screenshot({ path: path.join(OUT, 'camada-video-tela.png') });
    R.ok('video', 'modo Tela na camada de vídeo (capturas camada-video-*.png para conferir a logo)', tela === 'screen', OUT);
    await c.evaluate(() => [...document.querySelectorAll('.layer button.mv')].find((x) => /Tirar .*v[íi]deo/i.test(x.getAttribute('aria-label') ?? ''))?.click());
    await tab('Fundo');
    await click('Sem vídeo', true);
  });

  // ---------- gravação 16:9 ----------
  await block('gravacao', async () => {
    await openTel();
    await tab('Saída');
    await c.evaluate(() => { const sel = [...document.querySelectorAll('.tabBody select')]; const set = (pred, v) => { const s = sel.find((x) => [...x.options].some(pred)); if (s) { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); } }; set((o) => o.value === 'VERTICAL', 'TELAO'); set((o) => o.value === 'LEVE', 'LEVE'); set((o) => o.value === '30', '30'); });
    await wait(500);
    files.watchDir('recordings');
    await click('Gravar', true); await wait(10300); await click('Parar', true);
    const last = await until(async () => (await body()).match(/Última: (.+)/)?.[1]?.trim(), 15000, 250);
    const f = last ? files.add(last) : null;
    const ok = f && fs.existsSync(f), size = ok ? fs.statSync(f).size : 0, head = ok ? fs.readFileSync(f).subarray(4, 8).toString() : '';
    R.ok('gravacao', 'Gravar 10 s → arquivo com ftyp', ok && size > 0 && (head === 'ftyp' || f.endsWith('.webm')), `${f ? path.basename(f) : 'sem arquivo'} · ${(size / 1048576).toFixed(1)} MB · ${head}`);
    // Gravar → Parar em 100 ms (vertical): não pode ficar preso em "Finalizando…" nem deixar arquivo (fix `stopAsked`)
    await c.evaluate(() => { const s = [...document.querySelectorAll('.tabBody select')].find((x) => [...x.options].some((o) => o.value === 'VERTICAL')); if (s) { s.value = 'VERTICAL'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await wait(500);
    const recDir = path.join(APP_DATA, 'recordings');
    const names = () => (fs.existsSync(recDir) ? fs.readdirSync(recDir) : []);
    const before = new Set(names()), tq = Date.now();
    await click('Gravar', true); await wait(100); await click('Parar', true);
    const back = await until(() => c.evaluate(() => [...document.querySelectorAll('.tabBody button')].some((x) => x.textContent.trim() === 'Gravar')), 10000, 250);
    await wait(1500);
    const extra = names().filter((n) => !before.has(n));
    // um arquivo que sobrou é do teste se o nome é do instante desta gravação (o app nomeia AAAAMMDDTHHMMSS)
    const stamp = (n) => { const m = n.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN; };
    for (const n of extra) if (Math.abs(stamp(n) - tq) < 15000) files.add(path.join(recDir, n));
    R.ok('gravacao', 'Gravar → Parar em 100 ms (vertical): volta a "Gravar" e não sobra arquivo', !!back && extra.length === 0, `${back ? 'botão Gravar de volta' : 'preso'} · ${extra.length ? 'sobrou: ' + extra.join(', ') : 'nenhum arquivo novo'}`);
  });

  // ---------- OSC ----------
  await block('osc', async () => {
    const port = await freeUdpPort();
    await tab('Saída');
    R.ok('osc', `porta livre ${port} no campo do OSC`, await setPortOf('OSC', port));
    await click('Ligar OSC');
    const st = await until(async () => { const s = (await inv('osc_status')).v; return s?.running ? s : null; }, 5000);
    R.ok('osc', 'servidor ligado', !!st, JSON.stringify(st));
    const str = (s) => { const x = Buffer.from(s + '\0'); return Buffer.concat([x, Buffer.alloc((4 - (x.length % 4)) % 4)]); };
    const u = dgram.createSocket('udp4');
    const send = (tag) => new Promise((r) => u.send(Buffer.concat([str('/doublek/v1/blackout'), str(',' + tag)]), port, '127.0.0.1', r));
    const bo = await blackout();
    await send(bo ? 'F' : 'T');
    const flipped = await until(async () => (await blackout()) === !bo, 3000, 100);
    await send(bo ? 'T' : 'F');
    const back = await until(async () => (await blackout()) === bo, 3000, 100);
    u.close();
    R.ok('osc', '/doublek/v1/blackout por UDP liga e desliga', flipped && back, `recebidas ${(await inv('osc_status')).v?.received}`);
    await click('Desligar OSC'); await wait(300);
  });

  // ---------- celular ----------
  await block('celular', async () => {
    const port = await freeTcpPort();
    await tab('Saída');
    R.ok('celular', `porta livre ${port} no campo do celular`, await setPortOf('Celular', port));
    await click('Ligar celular');
    R.ok('celular', 'serviço ligado', !!(await until(async () => (await inv('remote_status')).v?.running, 5000)));
    // D-30: o `remote_status` do teste pode responder antes de a tela ver o serviço ligado; aí "Mostrar código" ainda
    // não existia, o código nunca aparecia e o bloco caía com "text is not iterable" ao digitar `undefined`
    const shown = await until(() => click('Mostrar código'), 10000);
    const code = await until(() => c.evaluate(() => [...document.querySelectorAll('.pair')].map((x) => x.textContent.trim()).find((t) => /^\d{6}$/.test(t))), 10000);
    R.ok('celular', 'app mostra o código de 6 dígitos', !!code, shown ? '' : 'botão "Mostrar código" não apareceu');
    if (!code) return;
    const edge = await launchEdge();
    try {
      const ph = await edge.browser.newPage();
      await ph.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      ph.on('pageerror', (e) => errs.celular.push(e.message));
      ph.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|40[19]|429/.test(m.text())) errs.celular.push(m.text().slice(0, 200)); });
      const vis = (id) => ph.evaluate((id) => !document.getElementById(id).hidden, id);
      const txt = (id) => ph.evaluate((id) => document.getElementById(id).textContent, id);
      const typeCode = async (s) => { await ph.evaluate(() => { document.getElementById('code').value = ''; }); await ph.type('#code', s); };
      await ph.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await typeCode(String((+code + 1) % 1e6).padStart(6, '0'));
      R.ok('celular', 'código errado → erro na tela', !!(await until(async () => /Código errado/.test(await txt('pairErr')), 4000)), await txt('pairErr'));
      await typeCode(code);
      R.ok('celular', 'código certo → tela de controle', !!(await until(() => vis('ctl'), 5000)));
      const pads = await until(async () => { const p = await ph.$$eval('#pads button', (bs) => bs.map((b) => b.textContent)); return p.length === 8 && p[0] !== 'Cena 1' ? p : null; }, 5000);
      R.ok('celular', '8 pads com os nomes das cenas do app', !!pads, (pads ?? []).join(' | '));
      if (process.env.SHOTS) { // capturas para docs/img (retrato e paisagem, com a cena 2 acesa)
        await ph.tap('#pads button:nth-child(2)');
        await until(() => ph.$eval('#pads button:nth-child(2)', (x) => x.classList.contains('on')), 5000);
        await wait(600);
        await ph.screenshot({ path: path.join(OUT, 'celular-retrato.png') });
        await ph.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await wait(800);
        await ph.screenshot({ path: path.join(OUT, 'celular-paisagem.png') });
        await ph.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await wait(500);
      }
      const bo = await blackout();
      await ph.tap('#blackout');
      R.ok('celular', 'BLACKOUT pelo celular', !!(await until(async () => (await blackout()) === !bo, 3000, 100)));
      await ph.tap('#blackout');
      await until(async () => (await blackout()) === bo, 3000, 100);
      for (let k = 0; k < 3; k++) { await ph.tap('#blackout'); await wait(120); await ph.tap('#blackout'); await wait(450); }
      await wait(1500);
      R.ok('celular', 'toque duplo rápido ×3 → volta ao estado inicial (app e celular)', (await blackout()) === bo && (await ph.$eval('#blackout', (x) => x.classList.contains('on'))) === bo);
      await ph.evaluate(async () => { const el = document.querySelector('[data-knob="amount"]'); for (let i = 1; i <= 25; i++) { el.value = String(i === 25 ? 0.6 : Math.random()); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 20)); } });
      let seen = NaN;
      const ok = await until(async () => { seen = await knob('Pulso'); return Math.abs(seen - 0.9) < 0.011; }, 8000, 300);
      R.ok('celular', 'arraste rápido do slider: o app termina no valor final', !!ok, `knob Pulso ${seen} (esperado 0,90 = 0,6 × 1,5)`);
      const net = await ph.createCDPSession();
      await net.send('Network.enable');
      await net.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      R.ok('celular', 'sem rede: faixa "sem conexão" e controles desabilitados', !!(await until(async () => (await vis('offline')) && (await ph.$eval('#panic', (x) => x.disabled)), 5000)));
      await net.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      R.ok('celular', 'rede voltou: faixa some', !!(await until(async () => !(await vis('offline')), 5000)));
      await click('Desconectar todos');
      R.ok('celular', 'Desconectar todos → celular volta ao pareamento', !!(await until(() => vis('pair'), 5000)));
      R.ok('celular', 'console do celular sem erros/CSP', errs.celular.length === 0, errs.celular.join(' | '));
    } finally {
      await edge.close();
    }
    await click('Desligar celular'); await wait(300);
  });

  // ---------- console e fechamento deste exe ----------
  const all = [...errs.controle.map((x) => 'controle: ' + x), ...errs['telão'].map((x) => 'telão: ' + x)];
  R.ok(current, 'console do controle e do telão sem erros/CSP', all.length === 0, all.join(' | '));
  if (o) {
    const t0 = Date.now();
    try { await within(closeTel(), 15000, 'fechar o telão'); R.ok(current, 'fechar o telão no fim', true, `${Date.now() - t0} ms`); }
    catch (e) { R.ok(current, 'fechar o telão no fim', false, `${e.message} (janela de controle ocupada — ver o bloco "resposta")`); }
  }
}

try {
  const M = await media();
  for (const name of BLOCKS) {
    if (!only.has(name)) continue;
    try { await session(name, M); } catch (e) { R.ok(name, 'abrir o exe e rodar o bloco', false, e.message); }
    if (app) { await app.close(); app = null; }
  }
} catch (e) {
  R.ok('geral', 'preparo do smoke', false, e.message);
}
await finish();
