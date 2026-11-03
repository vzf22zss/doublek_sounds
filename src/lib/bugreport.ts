// "Relatar problema" (DK-007, feedback beta): do JSON do Diagnóstico sai um resumo curto para colar na issue.
// Só campos escolhidos a dedo (nada de caminhos de gravação, nomes de roteiro ou ajustes visuais), nome do
// usuário do Windows trocado por %USER% e nomes de arquivos de mídia trocados pela extensão. Nada vai pela rede
// daqui: o resumo vai para a área de transferência e a issue abre no navegador com um corpo curto.

export const REPO = 'https://github.com/vzf22zss/doublek_sounds/';
export const MAX_CHARS = 6000; // folga para colar em qualquer lugar; o corpo de uma issue aceita 65 mil
const LOG_LINES = 20, REJECTED = 10, LINE = 200;

/** O que o resumo lê do Diagnóstico (o resto é ignorado). */
export type Diag = {
  app?: string; when?: string; userAgent?: string; windows?: string; gpu?: string;
  screen?: { w: number; h: number; dpr: number };
  audio?: { device?: string; channel?: number; lost?: boolean; lastFrameAgeMs?: number | null; bpm?: number; locked?: boolean };
  midi?: { devices?: string[]; mapped?: number };
  osc?: { running?: boolean }; remote?: { running?: boolean; clients?: number };
  output?: { open?: boolean; fps?: number; p50?: number; p95?: number; p99?: number; drops?: number; lost?: boolean };
  control?: { maxFrameGapMs?: number; jsHeapMB?: number | null };
  recording?: { phase?: string };
  commands?: { t: number; source: string; cmd: { type: string }; ok: boolean; reason?: string }[];
  log?: { t: string; level: string; msg: string }[];
};

const MEDIA = 'mp3|wav|flac|ogg|opus|m4a|aac|aif|aiff|png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|mkv|avi|jsonl?|dkshow|zip';

/** Troca o usuário do Windows em caminhos por %USER% e o nome de arquivos de mídia pela extensão. */
export function anonymize(s: string) {
  return s
    // o nome pode ter espaço ("Ana Souza"): vai até a próxima barra; sem barra depois, até o fim da palavra
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)(?:[^\\/"'\n]+?(?=[\\/])|[^\\/"'\s]+)/gi, '$1%USER%')
    .replace(/([\\/]home[\\/]+|[\\/]Users[\\/]+)(?!%USER%)(?:[^\\/"'\n]+?(?=[\\/])|[^\\/"'\s]+)/g, '$1%USER%')
    .replace(new RegExp(`(["“'])[^"”']*?\\.(${MEDIA})(["”'])`, 'gi'), (_m, a, e, b) => `${a}<arquivo .${e.toLowerCase()}>${b}`)
    // dentro de um caminho, o nome vai da última barra até a extensão, com espaços ("\\Music\\Set da Ana.mp3")
    .replace(new RegExp(`([\\\\/])[^\\\\/"“'\\n<>]*?\\.(${MEDIA})\\b`, 'gi'), (_m, sep, e) => `${sep}<arquivo .${e.toLowerCase()}>`)
    // ponytail: nome solto, sem aspas nem barra, com espaço ("toquei Artista - Faixa.mp3") só perde a última palavra
    .replace(new RegExp(`[^\\s"“'\\\\/:<]+\\.(${MEDIA})\\b`, 'gi'), (_m, e) => `<arquivo .${e.toLowerCase()}>`);
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const n1 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(1) : '—');

export function bugReport(d: Diag): string {
  const o = d.output ?? {}, a = d.audio ?? {}, m = d.midi ?? {};
  const rows = [
    `**DoubleK Visuals ${d.app ?? '?'}** · ${d.windows ?? 'Windows ?'} · ${d.when ?? ''}`,
    `- GPU: ${d.gpu ?? '?'}`,
    `- Tela: ${d.screen ? `${d.screen.w}×${d.screen.h} @${d.screen.dpr}x` : '?'}`,
    `- Telão: ${o.open ? `aberto, ${o.fps ?? '—'} fps, p50/p95/p99 ${n1(o.p50)}/${n1(o.p95)}/${n1(o.p99)} ms, ${o.drops ?? 0} quadros perdidos/s${o.lost ? ', **contexto WebGL perdido**' : ''}` : 'fechado'}`,
    `- Controle: maior intervalo entre quadros ${d.control?.maxFrameGapMs ?? '—'} ms, heap ${d.control?.jsHeapMB ?? '—'} MB`,
    `- Áudio: ${a.device || 'padrão'} (canal ${a.channel ?? '?'})${a.lost ? ', **entrada perdida**' : ''}, último quadro há ${a.lastFrameAgeMs ?? '—'} ms, BPM ${n1(a.bpm)}${a.locked ? ' travado' : ''}`,
    `- MIDI: ${m.devices?.length ? m.devices.join(', ') : 'nenhum'} · ${m.mapped ?? 0} controles mapeados`,
    `- Rede: OSC ${d.osc?.running ? 'ligado' : 'desligado'} · celular ${d.remote?.running ? `ligado (${d.remote.clients ?? 0})` : 'desligado'} · gravação ${d.recording?.phase ?? 'idle'}`,
  ];
  const rejected = (d.commands ?? []).filter((c) => !c.ok).slice(-REJECTED);
  rows.push('', `**Comandos recusados** (últimos ${REJECTED}): ${rejected.length ? '' : 'nenhum'}`);
  // anonimiza antes de cortar: um corte no meio de "C:\Users\Ana Sou…" deixaria parte do nome passar
  const line = (s: string) => cut(anonymize(s), LINE);
  for (const c of rejected) rows.push(`- ${line(`${c.cmd?.type ?? '?'} (${c.source}): ${c.reason ?? ''}`)}`);
  const log = (d.log ?? []).slice(-LOG_LINES);
  rows.push('', `**Diário** (últimas ${LOG_LINES} linhas): ${log.length ? '' : 'vazio'}`);
  for (const e of log) rows.push(`- ${(e.t ?? '').slice(11, 19)} ${e.level} ${line(String(e.msg ?? ''))}`);
  return cut(anonymize(rows.join('\n')), MAX_CHARS);
}

/** Issue nova com o modelo de bug; o corpo na URL é curto e pede para colar o resumo copiado. */
export function issueUrl(version: string) {
  const body = `## O que aconteceu\n\n<!-- Descreva em uma ou duas frases. -->\n\n## Resumo do app\n\n<!-- Cole aqui (Ctrl+V) o resumo que o DoubleK copiou. Arraste também o arquivo doublek-diagnostico-….json que ele salvou. -->\n`;
  const q = { template: 'bug_report.md', title: `[bug] ${version}: `, body };
  return `${REPO}issues/new?` + Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
