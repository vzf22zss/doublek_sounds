// Mídia de teste do smoke, gerada aqui (nada de terceiros) e guardada em %TEMP%\doublek-e2e-media:
// - "Anéis neon.webm" (8 s, 960×540, VP9) para a camada de vídeo;
// - "kf2-webm.webm" (6 s, keyframe a cada 2 s, o segundo desenhado) para o loop início/fim — o seek para 1 s cai no
//   keyframe do 0 s, que era o caso que travava (0.3.8);
// - os 2 exemplos de docs/examples/fx empacotados (.doublekfx) com o writeFxPack do próprio app.
// Uso solto: node scripts/e2e/media.mjs  (imprime os caminhos)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFxPack, readFxPack } from '../../src/lib/shaders/manifest.ts';
import { launchEdge, REPO } from './lib.mjs';

export const MEDIA_DIR = path.join(os.tmpdir(), 'doublek-e2e-media');
const FILES = { neon: 'Anéis neon.webm', loop: 'kf2-webm.webm', rgb: 'rgb-split-kick.doublekfx', ondas: 'ondas-grave.doublekfx' };

/** Grava um vídeo de `secs` s desenhando `draw(g, s)` num canvas, pelo MediaRecorder do Edge. */
async function record(page, mime, secs, w, h, drawSrc) {
  const b64 = await page.evaluate(async (mime, secs, w, h, drawSrc) => {
    if (!MediaRecorder.isTypeSupported(mime)) throw new Error('sem ' + mime);
    const draw = new Function('g', 's', 'w', 'h', drawSrc);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 3_000_000, videoKeyFrameIntervalDuration: 2000 });
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const t0 = performance.now();
    rec.start(250);
    await new Promise((res) => { const f = () => { const s = (performance.now() - t0) / 1000; draw(g, s, w, h); if (s < secs) requestAnimationFrame(f); else res(); }; f(); });
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    const buf = new Uint8Array(await new Blob(parts).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  }, mime, secs, w, h, drawSrc);
  return Buffer.from(b64, 'base64');
}

const RINGS = `g.fillStyle = '#05010d'; g.fillRect(0, 0, w, h);
for (let i = 18; i > 0; i--) { const r = (i * 34 + s * 90) % 612;
  g.strokeStyle = 'hsl(' + ((s * 40 + i * 22) % 360) + ' 95% ' + (45 + 15 * Math.sin(s * 3 + i)) + '%)'; g.lineWidth = 6 + 4 * Math.sin(s * 2 + i);
  g.beginPath(); g.ellipse(w / 2, h / 2, r * 1.4, r, s * 0.3 + i * 0.05, 0, Math.PI * 2); g.stroke(); }`;
const SECONDS = `g.fillStyle = 'hsl(' + ((s * 72) % 360) + ' 70% 35%)'; g.fillRect(0, 0, w, h);
g.fillStyle = '#fff'; g.font = 'bold 220px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(Math.floor(s)), w / 2, h / 2 + 10);
g.fillRect(0, h - 20, (s / 6) * w, 20);`;

/** Caminhos da mídia (gera o que faltar). */
export async function media() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const p = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, path.join(MEDIA_DIR, f)]));
  for (const ex of ['rgb-split-kick', 'ondas-grave']) {
    const out = path.join(MEDIA_DIR, `${ex}.doublekfx`);
    if (fs.existsSync(out)) continue;
    const dir = path.join(REPO, 'docs', 'examples', 'fx', ex);
    const bytes = writeFxPack({ manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), code: fs.readFileSync(path.join(dir, 'effect.frag'), 'utf8') });
    readFxPack(bytes); // o que o app vai ler
    fs.writeFileSync(out, bytes);
  }
  if (!fs.existsSync(p.neon) || !fs.existsSync(p.loop)) {
    const edge = await launchEdge();
    try {
      const page = await edge.browser.newPage();
      await page.goto('about:blank');
      if (!fs.existsSync(p.neon)) fs.writeFileSync(p.neon, await record(page, 'video/webm;codecs=vp9', 8, 960, 540, RINGS));
      if (!fs.existsSync(p.loop)) fs.writeFileSync(p.loop, await record(page, 'video/webm;codecs=vp9', 6, 640, 360, SECONDS));
    } finally {
      await edge.close();
    }
  }
  return p;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await media());
