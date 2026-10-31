// DK-044 — stress no mock (Edge headless, inject.js). Parte A: 5 min de comandos aleatórios (~20/s) com o áudio
// sintético alternando groove/breakdown; métricas por minuto. Parte B: taxa real de flashes do strobe no telão
// (uniform uStrobe, relógio virtual em passos de 4 ms), com e sem o limite de flashes.
// Uso: ver scripts/stress/README.md. Grava stress-result.json na pasta atual (não versionar).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const CAP = process.env.DOUBLEK_MOCK; // pasta com inject.js (mock do Tauri) e puppeteer-core instalado
if (!CAP || !fs.existsSync(path.join(CAP, 'inject.js'))) { console.error('Defina DOUBLEK_MOCK com a pasta do mock (inject.js + node_modules/puppeteer-core).'); process.exit(2); }
const puppeteer = createRequire(CAP + '/package.json')('puppeteer-core');
const OUT = process.cwd();
const URL0 = `http://localhost:${process.env.PORT ?? 4183}/`;
const SECS = +(process.argv[2] ?? 300);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// grava cada uniform uStrobe com o relógio da página (virtual no mock)
const STROBE_SPY = `(() => {
  const P = WebGL2RenderingContext.prototype, names = new WeakMap(), gul = P.getUniformLocation, u1 = P.uniform1f;
  P.getUniformLocation = function (p, n) { const l = gul.call(this, p, n); if (l) names.set(l, n); return l; };
  window.__strobe = [];
  P.uniform1f = function (l, v) { if (l && names.get(l) === 'uStrobe') { const a = window.__strobe; a.push(performance.now(), v); if (a.length > 400000) a.splice(0, 200000); } return u1.call(this, l, v); };
})();`;

const b = await puppeteer.launch({ executablePath: process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info',
  // as duas janelas rodam ao mesmo tempo, como no app: sem frear timers/rAF da aba que não está na frente
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
const open = async (p, w, h, spy = false, existing = null) => {
  const pg = existing ?? await b.newPage();
  if (!existing) await pg.setViewport({ width: w, height: h });
  await pg.evaluateOnNewDocument(fs.readFileSync(path.join(CAP, 'inject.js'), 'utf8'));
  await pg.evaluateOnNewDocument('window.__breakdown = false');
  if (spy) await pg.evaluateOnNewDocument(STROBE_SPY);
  pg.on('pageerror', (e) => errors.push(`${p} pageerror: ${e.message}`));
  pg.on('console', (m) => { if (m.type() === 'error') errors.push(`${p} console.error: ${m.text()}`); });
  await pg.goto(URL0 + p);
  return pg;
};
const heap = async (pg) => {
  const s = await pg.createCDPSession();
  await s.send('Performance.enable');
  await s.send('HeapProfiler.collectGarbage');
  const m = await s.send('Performance.getMetrics');
  await s.detach();
  return Math.round((m.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1024);
};
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

// ---------------- parte A ----------------
let c = await open('control.html', 1280, 800);
const eight = (k) => Array.from({ length: 8 }, (_, i) => (i < 5 ? { name: `B${k} C${i + 1}`, look: { bgc1: ['#200040', '#002040', '#402000', '#004020', '#300030'][i], fxRings: 0.2 * i } } : null));
await c.evaluate((banks, R) => {
  localStorage.clear();
  localStorage.setItem('doublek.banks', JSON.stringify({ v: 1, data: banks }));
  localStorage.setItem('doublek.roteiros', JSON.stringify({ v: 1, data: [R] }));
}, { active: 0, banks: [1, 2, 3].map((k) => ({ name: `Banco ${k}`, scenes: eight(k) })) }, {
  id: 'r1', name: 'Stress', track: '18f3a2b.mp3', trackName: 'faixa.mp3', bpm: 148, anchor: 0.2, barShift: 0, goBeat: 0,
  cues: [0, 16, 32, 48, 64, 80].flatMap((b, i) => [
    { id: `s${b}`, beat: b, kind: 'scene', scene: i % 5, fade: 2, ...(i % 2 ? { bank: 1 } : {}) },
    { id: `f${b}`, beat: b + 4, kind: 'fx', fx: ['strobe', 'flash', 'blackout', 'logoOnly'][i % 4], beats: 4, div: 2 },
    { id: `k${b}`, beat: b + 8, kind: 'knob', key: 'trail', to: (i % 3) / 3, ramp: 8 },
  ]),
});
await c.close();
c = await open('control.html', 1280, 800);
// o telão numa JANELA própria (popup), como no app: aba em segundo plano não recebe quadros no Edge headless
const popup = b.waitForTarget((t) => t.opener() === c.target());
await c.evaluate(() => window.open('about:blank', 'telao', 'popup,width=640,height=360'));
const o = await open('output.html', 960, 540, true, await (await popup).page());
await c.bringToFront();
await wait(3000);
// roteiro escolhido (GO/STOP aleatórios vão tocar de verdade)
await c.evaluate(() => [...document.querySelectorAll('.tabs button')].find((x) => x.textContent === 'Roteiro').click());
await wait(300);
await c.select('aside select', 'r1');
await wait(1500);
// telemetria do telão chega no controle pelo canal do mock
await c.evaluate(() => {
  window.__tel = [];
  const ch = new BroadcastChannel('tauri-mock');
  ch.onmessage = (e) => { if (e.data.target === 'control' && e.data.event === 'telemetry') window.__tel.push({ t: Date.now(), ...e.data.payload }); };
});
// gerador de comandos (~20/s) e verificador de fila presa (1×/s, fora de qualquer dispatch)
await c.evaluate(() => {
  const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)];
  const src = () => pick(['ui', 'ui', 'midi', 'midi', 'keyboard', 'automation']);
  let sent = 0, refused = 0, notIdle = 0, histMax = 0;
  const why = {};
  const send = (cmd, s = src()) => { sent++; const r = window.__dispatch(cmd, s); if (!r.ok) { refused++; const k = r.reason.replace(/\d+/g, 'N').slice(0, 60); why[k] = (why[k] ?? 0) + 1; } };
  const fader = (key, from, to) => { for (let i = 0; i <= 10; i++) send({ type: 'SET_PARAMETER', key, value: +(from + ((to - from) * i) / 10).toFixed(3) }, 'midi'); };
  const gens = [
    () => send({ type: 'SCENE_RECALL', index: Math.floor(R() * 8), fade: pick([0, 1, 2]) }),
    () => send({ type: 'SCENE_PREVIEW', index: Math.floor(R() * 5) }),
    () => send({ type: 'SCENE_TAKE', fade: pick([0, 2]) }),
    () => send({ type: 'PREVIEW_CLEAR' }),
    () => send({ type: 'PREVIEW_MODE' }),
    () => send({ type: 'BANK_STEP', delta: pick([-1, 1]) }),
    () => send({ type: 'BANK_SET', index: Math.floor(R() * 3) }),
    () => send({ type: 'MACRO', id: pick(['BUILD_UP', 'DROP', 'CHAOS']) }),
    () => send({ type: 'FX_BURST', fx: pick(['strobe', 'flash']), beats: 2, div: pick([1, 2, 4]) }, 'midi'),
    () => fader(pick(['trail', 'glow', 'chroma', 'fxRings', 'bgPulse']), R(), R()),
    () => send({ type: 'VIDEO_SET', id: pick(['', 'v1']) }),
    () => send({ type: 'ROTEIRO_GO' }),
    () => send({ type: 'ROTEIRO_STOP' }),
    () => send({ type: 'ROTEIRO_NUDGE', beats: pick([-4, -1, 1, 4]) }),
    () => send({ type: 'AUTOMATION_MODE' }),
    () => send({ type: 'BLACKOUT', on: R() < 0.5 }),
    () => send({ type: 'TAP' }),
  ];
  // ~20 comandos/s em média: o timer atrasa quando o GL por software segura a thread, então recupera pelo relógio
  const start = performance.now(); let ticks = 0;
  setInterval(() => {
    const due = Math.floor(((performance.now() - start) / 1000) * 20);
    for (; ticks < due; ticks++) {
      const g = R() < 0.01 ? () => send({ type: 'PANIC' }) : R() < 0.02 ? () => send({ type: 'MACRO', id: 'RESET' }) : pick(gens);
      g();
    }
  }, 50);
  setInterval(() => {
    if (!window.__commands.idle()) notIdle++;
    histMax = Math.max(histMax, window.__commands.history().length);
  }, 1000);
  window.__stats = () => ({ sent, refused, notIdle, histMax, hist: window.__commands.history().length });
  window.__why = () => why;
});
const targets = () => o.evaluate(async () => (await import('/src/render/gl/texture.ts')).targetsMade());
const minutes = [];
const t0 = Date.now();
let breakdown = false, nextFlip = 20000;
for (let m = 1; Date.now() - t0 < SECS * 1000; m++) {
  const mEnd = Math.min(m * 60000, SECS * 1000);
  while (Date.now() - t0 < mEnd) {
    if (Date.now() - t0 > nextFlip) { breakdown = !breakdown; nextFlip += 20000; for (const p of [c, o]) await p.evaluate((x) => (window.__breakdown = x), breakdown); }
    await wait(1000);
  }
  const tel = await c.evaluate((a, b) => window.__tel.filter((x) => x.t >= a && x.t < b), t0 + (m - 1) * 60000, t0 + mEnd);
  const row = {
    min: m, p95: +quantile(tel.map((x) => x.p95), 0.5).toFixed(1), p99: +quantile(tel.map((x) => x.p99), 0.5).toFixed(1), fps: +quantile(tel.map((x) => x.fps), 0.5).toFixed(1),
    drops: tel.reduce((s, x) => s + (x.drops ?? 0), 0), heapControlKB: await heap(c), heapOutputKB: await heap(o), targets: await targets(), ...(await c.evaluate(() => window.__stats())),
  };
  minutes.push(row);
  log('minuto', JSON.stringify(row));
}
const strobeA = await o.evaluate(() => window.__strobe.slice());
const whyA = await c.evaluate(() => window.__why());

// ---------------- parte B: taxa de flashes, passos de 4 ms ----------------
await c.close(); await o.close();
const rate = async (div, safe) => {
  const p = await open('output.html', 640, 360, true);
  await wait(2500);
  await p.evaluate(async (div, safe) => {
    const { VISUAL } = await import('/src/lib/settings.ts');
    const v = { ...structuredClone(VISUAL), strobe: 1, strobeDiv: div, safeFlash: safe, react: true, blackout: false };
    window.__step(1);
    new BroadcastChannel('tauri-mock').postMessage({ target: 'output', event: 'visual', payload: v });
  }, div, safe);
  await p.evaluate(async () => { for (let i = 0; i < 250; i++) { window.__step(4); if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0)); } window.__strobe = []; }); // 1 s de assentamento
  await p.evaluate(async () => { for (let i = 0; i < 2500; i++) { window.__step(4); if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0)); } });
  const a = await p.evaluate(() => window.__strobe.slice());
  await p.close();
  const on = [];
  for (let i = 2, prev = 0; i < a.length; i += 2) { const v = a[i + 1]; if (v > 0.05 && prev <= 0.05) on.push(a[i]); prev = v; }
  let max = 0;
  for (let i = 0; i < on.length; i++) { let j = i; while (j < on.length && on[j] - on[i] < 1000) j++; max = Math.max(max, j - i); }
  const peak = a.filter((_, i) => i % 2).reduce((m, v) => Math.max(m, v), 0);
  return { div, safe, seconds: 10, flashes: on.length, maxPerSecond: max, peak: +peak.toFixed(2), samples: a.length / 2 };
};
const rates = [];
if (process.argv[3] !== 'semB') for (const [div, safe] of [[1, true], [2, true], [4, true], [4, false]]) { const r = await rate(div, safe); rates.push(r); log('strobe', JSON.stringify(r)); }

// strobe durante o stress (amostrado no ritmo do render, subestima flashes curtos: só informativo)
const onA = [];
for (let i = 0, prev = 0; i < strobeA.length; i += 2) { const v = strobeA[i + 1]; if (v > 0.05 && prev <= 0.05) onA.push(strobeA[i]); prev = v; }
let maxA = 0;
for (let i = 0; i < onA.length; i++) { let j = i; while (j < onA.length && onA[j] - onA[i] < 1000) j++; maxA = Math.max(maxA, j - i); }

const result = { secs: SECS, minutes, rates, stressStrobeMaxPerSecond: maxA, refusedWhy: whyA, errors };
fs.writeFileSync(path.join(OUT, 'stress-result.json'), JSON.stringify(result, null, 2));
log('erros:', errors.length, errors.slice(0, 10));
await b.close();
