// npm run check — efeitos com duração do roteiro (DK-143): começar, sobrepor, vencer, rampas, cancelar.
import assert from 'node:assert/strict';
import { busy, clear, EMPTY, startBurst, startRamp, step, type Running, type Values } from './roteiro-fx.ts';

let vs: Values = { strobe: 0.1, strobeDiv: 4, blackout: false, logoOnly: false, trail: 0.2, glow: 0.6 };
const apply = (set: Values) => (vs = { ...vs, ...set });
let run: Running = EMPTY;

// strobe 1/2 por 4 beats no beat 16
let r = startBurst(run, vs, 'strobe', 16, 4, 2);
run = r.run; apply(r.set);
assert.deepEqual([vs.strobe, vs.strobeDiv], [1, 2]);
r = step(run, 19.9); run = r.run; apply(r.set);
assert.deepEqual([vs.strobe, vs.strobeDiv], [1, 2], 'ainda dentro dos 4 beats');
r = step(run, 20); run = r.run; apply(r.set);
assert.deepEqual([vs.strobe, vs.strobeDiv], [0.1, 4], 'no beat 20 volta ao que era');
assert.ok(!busy(run));

// flash = 1 beat, mesmo pedindo 8
r = startBurst(run, vs, 'flash', 30, 8); run = r.run; apply(r.set);
assert.deepEqual([vs.strobe, vs.strobeDiv], [1, 1]);
r = step(run, 31); run = r.run; apply(r.set);
assert.equal(vs.strobe, 0.1);

// strobe por cima de flash: no fim volta ao valor de ANTES do flash, não ao do flash
r = startBurst(run, vs, 'flash', 40, 1); run = r.run; apply(r.set);
r = startBurst(run, vs, 'strobe', 40.5, 2, 4); run = r.run; apply(r.set);
assert.equal(run.bursts.length, 1, 'strobe substitui o flash (mesmas chaves)');
r = step(run, 42.5); run = r.run; apply(r.set);
assert.deepEqual([vs.strobe, vs.strobeDiv], [0.1, 4]);

// blackout e só logo convivem com strobe
r = startBurst(run, vs, 'blackout', 50, 2); run = r.run; apply(r.set);
r = startBurst(run, vs, 'logoOnly', 50, 4); run = r.run; apply(r.set);
r = startBurst(run, vs, 'strobe', 50, 4); run = r.run; apply(r.set);
assert.equal(run.bursts.length, 3);
r = step(run, 52); run = r.run; apply(r.set);
assert.deepEqual([vs.blackout, vs.logoOnly, vs.strobe], [false, true, 1]);

// rampa de knob: do valor atual até `to` em N beats; outra da mesma chave substitui
run = startRamp(run, vs, 'trail', 1, 60, 8);
r = step(run, 64); run = r.run; apply(r.set);
assert.ok(Math.abs((vs.trail as number) - 0.6) < 1e-9, `metade da rampa: ${vs.trail}`);
run = startRamp(run, vs, 'trail', 0, 64, 0);   // rampa de 0 beats = salto
r = step(run, 64); run = r.run; apply(r.set);
assert.equal(vs.trail, 0);
assert.equal(run.ramps.length, 0, 'rampa de 0 beats sai logo');
run = startRamp(run, vs, 'glow', 0.2, 70, 4);
run = startRamp(run, { ...vs, nada: 'x' as any }, 'nada', 3, 70, 4); // chave sem número: começa já no alvo
r = step(run, 72); run = r.run; apply(r.set);
assert.ok(Math.abs((vs.glow as number) - 0.4) < 1e-9);
assert.equal(vs.nada, 3);

// cancelar (PÂNICO/RESET): efeitos voltam, rampas param onde estão
r = startBurst(run, vs, 'blackout', 80, 16); run = r.run; apply(r.set);
assert.equal(vs.blackout, true);
const glowBefore = vs.glow;
r = clear(run); run = r.run; apply(r.set);
assert.deepEqual([vs.blackout, vs.logoOnly, vs.strobe, vs.strobeDiv], [false, false, 0.1, 4]);
assert.equal(vs.glow, glowBefore, 'rampa cancelada não salta para o alvo');
assert.ok(!busy(run));
r = step(run, 200);
assert.deepEqual(r.set, {});

console.log('roteiro-fx: ok');
