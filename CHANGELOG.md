# Changelog

Todas as mudanças relevantes do DoubleK Visuals ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/). As entradas vêm do histórico do git; a data de cada versão é a do commit que subiu o número em `package.json`.

## [Não lançado]

### Adicionado

- Roadmap agêntico alinhado à v0.3.1 (`docs/DOUBLEK_VISUALS_PLANO_AGENTICO_ROADMAP.md`).
- DK-001: baseline técnica da v0.3.1 (`docs/quality/BASELINE.md`) e ADRs de persistência, renderer e protocolo de comandos.
- DK-002: armazenamento versionado com envelope `{ v, data }`, migrações, validação dos dados salvos e workflow de CI em push/PR.
- DK-003: telemetria local do telão (fps, p50/p95/p99, quadros perdidos), bolinhas de saúde do show, diário de eventos e botão de Diagnóstico (JSON sem áudio); fail-safe do telão com recuperação do contexto WebGL.
- DK-005: CSP restritiva nas duas janelas, limites de tamanho e tipo para imagem, vídeo, música e JSON, auditoria de licenças e vulnerabilidades das dependências.
- DK-006: limite de 3 flashes por segundo (ligado por padrão), blackout por CSS independente do renderer e botão PÂNICO.

### Corrigido

- DK-005: `favicon.ico` automático devolvia erro no protocolo de assets; silenciado.

## [0.3.1] - 2026-10-30

### Adicionado

- Roteiro: modo "Só o som" e comparação A/B com a música tocando (tecla R).

### Alterado

- README: comparação do roteiro com "só o som".

## [0.3.0] - 2026-10-30

### Adicionado

- Efeitos "só no drop": somem no breakdown e entram quando o grave volta.
- Vídeo em loop no fundo.
- Motor de faixa: o app toca e analisa um arquivo de música.
- Roteiro: marcar pontos numa música e rodar com o app ou com o DJ nos decks.

### Alterado

- Tutorial e README: vídeo de fundo, efeitos no drop e roteiro.

## [0.2.0] - 2026-10-30

### Adicionado

- Atualização automática pelas Releases do GitHub (branch `prod`): o app avisa no rodapé e só instala com um clique.

## [0.1.0] - 2026-10-30

### Adicionado

- Esqueleto do app desktop: Tauri 2 + Vite + Svelte 5.
- Motor de áudio: captura WASAPI, detecção de kick e relógio de beat.
- Renderer WebGL2 e janela de saída para o telão.
- Janela de controle: entrada, analisador, tempo, preview e ajustes.
- Matriz de modulação: cada efeito escolhe o que no som o move.
- Barra de performance: knobs, cenas com crossfade no beat e presets.
- Checagem de tipos e check do crossfade/presets; atalhos no README.
- MIDI: conecta em todos os controladores e reconecta ao plugar.
- MIDI learn: clicar num controle e mexer no controlador.
- Instalador `.msi` em pt-BR.
- Cores automáticas a partir da foto de fundo e botão "Cores da logo".
- README e tutorial com capturas e GIFs.
- HTML original preservado como plano B em `legacy/` e na tag `html-original`.

### Corrigido

- Crossfade de cena, barra do topo em 1280px e selo MIDI nos pads.

[Não lançado]: https://github.com/vzf22zss/doublek_sounds/compare/09a7677...main
[0.3.1]: https://github.com/vzf22zss/doublek_sounds/compare/24883e2...09a7677
[0.3.0]: https://github.com/vzf22zss/doublek_sounds/compare/ecf84ce...24883e2
[0.2.0]: https://github.com/vzf22zss/doublek_sounds/compare/40f3349...ecf84ce
[0.1.0]: https://github.com/vzf22zss/doublek_sounds/compare/b53c30d...40f3349
