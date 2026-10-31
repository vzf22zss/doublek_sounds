# Controle pelo celular — serviço remoto local (DK-081/082)

Controle do show pelo celular/tablet no Wi-Fi do palco: o app serve uma página própria (sem instalar nada no celular), pareada por código, que manda os mesmos comandos do OSC.

## Usar no celular

1. No app: **Saída → Celular (rede)**, marque **Abrir para a rede local**, **Ligar celular** e **Mostrar código**.
2. No celular (mesmo Wi-Fi): abra o endereço mostrado (`http://<IP>:8008`) e digite os 6 dígitos — pareia sozinho no 6º. Código errado ou vencido avisa na hora; 5 erros bloqueiam por 1 min (com contagem; um código novo no app libera).
3. Tela de controle: BPM e estado da batida (e a pílula DROP), banco (1–4), os 8 pads com os nomes das cenas (o pad aceso é a cena no telão), **BLACKOUT** e **SÓ LOGO** (acendem conforme o app), macros Build-up/Drop/Chaos/Reset, TAP e fase ◀ ▶ (5 ms), sliders Pulso, Glow, Flash e Rastro (acompanham o app; no máximo 10 envios/s) e **PÂNICO** separado. Em paisagem, os pads e o PÂNICO ficam à esquerda.
4. Se o app sumir (Wi-Fi caiu, serviço desligado), aparece a faixa **"Sem conexão com o app"** e os botões ficam apagados; volta sozinho quando a conexão volta. Se o app desconectar o celular (Desconectar todos, desligou/religou o serviço, reiniciou), a tela volta para o código.
5. O pareamento vale enquanto a aba estiver aberta (recarregar mantém); fechar a aba esquece.

![Celular em retrato](img/celular-retrato.png) ![Celular em paisagem](img/celular-paisagem.png)

A página tem ~13 KB (HTML, `/app.js`, `/app.css` embutidos no app), funciona sem internet e não usa nada de fora. Comandos têm tempo-limite de 2 s; o estado é lido a 2 Hz.

## Ligar na tela

Aba **Saída** → **Celular (rede)**:

1. **Porta** (padrão 8008) e, se o celular for usar o Wi-Fi, **Abrir para a rede local** (aviso: rede local sem criptografia). Os dois ficam travados com o serviço ligado.
2. **Ligar celular**. Erro (porta em uso, porta reservada) aparece abaixo do botão.
3. **Mostrar código**: 6 dígitos grandes e o endereço para abrir no celular (`http://<IP deste computador>:8008` com rede local; `http://127.0.0.1:8008` só na própria máquina). O código vale **2 minutos** e **um celular só**; para outro celular, mostre outro código.
4. "N clientes pareados" e **Desconectar todos** (os tokens deixam de valer na hora). A cada comando vindo do celular, o rodapé mostra em laranja **"alguém está controlando pelo celular"** por 3 s.

Porta, rede local e ligado/desligado ficam em `doublek.settings`; ao abrir o app, religa sozinho só se estava ligado e em `127.0.0.1`. **Os pareamentos não são salvos:** desligar o serviço ou reiniciar o app desconecta todo mundo.

## Protocolo

| Rota | Autenticação | Corpo / resposta |
|---|---|---|
| `GET /` · `/app.js` · `/app.css` | — | a tela do celular, embutida no app (sem servir arquivos do disco) |
| `POST /pair` | — | `{"code":"123456"}` → `{"token":"<64 hex>","client":"celular 1 (IP)"}` |
| `POST /cmd` | `Authorization: Bearer <token>` | `{"addr":"/doublek/v1/blackout","args":[{"t":"T","v":true}]}` → `{"ok":true}` |
| `GET /state` | `Authorization: Bearer <token>` | `{"state":"<linha de status>","bpm":145.2,"music":"travado","drop":true,"scene":3,"bank":1,"blackout":false,"logoOnly":false,"sceneNames":[...8],"bankNames":[...] \| null,"knobs":{"amount":0.3,"glow":0.6,"fxFlash":0.35,"trail":0}}` (cena/banco a partir de 1; `null` se não há; `knobs` em 0–1 na faixa do `/parameter`) |

- `/cmd` usa **exatamente o formato e os endereços do OSC** (`docs/OSC.md`): o app passa por `oscToCommand` e pelo dispatcher com a fonte `remote`, que só é aceita com o serviço ligado. `200` significa "chegou", não "executou": endereço inválido ou comando recusado vai para o diário (Diagnóstico) com o nome do cliente.
- Erros: `400` pedido/corpo inválido · `401` sem token, token errado/desconectado ou código errado/vencido · `403` Host que não é IP ou Origin de outro site · `404` · `405` método errado (inclui `OPTIONS`) · `408` tempo esgotado · `413` corpo > 4 KB · `429` limite de taxa ou pareamento bloqueado · `431` cabeçalho > 8 KB · `501` `Transfer-Encoding`. Corpo de erro: `{"error":"<motivo em português>"}`.
- Uma resposta por conexão (`Connection: close`), HTTP/1.1 só com `Content-Length`.

## Segurança

- **Desligado por padrão** e em `127.0.0.1`; rede local só com a opção marcada.
- **Sem pareamento, sem acesso:** `/cmd` e `/state` exigem o token; o token (32 bytes do gerador do sistema, `BCryptGenRandom`) só existe na memória do app e é comparado em tempo constante.
- **Código:** 6 dígitos, 2 min, uso único; **5 erros bloqueiam o pareamento por 1 minuto** (mostrar um código novo no app zera o bloqueio). Na pior das hipóteses, ~10 palpites por código em 10⁶.
- **Limites:** 20 pedidos/s por token (`429`), corpo ≤ 4 KB, cabeçalho ≤ 8 KB, até 32 conexões simultâneas, 3 s de tempo-limite por conexão; o comando só aceita o formato `{addr, args}` (até 16 argumentos de tipo OSC) — nada de arquivo, caminho ou execução.
- **Navegador de outro site:** sem `Access-Control-Allow-*` (nada de CORS aberto), `OPTIONS` = 405, `Origin` diferente do próprio endereço = 403, `Host` precisa ser IP ou `localhost` (barra DNS rebinding). Cabeçalhos `no-store`, `nosniff`, `X-Frame-Options: DENY` e CSP estrita (`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'`…, nada inline). A página do celular só escreve dados do app como texto (nomes de cena não viram HTML).
- **LAN sem TLS:** na rede local o tráfego é HTTP puro. Quem estiver na mesma rede e capturar pacotes pode ver o código no momento do pareamento e o token depois — e então mandar comandos. Mitigações: o código expira em 2 min e é de uso único; **Desconectar todos** derruba os tokens na hora; desligar o serviço também. Use só rede confiável (roteador do palco, sem Wi-Fi aberto ao público).
- **Firewall do Windows:** na primeira vez que o serviço abre para a rede local, o Windows pode pedir "Permitir acesso"; sem liberar (rede privada), o celular não conecta.
- Se a rede cair, o show segue: o servidor roda em threads próprias, não toca a thread de áudio nem o BLACKOUT, e todos os comandos locais continuam funcionando.

## Verificado / pendente

- Testes Rust do parser HTTP, rotas (inclusive `/app.js`/`/app.css`, CSP e limite de 40 KB), pareamento, bloqueio, taxa e fumaça em TCP real; teste no exe real em `127.0.0.1` com o Edge headless fazendo o papel do celular (390×844 e 844×390): parear pela tela, pads, banco, macros, BLACKOUT, só logo, TAP, fase, slider, PÂNICO, rede caindo e voltando, serviço desligado/religado, bloqueio por 5 erros, Desconectar todos.
- **NÃO VERIFICADO:** celular de verdade no Wi-Fi (LAN `0.0.0.0`; Safari/iOS e Chrome/Android), prompt do firewall, IP mostrado em máquina com várias placas de rede (usa a rota padrão).
