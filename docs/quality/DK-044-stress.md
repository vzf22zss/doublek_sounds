# DK-044 — Stress de comandos (gate do M3)

**Data:** 2026-10-30 · **Branch medida:** `integ/onda-4` + `feat/dk-044-stress` (merge temporário só para medir, apagado depois) · **Ambiente:** mock do Tauri em Edge headless, GL por software (SwiftShader), sem GPU, sem áudio real.

**Resultado:** todas as asserções passaram. 0 erros de página, nenhum comando preso, histórico no teto, alvos GL constantes, p95 do telão estável (−1 % do 1º para o 5º minuto), heap sem crescimento monotônico, strobe ≤ 3 flashes/s com o limite ligado. Nenhum bug de dispatcher, preview, bancos ou roteiro-fx apareceu no stress. Os dois bugs da DK-044 foram achados no levantamento de teclas (seção 4).

## 1. Configuração

| Item | Valor |
|---|---|
| Duração | 300 s de relógio real (no modo "auto" do mock o relógio virtual acompanha o real) |
| Janelas | controle 1280×800 (aba) + telão 640×360 em **janela própria** (`window.open` popup), as duas renderizando ao mesmo tempo |
| Flags do Edge | `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows` |
| Áudio | sintético do mock a 148 BPM travado; `__breakdown` alterna grave/sem grave a cada 20 s nas duas janelas |
| Estado inicial | 3 bancos × 5 cenas; um roteiro de 6 blocos (cena, efeito de 4 beats, rampa de rastro; metade das cenas com `bank: 1`) escolhido na aba Roteiro |
| Comandos | 20 sorteios/s (recuperando pelo relógio quando o timer atrasa), pelo `dispatch` do App via gancho de desenvolvimento, fontes `ui`/`midi`/`keyboard`/`automation` |
| Mistura | pad (SCENE_RECALL com fade 0/1/2), SCENE_PREVIEW, SCENE_TAKE, PREVIEW_CLEAR, PREVIEW_MODE, BANK_STEP, BANK_SET, MACRO (BUILD_UP/DROP/CHAOS), FX_BURST (MIDI, strobe/flash), **fader MIDI** (11 SET_PARAMETER seguidos de rastro/glow/aberração/anéis/zoom), VIDEO_SET, ROTEIRO_GO/STOP/NUDGE, AUTOMATION_MODE (alterna), BLACKOUT, TAP; 1 % PÂNICO, 2 % RESET |
| Coleta por minuto | mediana do p95/p99/fps da telemetria do telão (evento `telemetry`), heap JS **depois de GC forçado** (CDP `HeapProfiler.collectGarbage` + `Performance.getMetrics`) nas duas janelas, `targetsMade()` de `src/render/gl/texture.ts` (importado na página: mesmo módulo do app no Vite), tamanho máximo do histórico, `idle()` do dispatcher amostrado 1×/s fora de qualquer comando, erros (`pageerror` + `console.error`) |
| Strobe | `uniform1f('uStrobe')` interceptado no telão; flash = subida acima de 0,05; maior número de flashes em qualquer janela de 1 s |

Taxa real alcançada: **9428 comandos em 300 s (≈ 31/s contando cada passo do fader)**.

## 2. Métricas por minuto

| Minuto | p95 telão (ms) | fps | quedas | heap controle (KB) | heap telão (KB) | alvos GL | comandos (acum.) | recusados (acum.) | fila ocupada | histórico máx. |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 366,0 | 4 | 260 | 8635 | 8131 | 3 | 2004 | 216 | 0 | 50 |
| 2 | 371,9 | 4 | 243 | 9020 | 8770 | 3 | 3888 | 409 | 0 | 50 |
| 3 | 369,2 | 4 | 253 | 8675 | 8394 | 3 | 5689 | 615 | 0 | 50 |
| 4 | 369,8 | 5 | 263 | 9603 | 9268 | 3 | 7537 | 842 | 0 | 50 |
| 5 | 361,9 | 4 | 252 | 9025 | 8858 | 3 | 9428 | 1025 | 0 | 50 |

| Asserção | Limite | Medido | Resultado |
|---|---|---|---|
| Erros de página / `console.error` | 0 | 0 | ok |
| Histórico do dispatcher | ≤ 50 | 50 (teto) | ok |
| Comando preso (`idle()` falso fora de um comando) | 0 | 0 de 300 amostras | ok |
| Alvos GL depois do 1º minuto | constantes | 3 → 3 | ok |
| p95 do telão, 5º ÷ 1º minuto | ≤ 1,20 | 0,99 | ok |
| Heap sem crescimento monotônico | não monotônico | controle 8635 → 9020 → 8675 → 9603 → 9025; telão 8131 → 8770 → 8394 → 9268 → 8858 | ok |

**Leitura honesta dos números:** fps 4 e p95 ~365 ms são do GL por software com as duas janelas renderizando no mesmo processo de teste, não do app. O stress mede **tendência** (se algo cresce ou vaza com o tempo), não desempenho absoluto; desempenho real fica para DK-008/DEC-02 em hardware.

### Recusas (todas esperadas)

| Motivo | Vezes |
|---|---|
| override manual: automação pausada | 736 |
| SCENE_TAKE: nada em preview | 189 |
| automação com o roteiro tocando (VIDEO_SET 25, SCENE_RECALL 22, SCENE_TAKE 22, BANK_SET 17, BANK_STEP 16) | 102 |

Nenhuma recusa por validação: o gerador só manda comandos válidos, e as regras de prioridade fizeram o que deviam (DJ > roteiro > automação).

## 3. Strobe e o limite de 3 flashes/s

Telão sozinho, relógio virtual em passos de 4 ms (um quadro a cada passo, para não perder flash curto), strobe 1, 10 s por configuração, 148 BPM.

| Limite de flashes | Subdivisão | Flashes em 10 s | Máx. em 1 s | Intensidade máx. |
|---|---|---|---|---|
| ligado | 1/1 | 25 | **3** | 0,7 |
| ligado | 1/2 | 25 | **3** | 0,7 |
| ligado | 1/4 | 24 | **3** | 0,7 |
| desligado (controle) | 1/4 | 99 | 10 | 1,0 |

A rodada com o limite desligado é o controle: mostra que a medição enxerga mais de 3 Hz quando eles existem. Durante o stress (amostragem no ritmo do render, que subestima flashes curtos) o máximo observado foi 2/s.

Observação: `output-log` só registra avisos e erros do telão; não há linha de strobe ali. Por isso a medida é feita no uniform `uStrobe`, que é o valor final já com o limite aplicado em `src/render/music.ts`.

## 4. Bugs achados (DK-044)

Corrigidos na branch `feat/dk-044-stress` (commit `e828671`), no levantamento de teclas e MIDI, antes do stress:

1. **Ctrl/Cmd + tecla disparava comando de show:** Ctrl+B = BLACKOUT, Ctrl+R = A/B do roteiro, Ctrl+F = abrir/fechar telão; com as teclas novas, Ctrl+C dispararia o Caos. Agora Ctrl/Cmd ficam para o sistema.
2. **Tecla segurada repetia o comando:** D segurado = vários drops seguidos. Agora só as setas de fase repetem.

Achados do próprio stress (do ambiente de teste, não do app):

- Aba em segundo plano no Edge headless não recebe quadros: na 1ª rodada o telão não renderizou (sem telemetria, sem strobe). Corrigido no script abrindo o telão em janela própria, como no app.
- Timers da aba em segundo plano eram freados (≈ 10 comandos/s em vez de 20): corrigido com as flags da tabela 1 e recuperação pelo relógio.

## 5. Mapeamento conferido (tecla e id MIDI)

| Comando | Tecla | MIDI learn |
|---|---|---|
| Pads (chamar) | 1–8 | `c:0`–`c:7` |
| Preparar no preview | Shift+1–8 | `c:<i>` com o modo preview ligado |
| TAKE / limpar preview | T / Shift+T | `a:take` / `a:previewClear` |
| Modo preview | **V** (novo) | `a:previewMode` |
| Banco anterior/seguinte | [ / ] | `a:bank-` / `a:bank+` |
| Ir ao banco N | **Alt+1–4** (novo) | **`a:bank:1`–`a:bank:4`** (novo; clicar em "Banco N/M" com o banco N aberto) |
| Macros Build-up/Drop/Caos/Reset | **U / D / C / X** (novo) | `a:macro:BUILD_UP` … `a:macro:RESET` |
| Modo de automação (alterna) | **A** (novo) | **`a:autoMode`** (novo; clicar no chip de estado) |
| Roteiro GO / parar | G / Shift+G | `a:go` / `a:stop` |
| Roteiro ±1 beat / ±1 compasso | , . / ; ' | `a:beat-` `a:beat+` / `a:bar-` `a:bar+` |
| Roteiro A/B | R | `a:ab` |
| TAP, ½, ×2, fase | Espaço, —, —, ← → | `a:tap`, `a:half`, `a:double`, `a:nudge-`/`a:nudge+` |
| BLACKOUT / Só logo / PÂNICO | B / L / P | `a:blackout` / `a:logoOnly` / `a:panic` |

`commands.check.ts` tem um teste de cobertura que falha se um comando ao vivo ficar sem tecla ou sem id MIDI.

## 6. Como repetir

O script (`stress.mjs`, Node + puppeteer-core) ficou fora do repositório, na pasta temporária da sessão, porque a tarefa só autorizava este documento; ele usa o `inject.js` do mock e o gancho de desenvolvimento `window.__dispatch`/`__commands` (existe só no `vite` de desenvolvimento, 0 ocorrências no build). Passos: `npx vite --port 4183`, depois `node stress.mjs 300` (ou `node stress.mjs 70 semB` para uma rodada curta sem a parte do strobe). Se o mantenedor quiser o script versionado, o lugar natural é `scripts/stress/` — pedir.
