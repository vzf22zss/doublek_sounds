# Changelog

Todas as mudanças relevantes do DoubleK Visuals ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/). As entradas vêm do histórico do git; a data de cada versão é a do commit que subiu o número em `package.json`.

## [Não lançado]

## [0.3.5] - 2026-10-30

### Adicionado

- DK-032/033/034: Intelligent Show v1 — estado musical estimado (breakdown, build-up, groove, drop; "—" quando a confiança é baixa) com histerese, mostrado como chip na linha das macros; mapa de automação por estado (rampas no breakdown/build, macro Drop e cenas opcionais no drop/groove) quantizado no beat/compasso; modos Manual (padrão), Assistido (só rampas e macros) e Automático; "só roteiro" desliga a automação; comando manual pausa a automação por 8 s.
- DK-051/052: camadas do Psy Engine com ordem, opacidade e modo de mistura (normal, somar, tela, multiplicar) e compositor que só gasta um passe quando precisa; seção "Camadas" na aba Efeitos. Imagem padrão idêntica à anterior.
- DK-091: servidor OSC local (Rust, sem dependência nova) com parser validado, limite de 200 msg/s e mapeamento `/doublek/v1/...` → comandos do dispatcher (`docs/OSC.md`). Ainda sem botão na tela: entra na 0.3.6.
- DK-143: roteiro inteiro passa pelo dispatcher (efeitos, vídeo e rampas), ponto de cena pode apontar para um banco fixo ("B2·nome" na timeline), roteiro tocando tem precedência sobre a automação, Reset desfaz os efeitos do roteiro sem pará-lo e PÂNICO para tudo.
- DK-009 (P7): a grade do BPM não trava mais no contratempo com chimbal (o kick é reconhecido pelo "punch" em 160 Hz); a trava não cai mais na volta do drop com poucos kicks.

### Alterado

- Capturas do tutorial refeitas com a UI atual (saúde, PÂNICO, bancos, TAKE, macros, Show Pack); seções novas no tutorial (Bancos, Preview e TAKE, Macros, Salvar e abrir um show, Psy Engine, ponto de cena de outro banco); README com Psy Engine, operação de show, Show Pack e requisitos; BASELINE atualizada.
- Dados salvos das camadas passam pela mesma validação que o renderer e a tela usam.

## [0.3.4] - 2026-10-30

### Adicionado

- DK-024: custo por módulo do Psy Engine (GPU via timer query quando a placa informa, CPU senão), orçamento automático de frametime (rebaixa a qualidade e desliga o módulo mais caro quando o p95 passa do teto; volta com folga) e interruptor "Psy Engine ligado/desligado"; o telão envia orçamento e custos à aba Efeitos.
- DK-043: Program/Preview e TAKE — Shift+1..8 prepara uma cena só no canvas do operador, T manda para o telão no próximo beat com a transição escolhida; modo Preview para pads e MIDI; novos comandos e ids MIDI (`a:take`, `a:previewMode`, `a:previewClear`).

### Alterado

- Shift+dígito deixou de chamar a cena (agora prepara); rótulos da transição em números; "Só logo" na linha das macros.

## [0.3.3] - 2026-10-30

### Adicionado

- DK-021: renderer em módulos (orquestrador, lógica de CPU pura e testada, helpers GL, efeitos cena/rastro/pós) com imagem idêntica pixel a pixel; módulo que falha é desligado sozinho.
- DK-022/023: Psy Engine com seis módulos — caleidoscópio, túnel fractal, mandala, partículas, orgânico e glitch (rajadas limitadas a 3/s com o limite de flashes) — com fonte de modulação, chip "drop", qualidade e 12 presets novos (23 no total).
- DK-014: botões "Salvar show" e "Abrir show" (`.doublekshow`) com conferência antes de qualquer escrita, backup automático em `app_data/backups` (5 mais recentes) e comandos Rust `save_backup`/`put_track`.
- DK-041: até 4 bancos de 8 cenas, migração automática das cenas existentes, seletor na barra, teclas `[`/`]` (também por caractere, ABNT2) e ações MIDI de banco; `banks.json` no Show Pack.
- DK-042: dispatcher único de comandos (teclado, MIDI, botões e cenas do roteiro) com validação, prioridade de BLACKOUT/PÂNICO, override manual e histórico no Diagnóstico; macros Build-up, Drop, Caos e Reset.
- DK-009 (P1–P4): a trava do BPM não cai mais ao voltar o drop; Auto não trava em meio tempo; kick sem baixo rolante não perde mais a borda; ruído alto não mascara o click no beat previsto. Benchmark com estresse de 10 sementes e chimbal (`docs/quality/DETECCAO.md`).

### Alterado

- PÂNICO zera também os módulos do Psy Engine; qualidade do Psy Engine fora das cenas.

## [0.3.2] - 2026-10-30

### Adicionado

- Roadmap agêntico alinhado à v0.3.1 (`docs/DOUBLEK_VISUALS_PLANO_AGENTICO_ROADMAP.md`) e plano de teste do roteiro com música real (`docs/quality/DK-141-plano-de-teste.md`).
- DK-001: baseline técnica (`docs/quality/BASELINE.md`) e ADRs de persistência, renderer e protocolo de comandos.
- DK-002: armazenamento versionado com envelope `{ v, data }`, migrações, validação dos dados salvos e workflow de CI em push/PR.
- DK-003: telemetria local do telão (fps, p50/p95/p99, quadros perdidos), bolinhas de saúde do show, diário de eventos e botão de Diagnóstico (JSON sem áudio); fail-safe do telão com recuperação do contexto WebGL.
- DK-004 (parte): CONTRIBUTING, SECURITY, templates de issue/PR e este changelog.
- DK-005: CSP restritiva nas duas janelas (confirmada no app real), limites de tamanho e tipo para imagem, vídeo, música e JSON, auditoria de licenças e vulnerabilidades das dependências.
- DK-006: limite de 3 flashes por segundo (ligado por padrão), blackout por CSS independente do renderer e botão PÂNICO.
- DK-008: benchmark de detecção de kick/BPM com faixa sintética (`examples/bench.rs`, `docs/quality/DETECCAO.md`).
- DK-011/012/013: formato Show Pack (`docs/SHOWPACK.md`), validador do manifesto, exportação ZIP sem dependência e importação com inspeção, backup e rollback (biblioteca).
- DK-131: catálogo de 11 presets de fábrica por estilo e botão Catálogo.
- `store.migrate` para aplicar migrações a dados vindos de arquivo.

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

[Não lançado]: https://github.com/vzf22zss/doublek_sounds/compare/0f3dab9...main
[0.3.5]: https://github.com/vzf22zss/doublek_sounds/compare/ef1a66a...0f3dab9
[0.3.4]: https://github.com/vzf22zss/doublek_sounds/compare/1c4ade7...ef1a66a
[0.3.3]: https://github.com/vzf22zss/doublek_sounds/compare/7582b07...1c4ade7
[0.3.2]: https://github.com/vzf22zss/doublek_sounds/compare/09a7677...7582b07
[0.3.1]: https://github.com/vzf22zss/doublek_sounds/compare/24883e2...09a7677
[0.3.0]: https://github.com/vzf22zss/doublek_sounds/compare/ecf84ce...24883e2
[0.2.0]: https://github.com/vzf22zss/doublek_sounds/compare/40f3349...ecf84ce
[0.1.0]: https://github.com/vzf22zss/doublek_sounds/compare/b53c30d...40f3349
