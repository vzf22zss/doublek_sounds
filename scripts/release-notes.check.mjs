// Check das notas da Release (DK-004): node scripts/release-notes.check.mjs (npm run check:scripts).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notes, section } from './release-notes.mjs';

const CHANGELOG = `# Changelog

## [Não lançado]

## [1.2.0] - 2026-11-01

### Adicionado

- Coisa nova.

## [1.1.0] - 2026-10-30

## [1.0.0] - 2026-10-01

### Corrigido

- Primeira correção.

[Não lançado]: https://exemplo/compare/b...main
[1.2.0]: https://exemplo/compare/a...b
`;

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// 1. versão existe: só a seção dela, com o bloco de instalação e a linha do SHA-256
const s = section(CHANGELOG, '1.2.0');
ok(s.startsWith('### Adicionado') && s.includes('- Coisa nova.'), 'seção 1.2.0');
ok(!s.includes('1.1.0') && !s.includes('Primeira correção'), 'não vaza a seção seguinte');
const md = notes(CHANGELOG, '1.2.0');
ok(md.includes('### Como instalar/atualizar') && md.includes('.msi'), 'bloco de instalação');
ok(md.includes('Verifique o download: SHA-256 em `SHA256SUMS.txt`'), 'linha do SHA-256');

// 2. versão não existe, ou existe vazia: erro (release sem notas não sai)
assert.throws(() => section(CHANGELOG, '9.9.9'), /não tem a seção/); n++;
assert.throws(() => section(CHANGELOG, '1.1.0'), /está vazia/); n++;
assert.throws(() => section(CHANGELOG, 'Não lançado'), /está vazia/); n++;

// 3. última seção do arquivo: para nas definições de link do rodapé
const last = section(CHANGELOG, '1.0.0');
ok(last === '### Corrigido\n\n- Primeira correção.', `última seção: ${JSON.stringify(last)}`);
ok(section(CHANGELOG.replace(/\n/g, '\r\n'), '1.0.0') === last, 'CRLF igual a LF');

// CLI: exit 0 com as notas no stdout; exit 1 com mensagem quando falta a seção
const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
const file = join(dir, 'CHANGELOG.md');
writeFileSync(file, CHANGELOG);
const cli = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
ok(execFileSync(process.execPath, [cli, '1.2.0', file], { encoding: 'utf8' }) === md, 'CLI imprime as notas');
let code = 0;
try {
  execFileSync(process.execPath, [cli, '9.9.9', file], { stdio: 'pipe' });
} catch (e) {
  code = e.status;
}
ok(code === 1, `CLI sai com 1 sem a seção (saiu ${code})`);

console.log(`release-notes.check: ${n} asserts ok`);
