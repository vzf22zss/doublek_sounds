// Program/Preview (DK-043): o operador prepara uma cena no PREVIEW (só o canvas da janela de controle) e manda para o
// PROGRAM (o telão) com TAKE. O preview guarda banco + pad, não uma cópia: gravar por cima da cena atualiza o que
// aparece, e trocar de banco não perde a cena preparada. Pontos de cena do roteiro vão direto ao Program.
import type { Banks } from './banks.ts';
import type { Look } from './settings.ts';

export type PreviewRef = { bank: number; index: number } | null;
export type Staged = { bank: number; index: number; name: string; look: Look } | null;

/** Resolve a referência contra os bancos de agora. Banco ou pad que sumiu/esvaziou = nada em preview. */
export function resolve(ref: PreviewRef, b: Banks): Staged {
  const sc = ref ? b.banks[ref.bank]?.scenes[ref.index] : null;
  return ref && sc ? { bank: ref.bank, index: ref.index, name: sc.name, look: sc.look } : null;
}

/** Põe o pad em preview. Erro (texto para a linha de status) se o banco não existe ou o pad está vazio. */
export function stage(b: Banks, bank: number, index: number): { ref: PreviewRef } | { error: string } {
  if (!b.banks[bank]) return { error: `não existe o banco ${bank + 1}` };
  if (!b.banks[bank].scenes[index]) return { error: `o pad ${index + 1} do banco ${bank + 1} está vazio` };
  return { ref: { bank, index } };
}

export type Take = { bank: number; index: number; fade: number; name: string };
/** O que o TAKE deve chamar (o App faz o recall e limpa o preview). Sem preview = sem efeito, com motivo. */
export function take(s: Staged, fade: number): { ok: true; take: Take } | { ok: false; reason: string } {
  if (!s) return { ok: false, reason: 'nada em preview (Shift+1..8, ou ligue o modo Preview e toque um pad)' };
  return { ok: true, take: { bank: s.bank, index: s.index, fade: Math.max(0, fade), name: s.name } };
}

/** Banco i apagado: o preview some se era dele, ou acompanha o novo índice se estava depois. */
export function afterRemoveBank(ref: PreviewRef, i: number): PreviewRef {
  if (!ref || ref.bank < i) return ref;
  return ref.bank === i ? null : { ...ref, bank: ref.bank - 1 };
}

/** PÂNICO limpa o preview; BLACKOUT (e o resto) não mexe nele. */
export const afterCommand = (ref: PreviewRef, type: string): PreviewRef => (type === 'PANIC' ? null : ref);
