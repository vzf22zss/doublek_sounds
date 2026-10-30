// npm run check — lógica musical do renderer (DK-021): envelopes, fase, fontes, drop, strobe e blackout.
import assert from 'node:assert/strict';
import { BURST_HZ, BURST_MS, burst, burstState, music, musicFrame, musicState } from './music.ts';
import { VISUAL, type Visual } from '../lib/settings.ts';
import { SAFE_STROBE_MAX, MAX_FLASH_HZ } from '../lib/safety.ts';
import type { Frame } from '../lib/types.ts';

const V = (o: Partial<Visual> = {}): Visual => ({ ...structuredClone(VISUAL), ...o });
const F = (o: Partial<Frame> = {}): Frame => ({
  peak: 0, rms: 0, bands: [0.5, 0.6, 0.4, 0.3, 0.2], kick: 0, bpm: 0, locked: false, holding: false,
  beatPhase: 0, beat: 0, flux: 0, thr: 0, spectrum: Array(64).fill(0.5), low: 1, pos: -1, ...o,
});
const close = (a: number, b: number, msg: string, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);
/** Frame de um andamento fixo, coerente com o instante `t`. */
const at = (t: number, bpm: number, o: Partial<Frame> = {}) => {
  const x = (t * bpm) / 60000;
  return F({ bpm, locked: true, beatPhase: x - Math.floor(x), beat: Math.floor(x), ...o });
};

// sem frame: a logo respira devagar
{
  const st = musicState(), v = V();
  for (const t of [1000, 1500, 2300]) {
    const u = music(st, v, t);
    assert.ok(u.stale);
    close(u.p, 0.12 * (0.5 + 0.5 * Math.sin((t / 1000) * 1.6)), 'respira');
  }
}

// kick (sem andamento travado) dispara na hora e decai com `rel`; o anel dura 900 ms
{
  const st = musicState(), v = V({ rel: 0.12 });
  music(st, v, 1000);
  musicFrame(st, F({ kick: 0.9 }), v, 1000);
  assert.equal(st.kickEnv, 0.9);
  assert.equal(st.rings.length, 1);
  let t = 1000;
  while (t < 1600) music(st, v, (t += 16));
  close(st.kickEnv, 0.9 * Math.exp(-(t - 1000) / 1000 / 0.12), 'decai com rel');
  const slow = musicState(), vs = V({ rel: 0.4 });
  music(slow, vs, 1000); musicFrame(slow, F({ kick: 0.9 }), vs, 1000); music(slow, vs, 1300);
  music(st, v, 1950);
  assert.equal(st.rings.length, 0, 'anel some depois de 900 ms');
  assert.ok(slow.kickEnv > 0.9 * Math.exp(-0.3 / 0.12), 'rel maior decai mais devagar');
}

// "só roteiro" (react:false): sem fontes de áudio nem espectro; beat, compasso e LFO continuam
{
  const st = musicState();
  let t = 1000;
  for (; t < 1400; t += 16) { musicFrame(st, at(t, 148), V(), t); music(st, V(), t); }
  assert.ok(st.spec[10] > 0.4, 'espectro encheu ao vivo');
  const v = V({ react: false });
  const seen = { beat: 0, bar: 0 };
  let u = music(st, v, t);
  const rings = st.rings.length, t0 = t;
  for (const end = t + 2000; t < end; t += 16) {
    musicFrame(st, at(t, 148, { kick: 0.9 }), v, t);
    u = music(st, v, t);
    for (const k of ['sub', 'bass', 'mid', 'hats'] as const) assert.equal(u.S[k], 0, k);
    assert.ok(st.rings.length <= rings, 'nenhum kick novo');
    if (t - t0 > 1000) assert.ok(u.S.kick < 1e-3, 'o kick que já vinha só decai');
    assert.equal(u.p, 0);
    assert.ok(u.S.lfo >= 0 && u.S.lfo <= 1);
    seen.beat = Math.max(seen.beat, u.S.beat); seen.bar = Math.max(seen.bar, u.S.bar);
  }
  assert.ok(seen.beat > 0.9 && seen.bar > 0.7, 'beat e compasso seguem');
  assert.ok(st.spec.every((s) => s < 1e-6), 'espectro zerado');
  assert.equal(u.drop, 1, 'sem som, "só no drop" fica ligado');
}

// L (só logo): fx 0 e nada de strobe
{
  const st = musicState(), v = V({ logoOnly: true, strobe: 0.5 });
  musicFrame(st, at(1000, 148, { kick: 0.9 }), v, 1000);
  const u = music(st, v, 1000);
  assert.equal(u.fx, 0);
  assert.equal(u.strobe, 0);
}

// "só no drop": dropEnv segue `low` com constante de tempo dropFade × beat / 3
for (const dropFade of [1, 4]) {
  const st = musicState(), v = V({ dropFade }), bpm = 148;
  st.lastT = 1000; // relógio parte daqui (o 1º quadro não conta 0,1 s)
  musicFrame(st, at(1000, bpm, { low: 0 }), v, 1000);
  let t = 1000;
  while (t < 2000) music(st, v, (t += 1000 / 60));
  const tau = Math.max(0.02, (dropFade * 60000) / bpm / 3000);
  close(st.dropEnv, Math.exp(-(t - 1000) / 1000 / tau), `dropEnv dropFade=${dropFade}`);
}

// strobe: com safeFlash nunca passa de 3 flashes/s (220 BPM, 1/1 = 3,67 Hz); sem ele, passa
for (const safeFlash of [true, false]) {
  const st = musicState(), v = V({ strobe: 1, strobeDiv: 1, safeFlash }), bpm = 220;
  let flashes = 0, prev = 0, peak = 0;
  for (let t = 0; t <= 10000; t++) {
    if (t % 10 === 0) musicFrame(st, at(t, bpm), v, t);
    const s = music(st, v, t).strobe;
    if (s > 0 && prev === 0) flashes++;
    prev = s; peak = Math.max(peak, s);
  }
  if (safeFlash) {
    assert.ok(flashes <= MAX_FLASH_HZ * 10 && flashes >= 15, `safeFlash: ${flashes} flashes em 10 s`);
    assert.ok(peak <= SAFE_STROBE_MAX + 1e-9, 'intensidade limitada');
  } else assert.ok(flashes > 33, `sem limite: ${flashes} flashes em 10 s`);
}

// blackout: ~63 % em 80 ms, total em seguida
{
  const st = musicState(), v = V({ blackout: true });
  st.lastT = 1000;
  for (let t = 1016; t <= 1080; t += 16) music(st, v, t);
  close(st.black, 1 - Math.exp(-1), 'black em 80 ms');
  for (let t = 1096; t <= 1500; t += 16) music(st, v, t);
  assert.ok(st.black > 0.99);
}

// andamento travado + predict: o pulso sai do wrap da fase (com offset), não do kick detectado
{
  const st = musicState(), v = V({ predict: true, offset: -40 }), bpm = 120;
  music(st, v, 1000);
  musicFrame(st, F({ bpm, locked: true, beatPhase: 0.5, kick: 0.9 }), v, 1000);
  assert.equal(st.rings.length, 0, 'kick detectado não dispara');
  for (let t = 1001; t <= 1300; t++) music(st, v, t);
  assert.equal(st.rings.length, 1, 'um disparo no wrap');
  assert.equal(st.rings[0].t, 1210, 'wrap: 0,5 beat a 120 BPM = 250 ms, adiantado 40 ms');
  assert.equal(st.rings[0].s, 0.9, 'com a força do último kick');
  const nop = musicState(), vn = V({ predict: false });
  musicFrame(nop, F({ bpm, locked: true, kick: 0.9 }), vn, 1000);
  assert.equal(nop.rings.length, 1, 'sem predict: dispara no kick');
}

// glitch: nunca mais de 3 rajadas em qualquer janela de 1 s, cada uma ≤ 120 ms; sem safeFlash, até o dobro
for (const safe of [true, false]) {
  const b = burstState(), starts: number[] = [];
  let on = 0, longest = 0;
  for (let t = 0; t <= 10000; t++) {
    const src = Math.floor(t / 50) % 2 ? 0 : 0.9; // fonte batendo a 10 Hz: bem acima do teto
    const n = b.n, e = burst(b, t, src, safe);
    if (b.n > n) starts.push(t);
    on = e > 0 ? on + 1 : 0;
    longest = Math.max(longest, on);
  }
  const cap = BURST_HZ * (safe ? 1 : 2);
  for (const s of starts) assert.ok(starts.filter((x) => x >= s && x < s + 1000).length <= cap, `${safe}: mais de ${cap} rajadas/s a partir de ${s}`);
  assert.ok(starts.length >= cap * 10 * 0.75, `${safe}: rajadas demais cortadas (${starts.length})`);
  assert.ok(longest <= BURST_MS, `rajada de ${longest} ms`);
}
{
  const b = burstState();
  for (let t = 0; t < 2000; t++) burst(b, t, 0.3, true); // fonte abaixo do limiar: nada
  assert.equal(b.n, 0);
  for (let t = 2000; t < 4000; t++) burst(b, t, 0.9, true); // fonte parada no alto: uma rajada só
  assert.equal(b.n, 1);
}

console.log('music: ok');
