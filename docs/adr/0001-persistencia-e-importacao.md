# ADR 0001 — Persistência local e importação de shows

**Status:** aceita (itens 1 e 3 em vigor desde DK-002; 2, 4 e 5 propostos para DK-010) · **Data:** 2026-10-30 · **Tarefa:** DK-001

## Contexto

Hoje o estado vive em três lugares, todos locais e sem versão de schema (ver `docs/quality/BASELINE.md` §6): `localStorage` (ajustes, visual, cenas, MIDI, lista de vídeos, roteiros), IndexedDB (logo, foto, vídeos) e disco (`app_data/tracks/`, músicas dos roteiros). As duas janelas compartilham a origem, então leem o mesmo armazenamento. As exportações existentes (preset JSON, roteiro JSON) não levam mídia.

Isso é rápido e simples para uma máquina só, mas **não transporta um show** para o notebook do show e não protege contra limpeza do perfil do WebView2.

## Decisão

1. **Manter** `localStorage` + IndexedDB como **cache de sessão** e fonte de verdade em execução. Não migrar para arquivos JSON soltos agora.
2. **Criar o Show Pack** (`.doublekshow`, ZIP) como forma de transporte e backup (DK-010): `manifest.json` versionado + JSONs de estado + `assets/` com hash. Importação em **staging**: validar tudo, só então aplicar; backup automático do estado anterior.
3. **Introduzido em DK-002** (`src/lib/store.ts`): cada chave `doublek.*` tem envelope `{ v, data }`, migrações numeradas por chave (v0 = formato cru da v0.3.1) e um validador. Inválido ou de versão futura cai no padrão e o bruto vai para `<chave>.bak`; nada é apagado.
4. **Música do roteiro é opt-in** no pacote (DEC-09).
5. Qualquer caminho vindo de arquivo é validado (sem `..`, sem absoluto, lista de extensões, tamanho máximo).

## Consequências

- Nenhum dado existente é migrado de forma destrutiva; o app continua funcionando sem Show Pack.
- O código de importação fica isolado em `src/lib/showpack/`; o Rust só entra se ZIP grande exigir (streaming/hash).
- Testes de roundtrip, ZIP malicioso e versão futura passam a ser obrigatórios antes de fechar DK-010.
