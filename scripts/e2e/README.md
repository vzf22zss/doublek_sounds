# Smoke de release no exe real

`smoke.mjs` abre o **exe compilado deste worktree** e roda o roteiro de smoke (o da 0.3.9) em cerca de 8 minutos. Cada bloco usa **um exe novo**, com pasta e porta próprias, para que uma falha que trave a janela não derrube os blocos seguintes e cada um comece do zero. No fim, imprime a tabela OK / FALHA / PULADO. Ele substitui os scripts soltos que as sessões usaram nas regressões 0.3.7–0.3.9.

## Pré-requisitos

1. **Exe compilado:** no worktree, `npx tauri build --no-bundle`. Não use `cargo build` sozinho: ele gera um binário com cfg dev, que tenta carregar o servidor de desenvolvimento.
2. **puppeteer-core** numa pasta à parte, para não criar dependência no repo. É a mesma convenção do `scripts/stress`: `npm i puppeteer-core` dentro dela e `DOUBLEK_MOCK=<essa pasta>`.
3. **Microsoft Edge** instalado. Para usar outro caminho, defina `EDGE=<caminho do msedge.exe>`. O "celular" e a geração de vídeos de teste usam o Edge headless.
4. Opcional: `cargo` no PATH (ou em `%USERPROFILE%\.cargo\bin`) para conferir o diário com `cargo run --example replay`. Sem ele, esse item sai como PULADO.

## Como rodar

```powershell
$env:DOUBLEK_MOCK = 'C:\caminho\da\pasta\com\puppeteer-core'
node scripts/e2e/smoke.mjs                       # tudo
node scripts/e2e/smoke.mjs --only=celular,osc    # só alguns blocos
node scripts/e2e/smoke.mjs --exe=..\outro-worktree\src-tauri\target\release\doublek-visuals.exe --out=C:\temp\smoke
```

- Blocos: `resposta`, `spout`, `diario`, `fx`, `video`, `gravacao`, `osc`, `celular`. Em cada bloco, o console do controle e do telão (CSP) é conferido, e o telão é fechado no fim.
- Saída: a tabela no terminal, `smoke-table.md`, `smoke-result.json` e as capturas, em `--out` (padrão `%TEMP%\doublek-e2e-out`). O código de saída é 0 se nada falhou.
- `node scripts/e2e/media.mjs` só gera a mídia de teste (cache em `%TEMP%\doublek-e2e-media`). O smoke também a gera sozinho quando falta.

## Segurança: o app instalado nunca é alvo

- O script **recusa** um exe que não esteja dentro de um `git worktree` deste repositório. Ou seja, nunca usa `C:\Program Files\DoubleK Visuals`.
- O exe abre com **pasta de dados própria**, temporária (`WEBVIEW2_USER_DATA_FOLDER`), e **porta de depuração livre**. Configurações, mídia e pareamentos do usuário não são tocados.
- Ao fechar, o script mata **só** o exe que ele lançou e os processos cuja linha de comando contém a pasta isolada dele. Depois apaga essa pasta.
- As portas do OSC e do celular são **livres**, escolhidas na hora. Não colide com o app do usuário nem com outras sessões, que usam 9000/8008/4183/4184.
- Em `%APPDATA%\com.doublek.visuals` ficam gravações e diários, e essa pasta é compartilhada com o app instalado. O script apaga **só** os arquivos cujo caminho o próprio app informou nesta execução ("Última: …", "Análise salva em …"). Se a pasta `recordings` ou `analysis` não existia antes e ficou vazia, ela também é apagada. A lista do que foi apagado sai no fim.
- O telão abre em tela cheia no **último monitor**. No bloco `spout`, com 2 monitores, ele passa uns segundos pelo monitor 1 para provar a troca de monitor. Com 1 monitor só, o telão cobre a tela durante o smoke.
- O bloco `diario` liga **"Ouvir" na entrada de áudio padrão do Windows** (o microfone) por cerca de 10 s. O diário grava só números, nunca o som.

## O que cada bloco prova

| Bloco | Prova | NÃO VERIFICADO |
|---|---|---|
| `resposta` | Mudar um ajuste (10× o slider Pulso) **não recria o renderer do PREVIEW** (0 `createProgram` novos) e a janela de controle responde em < 1 s. É a regressão do achado de 2026-11-02: cada mudança de `vs` recriava o PREVIEW, com cerca de 250 ms de compilação de shader por mudança | — |
| `spout` | Ligar sem telão dá mensagem. Com o telão, o status mostra "W×H · fps · quadros" subindo. Trocar o telão de monitor mantém o envio com o mesmo nome. Desligar funciona. O nome fica em `doublek.settings` | receptor Spout real (Resolume) |
| `diario` | "Gravar análise" → M 2× → Parar gera um `.jsonl` com amostras e as 2 marcas, e o `replay` imprime o resumo | precisão da detecção com música real |
| `fx` | Os 2 exemplos de `docs/examples/fx` importados viram camadas que **compilam e desenham no telão**: os programas `uP[` são contados por instrumentação do WebGL do telão. O MIDI learn da opacidade arma o alvo. O modo seguro zera os efeitos, e sair dele os traz de volta | controlador MIDI físico; GPUs diferentes |
| `video` | Importa 2 WebM. O loop de 1–3 s num vídeo com keyframe a cada 2 s fica na janela, dá a volta e faz cerca de 1 seek por volta: é o caso que travava na 0.3.8. "Vídeo do fundo como camada" entra na lista e aceita o modo Tela. As capturas `camada-video-normal.png` e `camada-video-tela.png` servem para conferir a logo | conferência automática da logo na captura (é visual) |
| `gravacao` | Gravar 10 s em 16:9 Leve gera um arquivo em `%APPDATA%\…\recordings` com `ftyp` (MP4), e o arquivo é apagado no fim | tocar o arquivo num player; vertical (tem `--only` próprio no futuro) |
| `osc` | Com uma porta UDP livre, `/doublek/v1/blackout` T/F por UDP liga e desliga o BLACKOUT | TouchOSC/rede local |
| `celular` | Com uma porta TCP livre, um Edge headless faz o papel do celular (390×844): código errado dá erro e o certo leva à tela de controle; os 8 pads mostram os nomes das cenas; BLACKOUT funciona, inclusive com toque duplo rápido ×3; o arraste rápido do slider termina no valor final; sem rede aparece a faixa, e ela some quando a rede volta; "Desconectar todos" leva de volta ao pareamento; console sem CSP | celular real no Wi-Fi (LAN, firewall) |
| (todo bloco) | Console da janela de controle e do telão sem erros nem CSP. Fechar o telão no fim em < 15 s | — |

## Quando algo falha

- **"recuso rodar"**: o `--exe` aponta para fora de um worktree do repo. Isso é de propósito.
- **"conectar no WebView2: sem resposta"**: às vezes o endpoint de depuração do WebView2 congela numa conexão. Rode de novo: cada execução usa pasta e porta novas.
- Um bloco que estoura 5 min vira FALHA "bloco rodou até o fim", e os outros continuam. O smoke inteiro tem teto de 40 min e, mesmo estourando, limpa o que criou.
