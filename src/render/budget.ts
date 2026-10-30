// Orçamento do Psy Engine (DK-024), em TS puro. Recebe 1 amostra por segundo: o p95 do frametime daquele segundo.
// Estourou o teto 3 s seguidos → desce um degrau: qualidade Alta → Média → Baixa; já em Baixa, desliga o módulo
// mais caro. Volta um degrau por vez, só com folga (p95 ≤ 85% do teto) e no mínimo 10 s depois da última mudança.
// Se o degrau que voltou estoura de novo dentro da espera, a espera dobra (até 2 min), para não ficar oscilando.

export const OVER_S = 3, UP_MS = 10000, UP_MAX_MS = 120000, MARGIN = 0.85;
export const QUALITY = ['Baixa', 'Média', 'Alta'];
export const NAMES: Record<string, string> = {
  organic: 'Orgânico', tunnel: 'Túnel', particles: 'Partículas', mandala: 'Mandala', kaleido: 'Caleidoscópio', glitch: 'Glitch',
};

/** Custo relativo estimado por pixel (baixa, média, alta), para escolher o mais caro quando não há timer de GPU.
 *  Unidade: ~leituras de textura + iterações do laço; mesmas contas da tabela no topo de renderer.ts. */
export const ESTIMATE: Record<string, [number, number, number]> = {
  organic: [25, 37, 49], particles: [9, 17, 33], mandala: [4, 6, 9], tunnel: [3, 4, 6], kaleido: [2, 3, 5], glitch: [4, 4, 4],
};

export type BudgetState = { drop: number; off: string[]; over: number; last: number; lastUp: number; wait: number };
export const budgetState = (): BudgetState => ({ drop: 0, off: [], over: 0, last: -Infinity, lastUp: -Infinity, wait: UP_MS });

export type Candidate = { id: string; cost: number };
export type BudgetInfo = { action: 'down' | 'up' | 'reset'; quality: number; off: string[]; p95: number; msg: string };

/** Qualidade que os módulos usam de fato: a do operador menos os degraus descidos. */
export const effQuality = (st: BudgetState, user: number) => Math.max(0, Math.min(2, Math.round(user)) - st.drop);

export function budgetStep(
  st: BudgetState,
  s: { now: number; p95: number; budgetMs: number; auto: boolean; quality: number; active: Candidate[] },
): BudgetInfo | null {
  const info = (action: BudgetInfo['action'], msg: string): BudgetInfo =>
    ({ action, quality: effQuality(st, s.quality), off: st.off.slice(), p95: Math.round(s.p95 * 10) / 10, msg });
  if (!s.auto) {
    if (!st.drop && !st.off.length) return null;
    Object.assign(st, budgetState());
    return info('reset', 'Psy Engine: ajuste automático desligado, tudo volta como você deixou.');
  }
  const why = `p95 ${Math.round(s.p95)} ms > ${s.budgetMs} ms`;
  if (s.p95 > s.budgetMs) {
    if (++st.over < OVER_S) return null;
    st.over = 0;
    if (s.now - st.lastUp < st.wait) st.wait = Math.min(UP_MAX_MS, st.wait * 2); // o degrau que voltou não aguentou
    const q = effQuality(st, s.quality);
    if (q > 0) {
      st.drop++;
      st.last = s.now;
      return info('down', `Psy Engine pesado (${why}): qualidade ${QUALITY[q]} → ${QUALITY[q - 1]}.`);
    }
    const worst = s.active.filter((c) => !st.off.includes(c.id)).sort((a, b) => b.cost - a.cost)[0];
    if (!worst) return null;
    st.off.push(worst.id);
    st.last = s.now;
    return info('down', `Psy Engine pesado (${why}): ${NAMES[worst.id] ?? worst.id} desligado.`);
  }
  st.over = 0;
  if ((!st.drop && !st.off.length) || s.p95 > s.budgetMs * MARGIN || s.now - st.last < st.wait) return null;
  st.last = st.lastUp = s.now;
  const back = st.off.pop();
  if (back) return info('up', `Psy Engine aliviado: ${NAMES[back] ?? back} religado.`);
  st.drop--;
  return info('up', `Psy Engine aliviado: qualidade de volta a ${QUALITY[effQuality(st, s.quality)]}.`);
}
