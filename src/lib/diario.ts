// Resumo do diário de análise na aba Áudio: o que o Rust devolve (analysis_summary) e a orientação em 1 frase.
// Só regras óbvias, na ordem de importância (docs/quality/CALIBRACAO.md, "Resumo no app").

/** Espelho de `diary::Summary` (src-tauri/src/diary.rs), em camelCase. */
export type AnalysisSummary = {
  secs: number;
  samples: number;
  lockedPct: number;
  unlocks: number;
  jumps: number;
  restarts: number;
  buildPct: number;
  kickRateByMin: [number, number][];
  marks: number;
  dropHits: number;
  dropMissed: number;
  missedNoBreakdown: number; // perdidos em que o grave nunca saiu antes da marca
  dropFalse: number;
  dropDelayMean: number | null; // null = nenhum acerto
};

export function advice(s: AnalysisSummary): string[] {
  const out: string[] = [];
  if (s.secs < 120) out.push('Gravação curta: grave pelo menos uns 10 minutos de set para tirar conclusão.');
  if (s.samples && s.lockedPct < 70) out.push(`O BPM ficou travado só ${s.lockedPct.toFixed(0)}% do tempo: confira o ganho e a faixa de BPM (Psy, Dark, Hi-tech).`);
  if (!s.marks) out.push('Nenhum drop marcado: aperte M no instante de cada drop para comparar com o que o app detecta.');
  else if (s.dropMissed && s.dropMissed / s.marks >= 0.25)
    out.push(s.missedNoBreakdown * 2 > s.dropMissed
      ? `O app perdeu ${s.dropMissed} de ${s.marks} drops sem perceber o breakdown (o grave nunca saiu): suba o Limiar do grave.`
      : `O app perdeu ${s.dropMissed} de ${s.marks} drops: baixe o Limiar do grave.`);
  else if (s.dropFalse >= 3 && s.dropFalse > 2 * s.marks)
    out.push(`O app viu ${s.dropFalse} drops que você não marcou: se não eram drops, suba o Limiar do grave.`);
  if (!out.length) out.push('Detecção em dia com a sua música: nada a ajustar.');
  return out;
}

/** "12 min 05 s" */
export const duration = (secs: number) => { const t = Math.round(secs); return `${Math.floor(t / 60)} min ${String(t % 60).padStart(2, '0')} s`; };
