// npm run check — crossfade de cenas, saneamento de presets, cores e roteiro.
import assert from 'node:assert/strict';
import { blend, lookOf, sanitizeLook, validScenes, validVisual, VISUAL, type Visual } from './settings.ts';
import { pickColors } from './assets.ts';
import { barLabel, beatAt, jumped, bpmLabel, cueLabel, due, newCue, nudgeGrid, rampAt, sanitizeRoteiro, snap, stateAt, timeAt, type Roteiro } from './roteiro.ts';

const from: Visual = { ...VISUAL, amount: 0, color: '#000000', bgGrad: false, strobeDiv: 1, blackout: true };
const to = { ...lookOf(VISUAL), amount: 1, color: '#ffffff', bgGrad: true, strobeDiv: 4, mod: { ...VISUAL.mod, glow: 'bass' as const } };

const mid = blend(from, to, 0.5);
assert.equal(mid.amount, 0.5);
assert.equal(mid.color, '#808080');
assert.equal(mid.bgGrad, true); // troca no meio
assert.equal(mid.strobeDiv, 4); // discreto: não interpola
assert.ok(!('blackout' in mid), 'crossfade não pode mexer no blackout');
assert.equal(blend(from, to, 0.2).bgGrad, false);
assert.equal(blend(from, to, 1).mod.glow, 'bass');

const s = sanitizeLook({ amount: 0.7, glow: 'x', size: Infinity, blackout: true, evil: 1, mod: { glow: 'kick', fxFlash: 'nope', bogus: 'kick' } });
assert.deepEqual(Object.keys(s).sort(), ['amount', 'mod']);
assert.equal(s.mod!.glow, 'kick');
assert.equal(s.mod!.fxFlash, VISUAL.mod.fxFlash);
assert.ok(!('bogus' in s.mod!));
assert.deepEqual(sanitizeLook(null), {});

// "só no drop": entra nas cenas e é saneado como o mod
const dr = sanitizeLook({ drop: { fxRings: true, strobe: 'sim', bogus: true }, dropFade: 2 });
assert.equal(dr.drop!.fxRings, true);
assert.equal(dr.drop!.strobe, false);
assert.ok(!('bogus' in dr.drop!));
assert.equal(dr.dropFade, 2);
assert.equal(blend(from, { ...to, drop: { ...VISUAL.drop, trail: true } }, 1).drop.trail, true);
assert.deepEqual(sanitizeLook({ mod: 'x', drop: [1] }).drop, { ...VISUAL.drop }); // objeto inválido não passa

// régua (onda 10): só [mín, máx] com 0 ≤ mín < máx ≤ 1 em alvo conhecido; preset/cena antiga carrega sem régua
{
  const r = sanitizeLook({ range: {
    glow: [0.2, 0.8], amount: [0.5, 0.5], chroma: [-0.1, 0.5], tunnel: [0, 2], bogus: [0, 1],
    mid: 'x', fxFlash: [0.1, 'a'], kaleido: [0.1, 0.3, 0.5], organic: [NaN, 1],
  } }).range;
  assert.deepEqual(r, { glow: [0.2, 0.8] });
  assert.deepEqual(sanitizeLook({ range: 'x' }).range, {});
  assert.ok(!('range' in sanitizeLook({ amount: 0.7 })), 'preset antigo: sem régua');
  const old = validScenes([{ name: 'Velha', look: { amount: 0.7, mod: { glow: 'bass' } } }, null, null, null, null, null, null, null]);
  assert.deepEqual(old[0]!.look.range, {});
  assert.equal(old[0]!.look.amount, 0.7);
  // o visual salvo guarda a régua (o `shaped` sozinho, com o padrão {}, jogava fora)
  assert.deepEqual(validVisual({ range: { amount: [0.1, 0.9], glow: [1, 0] } }).range, { amount: [0.1, 0.9] });
  assert.deepEqual(validVisual({}).range, {});
  // crossfade: troca no meio, como o mod
  const tr = { ...to, range: { glow: [0.2, 0.8] as [number, number] } };
  assert.deepEqual(blend(from, tr, 0.4).range, {});
  assert.deepEqual(blend(from, tr, 0.6).range, { glow: [0.2, 0.8] });
}

// cores da foto: muito azul escuro + um pouco de vermelho vivo → brilho vermelho, fundo azul escuro
const px = (rgb: number[], n: number) => Array.from({ length: n }, () => [...rgb, 255]).flat();
const c = pickColors([...px([10, 20, 60], 300), ...px([230, 20, 30], 60), ...px([128, 128, 128], 100)])!;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const [r, g, b] = rgb(c.color);
assert.ok(r > 200 && g < 120 && b < 120, 'brilho deveria ser vermelho: ' + c.color);
const [r1, g1, b1] = rgb(c.bgc1);
assert.ok(b1 > r1 && b1 > g1 && b1 < 40, 'fundo deveria ser azul bem escuro: ' + c.bgc1);
// logo lima + roxo com contorno preto → brilho lima, segunda cor do fundo roxa
const l = pickColors([...px([215, 245, 20], 200), ...px([110, 40, 170], 150), ...px([5, 5, 5], 250)])!;
const [lr, lg, lb] = rgb(l.color), [pr, pg, pb] = rgb(l.bgc2);
assert.ok(lg > 200 && lr > 150 && lb < 120, 'brilho deveria ser lima: ' + l.color);
assert.ok(pb > pg && pr > pg, 'fundo deveria ser roxo: ' + l.bgc2);
assert.equal(pickColors(px([0, 0, 0], 10).map((v, i) => (i % 4 === 3 ? 0 : v))), null); // tudo transparente
assert.match(pickColors(px([200, 200, 200], 10))!.color, /^#([0-9a-f]{2})\1\1$/); // foto cinza → brilho cinza

// ---------- roteiro ----------
const R: Roteiro = { id: 'r', name: 't', track: 'x.mp3', trackName: 'x', bpm: 150, anchor: 0.5, barShift: 0, goBeat: 0, cues: [] };
const cs = [newCue('scene', 0), { ...newCue('fx', 16), beats: 4 }, { ...newCue('scene', 32), scene: 2 }, { ...newCue('video', 24), video: 'v1' }];
assert.deepEqual(due(cs, -1, 16).map((c) => c.beat), [0, 16]); // cruzou 0 e 16
assert.deepEqual(due(cs, 16, 31.9).map((c) => c.beat), [24]);   // 16 já disparou
assert.deepEqual(due(cs, 40, 20), []);                          // voltar (seek para trás) não dispara
const st = stateAt(cs, 33);
assert.equal(st.scene!.scene, 2);
assert.equal(st.video!.video, 'v1');
assert.equal(stateAt(cs, 10).video, undefined);
assert.equal(beatAt(R, timeAt(R, 37.5)), 37.5);
assert.equal(barLabel(R, 0), '1.1');
assert.equal(barLabel(R, 5), '2.2');
assert.equal(barLabel({ ...R, barShift: 1 }, 0), '0.4'); // antes do 1º compasso
assert.equal(snap(R, 6.4, false), 6);
assert.equal(snap(R, 6.4, true), 8);
const k = { ...newCue('knob', 8), to: 1, ramp: 4 };
assert.equal(rampAt(k, 0, 8), 0);
assert.equal(rampAt(k, 0, 10), 0.5);
assert.equal(rampAt(k, 0, 20), 1);
assert.equal(rampAt({ ...k, ramp: 0 }, 0, 8), 1); // sem rampa: pula
const imp = sanitizeRoteiro({ name: 'x', bpm: 148, cues: [{ kind: 'fx', beat: 4, fx: 'rm -rf' }, { kind: 'nope', beat: 1 }, { kind: 'scene', beat: NaN }] })!;
assert.equal(imp.cues.length, 1);
assert.equal(imp.cues[0].fx, 'strobe');
assert.equal(sanitizeRoteiro({ cues: 'x' }), null);

// cue.bank (DK-143): opcional; só inteiro 0–3 entra; ausente continua ausente (roteiro antigo igual)
{
  const r = sanitizeRoteiro({ name: 'b', cues: [
    { kind: 'scene', beat: 0, scene: 2, bank: 1 }, { kind: 'scene', beat: 4, scene: 2 }, { kind: 'scene', beat: 8, bank: 4 },
    { kind: 'scene', beat: 12, bank: -1 }, { kind: 'scene', beat: 16, bank: 1.5 }, { kind: 'scene', beat: 20, bank: '2' },
  ] }, true)!;
  assert.deepEqual(r.cues.map((c) => c.bank), [1, undefined, undefined, undefined, undefined, undefined]);
  assert.ok(!('bank' in r.cues[1]), 'sem bank no arquivo = sem a chave (JSON igual ao de antes)');
  const names = [{ name: 'Azul' }, null, { name: 'Drop' }];
  assert.equal(cueLabel(r.cues[0], names, []), 'B2·Drop');
  assert.equal(cueLabel(r.cues[1], names, []), 'Drop');
}

// Onda 10: modo da pausa só com valor conhecido (nada herdado do protótipo), sensibilidade na faixa, fora das cenas
{
  for (const pause of ['toString', 'xx', 3]) assert.equal(validVisual({ pause }).pause, 'breathe', String(pause));
  assert.equal(validVisual({ pause: 'stop' }).pause, 'stop');
  assert.deepEqual([validVisual({ pauseThr: 5 }).pauseThr, validVisual({ pauseThr: -1 }).pauseThr], [0.3, 0]);
  const look = lookOf({ ...VISUAL, pause: 'stop' }) as Record<string, unknown>;
  assert.ok(!('pause' in look) && !('pauseThr' in look), 'pausa fora das cenas');
}
// mapa de andamento (onda 10): opcional; roteiro antigo (só bpm/anchor) carrega e calcula igual
{
  const antigo = { app: 'doublek-roteiro', version: 1, roteiro: { name: 'velho', track: 'x.mp3', bpm: 145.123, anchor: 0.37, barShift: 1, goBeat: 64, cues: [{ kind: 'scene', beat: 32, scene: 1 }] } };
  const r = sanitizeRoteiro(JSON.parse(JSON.stringify(antigo)).roteiro)!;
  assert.ok(!('tempo' in r), 'sem mapa no arquivo = sem a chave');
  for (const t of [0, 0.37, 61.2, 300]) assert.equal(beatAt(r, t), (t - 0.37) / (60 / 145.123));
  assert.equal(timeAt(r, 100), 0.37 + 100 * (60 / 145.123));
  assert.equal(bpmLabel(r), '145.12 BPM');

  // 140 → 146 no beat 140 (t = 0.37 + 140·60/140 = 60.37): âncora do 2º trecho = a do beat 0 extrapolada
  const t1 = 0.37 + 140 * (60 / 140), tempo = [{ t: 0, bpm: 140, anchor: 0.37 }, { t: t1, bpm: 146, anchor: t1 - 140 * (60 / 146) }];
  const m = sanitizeRoteiro({ ...antigo.roteiro, bpm: 140, anchor: 0.37, tempo }, true)!;
  assert.deepEqual(m.tempo, tempo);
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} ≠ ${b}`);
  near(beatAt(m, 60), (60 - 0.37) / (60 / 140), 'antes da troca: 140');
  near(beatAt(m, t1), 140, 'na troca: beat 140 nos dois trechos');
  assert.ok(Math.abs(beatAt(m, t1 - 1e-6) - 140) < 1e-5, 'contínuo na troca');
  near(beatAt(m, t1 + 60), 140 + 146, '1 min depois: +146 beats');
  for (const b of [-2, 0, 50, 139.5, 140, 140.5, 400]) near(beatAt(m, timeAt(m, b)), b, `ida e volta no beat ${b}`);
  near(timeAt(m, 286), t1 + 60, 'timeAt usa o trecho do beat');
  assert.equal(bpmLabel(m), '140.00 → 146.00 BPM');
  nudgeGrid(m, 0.005);
  assert.deepEqual([m.anchor, m.tempo![0].t, m.tempo![1].t], [0.375, 0, t1 + 0.005], 'arrastar move a grade e os trechos, o 1º fica no início');
  near(beatAt(m, t1 + 0.005), 140, 'arrastada, a troca anda junto');
  // mapa inválido cai fora inteiro (vale o bpm/anchor)
  for (const bad of [[tempo[0]], [tempo[1], tempo[0]], [{ ...tempo[0], t: 1 }, tempo[1]], [tempo[0], { ...tempo[1], bpm: NaN }], [tempo[0], { ...tempo[1], bpm: 0 }], 'x', Array(501).fill(tempo[0])]) {
    assert.ok(!('tempo' in sanitizeRoteiro({ ...antigo.roteiro, tempo: bad })!), JSON.stringify(bad).slice(0, 60));
  }
  // só os campos conhecidos de cada trecho
  assert.deepEqual(sanitizeRoteiro({ ...antigo.roteiro, tempo: tempo.map((s) => ({ ...s, x: 1 })) })!.tempo, tempo);
}

// Revisão 0.3.11: recuo de até ¼ de beat na troca de trecho não é salto (não cancela strobe/crossfade)
assert.equal(jumped(57.2, 57.0), false);
assert.equal(jumped(57.2, 56.9), true);
assert.equal(jumped(10, 19), true);
assert.equal(jumped(10, 10.1), false);

console.log('settings: ok');
