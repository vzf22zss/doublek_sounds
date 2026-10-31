// npm run check — mapa de automação (DK-033/034/035): modos, regras desligáveis, tetos editáveis, cenas com banco,
// quantização (com e sem `stability`), validação do que vem do armazenamento.
import assert from 'node:assert/strict';
import { validate } from '../commands.ts';
import { DEFAULT_AUTOMATION, DEFAULT_LIMITS, LIMIT_KEYS, validAutomation, type AutomationConfig } from './config.ts';
import { plan, quantizeDelay } from './rules.ts';
import type { MusicState, StateName } from './state.ts';

const st = (state: StateName, dropEvent = false): MusicState => ({ state, confidence: 0.8, dropEvent, since: 0, barMs: 1600, staleGrid: false });
const cfg = (x: Partial<AutomationConfig> = {}): AutomationConfig => ({ ...structuredClone(DEFAULT_AUTOMATION), ...x });
const types = (steps: { cmd: { type: string } }[]) => steps.map((s) => s.cmd.type);
const SCENE = ['SCENE_RECALL', 'SCENE_TAKE', 'SCENE_PREVIEW', 'BANK_STEP', 'BANK_SET', 'VIDEO_SET'];
const ctx = (mode: 'MANUAL' | 'ASSIST' | 'AUTO', scriptOnly = false) => ({ mode, scriptOnly });
const comCenas = cfg({ dropScene: { bank: 1, index: 2 }, grooveScene: { bank: 0, index: 5 } });
const transicoes = [['GROOVE', st('BREAKDOWN')], ['BREAKDOWN', st('BUILD_UP')], ['BUILD_UP', st('DROP', true)], ['DROP', st('GROOVE')]] as const;

// MANUAL: só calcula, nunca emite; "só roteiro" também desliga
for (const [p, c] of transicoes) assert.deepEqual(plan(p, c, comCenas, ctx('MANUAL')), []);
assert.deepEqual(plan('BUILD_UP', st('DROP', true), comCenas, ctx('AUTO', true)), []);

// AUTO: entrada de cada estado; cena do mapa com banco
assert.deepEqual(types(plan('GROOVE', st('BREAKDOWN'), comCenas, ctx('AUTO'))), ['PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP']);
assert.deepEqual(types(plan('BREAKDOWN', st('BUILD_UP'), comCenas, ctx('AUTO'))), ['PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP', 'PARAM_RAMP']);
assert.deepEqual(plan('BUILD_UP', st('DROP', true), comCenas, ctx('AUTO')).map((s) => s.cmd), [{ type: 'MACRO', id: 'DROP' }, { type: 'SCENE_RECALL', index: 2, bank: 1, fade: 0 }]);
assert.deepEqual(plan('DROP', st('GROOVE'), comCenas, ctx('AUTO')).map((s) => s.cmd), [{ type: 'SCENE_RECALL', index: 5, bank: 0, fade: 4 }]);
// sem mudança de estado e sem drop: nada; UNKNOWN (ex.: guarda P8) não tem regra
assert.deepEqual(plan('BUILD_UP', st('BUILD_UP'), comCenas, ctx('AUTO')), []);
assert.deepEqual(plan('GROOVE', st('UNKNOWN'), comCenas, ctx('AUTO')), []);
// sem cena no mapa (padrão): o drop só dispara a macro; o groove não faz nada
assert.deepEqual(types(plan('BUILD_UP', st('DROP', true), cfg(), ctx('AUTO'))), ['MACRO']);
assert.deepEqual(plan('DROP', st('GROOVE'), cfg(), ctx('AUTO')), []);

// ASSIST: knobs/rampas/macros, nunca cena/banco/vídeo
for (const [p, c] of transicoes) assert.ok(types(plan(p, c, comCenas, ctx('ASSIST'))).every((x) => !SCENE.includes(x)));
assert.deepEqual(types(plan('BUILD_UP', st('DROP', true), comCenas, ctx('ASSIST'))), ['MACRO']);

// cada regra desliga sozinha
const off = (id: keyof AutomationConfig['enabled']) => cfg({ ...comCenas, enabled: { ...DEFAULT_AUTOMATION.enabled, [id]: false } });
assert.deepEqual(plan('GROOVE', st('BREAKDOWN'), off('breakdown'), ctx('AUTO')), []);
assert.deepEqual(plan('BREAKDOWN', st('BUILD_UP'), off('buildUp'), ctx('AUTO')), []);
assert.deepEqual(plan('BUILD_UP', st('DROP', true), off('drop'), ctx('AUTO')), []);
assert.deepEqual(plan('DROP', st('GROOVE'), off('groove'), ctx('AUTO')), []);

// tetos vêm da configuração (editados na tela)
const baixo = cfg({ limits: { ...structuredClone(DEFAULT_LIMITS), BREAKDOWN: { trail: 0.05, fxRings: 0.1, bgPulse: 0, chroma: 0 } } });
assert.deepEqual(plan('GROOVE', st('BREAKDOWN'), baixo, ctx('AUTO')).map((s) => [(s.cmd as any).key, (s.cmd as any).to]), [['trail', 0.05], ['fxRings', 0.1], ['bgPulse', 0], ['chroma', 0]]);
for (const [p, c] of transicoes) for (const s of plan(p, c, comCenas, ctx('AUTO'))) assert.equal(validate(s.cmd), null, JSON.stringify(s.cmd));
assert.ok(Object.entries(DEFAULT_LIMITS.BREAKDOWN).every(([k, v]) => v <= DEFAULT_LIMITS.BUILD_UP[k as keyof typeof LIMIT_KEYS]), 'breakdown mais calmo que build-up por padrão');

// validAutomation: o que vem do armazenamento
{
  const v = validAutomation({ enabled: { drop: false, groove: 'sim' }, limits: { BUILD_UP: { trail: 9, chroma: -3, nada: 1 }, BREAKDOWN: 'x' },
    dropScene: { bank: 1, index: 7 }, grooveScene: { bank: 4, index: 0 }, extra: true });
  assert.deepEqual(v.enabled, { breakdown: true, buildUp: true, drop: false, groove: true });
  assert.equal(v.limits.BUILD_UP.trail, 1, 'teto acima da faixa do knob é cortado');
  assert.equal(v.limits.BUILD_UP.chroma, 0);
  assert.deepEqual(v.limits.BREAKDOWN, DEFAULT_LIMITS.BREAKDOWN);
  assert.deepEqual(v.dropScene, { bank: 1, index: 7 });
  assert.equal(v.grooveScene, null, 'banco 5 não existe');
  assert.ok(!('extra' in v));
  assert.throws(() => validAutomation([]), /objeto/);
  assert.deepEqual(validAutomation({}), DEFAULT_AUTOMATION);
}

// quantização: só com BPM travado; com `stability` do Rust, só se ≥ 0,5
const f = (locked: boolean, beat: number, beatPhase: number, bpm = 120, stability?: number) => ({ locked, bpm, beat, beatPhase, ...(stability !== undefined ? { stability } : {}) });
assert.equal(quantizeDelay('beat', f(false, 5, 0.3)), 0);
assert.equal(quantizeDelay('bar', f(true, 5, 0.3, 0)), 0, 'sem BPM: na hora');
assert.equal(quantizeDelay('beat', f(true, 5, 0.25)), 375);
assert.equal(quantizeDelay('bar', f(true, 3, 0.5)), 250);
assert.equal(quantizeDelay('bar', f(true, 4, 0.5)), 250 + 3 * 500);
assert.equal(quantizeDelay('beat', f(true, 5, 0.25, 120, 0.9)), 375, 'relógio confiável: quantiza');
assert.equal(quantizeDelay('beat', f(true, 5, 0.25, 120, 0.3)), 0, 'travado mas instável: na hora');
assert.equal(quantizeDelay('bar', f(true, 5, 0.25, 120, 0.5)), 375 + 2 * 500, 'limiar 0,5 incluso');
assert.deepEqual(plan('BUILD_UP', st('DROP', true), comCenas, ctx('AUTO')).map((s) => s.quantize), ['beat', 'beat']);
assert.ok(plan('GROOVE', st('BREAKDOWN'), comCenas, ctx('AUTO')).every((s) => s.quantize === 'bar'));

console.log('show-engine/rules: ok');
