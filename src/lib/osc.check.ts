// npm run check — OSC → comando (DK-091): todos os endereços válidos, recusas com motivo, normalização de /parameter.
import assert from 'node:assert/strict';
import { VISUAL } from './settings.ts';
import { KNOBS } from './roteiro.ts';
import { MACROS, isParameter, validate, type ShowCommand } from './commands.ts';
import { OSC_PARAMS, oscToCommand, type OscArg } from './osc.ts';

const P = '/doublek/v1/';
const i = (v: number): OscArg => ({ t: 'i', v }), f = (v: number): OscArg => ({ t: 'f', v });
const T: OscArg = { t: 'T', v: true }, F: OscArg = { t: 'F', v: false };
const cmd = (addr: string, args: OscArg[] = []) => {
  const r = oscToCommand(addr, args);
  assert.ok('cmd' in r, `${addr}: ${'error' in r ? r.error : ''}`);
  assert.equal(validate(r.cmd), null, `${addr} gera comando que o dispatcher aceita`);
  return r.cmd;
};

// --- endereços válidos ---
const ok: [string, OscArg[], ShowCommand][] = [
  ['scene/1', [], { type: 'SCENE_RECALL', index: 0 }],
  ['scene/8', [f(4)], { type: 'SCENE_RECALL', index: 7, fade: 4 }],
  ['scene/3', [i(0)], { type: 'SCENE_RECALL', index: 2, fade: 0 }],
  ['preview/5', [], { type: 'SCENE_PREVIEW', index: 4 }],
  ['take', [], { type: 'SCENE_TAKE' }],
  ['take', [f(2)], { type: 'SCENE_TAKE', fade: 2 }],
  ['bank/1', [], { type: 'BANK_SET', index: 0 }],
  ['bank/4', [], { type: 'BANK_SET', index: 3 }],
  ['blackout', [], { type: 'BLACKOUT' }],
  ['blackout', [T], { type: 'BLACKOUT', on: true }],
  ['blackout', [F], { type: 'BLACKOUT', on: false }],
  ['blackout', [i(1)], { type: 'BLACKOUT', on: true }],
  ['blackout', [i(0)], { type: 'BLACKOUT', on: false }],
  ['logo', [], { type: 'LOGO_ONLY' }],
  ['logo', [T], { type: 'LOGO_ONLY', on: true }],
  ['tap', [], { type: 'TAP' }],
  ['nudge', [i(-5)], { type: 'NUDGE', ms: -5 }],
  ['nudge', [f(2.5)], { type: 'NUDGE', ms: 2.5 }],
  ['panic', [], { type: 'PANIC' }],
  ['roteiro/go', [], { type: 'ROTEIRO_GO' }],
  ['roteiro/stop', [], { type: 'ROTEIRO_STOP' }],
  ['roteiro/ab', [], { type: 'ROTEIRO_AB' }],
  ['roteiro/nudge', [i(-4)], { type: 'ROTEIRO_NUDGE', beats: -4 }],
  ['roteiro/nudge', [f(1)], { type: 'ROTEIRO_NUDGE', beats: 1 }], // fader que manda float inteiro
  ['parameter/trail', [f(0.5)], { type: 'SET_PARAMETER', key: 'trail', value: 0.5 }],
  ...MACROS.map((id): [string, OscArg[], ShowCommand] => [`macro/${id}`, [], { type: 'MACRO', id }]),
];
for (const [a, args, want] of ok) assert.deepEqual(cmd(P + a, args), want, a);
for (let n = 1; n <= 8; n++) assert.deepEqual(cmd(`${P}scene/${n}`), { type: 'SCENE_RECALL', index: n - 1 });

// --- recusas: nunca lança, sempre motivo em português ---
const bad: [string, OscArg[], RegExp][] = [
  ['/doublek/scene/1', [], /fora do protocolo/],            // sem versão
  ['/doublek/v2/tap', [], /fora do protocolo/],
  ['tap', [], /fora do protocolo/],                        // sem /
  [P + 'nada', [], /desconhecido/],
  [P, [], /desconhecido/],
  [P + 'scene/0', [], /1 a 8/], [P + 'scene/9', [], /1 a 8/], [P + 'scene/01', [], /1 a 8/], [P + 'scene/x', [], /1 a 8/], [P + 'scene', [], /1 a 8/],
  [P + 'scene/1', [{ t: 's', v: '4' }], /fade/], [P + 'scene/1', [f(NaN)], /fade/], [P + 'scene/1', [{ t: 'f', v: null }], /fade/],
  [P + 'scene/1/2', [], /desconhecido/],
  [P + 'preview/9', [], /1 a 8/],
  [P + 'take', [T], /fade/], [P + 'take/1', [], /desconhecido/],
  [P + 'bank/0', [], /1 a 4/], [P + 'bank/5', [], /1 a 4/],
  [P + 'blackout', [f(1)], /i, T ou F/], [P + 'blackout', [{ t: 's', v: 'on' }], /i, T ou F/], [P + 'blackout/1', [], /desconhecido/],
  [P + 'logo', [{ t: 'b', v: [1] }], /i, T ou F/],
  [P + 'tap/x', [], /desconhecido/], [P + 'nudge', [], /ms/], [P + 'nudge', [T], /ms/], [P + 'nudge/1', [], /desconhecido/], [P + 'panic/now', [], /desconhecido/],
  [P + 'macro/drop', [], /macro desconhecida/], [P + 'macro', [], /macro desconhecida/],
  [P + 'parameter/naoExiste', [f(0.5)], /sem faixa/],
  [P + 'parameter/__proto__', [f(0.5)], /sem faixa/],
  [P + 'parameter/color', [f(0.5)], /sem faixa/],
  [P + 'parameter/strobeDiv', [f(0.5)], /sem faixa/], [P + 'parameter/renderScale', [f(0.5)], /sem faixa/],
  [P + 'parameter/trail', [], /0 a 1/], [P + 'parameter/trail', [f(1.5)], /0 a 1/], [P + 'parameter/trail', [f(-0.1)], /0 a 1/],
  [P + 'parameter/trail', [{ t: 's', v: '0.5' }], /0 a 1/],
  [P + 'roteiro/nudge', [], /inteiro/], [P + 'roteiro/nudge', [f(0.5)], /inteiro/], [P + 'roteiro/pause', [], /go, stop, ab/],
];
for (const [a, args, re] of bad) {
  const r = oscToCommand(a, args);
  assert.ok('error' in r, `${a} deveria ser recusado`);
  assert.match(r.error, re, a);
}
assert.ok('error' in oscToCommand(undefined as any), 'endereço que não é texto');
assert.ok('cmd' in oscToCommand(P + 'tap', undefined as any), 'args ausente = sem argumentos');

// --- /parameter: 0 → mín, 1 → máx, passo respeitado, toda chave da tabela é um ajuste válido ---
for (const [k, [lo, hi, st]] of Object.entries(OSC_PARAMS)) {
  assert.ok(isParameter(k), `${k} é ajuste numérico do Visual`);
  const at = (x: number) => (cmd(`${P}parameter/${k}`, [f(x)]) as { value: number }).value;
  assert.equal(at(0), lo, `${k} 0 → mín`);
  assert.equal(at(1), hi, `${k} 1 → máx`);
  const mid = at(0.37);
  assert.ok(mid >= lo && mid <= hi && Math.abs(Math.round((mid - lo) / st) * st - (mid - lo)) < 1e-6, `${k} no passo`);
}
for (const [k, [, lo, hi]] of Object.entries(KNOBS)) assert.deepEqual(OSC_PARAMS[k].slice(0, 2), [lo, hi], `${k} = faixa do KNOBS`);
assert.equal((cmd(`${P}parameter/mandalaPetals`, [f(0.5)]) as { value: number }).value, 10);
assert.equal((cmd(`${P}parameter/size`, [i(1)]) as { value: number }).value, 150); // inteiro 0/1 também vale
// todo ajuste numérico do Visual tem faixa OSC ou está fora de propósito (chave nova não fica esquecida)
const OUT = ['strobeDiv', 'renderScale', 'psyQuality', 'psyBudgetMs', 'offset', 'white'];
for (const [k, v] of Object.entries(VISUAL)) if (typeof v === 'number') assert.ok(k in OSC_PARAMS !== OUT.includes(k), `${k}: faixa OSC ou lista de fora`);

console.log(`osc: ok (${ok.length + 8} válidos, ${bad.length + 1} recusas, ${Object.keys(OSC_PARAMS).length} ajustes)`);
