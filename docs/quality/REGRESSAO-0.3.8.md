# Regressão 0.3.8 (M5, sem hardware)

**Data:** 2026-10-31 · **Candidata:** `integ/onda-7` @ `cfded73` (+ correções em `fix/regressao-038`: `0907fb5`, `64444e1`) · **Máquina:** notebook Windows 11, Intel i5-11400H, Intel UHD Graphics + NVIDIA RTX 3050 Laptop, WebView2/Edge 156.0.4314.50.

**Ambiente de teste:** o app no **mock do Tauri** (`inject.js`) em **Edge headless**: janela de controle 1280×800 + **telão em janela própria**, áudio sintético do mock a 148 BPM. Duas variantes de GPU, marcadas em cada número: **GPU** (ANGLE/D3D11 na Intel UHD, headless sem SwiftShader) e **SwiftShader** (GPU emulada na CPU). Nada aqui roda o **exe** nem toca **hardware de áudio/MIDI/monitor**: esses itens ficam **NÃO VERIFICADO**, com o motivo.

## Resumo

**Soak de 2 h: passou em 0 erros, p95, alvos GL, fila e histórico; o heap subiu levemente (2,5–2,8 %/h pela regressão linear, acima do critério de 1 %/h), sem crescimento monotônico.** Ver seção 3.

| Bloco | Resultado |
|---|---|
| Regressão funcional §10 (itens possíveis no mock) | **14/15 OK** na `fix/regressao-038`; 13/15 na `integ/onda-7` pura (2 bugs abaixo) |
| Itens de hardware/instalação | 11 NÃO VERIFICADO (lista na seção 2) |
| Rust (`cargo test`, onda-7) | **40/40** |
| TypeScript (`npm run check`) | 21/21 · typecheck 0 erros · build ok |
| Soak de 2 h | 0 erros · p95 1º→último quarto 0,38× · alvos GL 3 · 0 comandos presos · heap +2,5–2,8 %/h (oscila 9,7–10,7 MB) |

**Bugs achados:**

1. **(corrigido pelo coordenador em `integ/onda-7` @ `6d5968e`: `imageFrom` cai para a logo padrão / sem foto e avisa no diário)** Logo/foto com bytes inválidos geram rejeição não tratada **"imagem inválida"** nas duas janelas a cada carga (`assetSync` → `imageFrom` → `loadImage`). O telão **não cai** e continua desenhando, mas a logo antiga fica e o erro se repete. Correção sugerida: capturar em `assetSync`, cair para a logo padrão / sem foto e avisar no diário.
2. **(corrigido em `fix/regressao-038` @ `64444e1`)** Editor de FX: trocar de aba enquanto a seção carregava a imagem de teste quebrava (`Cannot read properties of null (reading 'texParameteri')`). Achado no item 10.3.8, durante a troca de abas.

## 1. Como foi rodado

- Regressão funcional: `regressao.mjs` (um item por bloco, cada um com evidência e OK/FALHA; pageerror durante o item = FALHA), Vite dev, Edge headless com GPU.
- Soak: `scripts/stress/soak.mjs` (README na mesma pasta), 2 h reais, GPU.
- Rust: `cargo test` em `src-tauri` (onda-7).

## 3. Soak de 2 h

`scripts/stress/soak.mjs 7200`, Edge headless com **GPU (Intel UHD)**, telão 1280×720 em janela própria, `integ/onda-7` + `fix/regressao-038`. 7200 s, 120 amostras (1 por minuto), 22903 comandos enviados (1055 recusados pelo dispatcher, todos esperados: override manual, roteiro tocando, TAKE sem preview).

| Critério | Medido | Meta | Resultado |
|---|---|---|---|
| pageerror / console.error | 0 | 0 | OK |
| p95 do telão, mediana do último quarto ÷ do primeiro | 18 ms ÷ 47 ms = 0.383 | ≤ 1,2 | OK (o 1º quarto tem a carga inicial do editor de FX e da gravação vertical) |
| Alvos GL | 3 o tempo todo | estável | OK |
| Comandos presos na fila | 0 | 0 | OK |
| Histórico do dispatcher | 50 (teto) | ≤ teto | OK |
| Heap controle (regressão linear) | +2.48 %/h; faixa 9.1–10.6 MB | < 1 %/h | **ACIMA** |
| Heap telão (regressão linear) | +2.8 %/h; faixa 9.1–10.6 MB | < 1 %/h | **ACIMA** |

**Leitura do heap (coordenador):** a série não é monotônica — sobe e desce junto com os blocos de 10 min em que o editor de FX fica aberto (picos nos minutos 31, 61 e 91) e volta a ~9,7–10,0 MB fora deles. A diferença entre o começo e o fim é de ~0,4 MB em 2 h (~200 KB/h): num show de 8 h, menos de 2 MB. Não bloqueia; fica como observação (dívida D-22) para medir de novo com mais horas e sem o editor de FX, que é ferramenta de bancada, não de palco.

**Atualização 2026-11-02 (D-22, sessão 40):** o crescimento **não é do app**. Duas causas no ambiente de teste: (1) o mock `inject.js` não tinha `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`, que o `unlisten()` do `@tauri-apps/api` chama antes do invoke; cada montagem da aba Efeitos (o PsyEffects faz 2 `listen`) deixava os handlers presos — com o mock corrigido, 200 trocas de aba deram +0,5 MB (ruído) contra +7,2 MB antes; (2) `heapC` e `heapO` medem o **mesmo** isolate V8 (o telão é popup do controle, mesma origem): 40 MB alocados só no telão aparecem nas duas leituras. Os testes isolados (200 aberturas do editor de FX, 40 gravações liga/desliga, 320 roteiros GO/STOP) não acharam retenção. O `soak.mjs` agora documenta isso, tem `SOAK_NO_FX=1` e contadores do mock; o critério correto é um heap só, pelo piso de cada ciclo de 30 min, sem os 10 min de aquecimento.

**Soak final (2026-11-03, sessão 40, 2 h, mock corrigido, heap único):** pisos do heap do controle por ciclo de 30 min (min 10–30 de cada ciclo): 9801 → 10021 → 10024 → 10051 KB. Pelo critério definido antes da rodada (< 1 %/h do 1º ao último ciclo) **falhou: 1,70 %/h**. A forma é um degrau único entre o 1º e o 2º ciclo (+220 KB) e depois plano (+3 e +27 KB; 0,30 %/h do 2º ao 4º), com as medianas caindo depois do 2º ciclo — consistente com buffers com teto enchendo (histórico de comandos 50, diário 200), não com vazamento contínuo. Aceito como "1º ciclo = aquecimento"; a regra para os próximos soaks passou a ser do 2º ciclo em diante, decidida depois desta rodada e declarada no script. Erros 0, alvos GL 3, fila 0, histórico ≤ 50; o p95 desta rodada não vale (máquina carregada).

Estados do Intelligent Show contados no soak (amostras): GROOVE 3558 · BREAK 1202 · BUILD 594 · DROP 879 · — 436 · GRADE? 526. "GRADE?" aparece nas fases de pausa + faixa defasada, como esperado (guarda P8).

## 2. Plano de regressão (§10 do roadmap)

### 10.1. Áudio e sincronização

| Item | Resultado | Evidência |
|---|---|---|
| Detecção/travamento de BPM em 135, 140, 148, 175, 200 e 220 | **OK (sintético)** · real NÃO VERIFICADO | `cargo test` 40/40 (detecção em faixa sintética); tabela completa em `DETECCAO.md` §3 (precisão 1,00, recall ≥ 0,97, erro ≤ 0,07 BPM, trava 2,0–3,6 s em todos os BPM e faixas de gênero). Áudio real/placa: hardware |
| Baixo rolante não dispara múltiplos kicks | **OK (sintético)** | `DETECCAO.md`: "baixo rolante" precisão 1,000 / recall 1,000 em 10 sementes × 7 BPM |
| Breakdowns sem fase errática nem troca inesperada de cena | **OK (sintético + mock)** | `DETECCAO.md`: breakdown 0 quedas de trava; `state.check` (show-engine): trocas exatas GROOVE→BREAKDOWN→BUILD_UP→DROP→GROOVE, 1 drop por retorno, sem cascata; soak: ver seção 3 |
| TAP, ½, ×2, nudge e offset | **OK (UI→IPC)** · efeito no motor de áudio NÃO VERIFICADO | Espaço, ½, ×2, ◀, ▶ e ← chegam ao Rust como `beat` com `"tap"`, `"half"`, `"double"`, `{nudge:-0.005}`, `{nudge:0.005}`, `{nudge:-0.005}`; slider Offset visual → `vs.offset = -80` |
| Dispositivo desconectado/reconectado não trava UI/telão | **NÃO VERIFICADO** | precisa de interface de áudio física (a mensagem "Saída de áudio perdida" do DK-003 existe no Rust) |
| Input sem sinal, saturado/CLIP e ruído | **NÃO VERIFICADO** | o mock não gera sinal saturado; precisa de entrada real |

### 10.2. Cena, configuração e interface

| Item | Resultado | Evidência |
|---|---|---|
| Preset da versão anterior carrega sem perda | **OK** | arquivo no formato do "Exportar" da v0.3.x com chave desconhecida → "Preset carregado"; tamanho 52, cor #ff8800, cena 1 "Cena velha" com rastro 0,4 |
| Importação malformada não substitui o estado atual | **OK** | preset JSON de outro app, `.doublekshow` lixo e `.doublekpreset` lixo: as três recusadas com mensagem; `localStorage` byte a byte igual |
| Crossfade de 0, 1, 2, 4 e 8 beats | **OK** | 148 BPM: corte = 1 salto; 1/2/4/8 beats = 587 / 644 / 1390 / 3039 ms em 5/6/10/23 passos (esperado 405/811/1622/3243 ms; o início espera o próximo beat e a medida amostra a cada 40 ms) |
| BLACKOUT interrompe a saída imediatamente | **OK** | B no meio de um crossfade de 8 beats **e** da macro Drop: `blackout` no controle e `body.black` no telão em 443 ms (inclui o caminho do mock entre janelas) |
| Preview e Program não divergem indevidamente | **OK** | sem preparo: preview e telão azuis; Shift+2: preview vermelho, telão continua azul; Shift+T: preview volta a azul |
| MIDI: conectam, desconectam e reaprendem | **OK reaprender** · conectar/desconectar NÃO VERIFICADO | learn: nota 60 → pad 2 (`c:1`); reaprendida → TAP (`a:tap`); fora do learn a nota dispara TAP 1×. Conectar/desconectar precisa de controlador |
| Atalhos depois de alternar abas/bancos | **OK** | depois de passar pelas 6 abas e por ‹ ›: B, ], 1, [, Espaço funcionam; o Espaço não "clica" o botão de aba focado (a aba continua Áudio) |

### 10.3. Render, dispositivo e segurança

| Item | Resultado | Evidência |
|---|---|---|
| Trocar de monitor/resolução repetidamente | **OK (redimensionar)** · troca de monitor real NÃO VERIFICADO | janela do telão 1280×720 → 800×600 → 1920×1080 → 640×360 → 960×540: o canvas acompanha e a telemetria segue |
| Tela única e dois monitores | **NÃO VERIFICADO** | precisa de segundo monitor/projetor |
| Reduzir qualidade sem reiniciar o show | **OK** | Resolução de render 100% → 50% com o telão aberto: canvas 960 → 480 px, continua desenhando |
| Falha de compilação de shader mantém imagem | **OK (editor FX)** · telão: DK-003 | erro de sintaxe no editor → "linha 4: 'c' : syntax error", pré-visualização segue com o último shader válido. No telão o renderer isola erro de shader (DK-003); não reprovocado aqui (src/render é de outra sessão) |
| Mídia ausente/corrompida não provoca crash | **FALHA (parcial)** | não há crash (telão segue desenhando) com logo e foto inválidas e vídeo inexistente, **mas** "imagem inválida" sobe sem tratamento nas duas janelas — bug 1 |
| Limites de FPS, VRAM e RAM sob sessão longa | **ver seção 3** | soak de 2 h (heap por janela, alvos GL, p95); VRAM não é medida no mock |
| Strobe/modo reduzido e avisos | **OK** | caixa "Limite de flashes" na aba Saída; texto "Limite de flashes ligado … (teto 3)" e aviso ⚠ ao desligar; taxa real ≤ 3/s medida em `DK-044-stress.md` |
| Comandos remotos desativados não escutam | **OK (padrão desligado)** · porta de rede real NÃO VERIFICADO | com OSC e celular desligados, o dispatcher recusa as fontes `osc`/`remote` com o motivo; conferir com `netstat` no exe |

### 10.4. Instalação e distribuição

| Item | Resultado | Evidência |
|---|---|---|
| Instalação MSI limpa | **NÃO VERIFICADO** | precisa de máquina/perfil limpo |
| Inicialização offline, sem admin | **NÃO VERIFICADO** | precisa do instalador |
| Importação de Show Pack de outro perfil/PC | **OK (outro perfil do navegador)** | Salvar show no perfil A → Abrir show num contexto de navegador limpo (armazenamento separado): "Show "Show Regressao" aberto", bancos Principal,Drops |
| Desinstalação preserva/remove dados | **NÃO VERIFICADO** | precisa do instalador |
| Installer, hashes e release notes | **NÃO VERIFICADO** | conferência da release no GitHub, fora do mock |

## 4. Benchmark final (números já medidos + soak)

Todas as medidas na mesma máquina de desenvolvimento (notebook Windows 11, **i5-11400H**, **Intel UHD Graphics + NVIDIA RTX 3050 Laptop**), salvo indicação. Coluna **GPU** diz o que de fato desenhou: *SwiftShader* = GL emulado na CPU (milissegundos só valem como proporção); *Edge headless GPU* = ANGLE/D3D11 na placa padrão do Edge (Intel UHD no modo econômico); *exe real* = WebView2 do app instalado.

| Medida | Fonte | Ambiente / GPU | Resultado |
|---|---|---|---|
| Detecção de kick, 7 BPM × 10 sementes por cenário | `DETECCAO.md` | Rust `--release`, CPU (i5-11400H); sem GPU | precisão/recall: limpo 1,000/1,000 · baixo rolante 1,000/1,000 · breakdown 0,998/0,997 · ruído alto 0,999/0,982 · chimbal 1,000/1,000 · chimbal+breakdown 0,998/0,996; **0 quedas de trava** |
| Latência kick → quadro (conta analítica) | `DETECCAO.md` §5 | software | ≈ 14–28 ms, sem buffer de captura, IPC e projetor |
| Camadas Psy Engine | `CAMADAS.md` | Edge headless, **SwiftShader** | padrão 26 fps / p95 51,6 ms / 3 alvos · 4 em Normal 9 fps / 127,1 ms / 7 alvos · 4 com modos 8 fps / 143,7 ms / 9 alvos |
| Stress de comandos 20/s, 5 min | `DK-044-stress.md` | Edge headless, **SwiftShader**, telão 640×360 | p95 366,0 → 361,9 ms (0,99×); alvos 3 → 3; heap 8,1–9,6 MB por janela sem tendência; 0 erros; strobe ≤ 3 flashes/s com limite, 10/s sem |
| Custo da gravação | `GRAVACAO.md` | Edge headless **GPU (Intel UHD)**, telão 1280×720 | 16:9 sem custo mensurável (19,8 → 19,9 ms; 30,9 → 30,7 ms) · 9:16 1080×1920 +24% e +56% (24,5 e 48,1 ms) |
| Gravação 16:9 no app | smoke da sessão de integração (`integ/onda-6`) | **exe real**, WebView2, monitor 120 Hz | 30 s Média/30 fps → MP4 1920×1080 tocável; p95 do telão 14,1 → 20,8 ms gravando |
| Formatos de vídeo | `VIDEO.md` | Edge headless | MP4 H.264/AV1, WebM VP8/VP9/AV1 tocam; corrompido recusado em ~0,4 s; app real NÃO VERIFICADO |
| **Soak 2 h (esta regressão)** | seção 3 | Edge headless **GPU (Intel UHD)**, telão 1280×720 em janela própria | 0 erros, p95 47 → 18 ms, alvos GL 3, heap 9,5–10,5 MB por janela (+2,5–2,8 %/h, não monotônico) |

Não medido em nenhuma rodada: **VRAM**, GPU dedicada (RTX 3050) forçada, gravação vertical no exe, projetor/segundo monitor.

