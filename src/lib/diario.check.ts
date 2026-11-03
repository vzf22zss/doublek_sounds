// npm run check — orientação do resumo do diário de análise (cartão da aba Áudio).
import assert from 'node:assert/strict';
import { advice, duration, type AnalysisSummary } from './diario.ts';

const OK: AnalysisSummary = {
  secs: 1800, samples: 36000, lockedPct: 92, unlocks: 3, jumps: 1, restarts: 0, buildPct: 8, kickRateByMin: [[0, 3.9]],
  marks: 5, dropHits: 5, dropMissed: 0, missedNoBreakdown: 0, dropFalse: 1, dropDelayMean: 0.4,
};
const a = (p: Partial<AnalysisSummary>) => advice({ ...OK, ...p });

assert.deepEqual(a({}), ['Detecção em dia com a sua música: nada a ajustar.']);
// perdidos: ≥ 25% das marcas; direção do limiar pelo breakdown
assert.deepEqual(a({ dropHits: 3, dropMissed: 2 }), ['O app perdeu 2 de 5 drops: baixe o Limiar do grave.']);
assert.deepEqual(a({ dropHits: 3, dropMissed: 2, missedNoBreakdown: 2 }), ['O app perdeu 2 de 5 drops sem perceber o breakdown (o grave nunca saiu): suba o Limiar do grave.']);
assert.deepEqual(a({ dropHits: 3, dropMissed: 2, missedNoBreakdown: 1 }), ['O app perdeu 2 de 5 drops: baixe o Limiar do grave.'], 'metade não é maioria');
assert.deepEqual(a({ marks: 8, dropHits: 7, dropMissed: 1 }), ['Detecção em dia com a sua música: nada a ajustar.'], '1 de 8 é ruído');
// falsos: só com muitos a mais que as marcas
assert.match(a({ dropFalse: 11 })[0], /viu 11 drops que você não marcou: se não eram drops, suba/);
assert.deepEqual(a({ dropFalse: 10 }), ['Detecção em dia com a sua música: nada a ajustar.']);
assert.deepEqual(a({ marks: 0, dropHits: 0, dropFalse: 9 }), ['Nenhum drop marcado: aperte M no instante de cada drop para comparar com o que o app detecta.']);
// trava e duração somam
assert.deepEqual(a({ secs: 60, lockedPct: 41.6, marks: 0, dropHits: 0 }), [
  'Gravação curta: grave pelo menos uns 10 minutos de set para tirar conclusão.',
  'O BPM ficou travado só 42% do tempo: confira o ganho e a faixa de BPM (Psy, Dark, Hi-tech).',
  'Nenhum drop marcado: aperte M no instante de cada drop para comparar com o que o app detecta.',
]);
assert.ok(!a({ samples: 0, lockedPct: 0, secs: 0 }).some((x) => /travado/.test(x)), 'arquivo vazio não acusa trava');

assert.equal(duration(725.4), '12 min 05 s');
assert.equal(duration(119.95), '2 min 00 s');
console.log('diario: ok');
