// npm run check — "Relatar problema": anonimização, corte de tamanho, só os campos escolhidos, URL da issue.
import assert from 'node:assert/strict';
import { anonymize, bugReport, diagJson, issueUrl, MAX_CHARS, REPO, type Diag } from './bugreport.ts';

// caminhos: o usuário do Windows vira %USER% (barra invertida, barra normal, aspas, minúsculas)
assert.equal(anonymize('Análise salva em C:\\Users\\Ana Souza\\AppData\\x'), 'Análise salva em C:\\Users\\%USER%\\AppData\\x', 'nome com espaço');
assert.equal(anonymize('pasta C:\\Users\\dj e mais nada'), 'pasta C:\\Users\\%USER% e mais nada', 'sem barra depois: só a palavra');
assert.equal(anonymize('C:\\Users\\dj\\AppData\\Roaming\\com.doublek.visuals\\analysis\\a.log'), 'C:\\Users\\%USER%\\AppData\\Roaming\\com.doublek.visuals\\analysis\\a.log');
assert.equal(anonymize('c:/users/dj/Music'), 'c:/users/%USER%/Music');
assert.equal(anonymize('D:\\Users\\maria\\x'), 'D:\\Users\\%USER%\\x');
assert.equal(anonymize('/home/dj/x e /Users/ana/y'), '/home/%USER%/x e /Users/%USER%/y');
assert.equal(anonymize('C:\\Users\\%USER%\\x'), 'C:\\Users\\%USER%\\x', 'idempotente');
// nomes de arquivos de mídia: com aspas sai o nome inteiro, sem aspas a palavra com a extensão
assert.equal(anonymize('Não aceitei "Minha Faixa Secreta.MP3": grande demais.'), 'Não aceitei "<arquivo .mp3>": grande demais.');
assert.equal(anonymize('Vídeo “festa da firma.mov” no fundo.'), 'Vídeo “<arquivo .mov>” no fundo.');
assert.equal(anonymize('tocando set_final.flac agora'), 'tocando <arquivo .flac> agora');
assert.equal(anonymize('Efeito "Túnel" suspeito, p95 31.2 ms'), 'Efeito "Túnel" suspeito, p95 31.2 ms', 'sem extensão de mídia: fica');
assert.equal(anonymize('C:\\Users\\dj\\Music\\faixa.wav'), 'C:\\Users\\%USER%\\Music\\<arquivo .wav>');
assert.equal(anonymize('falhou ao ler C:\\Users\\Ana Souza\\Music\\Set da Ana.mp3 agora'), 'falhou ao ler C:\\Users\\%USER%\\Music\\<arquivo .mp3> agora', 'nome com espaço dentro de caminho');
assert.equal(anonymize('D:/DJ/Sets 2026/Abertura - Parte 1.flac'), 'D:/DJ/Sets 2026/<arquivo .flac>');

const DIAG: Diag & Record<string, unknown> = {
  app: '0.3.9', when: '2026-11-02T22:10:00.000Z', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', windows: 'Windows 11 (15.0.0)',
  gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11)', screen: { w: 1920, h: 1080, dpr: 1.25 },
  audio: { device: 'Line In (UMC204HD)', channel: 0, lost: false, lastFrameAgeMs: 12, bpm: 147.96, locked: true, gain: 1 } as Diag['audio'],
  midi: { devices: ['nanoKONTROL2 (ocupado)'], mapped: 12 },
  osc: { running: true }, remote: { running: false, clients: 0 },
  output: { open: true, fps: 59, p50: 16.7, p95: 24.04, p99: 40, drops: 1, lost: false },
  control: { maxFrameGapMs: 33, jsHeapMB: 80 },
  recording: { phase: 'idle', last: 'C:\\Users\\dj\\AppData\\Roaming\\com.doublek.visuals\\recordings\\20261102T220000.mp4' } as Diag['recording'],
  roteiro: { name: 'Set do casamento da Ana' },
  visual: { bgVideo: 'meu-video-segredo' },
  monitors: [{ name: 'EPSON-SALA-DA-ANA', width: 1920, height: 1080 }],
  commands: Array.from({ length: 40 }, (_, i) => ({ t: i, source: i % 2 ? 'osc' : 'ui', cmd: { type: `SCENE${i}` }, ok: i % 3 !== 0, reason: i % 3 ? undefined : `roteiro em andamento ${i}` })),
  log: Array.from({ length: 40 }, (_, i) => ({ t: `2026-11-02T22:0${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')}.000Z`, level: i % 4 ? 'info' : 'warn', msg: i === 39 ? 'Análise salva em C:\\Users\\dj\\AppData\\Roaming\\com.doublek.visuals\\analysis\\2026.jsonl e "Faixa X.mp3" ' + 'x'.repeat(400) : `linha ${i}` })),
};
const r = bugReport(DIAG);
assert.match(r, /^\*\*DoubleK Visuals 0\.3\.9\*\* · Windows 11 \(15\.0\.0\)/);
for (const want of ['GPU: ANGLE (NVIDIA', 'aberto, 59 fps, p50/p95/p99 16.7/24/40 ms', 'Line In (UMC204HD) (canal 0)', 'BPM 148 travado', 'nanoKONTROL2 (ocupado) · 12 controles mapeados', 'OSC ligado · celular desligado'])
  assert.ok(r.includes(want), want);
// sem campos proibidos: caminho da gravação, nome do roteiro, ajustes visuais, nomes de monitor, nome do usuário
for (const bad of ['recordings', '20261102T220000', 'casamento', 'meu-video-segredo', 'EPSON-SALA', '\\dj\\', 'Faixa X'])
  assert.ok(!r.includes(bad), `não pode aparecer: ${bad}`);
assert.ok(r.includes('C:\\Users\\%USER%\\AppData'), 'caminho no diário anonimizado');
// últimos 10 recusados e últimas 20 linhas do diário, cada linha cortada
const rej = r.split('\n').filter((l) => /^- SCENE\d+ /.test(l));
assert.equal(rej.length, 10);
assert.ok(rej[0].startsWith('- SCENE12 (ui): roteiro em andamento 12') && rej.at(-1)!.startsWith('- SCENE39 (osc): roteiro em andamento 39'), rej.join('|'));
const logl = r.split('\n').filter((l) => /^- \d\d:\d\d:\d\d (info|warn) /.test(l));
assert.equal(logl.length, 20);
assert.ok(logl[0].includes('linha 20') && logl.every((l) => l.length <= 2 + 9 + 5 + 200 + 2), 'linhas cortadas em 200');
assert.ok(r.length <= MAX_CHARS);
// corte total: diário gigante não passa do teto
const huge = bugReport({ ...DIAG, log: Array.from({ length: 20 }, () => ({ t: '', level: 'warn', msg: 'y'.repeat(5000) })), commands: [] });
assert.ok(huge.length <= MAX_CHARS && huge.endsWith('…'));
// corte de linha caindo no meio do nome do usuário não deixa pedaço do nome passar
const edge = bugReport({ log: [{ t: '', level: 'warn', msg: 'z'.repeat(186) + ' C:\\Users\\Ana Souza\\AppData\\x' }] });
assert.ok(!/Ana|Souza|Sou…/.test(edge), edge.slice(-60));
// Diagnóstico vazio/antigo não quebra
assert.match(bugReport({}), /DoubleK Visuals \?\*\* · Windows \?/);

// D-27: o arquivo .json do Diagnóstico (anexado na issue) também sai sem usuário do Windows nem nome de mídia
const dj = diagJson({ ...DIAG, log: [...DIAG.log!, { t: '', level: 'error', msg: 'falhou:\nfaixa.mp3' }] });
const back = JSON.parse(dj); // continua JSON válido (o \n escapado não vira "\<arquivo")
for (const bad of ['\\\\dj\\\\', 'Faixa X', 'faixa.mp3']) assert.ok(!dj.includes(bad), `diagnóstico não pode ter: ${bad}`);
assert.equal(back.recording.last, 'C:\\Users\\%USER%\\AppData\\Roaming\\com.doublek.visuals\\recordings\\<arquivo .mp4>');
assert.equal(back.roteiro.name, 'Set do casamento da Ana', 'o resto do diagnóstico fica');
assert.equal(back.log.at(-1).msg, 'falhou:\n<arquivo .mp3>');

// URL: modelo de bug do repositório, título com a versão, corpo curto pedindo para colar
const u = issueUrl('0.3.9');
assert.ok(u.startsWith(REPO + 'issues/new?template=bug_report.md&title=%5Bbug%5D%200.3.9%3A%20&body='), u);
assert.ok(u.length < 1000, `URL curta (${u.length})`);
const body = decodeURIComponent(u.split('&body=')[1]);
assert.match(body, /Cole aqui \(Ctrl\+V\) o resumo que o DoubleK copiou/);
assert.ok(!/[ +]/.test(u.split('?')[1]), 'espaço codificado como %20, não +');
console.log('bugreport: ok');
