// npm run check — estado musical (DK-032) com sequências sintéticas: silêncio, breakdown → build → drop com UM drop,
// volume/ruído sem troca de estado, grave piscando sem cascata, BPM 135 e 220, sem BPM travado.
import assert from 'node:assert/strict';
import { createMusicState, type Features, type StateName } from './state.ts';

const FPS = 60;
type Seg = { bars: number; low: 0 | 1; rms: number | ((i: number, n: number) => number); mid?: number; air?: number; noise?: number; lowFlicker?: number };

/** Roda segmentos a `bpm` e devolve a linha do tempo de estados, os drops e as trocas. */
function run(segs: Seg[], bpm = 148, locked = true, seed = 1) {
  let t = 0, rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const ms = createMusicState({ now: () => t });
  const barMs = locked && bpm > 0 ? 240000 / bpm : 2000;
  const out: { t: number; seg: number; state: StateName; drop: boolean; conf: number }[] = [];
  segs.forEach((s, si) => {
    const frames = Math.round((s.bars * barMs * FPS) / 1000);
    for (let i = 0; i < frames; i++) {
      const base = typeof s.rms === 'function' ? s.rms(i, frames) : s.rms;
      const rms = Math.max(0, base * (1 + (s.noise ?? 0) * (rand() * 2 - 1)));
      const low = s.lowFlicker && rand() < s.lowFlicker ? (1 - s.low) as 0 | 1 : s.low;
      const f: Features = { rms, bands: [low ? 0.8 : 0.05, low ? 0.7 : 0.05, s.mid ?? rms, 0.3, s.air ?? rms], kick: 0, low, locked, bpm, beat: Math.floor(t / (60000 / (bpm || 120))), flux: 0.5 };
      const r = ms.update(f);
      out.push({ t, seg: si, state: r.state, drop: r.dropEvent, conf: r.confidence });
      t += 1000 / FPS;
    }
  });
  const changes = out.filter((x, i) => i && x.state !== out[i - 1].state).map((x) => `${x.seg}:${x.state}`);
  return { out, drops: out.filter((x) => x.drop), changes, barMs, last: (seg: number) => out.filter((x) => x.seg === seg).at(-1)! };
}

// --- silêncio: UNKNOWN o tempo todo, confiança baixa ---
{
  const r = run([{ bars: 10, low: 0, rms: 0.001 }]);
  assert.ok(r.out.every((x) => x.state === 'UNKNOWN' && x.conf <= 0.3));
  assert.equal(r.drops.length, 0);
}

// --- sem BPM nenhum: UNKNOWN ---
assert.ok(run([{ bars: 6, low: 1, rms: 0.3 }], 0, false).out.every((x) => x.state === 'UNKNOWN'));

// --- groove → breakdown → build-up → drop → groove: um drop só, na hora certa ---
for (const bpm of [148, 135, 220]) {
  const r = run([
    { bars: 12, low: 1, rms: 0.3, noise: 0.2 },                                   // 0 groove
    { bars: 8, low: 0, rms: 0.15, noise: 0.1 },                                   // 1 breakdown
    { bars: 8, low: 0, rms: (i, n) => 0.15 + 0.35 * (i / n), noise: 0.05 },       // 2 virada subindo
    { bars: 12, low: 1, rms: 0.35, noise: 0.2 },                                  // 3 drop
  ], bpm);
  assert.equal(r.last(0).state, 'GROOVE', `${bpm}: groove`);
  assert.equal(r.last(1).state, 'BREAKDOWN', `${bpm}: breakdown`);
  assert.equal(r.last(2).state, 'BUILD_UP', `${bpm}: build-up (${r.changes})`);
  assert.equal(r.drops.length, 1, `${bpm}: um drop só (${r.drops.length})`);
  const dropStart = r.out.findIndex((x) => x.seg === 3);
  const lag = r.drops[0].t - r.out[dropStart].t;
  assert.ok(lag >= r.barMs && lag < r.barMs * 1.2, `${bpm}: drop confirmado ~1 compasso depois da volta do grave (${lag.toFixed(0)} ms, compasso ${r.barMs.toFixed(0)} ms)`);
  assert.equal(r.out.find((x) => x.drop)!.state, 'DROP');
  assert.equal(r.last(3).state, 'GROOVE', `${bpm}: depois de 8 compassos de drop, groove`);
  assert.deepEqual(r.changes, ['0:GROOVE', '1:BREAKDOWN', '2:BUILD_UP', '3:DROP', '3:GROOVE'], `${bpm}: sem troca nervosa (${r.changes})`);
  assert.ok(r.out.filter((x) => x.seg === 0 && x.state !== 'UNKNOWN').every((x) => x.conf >= 0.6));
}

// --- volume subindo/descendo e ruído no groove: continua GROOVE, sem drop ---
{
  const r = run([{ bars: 24, low: 1, rms: (i, n) => 0.1 + 0.4 * Math.abs(Math.sin((i / n) * 6 * Math.PI)), noise: 0.5 }]);
  assert.deepEqual(r.changes, ['0:GROOVE']);
  assert.equal(r.drops.length, 0);
}

// --- grave piscando (detector instável) no groove: nada de cascata de drops ---
{
  const r = run([{ bars: 4, low: 1, rms: 0.3 }, { bars: 16, low: 1, rms: 0.3, lowFlicker: 0.15 }]);
  assert.equal(r.drops.length, 0);
  assert.ok(r.changes.length <= 1, `sem alternância: ${r.changes}`);
}

// --- buraco curto de grave (1,5 compasso) não vale como breakdown → sem drop na volta ---
{
  const r = run([{ bars: 8, low: 1, rms: 0.3 }, { bars: 1.5, low: 0, rms: 0.2 }, { bars: 8, low: 1, rms: 0.3 }]);
  assert.equal(r.drops.length, 0);
}

// --- dois breakdowns de verdade = dois drops, cada um uma vez ---
{
  const seg = (low: 0 | 1, bars: number): Seg => ({ bars, low, rms: low ? 0.3 : 0.15 });
  const r = run([seg(1, 8), seg(0, 4), seg(1, 12), seg(0, 4), seg(1, 12)]);
  assert.equal(r.drops.length, 2);
  assert.deepEqual(r.drops.map((d) => d.seg), [2, 4]);
}

// --- sem BPM travado (bpm conhecido mas instável): compasso de 2 s, drop detectado uma vez ---
{
  const r = run([{ bars: 8, low: 1, rms: 0.3 }, { bars: 6, low: 0, rms: 0.15 }, { bars: 10, low: 1, rms: 0.3 }], 140, false);
  assert.equal(r.barMs, 2000);
  assert.equal(r.drops.length, 1);
  assert.ok(r.out.filter((x) => x.state === 'GROOVE').every((x) => x.conf < 0.81), 'sem travar: confiança menor');
}

console.log('show-engine/state: ok');
