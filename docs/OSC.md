# OSC — controle por rede (DK-091/092)

O DoubleK Visuals tem um servidor **OSC 1.0** (UDP) para receber comandos de TouchOSC, controladores de rede e outros programas de performance. Cada mensagem vira um comando do **mesmo dispatcher** que teclado, MIDI, botões e roteiro usam (ADR 0003): mesma validação, mesmo BLACKOUT/PÂNICO na frente, mesmo histórico.

## Ligar na tela

Aba **Saída** → **OSC (rede)**:

1. **Porta** (padrão 9000) e, se precisar, **Abrir para a rede local** (aparece o aviso: *sem autenticação: qualquer um na rede controla o show*). Os dois ficam travados enquanto o OSC está ligado.
2. **Ligar OSC**. O botão vira "Desligar OSC (127.0.0.1:9000)" e a linha "Recebidas · descartadas · recusadas" atualiza 1× por segundo. Erro (porta em uso, porta reservada) aparece logo abaixo do botão.
3. No cliente (TouchOSC, Pure Data, `oscsend`...), mande para o IP desta máquina e a porta escolhida. Mesma máquina: `127.0.0.1`.

- O dispatcher só aceita a fonte `osc` enquanto o servidor está ligado; desligou, volta a recusar.
- Endereço que não mapeia (ex.: `/doublek/v1/scene/9`) e comando recusado entram no **diário** (Diagnóstico), não na linha de status; o mesmo erro repetido entra no máximo 1× a cada 2 s. Os comandos aceitos aparecem no histórico do Diagnóstico com `source: "osc"`.
- OSC não conta como "mão do DJ" para o override manual da automação (é tratado como programa externo).
- Porta, rede local e ligado/desligado ficam salvos em `doublek.settings`. Ao abrir o app, o OSC **religa sozinho só se estava ligado e só em `127.0.0.1`**; com rede local, é preciso clicar de novo.
- **Firewall do Windows:** na primeira vez que o OSC abre para a rede local, o Windows pode mostrar "Permitir acesso" para o DoubleK Visuals. Sem liberar (rede privada), os pacotes de outros aparelhos não chegam — o servidor parece ligado, mas o contador "Recebidas" não sobe. Em `127.0.0.1` não há aviso.

## Como funciona

| Parte | Onde | O quê |
|---|---|---|
| Servidor | `src-tauri/src/osc.rs` | Abre a porta UDP, decodifica mensagens e bundles, aplica o limite de taxa e emite o evento `osc` `{ addr, args }` para a janela de controle. |
| Comandos Tauri | `src-tauri/src/main.rs` | `osc_start(bind, port)`, `osc_stop()`, `osc_status()`. |
| Mapeamento | `src/lib/osc.ts` | `oscToCommand(addr, args)` → `{ cmd }` (um `ShowCommand`) ou `{ error }` com o motivo em português. |

- **Padrão:** `127.0.0.1:9000` (`bind` vazio = `127.0.0.1`). Um servidor por vez: para trocar a porta, `osc_stop` e `osc_start` de novo.
- **Porta em uso:** `osc_start` recusa na hora, com "A porta N já está em uso por outro programa: escolha outra". Porta reservada pelo Windows e endereço inexistente também têm mensagem própria.
- **`osc_status`:** `{ running, bind, received, dropped, rejected }`. `received` = mensagens repassadas; `dropped` = descartadas pelo limite de taxa; `rejected` = pacotes malformados.
- **Argumentos no evento:** lista de `{ t, v }`, com `t` = `i` (inteiro 32 bits), `f` (float 32 bits; NaN/infinito chegam como `null` e são recusados), `s` (texto), `b` (blob, lista de bytes), `T`/`F` (`v` = true/false). Outros tipos OSC (`d`, `h`, `t`, `N`...) recusam o pacote inteiro.
- **Bundles** (`#bundle`) são aceitos, inclusive aninhados (até 8 níveis); o timetag é **ignorado**: tudo executa ao chegar.

## Endereços (versão 1)

Todos começam com `/doublek/v1/`. Cenas, bancos e pré-visualização contam **a partir de 1**, como na tela.

| Endereço | Argumentos | Comando |
|---|---|---|
| `/doublek/v1/scene/{1–8}` | opcional `f`/`i` = fade em beats (0–32) | `SCENE_RECALL` (pad do banco ativo) |
| `/doublek/v1/preview/{1–8}` | — | `SCENE_PREVIEW` |
| `/doublek/v1/take` | opcional `f`/`i` = fade em beats | `SCENE_TAKE` |
| `/doublek/v1/bank/{1–4}` | — | `BANK_SET` |
| `/doublek/v1/blackout` | nenhum = alterna; `T`/`F` ou `i` (0 = desliga) | `BLACKOUT` |
| `/doublek/v1/logo` | igual ao blackout | `LOGO_ONLY` |
| `/doublek/v1/tap` | — | `TAP` |
| `/doublek/v1/nudge` | `i`/`f` = ms (−50 a 50, ≠ 0) | `NUDGE` (fase do beat, como ← →) |
| `/doublek/v1/panic` | — | `PANIC` |
| `/doublek/v1/macro/{BUILD_UP\|DROP\|CHAOS\|RESET}` | — | `MACRO` |
| `/doublek/v1/parameter/{chave}` | `f` (ou `i`) de **0 a 1** | `SET_PARAMETER` na faixa da chave |
| `/doublek/v1/roteiro/go` · `/stop` · `/ab` | — | `ROTEIRO_GO` · `ROTEIRO_STOP` · `ROTEIRO_AB` |
| `/doublek/v1/roteiro/nudge` | `i` = beats (−16 a 16, ≠ 0); `f` só se for inteiro | `ROTEIRO_NUDGE` |

Argumentos a mais são ignorados. Endereço desconhecido, índice fora da faixa ou tipo errado viram `{ error }` e nada chega ao visual.

### `/parameter`: 0–1 → faixa do ajuste

O valor 0–1 do fader é escalado para a faixa do slider correspondente e arredondado no passo dele (tabela `OSC_PARAMS` em `src/lib/osc.ts`):

- os 22 ajustes do ponto "Knob" do roteiro (`KNOBS` em `src/lib/roteiro.ts`), por exemplo `size` 10–150, `trail` 0–1, `bgHue` −180–180;
- os demais ajustes de cena, com a faixa dos sliders: `rel` 0,03–0,5 · `wave` 0–1 · `dropFade` 0,25–8 · `bgAngle` 0–360 · `bgBlur` 0–40 · `kaleido` 0–1 · `kaleidoN` 3–12 (inteiro) · `kaleidoSpin` −1–1 · `kaleidoZoom` 0,5–2 · `tunnel` 0–1 · `tunnelSpeed` 0–2 · `tunnelDensity` 0–1 · `mandala` 0–1 · `mandalaPetals` 4–16 (de 2 em 2) · `particles`, `particlesDensity`, `particlesTurb` 0–1 · `particlesDir` 0–360 · `organic` 0–1 · `organicScale` 0,3–3 · `glitch` 0–1.

**Fora de propósito:** `strobeDiv` (só aceita 1, 2 ou 4) e os ajustes de operação (`renderScale`, `psyQuality`, `psyBudgetMs`, `offset`, `white`), que não devem mudar no meio do set por um fader de rede. O `npm run check` falha se um ajuste numérico novo do Visual não estiver nem na tabela nem nesta lista.

## Exemplos de pacote (hex)

Strings OSC terminam em NUL e são completadas com NULs até múltiplo de 4 bytes; números são big-endian.

```text
/doublek/v1/tap  (sem argumentos)
2f 64 6f 75 62 6c 65 6b 2f 76 31 2f 74 61 70 00  2c 00 00 00

/doublek/v1/scene/2  f 4.0  → SCENE_RECALL index 1, fade 4
2f 64 6f 75 62 6c 65 6b 2f 76 31 2f 73 63 65 6e 65 2f 32 00  2c 66 00 00  40 80 00 00

/doublek/v1/blackout  T  → BLACKOUT on
2f 64 6f 75 62 6c 65 6b 2f 76 31 2f 62 6c 61 63 6b 6f 75 74 00 00 00 00  2c 54 00 00

/doublek/v1/parameter/trail  f 0.75  → SET_PARAMETER trail 0.75
2f 64 6f 75 62 6c 65 6b 2f 76 31 2f 70 61 72 61 6d 65 74 65 72 2f 74 72 61 69 6c 00  2c 66 00 00  3f 40 00 00

bundle com o /tap acima (timetag 1 = "agora")
23 62 75 6e 64 6c 65 00  00 00 00 00 00 00 00 01  00 00 00 14  <os 20 bytes do /tap>
```

## Segurança

- **Só esta máquina por padrão** (`127.0.0.1`). Abrir para a rede local (`0.0.0.0` ou o IP da placa) só quando o operador pedir explicitamente.
- **OSC/UDP não autentica nada:** qualquer aparelho na mesma rede que souber a porta pode mandar BLACKOUT, trocar cena ou mexer em ajustes. Use LAN só em rede confiável (roteador próprio do palco, sem Wi-Fi aberto ao público).
- **Limite de taxa:** até 200 mensagens por segundo (janela de 1 s); o excedente é descartado e contado em `dropped`. Um fader de TouchOSC manda ~60/s.
- **Parser estrito:** pacote malformado (cortado, sem padding, tamanho mentiroso, tipo desconhecido, bundle fundo demais) é recusado inteiro e contado em `rejected`, sem pânico; o servidor continua ouvindo.
- O servidor roda numa thread própria e só emite eventos: não toca a thread de áudio e não bloqueia o BLACKOUT.

## Futuro

- Status de volta para o cliente (`/doublek/v1/status`: BPM, cena, banco, blackout) — fora por enquanto (YAGNI).
- Teste com TouchOSC num celular/tablet pela rede local — **NÃO VERIFICADO** (o teste do DK-092 mandou pacotes UDP do próprio PC para o app real).
