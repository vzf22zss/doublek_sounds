// npm run check — orçamento do Psy Engine (DK-024): degraus, histerese de 10 s, módulo mais caro, psyAuto.
import assert from 'node:assert/strict';
import { budgetState, budgetStep, effQuality, type BudgetInfo, type Candidate } from './budget.ts';

const ALL: Candidate[] = [
  { id: 'kaleido', cost: 2 }, { id: 'organic', cost: 9 }, { id: 'particles', cost: 5 }, { id: 'glitch', cost: 1 },
];
/** Roda uma amostra por segundo a partir de `t0` e devolve o que aconteceu em cada uma. */
function run(st = budgetState(), p95s: number[], o: { t0?: number; auto?: boolean; quality?: number; active?: Candidate[] } = {}) {
  const out: (BudgetInfo | null)[] = [];
  p95s.forEach((p95, i) => out.push(budgetStep(st, {
    now: (o.t0 ?? 0) + i * 1000, p95, budgetMs: 22, auto: o.auto ?? true, quality: o.quality ?? 2, active: o.active ?? ALL,
  })));
  return { st, out, acts: out.filter(Boolean) as BudgetInfo[] };
}
const bad = (n: number) => Array(n).fill(30);
const good = (n: number) => Array(n).fill(15);

// 3 s seguidos acima do teto → um degrau; 2 s não bastam
{
  assert.equal(run(undefined, bad(2)).acts.length, 0);
  const r = run(undefined, [30, 30, 10, 30, 30]); // o segundo bom zera a contagem
  assert.equal(r.acts.length, 0);
}

// Alta → Média → Baixa → desliga o mais caro, depois o seguinte
{
  const r = run(undefined, bad(12));
  assert.deepEqual(r.acts.map((a) => [a.quality, a.off.join()]), [[1, ''], [0, ''], [0, 'organic'], [0, 'organic,particles']]);
  assert.match(r.acts[0].msg, /Alta → Média/);
  assert.match(r.acts[2].msg, /Orgânico desligado/);
  assert.equal(effQuality(r.st, 2), 0);
}

// sem nada para desligar: fica quieto
assert.equal(run(undefined, bad(9), { active: [] }).acts.length, 2);

// volta um degrau por vez, no mínimo 10 s depois da última mudança, e só com folga (≤ 85% do teto)
{
  const r = run(undefined, bad(9)); // desce 3 degraus; a última mudança foi em t = 8 s
  const up = run(r.st, good(30), { t0: 9000 });
  const at = up.out.map((a, i) => (a ? 9000 + i * 1000 : -1)).filter((t) => t >= 0);
  assert.deepEqual(at, [18000, 28000, 38000], 'um degrau a cada 10 s');
  assert.deepEqual(up.acts.map((a) => [a.action, a.quality, a.off.join()]), [['up', 0, ''], ['up', 1, ''], ['up', 2, '']]);
  assert.match(up.acts[0].msg, /Orgânico religado/);
  const tight = run(run(undefined, bad(3)).st, Array(30).fill(20), { t0: 3000 }); // 20 ms: dentro do teto, sem folga
  assert.equal(tight.acts.length, 0);
}

// o degrau que voltou estourou logo em seguida: a próxima volta espera o dobro
{
  const st = run(undefined, bad(3)).st;                   // desce em t = 2 s
  run(st, good(11), { t0: 3000 });                         // volta em t = 12 s
  const again = run(st, bad(3), { t0: 14000 });            // estoura em t = 16 s, dentro dos 10 s
  assert.equal(again.acts.length, 1);
  assert.equal(st.wait, 20000);
  const back = run(st, good(25), { t0: 17000 }).out.findIndex(Boolean);
  assert.equal(17000 + back * 1000, 36000, 'espera 20 s');
}

// psyAuto desligado: não mexe; se já tinha descido, volta tudo de uma vez
{
  assert.equal(run(undefined, bad(12), { auto: false }).acts.length, 0);
  const st = run(undefined, bad(9)).st;
  const r = run(st, [30], { t0: 9000, auto: false });
  assert.equal(r.acts[0].action, 'reset');
  assert.deepEqual([st.drop, st.off.length], [0, 0]);
}

// operador já em Baixa: o primeiro degrau desliga módulo direto
assert.match(run(undefined, bad(3), { quality: 0 }).acts[0].msg, /Orgânico desligado/);

console.log('budget: ok');
