// Ponta a ponta no exe real (DoubleK Visuals): lançar o exe isolado, conectar, registrar resultados e limpar — sem
// nunca tocar no app instalado do usuário. Usado por smoke.mjs; ver README.md.
// Regras aprendidas nas ondas: WebView2 com pasta de dados própria (WEBVIEW2_USER_DATA_FOLDER) e porta de depuração
// livre; UMA conexão do puppeteer por execução (uma 2ª às vezes congela o endpoint), depois de ~12 s do exe abrir;
// recarregar com evaluate(location.reload()), nunca page.reload(); ao fechar, matar também os msedgewebview2 da pasta.
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const EDGE = process.env.EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export const APP_DATA = path.join(process.env.APPDATA ?? '', 'com.doublek.visuals');
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** puppeteer-core vem de uma pasta à parte (sem dependência nova no repo), a mesma convenção do scripts/stress. */
export function puppeteer() {
  const dir = process.env.DOUBLEK_MOCK;
  if (!dir || !fs.existsSync(path.join(dir, 'node_modules', 'puppeteer-core'))) {
    throw new Error('Defina DOUBLEK_MOCK com uma pasta que tenha node_modules/puppeteer-core (npm i puppeteer-core nela).');
  }
  return createRequire(path.join(dir, 'package.json'))('puppeteer-core');
}

/** Resolve antes de `ms` ou falha com a mensagem (CDP às vezes não responde). */
export const within = (p, ms, what) => Promise.race([p, wait(ms).then(() => { throw new Error(`${what}: sem resposta em ${ms / 1000} s`); })]);

/** Espera `fn()` ficar verdadeiro (devolve o valor) ou estoura `ms` (devolve o último valor). */
export async function until(fn, ms = 5000, step = 200) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < ms) {
    v = await fn();
    if (v) return v;
    await wait(step);
  }
  return v;
}

// ---------- alvo: só um exe de worktree deste repo ----------

function worktrees() {
  const out = execFileSync('git', ['-C', REPO, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  return out.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => path.resolve(l.slice(9)).toLowerCase());
}

/** Recusa qualquer exe fora de um worktree deste repositório (o app instalado nunca é alvo). */
export function checkExe(exe) {
  const abs = path.resolve(exe), low = abs.toLowerCase();
  if (!fs.existsSync(abs)) throw new Error(`exe não encontrado: ${abs} — rode "npx tauri build --no-bundle" no worktree`);
  if (!low.endsWith('.exe')) throw new Error(`não é um .exe: ${abs}`);
  if (!worktrees().some((w) => low.startsWith(w + path.sep))) {
    throw new Error(`recuso rodar: ${abs} não está dentro de um worktree deste repositório (o app instalado nunca é alvo)`);
  }
  return abs;
}

// ---------- portas livres ----------

export const freeTcpPort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
export const freeUdpPort = () => new Promise((res, rej) => {
  const s = dgram.createSocket('udp4');
  s.once('error', rej);
  s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

// ---------- processos: só os desta execução ----------

/** PIDs cuja linha de comando contém `needle` (a pasta isolada desta execução). */
function pidsWith(needle) {
  const lit = needle.replace(/'/g, "''");
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${lit}') -and $_.Name -ne 'powershell.exe' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean).map(Number).filter((p) => p && p !== process.pid);
}
const killQuiet = (pid) => { try { process.kill(pid); } catch {} };

/** Mata o que esta execução abriu (exe filho + processos da pasta isolada) e apaga a pasta quando ela soltar. */
export async function killAndRemove(dir, childPid) {
  if (childPid) killQuiet(childPid);
  for (let round = 0; round < 3; round++) {
    for (const pid of pidsWith(dir)) killQuiet(pid);
    await wait(800);
  }
  for (let i = 0; i < 30; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return true; } catch { await wait(500); }
  }
  return false;
}

// ---------- o app ----------

/** Lança o exe com pasta de dados e porta de depuração próprias e conecta uma vez. O endpoint de depuração do WebView2
 *  às vezes congela na conexão: aí fecha tudo e tenta de novo com pasta e porta novas (`attempts` vezes). */
export async function launchApp({ exe, settleMs = 12000, attempts = 3 } = {}) {
  exe = checkExe(exe ?? path.join(REPO, 'src-tauri', 'target', 'release', 'doublek-visuals.exe'));
  for (let i = 1; ; i++) {
    try { return await launchOnce(exe, settleMs); } catch (e) {
      if (i >= attempts) throw e;
      console.log(`(tentativa ${i}: ${e.message} — de novo com pasta e porta novas)`);
      await wait(3000);
    }
  }
}

async function launchOnce(exe, settleMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doublek-e2e-app-'));
  const port = await freeTcpPort();
  const child = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: dir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: 'ignore',
  });
  const close = () => killAndRemove(dir, child.pid);
  try {
    const up = await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }, 30000, 500);
    if (!up) throw new Error('o exe não abriu a porta de depuração em 30 s');
    await wait(settleMs); // conectar cedo demais às vezes congela o endpoint do WebView2
    const browser = await within(puppeteer().connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null, protocolTimeout: 60000 }), 30000, 'conectar no WebView2');
    const pageFor = async (label, ms = 20000) => until(async () => (await browser.pages()).find((p) => p.url().includes(label)) ?? null, ms, 400);
    return { exe, dir, port, child, browser, pageFor, close: async () => { try { browser.disconnect(); } catch {} return close(); } };
  } catch (e) {
    await close();
    throw e;
  }
}

/** Edge headless com perfil próprio (o "celular", o leitor de vídeo). Fechar também apaga o perfil. */
export async function launchEdge(args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doublek-e2e-edge-'));
  const browser = await puppeteer().launch({ executablePath: EDGE, headless: true, userDataDir: dir, args: ['--no-first-run', '--no-default-browser-check', ...args] });
  return { browser, close: async () => { try { await browser.close(); } catch {} return killAndRemove(dir); } };
}

// ---------- arquivos que o teste cria em %APPDATA% ----------

/** Registra só os caminhos que o app disse ter criado; no fim apaga só eles (e a pasta, se não existia e ficou vazia). */
export function appDataFiles() {
  const files = [], existed = new Map();
  return {
    /** Antes de o app criar algo numa subpasta (ex.: 'recordings'): lembra se ela já existia. */
    watchDir(sub) { const d = path.join(APP_DATA, sub); if (!existed.has(d)) existed.set(d, fs.existsSync(d)); },
    add(file) {
      const abs = path.resolve(file);
      if (!abs.toLowerCase().startsWith(APP_DATA.toLowerCase() + path.sep)) throw new Error(`fora da pasta do app, não registro: ${abs}`);
      files.push(abs);
      return abs;
    },
    cleanup() {
      const removed = [];
      for (const f of files) { try { fs.rmSync(f); removed.push(f); } catch {} }
      for (const [d, was] of existed) { try { if (!was && fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d); } catch {} }
      return removed;
    },
  };
}

// ---------- resultados ----------

export function results() {
  const rows = [];
  return {
    rows,
    ok: (block, name, ok, extra = '') => { rows.push({ block, name, status: ok ? 'OK' : 'FALHA', extra }); console.log(`${ok ? 'OK    ' : 'FALHA '} [${block}] ${name}${extra ? ' — ' + extra : ''}`); },
    skip: (block, name, why) => { rows.push({ block, name, status: 'PULADO', extra: why }); console.log(`PULADO [${block}] ${name} — ${why}`); },
    table: () => ['| Bloco | Item | Resultado | Detalhe |', '|---|---|---|---|', ...rows.map((r) => `| ${r.block} | ${r.name} | ${r.status} | ${String(r.extra).replace(/\|/g, '/').slice(0, 160)} |`)].join('\n'),
    failed: () => rows.filter((r) => r.status === 'FALHA').length,
  };
}
