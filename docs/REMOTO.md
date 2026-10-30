# Controle pelo celular — serviço remoto local (DK-081)

Base para controlar o show pelo celular/tablet no Wi-Fi do palco. Em DK-081 existe o **serviço** (HTTP local com pareamento) e a parte do app que liga, mostra o código e executa os comandos; a **tela do celular** é a DK-082 (hoje `GET /` só mostra "pareie no app").

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
| `GET /` | — | página HTML embutida (sem servir arquivos do disco) |
| `POST /pair` | — | `{"code":"123456"}` → `{"token":"<64 hex>","client":"celular 1 (IP)"}` |
| `POST /cmd` | `Authorization: Bearer <token>` | `{"addr":"/doublek/v1/blackout","args":[{"t":"T","v":true}]}` → `{"ok":true}` |
| `GET /state` | `Authorization: Bearer <token>` | `{"state":"<linha de status>","bpm":145.2,"scene":3,"bank":1,"blackout":false}` (cena/banco a partir de 1; `null` se não há) |

- `/cmd` usa **exatamente o formato e os endereços do OSC** (`docs/OSC.md`): o app passa por `oscToCommand` e pelo dispatcher com a fonte `remote`, que só é aceita com o serviço ligado. `200` significa "chegou", não "executou": endereço inválido ou comando recusado vai para o diário (Diagnóstico) com o nome do cliente.
- Erros: `400` pedido/corpo inválido · `401` sem token, token errado/desconectado ou código errado/vencido · `403` Host que não é IP ou Origin de outro site · `404` · `405` método errado (inclui `OPTIONS`) · `408` tempo esgotado · `413` corpo > 4 KB · `429` limite de taxa ou pareamento bloqueado · `431` cabeçalho > 8 KB · `501` `Transfer-Encoding`. Corpo de erro: `{"error":"<motivo em português>"}`.
- Uma resposta por conexão (`Connection: close`), HTTP/1.1 só com `Content-Length`.

## Segurança

- **Desligado por padrão** e em `127.0.0.1`; rede local só com a opção marcada.
- **Sem pareamento, sem acesso:** `/cmd` e `/state` exigem o token; o token (32 bytes do gerador do sistema, `BCryptGenRandom`) só existe na memória do app e é comparado em tempo constante.
- **Código:** 6 dígitos, 2 min, uso único; **5 erros bloqueiam o pareamento por 1 minuto** (mostrar um código novo no app zera o bloqueio). Na pior das hipóteses, ~10 palpites por código em 10⁶.
- **Limites:** 20 pedidos/s por token (`429`), corpo ≤ 4 KB, cabeçalho ≤ 8 KB, até 32 conexões simultâneas, 3 s de tempo-limite por conexão; o comando só aceita o formato `{addr, args}` (até 16 argumentos de tipo OSC) — nada de arquivo, caminho ou execução.
- **Navegador de outro site:** sem `Access-Control-Allow-*` (nada de CORS aberto), `OPTIONS` = 405, `Origin` diferente do próprio endereço = 403, `Host` precisa ser IP ou `localhost` (barra DNS rebinding). Cabeçalhos `no-store`, `nosniff`, `X-Frame-Options: DENY`, CSP.
- **LAN sem TLS:** na rede local o tráfego é HTTP puro. Quem estiver na mesma rede e capturar pacotes pode ver o código no momento do pareamento e o token depois — e então mandar comandos. Mitigações: o código expira em 2 min e é de uso único; **Desconectar todos** derruba os tokens na hora; desligar o serviço também. Use só rede confiável (roteador do palco, sem Wi-Fi aberto ao público).
- **Firewall do Windows:** na primeira vez que o serviço abre para a rede local, o Windows pode pedir "Permitir acesso"; sem liberar (rede privada), o celular não conecta.
- Se a rede cair, o show segue: o servidor roda em threads próprias, não toca a thread de áudio nem o BLACKOUT, e todos os comandos locais continuam funcionando.

## Verificado / pendente

- Testes Rust do parser HTTP, rotas, pareamento, bloqueio, taxa e fumaça em TCP real; teste no exe real (pareamento por `fetch`, BLACKOUT pelo `/cmd`, `/state`, Diagnóstico com `source: "remote"`, Desconectar todos, porta em uso) em `127.0.0.1`.
- **NÃO VERIFICADO:** celular de verdade no Wi-Fi (LAN `0.0.0.0`), prompt do firewall, IP mostrado em máquina com várias placas de rede (usa a rota padrão).
- **DK-082:** a tela do celular (pads, macros, blackout, TAP, sliders básicos) servida em `GET /`, usando `/pair`, `/cmd` e `/state`.
