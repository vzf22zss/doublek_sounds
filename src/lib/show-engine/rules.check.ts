// npm run check — mapa de automação (DK-033/034): modos, regras desligáveis, limites, quantização.
import assert from 'node:assert/strict';
import { validate } from '../commands.ts';
import { DEFAULT_RULES, LIMITS, plan, quantizeDelay, type RulesConfig } from './rules.ts';
import type { MusicState, StateName } from './state.ts';

const st = (state: StateName, dropEvent = false): MusicState => ({ state, confidence: 0.8, dropEvent, since: 0, barMs: 1600 });
const cfg = (x: Partial<RulesConfig> = {}): RulesConfig => ({ ...structuredClone(DEFAULT_RULES), ...x });
const types = (steps: { cmd: { type: string } }[]) => steps.map((s) => s.cmd.type);
const SCENE = ['SCENE_RECALL', 'SCENE_TAKE', 'SCENE_PREVIEW', 'BANK_STEP', 'BANK_SET', 'VIDEO_SET'];
const ctx = (mode: 'MANUAL' | 'ASSIST' | 'AUTO', turn = 0, scriptOnly = false) => ({ mode, turn, scriptOnly });
const comCenas = cfg({ dropScenes: [2, 5], grooveScenes: [0, 1] });

// MANUAL: só calcula, nunca emite; "só roteiro" também desliga
for (const [p, c] of [['BREAKDOWN', st('BUILD_UP')], ['BUILD_UP', st('DROP', true)], ['DROP', st('GROOVE')], ['GROOVE', st('BREAKDOWN')]] as const)
  assert.deepEqual(plan(p, c, comCenas, ctx('MANUAL')), []);
assert.deepEqual(plan('BUILD_UP', st('DROP', true), comCenas, ctx('AUTO', 0, true)), []);

// AUTO: entrada de cada estado
assert.deepEqual(types(plan('GROOVE', st('BREAKDOWN'), comCenas, ctx('AUTO'))), ['PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP']);
assert.deepEqual(types(plan('BREAKDOWN', st('BUILD_UP'), comCenas, ctx('AUTO'))), ['PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP']);
assert.deepEqual(plan('BUILD_UP', st('DROP', true), comCenas, ctx('AUTO', 1)).map((s) => s.cmd), [{ type: 'MACRO', id: 'DROP' }, { type: 'SCENE_RECALL', index: 5, fade: 0 }]);
assert.deepEqual(plan('DROP', st('GROOVE'), comCenas, ctx('AUTO', 3)).map((s) => s.cmd), [{ type: 'SCENE_RECALL', index: 1, fade: 4 }]);
// sem mudança de estado e sem drop: nada (as regras não repetem a cada quadro)
assert.deepEqual(plan('BUILD_UP', st('BUILD_UP'), comCenas, ctx('AUTO')), []);
assert.deepEqual(plan('DROP', st('DROP'), comCenas, ctx('AUTO')), []);
// sem cenas no mapa: o drop só dispara a macro; o groove não faz nada
assert.deepEqual(types(plan('BUILD_UP', st('DROP', true), cfg(), ctx('AUTO'))), ['MACRO']);
assert.deepEqual(plan('DROP', st('GROOVE'), cfg(), ctx('AUTO')), []);

// ASSIST: knobs/rampas/macros, nunca cena/banco/vídeo
for (const [p, c] of [['GROOVE', st('BREAKDOWN')], ['BREAKDOWN', st('BUILD_UP')], ['BUILD_UP', st('DROP', true)], ['DROP', st('GROOVE')]] as const) {
  const t = types(plan(p, c, comCenas, ctx('ASSIST')));
  assert.ok(t.every((x) => !SCENE.includes(x)), `${p}→${c.state}: ${t}`);
}
assert.deepEqual(types(plan('BUILD_UP', st('DROP', true), comCenas, ctx('ASSIST'))), ['MACRO']);

// cada regra desliga sozinha
const off = (id: keyof RulesConfig['enabled']) => cfg({ ...comCenas, enabled: { ...DEFAULT_RULES.enabled, [id]: false } });
assert.deepEqual(plan('GROOVE', st('BREAKDOWN'), off('breakdown'), ctx('AUTO')), []);
assert.deepEqual(plan('BREAKDOWN', st('BUILD_UP'), off('buildUp'), ctx('AUTO')), []);
assert.deepEqual(plan('BUILD_UP', st('DROP', true), off('drop'), ctx('AUTO')), []);
assert.deepEqual(plan('DROP', st('GROOVE'), off('groove'), ctx('AUTO')), []);

// limites por estado e comandos válidos para o dispatcher
for (const [p, c] of [['GROOVE', st('BREAKDOWN')], ['BREAKDOWN', st('BUILD_UP')], ['BUILD_UP', st('DROP', true)], ['DROP', st('GROOVE')]] as const)
  for (const s of plan(p, c, comCenas, ctx('AUTO'))) assert.equal(validate(s.cmd), null, JSON.stringify(s.cmd));
for (const s of plan('BREAKDOWN', st('BUILD_UP'), comCenas, ctx('AUTO'))) {
  const r = s.cmd as { key: string; to: number };
  assert.ok(r.to <= LIMITS.BUILD_UP[r.key]);
}
assert.ok(Object.entries(LIMITS.BREAKDOWN).every(([k, v]) => v <= LIMITS.BUILD_UP[k]), 'breakdown é mais calmo que build-up');

// quantização: só com BPM travado
const f = (locked: boolean, beat: number, beatPhase: number, bpm = 120) => ({ locked, bpm, beat, beatPhase });
assert.equal(quantizeDelay('beat', f(false, 5, 0.3)), 0);
assert.equal(quantizeDelay('bar', f(false, 5, 0.3)), 0);
assert.equal(quantizeDelay('bar', f(true, 5, 0.3, 0)), 0, 'sem BPM: na hora');
assert.equal(quantizeDelay('beat', f(true, 5, 0.25)), 375);              // 500 ms por beat a 120
assert.equal(quantizeDelay('bar', f(true, 3, 0.5)), 250);                // próximo beat (4) já é começo de compasso
assert.equal(quantizeDelay('bar', f(true, 4, 0.5)), 250 + 3 * 500);      // do beat 5 até o 8
assert.equal(quantizeDelay('bar', f(true, 6, 0)), 500 + 500);            // 7, depois 8
// drop sai no beat, mudanças de estado no compasso
assert.deepEqual(plan('BUILD_UP', st('DROP', true), comCenas, ctx('AUTO')).map((s) => s.quantize), ['beat', 'beat']);
assert.ok(plan('GROOVE', st('BREAKDOWN'), comCenas, ctx('AUTO')).every((s) => s.quantize === 'bar'));

console.log('show-engine/rules: ok');
