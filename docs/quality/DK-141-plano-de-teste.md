# DK-141 — Plano de teste do roteiro com música real

> Para quem vai executar: o mantenedor, no notebook, com som. Tempo estimado: 40 min.  
> Resultado: preencher as tabelas e anexar o JSON do **Diagnóstico** (4 bolinhas no topo) ao fim.  
> Regra do roadmap: o que não for executado fica **NÃO VERIFICADO**, nunca "aprovado".

## Antes de começar

- App instalado na versão da `main` atual (ou `npm run tauri dev`).
- 3 faixas suas, uma por estilo: **psy** (135–150), **dark/forest** (145–185), **hi-tech** (175–220). Anote o BPM de cada uma no Rekordbox.
- Saída de áudio do notebook ligada (caixa ou fone). Telão pode ser o segundo monitor ou a própria tela (**F**).

## T1 — Análise da música (BPM e 1º beat)

Para cada faixa: aba **Roteiro → Nova música**, escolher o arquivo, esperar a forma de onda.

| Faixa | BPM Rekordbox | BPM do app | Diferença | Grade bate no kick? (olhar a timeline: linha no pico) | Tempo da análise |
|---|---|---|---|---|---|
| psy | | | | | |
| dark | | | | | |
| hi-tech | | | | | |

**Aceite:** diferença ≤ 0,1 BPM; linhas da grade nos kicks (se estiverem deslocadas, quantos ms de **−5ms/+5ms** foram precisos).

## T2 — O app toca e os pontos caem no tempo

Na faixa psy: marque 3 pontos (duplo clique na timeline): **Cena** no primeiro drop, **Strobe 4 beats** num build, **Flash** 2 beats antes do drop. **▶ Tocar**.

| Ponto | Caiu no beat? (ouvido) | Adiantado/atrasado (estimativa em ms ou "no tempo") |
|---|---|---|
| Cena no drop | | |
| Strobe | | |
| Flash | | |

Depois: clique no meio da timeline durante a música (seek). O visual assume a cena do trecho? Pausar/retomar funciona? **R** (A/B) troca na hora?

## T3 — Saída de áudio

1. Troque a saída na aba Roteiro para outro dispositivo (ex.: HDMI do monitor) e toque. Funcionou?
2. Troque a saída **com a música tocando**. Apareceu a mensagem "A saída está em … Hz" ou tocou direto?
3. Deixe a música chegar ao fim. O status mostrou "Fim da faixa" e a entrada ao vivo voltou?

## T4 — Modo DJ (GO)

Toque a faixa dark **por outra fonte** (celular na mesa, ou o próprio Rekordbox) entrando no notebook pela interface/microfone. No app: aba Áudio → Ouvir; espere o BPM **travar**. Aba Roteiro → **O DJ (GO)**, GO no compasso 1. Aperte **G** exatamente no 1º beat do compasso 1 da música.

| Item | Resultado |
|---|---|
| Os pontos dispararam no tempo? | |
| Depois de 2 min, continuavam no tempo (derrapou?) | |
| Correção com ‹ › (±1 beat) e « » (±1 compasso) funcionou? | |
| Mexendo o pitch ±4% no deck, o roteiro acompanhou? | |

## T5 — Segurança (DK-006) no telão real

Com o strobe ligado (Efeitos → Strobe 1,0, 1/4): o limite de 3 flashes/s está visivelmente agindo? Desligue o limite (Saída → Segurança visual) por 5 segundos e compare. **B** apaga na hora? **P** zera e para o roteiro?

## T6 — Diagnóstico

Ao fim, clique nas 4 bolinhas: salva `doublek-diagnostico-….json`. Confira `output.p95` (ms) e `output.drops` depois de 1 min de telão aberto. Anexe o arquivo ao relatório.

## Relatório

Copie as tabelas preenchidas numa mensagem para o agente coordenador ou num issue. O que não deu para fazer, marque **NÃO VERIFICADO** e diga por quê.
