// Notas da Release a partir do CHANGELOG.md (DK-004). Node puro, sem dependência.
//   node scripts/release-notes.mjs 0.3.8                 → Markdown no stdout
//   node scripts/release-notes.mjs 0.3.8 outro/CHANGELOG.md
// Sai com código 1 se a seção `## [0.3.8]` não existir ou estiver vazia: release sem notas não sai.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Texto da seção `## [versão]` até a próxima `## [` (ou até as definições de link do rodapé). */
export function section(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const head = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (head < 0) throw new Error(`O CHANGELOG não tem a seção ## [${version}]`);
  const out = [];
  for (const l of lines.slice(head + 1)) {
    if (l.startsWith('## [') || /^\[[^\]]+\]:\s/.test(l)) break;
    out.push(l);
  }
  const body = out.join('\n').trim();
  if (!body) throw new Error(`A seção ## [${version}] do CHANGELOG está vazia`);
  return body;
}

/** Corpo da Release: a seção do CHANGELOG, como instalar/atualizar e como verificar o download. */
export function notes(changelog, version) {
  return [
    section(changelog, version),
    '',
    '### Como instalar/atualizar',
    '',
    '- Baixe o `.msi` abaixo e execute (Windows 10/11, 64 bits).',
    '- Quem já tem o DoubleK Visuals instalado recebe o aviso de atualização no rodapé do app ao abrir.',
    '- A atualização pelo app reinicia o DoubleK: faça com o telão fechado, fora do show.',
    '',
    'Verifique o download: SHA-256 em `SHA256SUMS.txt` (anexo desta Release; no PowerShell, `Get-FileHash .\\<arquivo>.msi`).',
    '',
  ].join('\n');
}

// rodado direto (não importado pelo check); no Windows a letra do drive pode vir em caixa diferente
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [version, file = 'CHANGELOG.md'] = process.argv.slice(2);
  try {
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('uso: node scripts/release-notes.mjs <x.y.z> [CHANGELOG.md]');
    process.stdout.write(notes(readFileSync(file, 'utf8'), version));
  } catch (e) {
    console.error(`release-notes: ${e.message}`);
    process.exit(1);
  }
}
