// Soak de sessão longa (regressão 0.3.8): o app no mock do Tauri por N segundos (padrão 2 h) em ritmo de show.
// - telão em janela própria; áudio sintético do mock + fases por cima (groove, breakdown, virada, drop, pausa,
//   faixa defasada com kickRate 0 = guarda P8), com os indicadores do DK-031 (contrast, stability, kickRate);
// - comandos: ~5/s nos trechos "DJ mexendo" (2 de cada 5 min), quase nada no resto (a automação age);
// - Intelligent Show em Automático com o mapa preenchido; roteiro tocando 10 de cada 30 min;
// - gravação em blocos de 5 min (5 ligada, 5 desligada), 16:9 e vertical alternados, bytes descartados;
// - editor de FX aberto 10 de cada 30 min.
// Por minuto: p95/fps do telão, heap das duas janelas (CDP depois de GC), alvos GL, histórico, fila, erros.
// ATENÇÃO (D-22): o telão é popup do controle (window.open, mesma origem), então as duas janelas dividem o mesmo
// processo e isolate V8: heapC e heapO medem o MESMO heap. O mock precisa de __TAURI_EVENT_PLUGIN_INTERNALS__
// (o unlisten() da API chama unregisterListener antes do invoke), senão cada listen/unlisten do app fica retido.
// SOAK_NO_FX=1: rodada de controle sem o editor de FX (não cria efeito nem visita a aba Efeitos).
// Uso: DOUBLEK_MOCK=<pasta com inject.js e puppeteer-core> node scripts/stress/soak.mjs [segundos=7200]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const CAP = process.env.DOUBLEK_MOCK;
if (!CAP || !fs.existsSync(path.join(CAP, 'inject.js'))) { console.error('Defina DOUBLEK_MOCK com a pasta do mock (inject.js + node_modules/puppeteer-core).'); process.exit(2); }
const puppeteer = createRequire(path.join(CAP, 'package.json'))('puppeteer-core');
const URL0 = `http://localhost:${process.env.PORT ?? 4183}/`;
const SECS = +(process.argv[2] ?? 7200);
const NO_FX = process.env.SOAK_NO_FX === '1'; // D-22: rodada de controle sem o editor de FX
const OUT = process.cwd();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// rec_* descartando bytes; beat/versão; e as fases do áudio por cima dos quadros do mock
const STUBS = `(() => {
  const I = window.__TAURI_INTERNALS__, orig = I.invoke;
  window.__recBytes = 0;
  I.invoke = async (cmd, a, o) => {
    if (cmd === 'rec_start') return 'mock/' + a.id;
    if (cmd === 'rec_chunk') { window.__recBytes += a.byteLength; return { total: window.__recBytes, stop: null }; }
    if (cmd === 'rec_stop') return { path: 'mock/' + a.id, bytes: window.__recBytes };
    if (cmd === 'rec_abort' || cmd === 'beat') return null;
    if (cmd === 'plugin:app|version') return '0.3.8';
    return orig(cmd, a, o);
  };
  window.__phase = 'groove';
  const tc = I.transformCallback;
  I.transformCallback = (cb, once) => tc((m) => {
    const f = m?.message?.t === 'frame' ? m.message.v : null;
    if (f) {
      const p = window.__phase;
      f.stability = p === 'defasada' ? 0.3 : 0.9;
      f.contrast = p === 'virada' ? 1.4 : 1.0;
      f.kickRate = p === 'groove' || p === 'drop' ? 4 : 0;
      if (p === 'pausa') { f.rms = 0.001; f.peak = 0.002; f.bands = [0, 0, 0, 0, 0]; f.kick = 0; f.low = 0; }
      if (p === 'defasada') { f.kick = 0; f.low = 1; f.locked = true; }
    }
    cb(m);
  }, once);
})();`;
// ciclo de 120 s (s desde o início do ciclo → fase; __breakdown do mock tira o kick e o grave)
const PHASES = [[45, 'groove'], [20, 'breakdown'], [10, 'virada'], [20, 'drop'], [5, 'pausa'], [12, 'defasada'], [8, 'groove']];
const phaseAt = (s) => { let t = s % 120; for (const [d, p] of PHASES) { if (t < d) return p; t -= d; } return 'groove'; };

const b = await puppeteer.launch({ executablePath: process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const errors = [];
const prep = async (p, label) => {
  await p.evaluateOnNewDocument(fs.readFileSync(path.join(CAP, 'inject.js'), 'utf8'));
  await p.evaluateOnNewDocument(STUBS);
  p.on('pageerror', (e) => errors.push({ t: Date.now(), where: label, msg: e.message }));
  p.on('console', (m) => { if (m.type() === 'error') errors.push({ t: Date.now(), where: label, msg: 'console.error: ' + m.text() }); });
};
const heap = async (pg) => {
  const s = await pg.createCDPSession();
  await s.send('Performance.enable');
  await s.send('HeapProfiler.collectGarbage');
  const m = await s.send('Performance.getMetrics');
  await s.detach();
  return Math.round((m.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1024);
};

// ---- estado inicial: 3 bancos, roteiro, mapa de automação ----
const L = (hex, x = {}) => ({ bgc1: hex, bgc2: hex, ...x });
const eight = (...s) => [...s, ...Array(8 - s.length).fill(null)];
const banks = { active: 0, banks: [1, 2, 3].map((k) => ({ name: 'Banco ' + k, scenes: eight(...['#200040', '#002040', '#402000', '#004020', '#300030'].map((h, i) => ({ name: `B${k} C${i + 1}`, look: L(h, { fxRings: 0.2 * i, trail: 0.1 * k }) }))) })) };
const cue = (beat, kind, x) => ({ id: `c${beat}${kind}`, beat, kind, ...x });
const R = { id: 'r1', name: 'Soak', track: '18f3a2b.mp3', trackName: 'faixa.mp3', bpm: 148, anchor: 0.2, barShift: 0, goBeat: 0,
  cues: [0, 32, 64, 96, 128, 160, 192, 224].flatMap((bt, i) => [cue(bt, 'scene', { scene: i % 5, fade: 2, ...(i % 3 === 1 ? { bank: 1 } : {}) }), cue(bt + 8, 'fx', { fx: ['strobe', 'flash', 'logoOnly'][i % 3], beats: 4, div: 2 }), cue(bt + 16, 'knob', { key: 'trail', to: (i % 4) / 4, ramp: 8 })]) };
const auto = { enabled: { breakdown: true, buildUp: true, drop: true, groove: true }, dropScene: { bank: 1, index: 2 }, grooveScene: { bank: 0, index: 1 } };

let c = await b.newPage();
await c.setViewport({ width: 1280, height: 800 });
await prep(c, 'controle');
await c.goto(URL0 + 'control.html');
await c.evaluate((banks, R, auto) => {
  localStorage.clear();
  localStorage.setItem('doublek.banks', JSON.stringify({ v: 1, data: banks }));
  localStorage.setItem('doublek.roteiros', JSON.stringify({ v: 1, data: [R] }));
  localStorage.setItem('doublek.automation', JSON.stringify({ v: 1, data: auto }));
}, banks, R, auto);
await c.reload();
await wait(2000);
const pop = b.waitForTarget((t) => t.opener() === c.target());
await c.evaluate(() => window.open('about:blank', 'telao', 'popup,width=1280,height=720'));
const o = await (await pop).page();
await prep(o, 'telão');
await o.goto(URL0 + 'output.html');
await wait(2000);
await c.bringToFront();

const tab = (n) => c.evaluate((n) => [...document.querySelectorAll('.tabs button')].find((x) => x.textContent === n)?.click(), n);
const ui = (fn, ...a) => c.evaluate(fn, ...a).catch((e) => errors.push({ t: Date.now(), where: 'script', msg: 'ação do teste falhou: ' + e.message }));
// roteiro escolhido; modo Automático; um efeito de FX criado
await tab('Roteiro'); await wait(300);
await c.select('aside select', 'r1').catch(() => {});
await wait(1500);
await ui(() => window.__dispatch({ type: 'AUTOMATION_MODE', mode: 'AUTO' }, 'ui'));
if (!NO_FX) {
await tab('Efeitos'); await wait(300);
await ui(() => { const d = document.querySelector('details.fx'); if (!d.open) d.querySelector('summary').click(); });
await wait(500);
await ui(() => [...document.querySelectorAll('details.fx button')].find((x) => x.textContent === 'Novo')?.click());
await wait(1500);
}
await tab('Saída');
// telemetria do telão + estado do Intelligent Show, guardados na página
await c.evaluate(() => {
  window.__tel = []; window.__states = {};
  new BroadcastChannel('tauri-mock').onmessage = (e) => { if (e.data.target === 'control' && e.data.event === 'telemetry') window.__tel.push({ t: Date.now(), ...e.data.payload }); };
  setInterval(() => { const s = document.querySelector('.perf .state')?.textContent?.split(' ')[0] ?? '?'; window.__states[s] = (window.__states[s] ?? 0) + 1; }, 1000);
});
// gerador: ~5/s com o "DJ mexendo" (2 de cada 5 min); 1 a cada 5 s no resto, só pela automação/roteiro
await c.evaluate(() => {
  const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)];
  let sent = 0, refused = 0, notIdle = 0, histMax = 0;
  const send = (cmd, s) => { sent++; if (!window.__dispatch(cmd, s).ok) refused++; };
  const gens = [
    () => send({ type: 'SCENE_RECALL', index: Math.floor(R() * 5), fade: pick([0, 1, 2, 4]) }, pick(['ui', 'midi', 'keyboard'])),
    () => send({ type: 'SCENE_PREVIEW', index: Math.floor(R() * 5) }, 'ui'),
    () => send({ type: 'SCENE_TAKE' }, 'midi'),
    () => send({ type: 'BANK_STEP', delta: pick([-1, 1]) }, 'midi'),
    () => { const k = pick(['trail', 'glow', 'chroma', 'fxRings']), a = R(), z = R(); for (let i = 0; i <= 4; i++) send({ type: 'SET_PARAMETER', key: k, value: +(a + ((z - a) * i) / 4).toFixed(3) }, 'midi'); },
    () => send({ type: 'MACRO', id: pick(['BUILD_UP', 'DROP', 'CHAOS']) }, 'ui'),
    () => send({ type: 'TAP' }, 'keyboard'),
  ];
  const t0 = Date.now();
  setInterval(() => {
    const min = (Date.now() - t0) / 60000;
    const active = min % 5 < 2;
    if (active || R() < 0.04) pick(gens)();
    if (R() < 0.0005) { send({ type: 'BLACKOUT', on: true }, 'ui'); setTimeout(() => send({ type: 'BLACKOUT', on: false }, 'ui'), 1500); }
  }, 200);
  setInterval(() => { if (!window.__commands.idle()) notIdle++; histMax = Math.max(histMax, window.__commands.history().length); }, 1000);
  window.__stats = () => ({ sent, refused, notIdle, histMax });
});

const targets = () => o.evaluate(async () => (await import('/src/render/gl/texture.ts')).targetsMade()).catch(() => -1);
const minutes = [];
const t0 = Date.now();
let lastPhase = '', recOn = false, fxOn = !NO_FX, rotOn = false, recFmt = 'TELAO';
const setRec = async (on) => {
  await tab('Saída'); await wait(300);
  if (on) {
    await ui((f) => { const s = [...document.querySelectorAll('aside select')].find((x) => [...x.options].some((o) => o.value === 'VERTICAL')); if (s) { s.value = f; s.dispatchEvent(new Event('change', { bubbles: true })); } }, recFmt);
    await wait(200);
    await ui(() => [...document.querySelectorAll('aside button')].find((x) => x.textContent.trim() === 'Gravar')?.click());
  } else await ui(() => [...document.querySelectorAll('aside button')].find((x) => x.textContent.trim() === 'Parar')?.click());
  await wait(500);
  if (fxOn) { await tab('Efeitos'); await wait(300); await ui(() => { const d = document.querySelector('details.fx'); if (d && !d.open) d.querySelector('summary').click(); }); }
};
for (let m = 1; Date.now() - t0 < SECS * 1000; m++) {
  const mEnd = Math.min(m * 60000, SECS * 1000);
  while (Date.now() - t0 < mEnd) {
    const s = Math.floor((Date.now() - t0) / 1000), min = s / 60;
    const ph = phaseAt(s);
    if (ph !== lastPhase) { lastPhase = ph; for (const p of [c, o]) await p.evaluate((ph) => { window.__phase = ph; window.__breakdown = ph === 'breakdown' || ph === 'virada' || ph === 'pausa'; }, ph).catch(() => {}); }
    const wantFx = !NO_FX && min % 30 < 10, wantRot = min % 30 >= 10 && min % 30 < 20, wantRec = min % 10 < 5;
    if (wantFx !== fxOn) { fxOn = wantFx; if (fxOn) { await tab('Efeitos'); await wait(300); await ui(() => { const d = document.querySelector('details.fx'); if (d && !d.open) d.querySelector('summary').click(); }); } else await tab('Saída'); }
    if (wantRot !== rotOn) { rotOn = wantRot; await ui((on) => window.__dispatch({ type: on ? 'ROTEIRO_GO' : 'ROTEIRO_STOP' }, 'ui'), rotOn); }
    if (wantRec !== recOn) { recOn = wantRec; if (recOn) recFmt = recFmt === 'TELAO' ? 'VERTICAL' : 'TELAO'; await setRec(recOn); }
    await wait(1000);
  }
  const from = t0 + (m - 1) * 60000;
  const tel = await c.evaluate((a, z) => { const x = window.__tel.filter((v) => v.t >= a && v.t < z); window.__tel = window.__tel.filter((v) => v.t >= z); return x; }, from, t0 + mEnd).catch(() => []);
  const med = (a) => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const row = {
    min: m, p95: med(tel.map((x) => x.p95)), fps: med(tel.map((x) => x.fps)), drops: tel.reduce((s, x) => s + (x.drops ?? 0), 0),
    heapC: await heap(c).catch(() => null), heapO: await heap(o).catch(() => null), targets: await targets(),
    ...(await c.evaluate(() => window.__stats()).catch(() => ({}))),
    rec: recOn ? recFmt : '-', fx: fxOn, roteiro: rotOn,
    hist: await c.evaluate(() => window.__commands.history().length).catch(() => null),
    errors: errors.length,
    mockC: await c.evaluate(() => window.__mockStats?.()).catch(() => null), mockO: await o.evaluate(() => window.__mockStats?.()).catch(() => null), // listen/unlisten do mock, se ele contar
  };
  minutes.push(row);
  log('min', JSON.stringify(row));
  fs.writeFileSync(path.join(OUT, 'soak-result.json'), JSON.stringify({ secs: SECS, noFx: NO_FX, minutes, errors, states: await c.evaluate(() => window.__states).catch(() => null) }, null, 1));
}

// ---- critérios ----
const fit = (xs) => { // inclinação por minuto (mínimos quadrados)
  const pts = xs.map((y, i) => [i, y]).filter(([, y]) => Number.isFinite(y)), n = pts.length;
  const mx = pts.reduce((s, [x]) => s + x, 0) / n, my = pts.reduce((s, [, y]) => s + y, 0) / n;
  const sxx = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0), sxy = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  return { slopePerMin: sxx ? sxy / sxx : 0, mean: my };
};
const after = minutes.slice(2); // dois minutos de aquecimento
const hc = fit(after.map((r) => r.heapC)); // heapO é o mesmo isolate (ver cabeçalho): só informativo
// D-22: piso (mínimo) de cada ciclo de 30 min, só nos min 10–30 do ciclo: fora o aquecimento (min 0–10 do 1º ciclo)
// e os blocos com o editor de FX aberto, que sobem o heap enquanto ele está aberto. Critério: os pisos crescem < 1 %/h.
const floors = [];
for (const r of minutes) { const k = Math.floor((r.min - 1) / 30); if ((r.min - 1) % 30 >= 10 && Number.isFinite(r.heapC)) floors[k] = Math.min(floors[k] ?? Infinity, r.heapC); }
const pisos = floors.filter(Number.isFinite);
const pisoPct = pisos.length >= 2 ? ((pisos.at(-1) - pisos[0]) / pisos[0] / ((pisos.length - 1) / 2)) * 100 : null; // ciclos de 0,5 h
const q = Math.max(1, Math.floor(minutes.length / 4));
const medOf = (rows) => { const s = rows.map((r) => r.p95).filter(Number.isFinite).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const p95First = medOf(minutes.slice(0, q)), p95Last = medOf(minutes.slice(-q));
const tg = after.map((r) => r.targets);
const criteria = {
  erros: { valor: errors.length, ok: errors.length === 0 },
  heapPisosPctPorHora: { valor: pisoPct === null ? null : +pisoPct.toFixed(2), pisosKB: pisos, ok: pisoPct !== null && pisoPct < 1,
    ...(pisoPct === null ? { nota: 'precisa de ≥ 2 ciclos (≥ 41 min)' } : {}) },
  p95UltimoQuartoSobrePrimeiro: { valor: +(p95Last / p95First).toFixed(3), primeiro: p95First, ultimo: p95Last, ok: p95Last <= 1.2 * p95First },
  alvosGL: { valor: [...new Set(tg)].join(','), ok: new Set(tg).size === 1 },
  filaPresa: { valor: minutes.at(-1)?.notIdle ?? null, ok: (minutes.at(-1)?.notIdle ?? 1) === 0 },
  historicoNoTeto: { valor: Math.max(...minutes.map((r) => r.histMax ?? 0)), ok: Math.max(...minutes.map((r) => r.histMax ?? 0)) <= 50 },
};
const info = { heapLinearPctPorHoraDesdeMin2: +((hc.slopePerMin * 60) / hc.mean * 100).toFixed(2) }; // antigo, sensível a aquecimento e degraus
fs.writeFileSync(path.join(OUT, 'soak-result.json'), JSON.stringify({ secs: SECS, noFx: NO_FX, minutes, errors, criteria, info, states: await c.evaluate(() => window.__states).catch(() => null) }, null, 1));
log('critérios', JSON.stringify(criteria), JSON.stringify(info));
await b.close();
process.exit(Object.values(criteria).every((x) => x.ok) ? 0 : 1);
