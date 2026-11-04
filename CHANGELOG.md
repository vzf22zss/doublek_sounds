# Changelog

Todas as mudanças relevantes do DoubleK Visuals ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/). As entradas vêm do histórico do git; a data de cada versão é a do commit que subiu o número em `package.json`.

## [Não lançado]

### Adicionado

- **Na pausa** pelo celular (parar, respirar ou beat), por MIDI learn (cada toque passa ao próximo modo) e por OSC (`/doublek/v1/pause/stop|breathe|beat`).

### Mudou

- Celular em pé: o **PÂNICO** fica preso no rodapé da tela e não some ao rolar.
- Janela de controle: Exportar, Catálogo e Salvar show em branco como os outros botões (o cinza parecia desligado); os botões ‹ › + × do banco ficam maiores (22 px, em 2×2 ao lado do nome).

## [0.3.15] - 2026-11-04

### Mudou

- Janela de controle mais leve: o analisador não aloca memória a cada quadro e não redesenha quando nada muda (sem som, de 60–144 para 0 desenhos/s); o medidor de nível não refaz o layout da janela a cada quadro; transições de cena, macros e rampas custam ~⅓ do processamento por quadro. A imagem do telão, do preview e do analisador é a mesma.
- Preview a ~30 fps em qualquer monitor (num monitor de 144 Hz ia a 72 fps e disputava a placa de vídeo com o telão).
- Notebook (1280–1670 px de largura) e janela baixa: os knobs ficam em 2 fileiras, os pads mostram o nome inteiro e o preview não encolhe até sumir. Em monitor grande o painel lateral cresce até 420 px, e o seletor de entrada de áudio mostra o nome inteiro quando há espaço.
- Celular: o pad acende logo depois do toque (antes, até 0,5 s); dois sliders arrastados juntos não são mais recusados pelo app; Wi-Fi que conecta mas não entrega nada mostra "sem conexão" em ~2 s (antes, ~7 s); com o celular deitado, o PÂNICO fica inteiro na tela.

### Corrigido

- Fundo com foto: o crossfade entre cenas com desfoque diferente travava as janelas (a foto era lida e desfocada de novo a cada quadro); agora é lida uma vez e o desfoque mais novo vence.
- Parar uma gravação logo depois de começar às vezes deixava um vídeo de poucos quadros; parar antes do primeiro segundo sempre cancela e apaga o arquivo.
- O arquivo do **Salvar diagnóstico** (o que vai anexado no relato) levava caminhos com o nome de usuário do Windows e nomes de músicas; agora é anonimizado como o resumo.
- A barra do MIDI learn cobria PÂNICO e BLACKOUT em janela estreita.
- Botões só com ícone (½, ×2, ◀ ▶, timeline, banco) agora têm nome para leitor de tela.

## [0.3.14] - 2026-11-03

### Corrigido

- Kick muito mais certo com música de psy real: o estalo do kick vem ~21 ms antes do grave dele e o app só aceitava até 17 ms, então recusava o kick e pegava a nota do baixo. Na música tocada pelo app (roteiro), de 62 % para 98,5 % dos kicks; ao vivo, de 10 % para 77 % (93 % pelo microfone de um headset ouvindo a caixa), com a batida no kick e não ~¼ de tempo antes.
- Mapa de andamento sem trechos falsos de 146–148 BPM em breakdowns de uma música a 145.
- No breakdown sem kick, a logo segue a onda da música em vez de pular com "kicks" que o app achava no ruído do pad.

### Adicionado

- Ferramenta de calibração com um arquivo de música (`cargo run --example calib` e `scripts/calib/`): mede o detector no roteiro e ao vivo contra a música e desenha tudo junto (ver `docs/quality/CALIBRACAO.md`).

## [0.3.13] - 2026-11-03

### Corrigido

- Sub, Bass, Mid, Hats, a onda e a pílula DROP presos em 0 com o kick sendo detectado: o **Corte de ruído** é calibrado pelo pico do som, mas esses níveis o comparavam com o volume médio (3 a 4 vezes menor). Agora todos comparam o pico. A música tocada pelo app (roteiro) não usa mais o corte, que é da entrada.
- **Calibrar ruído** com som tocando subia o corte até o teto (0,2) sem avisar. Agora o app recusa (pico acima de −26 dB não é ruído) e avisa; com o corte já alto, a aba Áudio mostra um aviso e o duplo clique volta ao padrão.

## [0.3.12] - 2026-11-03

### Corrigido

- Música de psy tocada pelo app (roteiro): a grade do beat podia travar na última nota do baixo rolante, ~¼ de beat antes do kick, e a logo pulsava sempre adiantada (numa faixa real a 145 BPM, 2 % dos kicks com pulso; agora 73–84 %, e quase nenhum pulso fora do kick). A análise da faixa acha a fase do kick pela subida do grave e desloca o mapa inteiro.
- Faixa com intro em tercina ou meio tempo: o mapa de andamento lia esse trecho como outro BPM (ex.: 217 em vez de 145) e a logo pulsava 3 vezes por kick. Trechos a 3/2, 2/3, 2× ou ½ do andamento principal ficam no andamento principal.
- Com o grave tocando, um kick que o detector deixou de ouvir por 1 a 3 s não vira mais "pausa" (o pulso não some no meio do drop).

### Mudou

- A logo pulsa nos tempos em que a música tem kick (kick a cada 2 tempos = pulso a cada 2 tempos) e também no kick fora do tempo; **Na pausa: seguir o beat** continua pulsando em todo beat.
- O pulso do kick tem o tamanho do volume do kick (o grave dele, em relação ao último minuto), não da certeza da detecção. A régua com a fonte **Kick** passa a falar de volume: em 50–100, kick fraco não mexe e kick forte bate cheio.

## [0.3.11] - 2026-11-03

### Adicionado

- **Régua por faixa**: em cada efeito com fonte (inclusive o pulso, o brilho e a aberração da logo), mínimo e máximo do nível da fonte, com o nível ao vivo; o efeito fica parado abaixo do mínimo e chega ao máximo no limite de cima. Entra nas cenas e presets; presets antigos carregam sem régua.
- **Na pausa** (aba Logo › Reação): parar, respirar ou seguir o beat quando a música silencia, com sensibilidade ajustável (MIDI learn). Padrão: respirar.
- Música tocada pelo app com andamento que muda: a análise gera um **mapa de andamento** (trechos), e a timeline, o roteiro e o relógio do beat seguem cada trecho sem pular beat. Faixas de BPM constante ficam exatamente como antes, e roteiros antigos abrem igual.
- Selo **BPM FIXO** no topo com "Travar BPM" ligado (clicar solta a trava) e aviso quando a música parece estar fora da faixa de andamento escolhida ("usar Auto?", clique troca).

### Corrigido

- Num silêncio da música tocada pelo app, a logo continuava dando zoom e os anéis continuavam aparecendo no beat previsto.
- Num trecho quase silencioso da entrada ao vivo, o chiado voltava a mexer a logo depois de poucos segundos.

### Mudou

- As fontes Sub, Bass, Mid e Hats e o "Seguir a música sem kick" medem o som em relação ao último minuto (antes, 4 s): trechos mais baixos aparecem mais baixos. Efeitos da comunidade (uBands) não mudam.
- Sem kick por 2 a 3 beats, a logo e os anéis param de bater no beat previsto e seguem a onda (escolha **Na pausa: seguir o beat** para o comportamento antigo).
- O estado do BPM "travado" passou a se chamar **firme** (a grade explica os kicks; o número continua se ajustando).
- Strobe do roteiro num build-up sem kick (com som) continua no beat; só o silêncio o apaga.

## [0.3.10] - 2026-11-03

### Adicionado

- Gravação: escolha do **tamanho** (Telão, 1080p, 720p; no vertical 1080×1920, 720×1280 ou pela qualidade), com aviso quando a imagem vai ser ampliada.
- Gravação vertical pela placa de vídeo (WebCodecs): custa o mesmo que gravar em 16:9, sem a cópia por quadro; volta sozinha para o caminho antigo se o computador não suportar.
- Resumo da análise dentro do app ao parar a gravação da análise, com orientação de ajuste e botão para abrir a pasta.
- MIDI Clock: **Song Position Pointer** — o Continue do equipamento retoma na posição certa do compasso.
- MIDI learn guarda de qual controlador veio cada controle; o **Testar tudo** avisa qual controlador ocupado ou desconectado tem controles mapeados.
- Vídeo: a cena preparada no Preview já deixa o vídeo dela carregado, e o TAKE entra sem engasgo (o roteiro tocando tem prioridade).
- **Relatar problema** no menu da pílula de saúde: salva o diagnóstico, copia um resumo sem dados pessoais e abre a página do relato no GitHub (nada é enviado sozinho).

### Corrigido

- A janela de controle travava um pouco a cada ajuste (slider, knob MIDI, OSC ou celular): o PREVIEW era refeito do zero toda vez (11 programas da placa de vídeo, ~0,3 s). Agora é criado uma vez só.
- Os desenhos do analisador, da timeline e do PREVIEW eram reiniciados a cada quadro de áudio, e o status do celular a cada quadro também (230 vezes em 3 s parado); agora rodam uma vez e seguem.
- Parar logo depois de Gravar (enquanto o telão preparava a gravação) não se perde mais: antes a gravação ficava presa em "Finalizando…" e crescia até 4 GB.
- **PÂNICO** e **Reset** passam a acalmar também Partículas e Orgânico (antes só caleidoscópio, túnel, mandala e glitch).
- Teclas **1–8** com o modo Preview ligado preparam a cena, como os pads (antes mandavam direto para o telão).
- Celular: "Caos" e "Só logo" com o mesmo nome do controle.
- Um erro de disco numa gravação vertical não desliga mais a gravação pela placa de vídeo nas seguintes; falhas ao preparar a gravação não deixam a captura do telão ligada.
- O resumo da análise não falha mais quando a última linha do arquivo ficou cortada (disco cheio, app fechado).
- Controladores MIDI com o nome numerado pelo Windows ("2- nanoKONTROL2") são reconhecidos no Testar tudo; um controlador mapeado noutro computador aparece em amarelo, não em vermelho.

## [0.3.9] - 2026-10-31

### Adicionado

- DK-102: saída **Spout** para Resolume/TouchDesigner/OBS — captura a janela do telão direto na placa de vídeo (menos de 0,5 ms por quadro), nome do sender salvo, religa sozinha ao trocar o telão de monitor; desligada por padrão (`docs/quality/SPOUT.md`, `docs/CREDITOS.md`).
- DK-123: efeitos da comunidade no telão como camadas (até 2), com desligamento automático do efeito que falha, pesa demais ou derruba a placa, e **modo seguro** (botão no editor, Shift + Projetar, ou automático depois de uma queda). Parâmetros com fonte de modulação passam a reagir ao som; opacidade e liga/desliga das camadas de efeito e de vídeo aprendem no MIDI.
- DK-063: vídeo do fundo como camada opcional (na frente de efeitos, com mistura e opacidade); o padrão continua igual.
- DK-144: gravar a análise de um set (só números, sem áudio) com a tecla **M** marcando os drops, para ajustar a detecção com a música do DJ (`docs/quality/CALIBRACAO.md`).
- DK-145: botão **Testar tudo** (aba Saída) que confere em 10 s áudio, BPM, telão, MIDI, disco, limite de flashes, efeitos, versão e rede, com a correção de cada item.
- Tutorial com capturas novas: mapa de automação, editor de efeitos, gravação vertical, vídeo em loop, aba Saída inteira.

### Alterado

- Janela de controle: o PREVIEW não fica mais atrás do analisador em telas baixas (1366×768); títulos de seção iguais em todas as abas; o seletor do editor de efeitos mostra o nome.

### Corrigido

- Desligar o OSC ou o celular podia levar alguns segundos com o notebook carregado; agora a porta é liberada na hora.
- Testes do servidor de rede deixaram de falhar de vez em quando em máquina carregada (prazos medidos pela causa, não pelo agendamento da CPU).

## [0.3.8] - 2026-10-31

### Adicionado

- DK-061/062: vídeo de fundo completo — o app testa o arquivo na importação (recusa o que este Windows não toca, como HEVC, e diz como converter), início e fim do loop por vídeo, "reiniciar no compasso", volta sozinho para a foto/cor se o vídeo der erro ou travar, e no máximo um vídeo tocando e um preparado (`docs/quality/VIDEO.md`).
- DK-111/112: MIDI Clock — o andamento (e, com Start, o 1º tempo) vem do equipamento do DJ; selo "MIDI CLK" na bolinha de BPM; volta para o som 2 s depois do último pulso (`docs/MIDI-CLOCK.md`).
- DK-073: gravação vertical 9:16 (1080×1920 ou 720×1280) com zoom e posição do recorte e prévia no PREVIEW.
- DK-121/122: efeitos da comunidade — formato `.doublekfx`, validação, editor com pré-visualização reagindo ao som, erros por linha, reverter para o último válido e proteção contra efeito que derruba a placa (`docs/SHADERS.md`). No telão, na próxima versão.

### Segurança

- DK-083: o servidor do celular não fica mais refém de conexões lentas (slowloris): prazo de 2 s por pedido e fila de espera quando lotado; testes com 10 mil entradas aleatórias no HTTP e no OSC.

### Corrigido

- Celular: o último valor de um slider arrastado rápido às vezes perdia para o penúltimo; resposta atrasada do pareamento apagava a contagem de espera.
- Logo ou foto guardada com arquivo inválido gerava erro repetido nas duas janelas; agora o telão usa a logo padrão / a cor de fundo e avisa no Diagnóstico.
- Editor de efeitos quebrava ao trocar de aba enquanto carregava a imagem de teste.

## [0.3.7] - 2026-10-30

### Adicionado

- DK-082: tela do celular servida pelo próprio app — pareamento por código, BPM e estado da música, bancos e pads com nomes, BLACKOUT, SÓ LOGO, macros, TAP, fase, 4 sliders e PÂNICO; aviso de "sem conexão" e reconexão sozinha; CSP estrita.
- DK-071/072: gravação da saída do telão em MP4/H.264 (sem áudio), em pedaços direto para o disco, com qualidade e FPS, indicador REC, limite de 4 GB e de 1 GB livre, e aviso se pesar no telão (`docs/quality/GRAVACAO.md`).
- DK-035: Intelligent Show v2 — usa os indicadores do motor de áudio, aviso "GRADE?" quando o BPM travado não bate mais com os kicks (troca de faixa com pausa) e painel **Mapa de automação** na aba Efeitos.
- DK-132: presets `.doublekpreset` — exportar o visual atual e importar presets de outros DJs na seção "Importados" do Catálogo (`docs/PRESETS.md`).
- OSC: endereço `/doublek/v1/nudge` para a fase do beat.

### Corrigido

- DK-009 P8: depois de uma pausa, uma faixa no mesmo BPM em outra fase ficava até 30 s sem kicks detectados; agora re-trava em até 2,3 s.
- Apagar um banco renumera os pontos de roteiro e o mapa de automação que apontavam para os bancos seguintes.
- Contadores de OSC/celular não quebram mais se o servidor não responder.

## [0.3.6] - 2026-10-30

### Adicionado

- DK-053: camadas dentro das cenas e presets (o pad guarda ordem, modos e opacidades), solo por camada, arrastar para reordenar e MIDI learn da opacidade e do liga/desliga de cada camada. Benchmark de 4 camadas em `docs/quality/CAMADAS.md`.
- DK-092: seção "OSC (rede)" na aba Saída — ligar/desligar, porta, abrir para a rede local com aviso, contadores e erros; comandos OSC só entram com o servidor ligado.
- DK-081: servidor local para o celular, desligado por padrão, com pareamento por código de 6 dígitos (2 min, uso único, bloqueio após 5 erros), token só em memória, limite de taxa e proteção contra DNS rebinding (`docs/REMOTO.md`). A página do celular com os botões chega na 0.3.7.
- DK-044: todo comando de show tem tecla e id MIDI — **A** (modo de automação), **Alt+1..4** (abrir banco), **U/D/C/X** (macros), **V** (modo Preview); stress de 5 min sem erro, sem comando preso e sem vazamento (`docs/quality/DK-044-stress.md`).
- DK-031: indicadores de energia no motor de áudio (energia, contraste entre compassos, estabilidade do relógio, kicks por compasso) para o Intelligent Show.

### Corrigido

- Ctrl+tecla (Ctrl+B, Ctrl+R…) disparava comandos de show; agora fica com o Windows.
- Segurar uma tecla repetia o comando (vários Drops); só as setas de fase repetem.

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

[Não lançado]: https://github.com/vzf22zss/doublek_sounds/compare/7d0fb47...main
[0.3.15]: https://github.com/vzf22zss/doublek_sounds/compare/52ef718...7d0fb47
[0.3.14]: https://github.com/vzf22zss/doublek_sounds/compare/dc01dd8...52ef718
[0.3.13]: https://github.com/vzf22zss/doublek_sounds/compare/353b128...dc01dd8
[0.3.12]: https://github.com/vzf22zss/doublek_sounds/compare/8e9ebc4...353b128
[0.3.11]: https://github.com/vzf22zss/doublek_sounds/compare/cc2cf94...8e9ebc4
[0.3.10]: https://github.com/vzf22zss/doublek_sounds/compare/7f1252a...cc2cf94
[0.3.9]: https://github.com/vzf22zss/doublek_sounds/compare/078fe13...7f1252a
[0.3.8]: https://github.com/vzf22zss/doublek_sounds/compare/8b5e6f2...078fe13
[0.3.7]: https://github.com/vzf22zss/doublek_sounds/compare/80d07b5...8b5e6f2
[0.3.6]: https://github.com/vzf22zss/doublek_sounds/compare/0f3dab9...80d07b5
[0.3.5]: https://github.com/vzf22zss/doublek_sounds/compare/ef1a66a...0f3dab9
[0.3.4]: https://github.com/vzf22zss/doublek_sounds/compare/1c4ade7...ef1a66a
[0.3.3]: https://github.com/vzf22zss/doublek_sounds/compare/7582b07...1c4ade7
[0.3.2]: https://github.com/vzf22zss/doublek_sounds/compare/09a7677...7582b07
[0.3.1]: https://github.com/vzf22zss/doublek_sounds/compare/24883e2...09a7677
[0.3.0]: https://github.com/vzf22zss/doublek_sounds/compare/ecf84ce...24883e2
[0.2.0]: https://github.com/vzf22zss/doublek_sounds/compare/40f3349...ecf84ce
[0.1.0]: https://github.com/vzf22zss/doublek_sounds/compare/b53c30d...40f3349
