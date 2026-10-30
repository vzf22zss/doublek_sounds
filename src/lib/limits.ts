// Limites de entrada (DK-005): o que o app aceita de arquivo do usuário, antes de tocar em disco ou IndexedDB.
// Mensagens em português, prontas para a linha de status.

export const LIMITS = { image: 25 << 20, video: 600 << 20, audio: 300 << 20, json: 2 << 20 } as const; // bytes
export const EXT = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'],
  json: ['json'],
} as const;
export type Kind = keyof typeof LIMITS;
const MIME: Record<Kind, string[]> = { image: ['image/'], video: ['video/'], audio: ['audio/', 'video/mp4'], json: ['application/json', 'text/plain', 'text/json'] };

export const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const fmtMB = (b: number) => String(+(b / 1048576).toFixed(1)); // "2", "2.5", "300"

/** Erro legível, ou null se o arquivo pode entrar. Só nome/tamanho/tipo: o conteúdo é validado por quem decodifica. */
export function checkFile(kind: Kind, f: { name: string; size: number; type?: string }): string | null {
  const e = ext(f.name);
  if (!(EXT[kind] as readonly string[]).includes(e)) return `tipo não aceito (.${e || '?'}); use ${EXT[kind].join(', ')}`;
  if (f.size <= 0) return 'arquivo vazio';
  if (f.size > LIMITS[kind]) return `arquivo grande demais (${fmtMB(f.size)} MB; máximo ${fmtMB(LIMITS[kind])} MB)`;
  // o navegador às vezes não sabe o tipo (vazio ou octet-stream): aí vale a extensão
  if (f.type && f.type !== 'application/octet-stream' && !MIME[kind].some((m) => f.type!.startsWith(m))) return `tipo não aceito (${f.type})`;
  return null;
}
