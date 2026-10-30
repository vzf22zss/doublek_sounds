# Detecção de kick/BPM — benchmark sintético e latência (DK-008)

> **Tarefas:** DK-008 (benchmark) e DK-009 (correções P1–P4, P7 e resíduo do breakdown) do [roadmap](../DOUBLEK_VISUALS_PLANO_AGENTICO_ROADMAP.md) · **Data:** 2026-10-30 · **Branches:** `feat/dk-008-benchmark`, `feat/dk-009-deteccao`  
> Tudo aqui vem de **faixas sintéticas** (`src-tauri/src/synth.rs`). Nenhum número abaixo foi medido com música real, interface de áudio, projetor ou pessoa: ver a seção 6.  
> DK-008 só mediu. DK-009 corrigiu P1–P4, P7 (grade no contratempo com chimbal) e o resíduo de quedas no breakdown (seção 8, antes/depois). P6 foi medido duas vezes e ficou como proposta (4.6).

## 1. Como regenerar

```powershell
cd src-tauri
cargo run --release --example bench            # ≈ 43 s na máquina de desenvolvimento (i5-11400H), fora a compilação (≈ 36 s são o estresse)
cargo run --release --example bench -- 60      # faixas de 60 s em vez de 30 s
cargo run --release --example bench -- custo   # só o custo do Analyzer::process (µs por hop)
```

A saída é Markdown; cole-a na seção 3 deste arquivo ao regenerar. O bench é determinístico (mesma semente → mesma faixa → mesmos números).

## 2. Método

**Faixa sintética** (`synth::Synth`, mono 48 kHz): kick = varredura de sub 170 → 50 Hz (decai em 200 ms) com "click" de ruído de 4 ms no ataque; baixo rolante opcional = 3 notas de sub em 55 Hz nas semicolcheias seguintes, sem click; ruído branco de fundo; ganho global; breakdown = trecho sem kick nem baixo, só um pad de 880 Hz; jitter uniforme opcional nos kicks (não usado nas tabelas; fica para testes de robustez). É a mesma faixa que os testes `psy_140`…`hitech_200` e `grade_da_faixa_inteira` já usavam, agora num único módulo.

**Cenários** (faixas de 30 s, kicks a partir de 0,05 s):

| Cenário | O que muda |
|---|---|
| limpo | só kick, sem baixo rolante |
| baixo rolante | kick + baixo nas 3 semicolcheias (o caso psy típico) |
| breakdown 10–18 s | baixo rolante; de 10 a 18 s só o pad |
| ruído alto | baixo rolante + ruído branco de amplitude 0,2 (≈ −14 dBFS RMS) |
| volume −20 dB | baixo rolante com ganho 0,1 |
| cold start | baixo rolante, 2 s de silêncio (só ruído de fundo) antes do primeiro kick |

**Faixas de andamento:** as do app (`App.svelte`): Psy 135–150 para 135/140/148, Dark 145–185 para 160/175, Hi-tech 175–220 para 200/220; e Auto 80–220 para todos. Demais `Params` no padrão do app (`sens` 1,4, `gate` 0,003, `needClick` ligado).

**Métricas** (contadas só depois de 3 s, como nos testes, porque o limiar adaptativo ainda está aprendendo antes):

- **Precisão / Recall:** um kick detectado conta como acerto se cai a ±30 ms de um kick real; no breakdown qualquer detecção é falso positivo.
- **Erro BPM:** `Beat::at(30 s)` − BPM real.
- **Trava após:** tempo entre o primeiro kick e `Beat.locked` virar verdadeiro pela primeira vez.
- **Atraso:** mediana de (instante da detecção − instante real do kick). A detecção é marcada no **fim** do hop em que ocorre, então isto já inclui o hop (5,3 ms).
- **½/×2:** estimativa a ±3 % da metade ou do dobro do BPM real ("outra razão" para ⅔, ¾, 4/3, 3/2).
- **Obs.:** "perdeu a trava N×" = `locked` caiu de verdadeiro para falso N vezes; "não travou" = nunca travou; "grade no contratempo" = travou com a âncora a mais de 0,35 beat dos kicks reais.

**Estresse** (desde DK-009, última tabela): os cenários limpo, baixo rolante, breakdown e ruído alto, mais **chimbal no contratempo** (`hats` = 0,15: ruído agudo de 30 ms a meio beat, junto com a 2ª nota do baixo) e chimbal + breakdown, cada um com 10 sementes × 7 BPM na faixa do gênero. Agrega precisão/recall, soma quedas de trava e grades no contratempo, e lista as faixas com problema como BPM/semente (reproduzir com `Synth { bpm, seed, .. }`).

## 3. Resultados (gerado em 2026-10-30, `feat/dk-031-indicadores`)

Depois das tabelas de detecção vêm o **estresse** (10 sementes × 7 BPM por cenário), os **indicadores de energia** (DK-031, seção 9) e o custo do `Analyzer::process`.

<!-- gerado por `cargo run --release --example bench` (src-tauri); faixas de 30 s a 48 kHz, HOP 256, janela ±30 ms, medido após 3 s -->

### Faixa de andamento do gênero

| BPM | Faixa | Cenário | Precisão | Recall | Erro BPM | Trava após | Atraso | ½/×2 | Obs. |
|---:|---|---|---:|---:|---:|---:|---:|:---:|---|
| 135 | Psy 135–150 | limpo | 1.00 | 1.00 | -0.01 | 2.2 s | 3.3 ms | não |  |
| 135 | Psy 135–150 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Psy 135–150 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Psy 135–150 | ruído alto (−14 dBFS) | 1.00 | 0.97 | +0.00 | 2.7 s | 6.9 ms | não |  |
| 135 | Psy 135–150 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Psy 135–150 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.1 s | 7.1 ms | não |  |
| 140 | Psy 135–150 | limpo | 1.00 | 1.00 | +0.00 | 2.1 s | 4.1 ms | não |  |
| 140 | Psy 135–150 | baixo rolante | 1.00 | 1.00 | -0.01 | 2.2 s | 6.8 ms | não |  |
| 140 | Psy 135–150 | breakdown 10–18 s | 1.00 | 1.00 | -0.01 | 2.2 s | 6.4 ms | não |  |
| 140 | Psy 135–150 | ruído alto (−14 dBFS) | 1.00 | 0.97 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Psy 135–150 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Psy 135–150 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.00 | 2.1 s | 6.5 ms | não |  |
| 148 | Psy 135–150 | limpo | 1.00 | 1.00 | +0.03 | 2.0 s | 4.4 ms | não |  |
| 148 | Psy 135–150 | baixo rolante | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Psy 135–150 | breakdown 10–18 s | 1.00 | 1.00 | -0.07 | 2.0 s | 7.8 ms | não |  |
| 148 | Psy 135–150 | ruído alto (−14 dBFS) | 1.00 | 0.98 | -0.05 | 2.0 s | 7.2 ms | não |  |
| 148 | Psy 135–150 | volume −20 dB | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Psy 135–150 | cold start (2 s de silêncio) | 1.00 | 0.98 | +0.03 | 3.3 s | 7.9 ms | não |  |
| 160 | Dark 145–185 | limpo | 1.00 | 1.00 | -0.02 | 1.9 s | 4.0 ms | não |  |
| 160 | Dark 145–185 | baixo rolante | 1.00 | 1.00 | +0.00 | 1.9 s | 7.7 ms | não |  |
| 160 | Dark 145–185 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 1.9 s | 7.7 ms | não |  |
| 160 | Dark 145–185 | ruído alto (−14 dBFS) | 0.99 | 0.99 | -0.08 | 2.3 s | 7.7 ms | não |  |
| 160 | Dark 145–185 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.3 s | 7.7 ms | não |  |
| 160 | Dark 145–185 | cold start (2 s de silêncio) | 1.00 | 0.97 | +0.01 | 3.0 s | 7.3 ms | não |  |
| 175 | Dark 145–185 | limpo | 1.00 | 1.00 | -0.01 | 1.7 s | 4.9 ms | não |  |
| 175 | Dark 145–185 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.8 s | 7.9 ms | não |  |
| 175 | Dark 145–185 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 2.4 s | 7.9 ms | não |  |
| 175 | Dark 145–185 | ruído alto (−14 dBFS) | 1.00 | 0.99 | +0.00 | 1.7 s | 7.9 ms | não |  |
| 175 | Dark 145–185 | volume −20 dB | 1.00 | 0.99 | +0.00 | 3.4 s | 7.9 ms | não |  |
| 175 | Dark 145–185 | cold start (2 s de silêncio) | 1.00 | 0.96 | +0.00 | 3.1 s | 8.4 ms | não |  |
| 200 | Hi-tech 175–220 | limpo | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | baixo rolante | 1.00 | 1.00 | -0.01 | 1.8 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | breakdown 10–18 s | 1.00 | 1.00 | -0.01 | 2.4 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | ruído alto (−14 dBFS) | 1.00 | 0.99 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.0 s | 10.7 ms | não |  |
| 220 | Hi-tech 175–220 | limpo | 1.00 | 1.00 | -0.00 | 3.6 s | 6.2 ms | não |  |
| 220 | Hi-tech 175–220 | baixo rolante | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Hi-tech 175–220 | breakdown 10–18 s | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Hi-tech 175–220 | ruído alto (−14 dBFS) | 1.00 | 0.99 | -0.01 | 1.9 s | 4.1 ms | não |  |
| 220 | Hi-tech 175–220 | volume −20 dB | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Hi-tech 175–220 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.02 | 1.4 s | 4.1 ms | não |  |

### Faixa Auto (80–220)

| BPM | Faixa | Cenário | Precisão | Recall | Erro BPM | Trava após | Atraso | ½/×2 | Obs. |
|---:|---|---|---:|---:|---:|---:|---:|:---:|---|
| 135 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.01 | 2.2 s | 3.3 ms | não |  |
| 135 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.97 | +0.00 | 2.7 s | 6.9 ms | não |  |
| 135 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.1 s | 7.1 ms | não |  |
| 140 | Auto 80–220 | limpo | 1.00 | 1.00 | +0.00 | 2.1 s | 4.1 ms | não |  |
| 140 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.01 | 2.2 s | 6.8 ms | não |  |
| 140 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | -0.01 | 2.2 s | 6.4 ms | não |  |
| 140 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.97 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.00 | 2.1 s | 6.5 ms | não |  |
| 148 | Auto 80–220 | limpo | 1.00 | 1.00 | +0.03 | 2.0 s | 4.4 ms | não |  |
| 148 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | -0.07 | 2.0 s | 7.8 ms | não |  |
| 148 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.98 | -0.05 | 2.0 s | 7.2 ms | não |  |
| 148 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | +0.03 | 3.3 s | 7.9 ms | não |  |
| 160 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.02 | 1.9 s | 4.0 ms | não |  |
| 160 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | +0.00 | 1.9 s | 7.7 ms | não |  |
| 160 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 1.9 s | 7.7 ms | não |  |
| 160 | Auto 80–220 | ruído alto (−14 dBFS) | 0.99 | 0.99 | -0.08 | 2.3 s | 7.7 ms | não |  |
| 160 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.3 s | 7.7 ms | não |  |
| 160 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.97 | +0.01 | 3.0 s | 7.3 ms | não |  |
| 175 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.01 | 1.7 s | 4.9 ms | não |  |
| 175 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.8 s | 7.9 ms | não |  |
| 175 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 2.4 s | 7.9 ms | não |  |
| 175 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.99 | +0.00 | 1.7 s | 7.9 ms | não |  |
| 175 | Auto 80–220 | volume −20 dB | 1.00 | 0.99 | +0.00 | 4.1 s | 7.9 ms | não |  |
| 175 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.96 | +0.00 | 3.1 s | 8.4 ms | não |  |
| 200 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.01 | 1.8 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | -0.01 | 2.4 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.99 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.0 s | 10.7 ms | não |  |
| 220 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.00 | 3.6 s | 6.2 ms | não |  |
| 220 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.99 | -0.01 | 1.9 s | 4.1 ms | não |  |
| 220 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.02 | 1.4 s | 4.1 ms | não |  |

### Casos fora da meta (precisão/recall < 0,95, |erro| > 0,5 BPM, sem trava ou ½/×2)

Nenhum.

### Estresse: 10 sementes × 7 BPM por cenário (faixa do gênero)

| Cenário | Precisão | Recall | Quedas de trava | Grade no contratempo | Pior erro BPM | Faixas com problema (BPM/semente) |
|---|---:|---:|---:|---:|---:|---|
| limpo | 1.000 | 1.000 | 0 | 0 | 0.03 | — |
| baixo rolante | 1.000 | 1.000 | 0 | 0 | 0.08 | — |
| breakdown 10–18 s | 0.998 | 0.997 | 0 | 0 | 0.17 | — |
| ruído alto (−14 dBFS) | 0.999 | 0.982 | 0 | 0 | 0.16 | 160/s7 175/s5 |
| chimbal no contratempo | 1.000 | 1.000 | 0 | 0 | 0.10 | — |
| chimbal + breakdown | 0.998 | 0.996 | 0 | 0 | 0.08 | — |

### Indicadores de energia (DK-031)

| BPM | Faixa | Contraste máx. groove | Contraste máx. no build-up | Kicks/compasso groove | Kicks/compasso breakdown (máx.) | Estabilidade groove (mín. após 8 s) |
|---:|---|---:|---:|---:|---:|---:|
| 135 | Psy | 1.00 | 1.40 | 3.5–4.0 | 0.0 | 0.91 |
| 140 | Psy | 1.00 | 1.40 | 3.5–4.0 | 0.0 | 0.92 |
| 148 | Psy | 1.01 | 1.40 | 3.5–4.0 | 0.0 | 0.92 |
| 160 | Dark | 1.01 | 1.40 | 3.5–4.0 | 0.0 | 0.91 |
| 175 | Dark | 1.00 | 1.38 | 3.5–4.0 | 0.0 | 0.91 |
| 200 | Hi-tech | 1.01 | 1.40 | 3.5–4.0 | 0.0 | 0.83 |
| 220 | Hi-tech | 1.01 | 1.40 | 3.5–4.0 | 0.0 | 0.92 |

Custo do `Analyzer::process`: **3.44 µs por hop** (mínimo de 7 passadas; o hop dura 5333 µs a 48 kHz).

## 4. Leitura dos resultados e casos degradados

Resumo (após P1–P4, P7 e o resíduo do breakdown): na tabela principal, **nenhum caso fora da meta**. Precisão 1,00 em 82 das 84 combinações (0,99 nas outras duas), recall ≥ 0,96 em todas, erro de BPM ≤ 0,08, nenhum ½/×2, nenhuma queda de trava. A trava chega em **1,4–4,1 s** depois do primeiro kick. O atraso algorítmico mediano é **3–11 ms** (seção 5). No **estresse** com 10 sementes: zero quedas de trava e zero grades no contratempo em todos os cenários; o único resíduo é recall 0,94 em 2 faixas com ruído alto (4.8). Cada caso abaixo foi conferido hop a hop com um exemplo descartável que imprimia `flux`, `thr`, bandas e estado da trava.

### 4.1. Ruído alto: recall 0,66–0,87 em todos os BPM (pior em 135–148) — **resolvido em DK-009 (P1)**

Com ruído de −14 dBFS, (a) o piso da banda de sub sobe e a subida logarítmica do kick cai de ≈ 11 para ≈ 4–5; (b) o click do kick se perde no ruído da banda de 2–6 kHz, então `click_ok` falha. Na grade o candidato só passa com `click_ok || strong`, e `strong` exige `ds > 2 × ts` (o limiar **não** abaixado), que o kick ruidoso não atinge. Resultado: um em cada três kicks é descartado mesmo estando exatamente no beat previsto. A precisão continua 1,00 porque as notas do baixo (fora da grade) continuam exigindo `click && strong`.

**Traço (DK-009):** o limiar do click fica no piso (`MIN_RISE` = 0,70) e a subida do click do kick no ruído fica em 0,6–1,0; ex.: 8,624 s, click 0,66 e sub 5,53 no hop seguinte, bem acima do limiar da grade mas abaixo do "forte" (2 × 3,45 = 6,9).

**Correção (P1):** só no beat previsto, vale um "click suave" acima de 0,75 × o limiar do click. Fora da grade e antes de travar nada muda. A opção "forte a 1,5× na grade" foi descartada: ganhava pouco (140 BPM: 0,66 → 0,79) e criava até 5 falsos no breakdown.

### 4.2. "Limpo" (sem baixo rolante): recall 0,84–0,91 em 135–160 BPM — **resolvido em DK-009 (P2)**

Contraintuitivo: sem o baixo, o detector perde mais kicks do que com ele. Mecanismo visto no traço (140 BPM, kick real em 8,193 s): no hop que termina em 8,192 s o `flux` da banda de sub oscila para 2,94, um pouco acima do limiar abaixado da grade (2,56), **sem** click ainda → candidato recusado, mas `sub_over` fica travado em verdadeiro; no hop seguinte (8,197 s) chega o kick de verdade, `flux` 12,08 e click presente, mas `rising` é falso porque `sub_over` já era verdadeiro → kick perdido. Ou seja: o disparo por borda em `sub_over` deixa um pré-candidato fraco "engolir" o kick real. Com o baixo rolante o piso de sub antes do kick é a cauda suave da nota, não ruído, e a oscilação não acontece. Acima de 175 BPM o kick anterior (200 ms de decaimento) ainda ocupa a banda, o piso não é ruído e o recall é 1,00.

**Correção (P2):** um cruzamento recusado só por falta de click fica pendente; se o click chegar enquanto o sub ainda está acima do limiar, vale como borda. A variante "só armar `sub_over` com click ou acima do limiar cheio" foi descartada: criava falsos no breakdown, onde a subida log do sub quase em silêncio oscila (2,92 recusado, 6,21 no hop seguinte passava como "forte" na grade, sem click).

### 4.3. Breakdown: a trava caía 1× ao voltar o drop, em **todas** as 14 combinações — **resolvido em DK-009 (P3)**

`Beat::tick` só solta a trava depois de `HOLD` = 30 s sem kick, então ela sobrevive aos 8 s de breakdown. Mas quando o drop volta, os kicks antigos já saíram da janela de 8 s do ajuste; no 4º kick novo `on_kick` refaz o ajuste com n = 4 e grava `locked = n >= 6 && …` → **falso**. A trava só volta no 6º kick, ≈ 3 beats depois (148 BPM: cai em 19,5 s, volta em 20,7 s). Efeito no show: por ~1,2 s logo no drop, `Frame.locked` é falso → o renderer deixa de prever a fase (`predicting()`) e volta a pulsar pelo kick detectado; e, sem grade, o limiar não abaixa no beat e um kick fraco sob o baixo se perde (`perdidos: 19,91 s` no traço). O BPM e a fase em si não mudam.

**Correção (P3):** se a trava já existe, a janela está limpa (todos os kicks são inliers, desvio < 3,5 %) e o ajuste bate com a grade travada (período ±3 %, fase dentro de `TOL`), a trava fica mesmo com menos de 6 kicks. A exigência de janela limpa é necessária: sem ela, numa troca de música a trava prendia no andamento velho para sempre (4.6).

### 4.4. ½ em Auto: 175 BPM, cold start → 87,5 BPM, recall 0,51 — **resolvido em DK-009 (P4)**

Sequência no traço: 2 s de silêncio deixam o limiar baixo; o 1º kick sobe 12 (enorme, porque o piso era silêncio) e infla a variância do limiar adaptativo (`thr` 2,7 → 3,5); os kicks seguintes, já com o baixo rolante entre eles, sobem só 2,6–3,9 e alguns ficam abaixo → só kicks alternados são detectados → IOI de 2 beats → `median_ioi` aceita 0,686 s (87,5 BPM) porque está dentro de 80–220 → trava em ½ → fora da grade os kicks do meio precisam de `click && strong` e são recusados → o ½ se realimenta e o erro fica **−87,5 BPM** até o fim. Na faixa Dark (145–185) o mesmo intervalo é dobrado por `median_ioi` e trava em 175. Só aconteceu em 175 porque depende de **quais** kicks se perdem no aquecimento; o mesmo mecanismo pode atingir qualquer BPM ≥ 160 em Auto (metade ≥ 80 cai dentro da faixa).

**Traço do ponto de decisão (DK-009):** aos 4,75 s os intervalos em `median_ioi` eram [341, 515, 688, 688] ms; a mediana caiu em 688 ms (2 beats), que em Auto cabe sem dobrar (87,4 BPM), e o ajuste aceitou com 4/5 inliers. Como `on_kick` tenta primeiro o período atual, a partir daí os kicks do contratempo são outliers; depois de travar, são recusados por estarem fora da grade.

**Correção (P4):** quando a metade do período também cabe na faixa, `on_kick` ajusta a grade com p/2 e fica com ela se explicar **mais** kicks. Kick perdido só alonga intervalos, então kick a mais no contratempo é evidência real. Em Psy/Dark/Hi-tech a metade nunca cabe na faixa, então só Auto é afetado. Teste `auto_sem_meio_tempo`: 175 com cold start trava em 175, e 90 e 100 BPM reais em Auto não dobram.

### 4.5. Outras observações

- **Atraso maior em 200 BPM (≈ 11 ms):** o kick anterior ainda está decaindo quando o próximo chega; a subida de sub fica mais lenta e a detecção escorrega 1 hop.
- **Volume −20 dB: sem diferença** — tudo é logarítmico/normalizado; o `gate` (0,003 de pico) ainda está bem abaixo.
- **Cold start nas faixas do gênero:** trava em 1,4–3,7 s após o 1º kick, recall ≥ 0,96; o problema é só na faixa Auto.
- **Drift de relógio:** em 30 s o erro fica ≤ 0,09 BPM; o bench não mede horas de set. Para drift real é preciso música real (seção 6).

### 4.6. Troca de música sem breakdown: re-trava em ~7,3 s (achado em DK-009; P6 medido duas vezes, não entrou)

Teste `troca_de_musica_148_175` (148 → 175 BPM emendados, sem pausa). Com a grade de 148 travada, os kicks de 175 fora dela são recusados mesmo com click (traço: só 1 a cada ~2 s cai na grade velha e é aceito); a janela de 8 s fica só com kicks que concordam com 148 e só esvazia depois de ~7 s. Medido: **7,26 s** em Dark e em Auto (Auto era 8,29 s antes de P4). Nesse intervalo o visual pulsa pela fase prevista de 148 sobre música a 175. É o comportamento do `main`; o teste fixa 9 s como teto.

**P6 medido:** soltar a trava (e esquecer os kicks da janela) quando, nos últimos 2 s, os candidatos **com click** recusados fora da grade forem ≥ 4 e mais que 2× os aceitos. Re-trava em **4,51 s** (Dark e Auto); bench principal e estresse idênticos. **Não entrou**, nem depois de P7:

- Sobre P7, num estresse avulso hostil (10 sementes × 7 BPM): chimbal 0,6 + ruído alto + breakdown → quedas de trava 1 → **22**, falsos 65 → **185**, recall 0,899 → 0,842; chimbal 0,3 + ruído → quedas 0 → 1, falsos 30 → 37. No ruído, chimbal + baixo + clicks do ruído geram muitos recusados com click fora da grade, e a razão engana.
- Refinamento testado: ignorar os recusados no contratempo exato (que P7 já trata). A guarda passa (idêntico a só P7), mas a re-trava piora para **7,94 s** — sem P6 é 7,26 s. Não serve.

Fica como proposta: o sinal precisa distinguir "candidatos com fase deslizando" (troca de música) de "candidatos espalhados por ruído".

### 4.7. Chimbal no contratempo: grade travava meio beat fora — **resolvido em DK-009 (P7)**

Cenário do synth (`hats`: ruído agudo de 30 ms no contratempo, coincidindo com a 2ª nota do baixo rolante). No estresse do DK-008, 175 BPM semente 3: a grade travava no andamento certo (175,00) mas **meio beat fora** — o contratempo virava kick (77 falsos na fase 0,52–0,55) e os kicks reais ficavam fora da grade (traço: kick real em 4,859 s com `grid Some(false)`; contratempo em 4,688 e 5,029 s com `grid Some(true)`, aceitos). Mecanismo: antes de travar basta click para aceitar, e chimbal + nota do baixo têm click **e** subida de sub; se a âncora cai num contratempo, os kicks reais passam a exigir `click && strong` e, pior, caem no **refratário** (0,6 × 60/hi é maior que meio beat em todas as faixas de gênero), então nem chegam a ser candidatos; o contratempo ganha o limiar abaixado da grade — se realimenta.

**O que separa kick de chimbal + baixo** (mediana por candidato rotulado, 175 BPM semente 3 e outros):

| Característica | Kick | Contratempo | Razão |
|---|---:|---:|---:|
| pico do sub em 40 ms | 0,33 | 0,69 | 0,48 (**ao contrário**) |
| energia do sub em 60 ms | 1,04 | 2,44 | 0,43 (**ao contrário**) |
| energia da banda de 160 Hz em 30 ms ("punch") | 1,46 | 0,25 | **5,8** (5–11 por BPM; 2,0 com o kick a meio volume) |
| agudos (banda ≥ 6 kHz / click) | 4,98 | 5,47 | 0,91 |

A ideia inicial ("o kick tem sub mais forte") falha neste synth: a nota do baixo tem o dobro do sub do kick nessa janela. O que separa é o **punch** — a varredura do kick passa por 100–200 Hz nos primeiros 30 ms.

**Correção (P7):** o `Analyzer` mede o punch de todo candidato com click (antes do refratário, porque o do contratempo cai nele) e o `Beat::score` compara as duas fases da grade atual: com ≥ 3 candidatos em cada e o contratempo com punch > 1,5× o da fase, a âncora anda meio beat e a janela do ajuste passa a ser os candidatos da fase nova. Vale também com a grade já travada errada. Testes `contratempo_com_chimbal` (175/s3 e kick a meio volume) e `contratempo_espelho` (chimbal 4× mais alto com kick a meio volume; kick fraco sem chimbal); ambos falham sem a virada (fase 0,48).

**Espelho e limite** (175 BPM, 10 sementes, grade no contratempo ao fim):

| Chimbal | Kick | Sem P7 | Com P7 |
|---:|---:|---:|---:|
| 0,15 | 1 | 1/10 | 0/10 |
| 0,15 | 0,5 | 10/10 | **0/10** |
| 0,6 | 0,5 | 10/10 | **0/10** |
| 0,15 ou 0,6 | 0,3 | 10/10 | 10/10 |
| 0 | 0,3 | não trava | não trava |

Limite: com o kick a ≤ 0,3 do volume (≈ −10 dB do padrão) ele **nem é detectado** sob o baixo (sem chimbal não trava); com chimbal, o único evento com click é o contratempo e a grade vai para ele, com ou sem P7. P7 nunca piorou um caso em relação ao detector anterior. **Risco com música real:** o punch é uma característica do kick sintético (varredura 170 → 50 Hz); baixo de psy com muito médio-grave (FM, serra filtrada) pode ter punch comparável — NÃO VERIFICADO.

### 4.8. Resíduos do estresse com 10 sementes

- **Breakdown — resolvido em DK-009:** 2 quedas de trava (140 BPM, sementes 8 e 10), e 4 em chimbal + breakdown. Traço: na volta do drop os 4 kicks novos são todos inliers (4/4, desvio 3,1 %), mas o período estimado só com eles oscila mais de 3 % do travado (a detecção varia ~1 hop), então o critério de P3 falhava. Correção: com menos de 6 kicks na janela e todos na grade travada, a grade vale como está (período mantido, só a fase se reajusta). Teste `breakdown_nao_solta_a_trava`.
- **Ruído alto — conhecido:** 160/s7 e 175/s5 com recall 0,94 (4 kicks perdidos em ~70, isolados, sem padrão). É o limite do click suave de P1 a 0,75×; 0,6× ganharia um pouco (4.1). Não corrigido.
- **Breakdown com o detector original:** com 10 sementes já havia falsos no breakdown (precisão 0,998); a semente 1 do bench mostrava 0.

### 4.9. Pausa e faixa nova no mesmo andamento: kicks ignorados até 30 s (achado em DK-031, não corrigido)

Medido ao testar o reset dos indicadores: 20 s de groove a 148 BPM, 3 s de silêncio digital (ou só ruído de fundo), outra faixa a 148 BPM com outra fase. A grade velha continua travada (`HOLD` = 30 s, feito para segurar breakdowns) e os kicks novos caem fora dela, onde precisam de `click && strong`: **1 de 49 kicks detectado** em 20 s, BPM e fase presos na faixa velha. **Já existia no detector do DK-008** (mesmo resultado); não é regressão de DK-009/031. No show: troca de faixa com pausa ou corte em que o kick volta defasado. Os indicadores novos denunciam o estado (kicks/compasso ≈ 0 com grave tocando e grade travada). Proposta P8.

## 5. Latência captura → evento (conta analítica)

Não há hardware nesta tarefa. A cadeia e o que se sabe de cada elo:

| Elo | Valor | Origem |
|---|---|---|
| Buffer de entrada do cpal/WASAPI | **NÃO VERIFICADO** (o app usa `default_input_config`, `BufferSize::Default`; em modo compartilhado o Windows costuma entregar períodos de 10 ms) | depende do driver/interface |
| Análise por hop | 256 amostras @ 48 kHz = **5,33 ms** (5,8 ms @ 44,1 kHz) | `analysis::HOP` |
| Atraso algorítmico (ataque → detecção, inclui o hop) | **3–11 ms** mediana, por BPM/cenário (coluna "Atraso") | medido no sintético |
| Emissão do `Frame` a cada 2 hops | 0–5,3 ms a mais, **média 2,7 ms** | `audio::run`, `n % 2 == 0` |
| Serialização + `Channel` do Tauri + WebView2 | **NÃO VERIFICADO** (estimativa < 2 ms; o `Frame` leva 64 bins de espectro) | — |
| Render no próximo `requestAnimationFrame` | 0–16,7 ms a 60 Hz, **média 8,3 ms** | WebView |
| Scanout + projetor/TV | **NÃO VERIFICADO** (projetores comuns: 1–3 quadros) | hardware |
| Interface de áudio USB (ADC + driver) | **NÃO VERIFICADO** | hardware |

Soma do que é conhecido ou estimado por software: **≈ 14–28 ms** entre o kick e o quadro renderizado (atraso algorítmico + emissão + rAF), **sem** contar buffer de captura, IPC e projetor. Com o andamento travado, o renderer pulsa pela **fase prevista** adiantada pelo `offset` do usuário (`predicting()` em `renderer.ts`), então a latência de detecção deixa de importar para o pulso principal: o que resta é a latência de vídeo, calibrada à mão pelo offset. Ela só volta a pesar quando a trava cai (caso 4.3) ou quando `predict` está desligado.

## 6. Limitações deste benchmark

1. **Sintético, não música real.** O kick e o baixo são idealizados (sem compressão, sem reverb, sem hats/lead/vocal, sem masterização). Os números são um teto, não uma medida de show; os itens "detecção com música real", "offset no projetor" e "drift em set longo" seguem **NÃO VERIFICADOS** (BASELINE.md §12).
2. A tabela principal usa uma semente por cenário; desde DK-009 o estresse roda 10 sementes por cenário e mostrou casos que a semente 1 esconde (4.7, 4.8). Ainda são 70 faixas por cenário, não uma distribuição.
3. 30 s por faixa: não cobre drift de relógio, nem breakdown > 30 s (quando `HOLD` solta a trava de propósito).
4. Métrica após 3 s; nada é dito sobre os 3 primeiros segundos além do tempo até travar.
5. O atraso é medido contra o instante em que o kick **começa** na faixa; com música real o "início" do kick é ambíguo em alguns ms.

## 7. Propostas (cada uma precisa rodar este bench antes/depois, incluindo o estresse)

| # | Caso | Proposta | Risco |
|---|---|---|---|
| P1 | 4.1 ruído | **Feito em DK-009** (seção 8): click suave (0,75 × limiar) vale no beat previsto | música real com algo agudo em todo beat (chimbal no tempo) pode virar kick na grade; já travado, só afeta o beat previsto |
| P2 | 4.2 limpo | **Feito em DK-009** (seção 8): cruzamento recusado só por falta de click fica pendente até o click | kick duplo se o click vier depois do refratário (0,6 beat); não visto no estresse |
| P3 | 4.3 breakdown | **Feito em DK-009** (seção 8): mantém a trava com janela limpa e mesma grade | se a música mudar **durante** o breakdown para um andamento a ±3 % do anterior, a grade velha segue até o desvio passar de 3,5 % |
| P4 | 4.4 ½ Auto | **Feito em DK-009** (seção 8): testa p/2 quando cabe na faixa e fica com ela se explicar mais kicks | em Auto, música real a 80–110 BPM com falsos no contratempo poderia dobrar; o teste cobre 90 e 100 BPM limpos |
| P6 | 4.6 troca de música | **Medido duas vezes, não entrou** (4.6): soltar a trava quando, em 2 s, recusados com click ≥ 4 e > 2× aceitos; re-trava 7,26 → 4,51 s, mas com chimbal + ruído + breakdown 22 quedas e 3× os falsos; ignorando o contratempo, não ajuda mais (7,94 s) | precisa de um sinal de "fase deslizando" que o ruído não imite |
| P7 | 4.7 contratempo | **Feito em DK-009** (seção 8): escolhe a fase da grade pelo punch (banda de 160 Hz, 30 ms) dos candidatos com click | baixo real com muito médio-grave pode ter punch de kick; kick ≤ −10 dB não é detectado |
| P8 | 4.9 pausa + faixa defasada | Soltar a trava (ou abaixar a exigência fora da grade) quando há grave tocando (`low`) e candidatos com click consistentes fora da grade por ~2 compassos sem nenhum kick aceito; ou zerar a grade depois de ≥ 1 s de silêncio | o breakdown com pad e sem kick não pode soltar (P3); fill de kick fora da grade |
| P5 | drift/real | Gravar 3–4 trechos reais (line-in e mic) rotulados no Rekordbox e acrescentar ao bench como fixtures opcionais (`examples/analyze` já lê mp3/wav) | tamanho do repo; licença das faixas (DEC-01) |

**Limites de regressão propostos** a partir destes dados (para o CI, quando o bench entrar como teste): tabela principal sem nenhum caso fora da meta (precisão ≥ 0,98, recall ≥ 0,95, erro ≤ 0,2 BPM, nenhum ½/×2, nenhuma queda de trava). Estresse: zero quedas de trava e zero grades no contratempo em todos os cenários; precisão ≥ 0,998; recall ≥ 0,98 por cenário (ruído alto tem 2 faixas a 0,94, conhecidas).

## 8. Antes/depois das correções (DK-009)

Critério: as linhas afetadas melhoram e **todas** as outras ficam iguais (±0,01 em precisão/recall, ±0,1 BPM, ±0,3 s na trava). Comparação linha a linha da saída do bench: DK-008 → P3 → P4.

### P3 — trava ao voltar o drop (`cf86bc3`)

16 de 84 linhas mudam, nenhuma piora; as outras 68 idênticas.

| BPM | Faixa | Cenário | Recall antes → depois | Obs. antes → depois |
|---:|---|---|---|---|
| 135, 140, 160 | gênero e Auto | breakdown | 1,00 → 1,00 | perdeu a trava 1× → — |
| 148 | Psy e Auto | breakdown | 0,98 → **1,00** | perdeu a trava 1× → — |
| 175 | Dark e Auto | breakdown | 0,96 → **1,00** | perdeu a trava 1× → — |
| 200 | Hi-tech e Auto | breakdown | 0,95 → **1,00** | perdeu a trava 1× → — |
| 220 | Hi-tech e Auto | breakdown | 0,99 → 0,99 | perdeu a trava 1× → — |
| 148 | Psy e Auto | ruído alto | 0,69 → 0,69 | perdeu a trava 1× → — |

Teste novo `troca_de_musica_148_175`: re-trava em 7,26 s (Dark) e 8,29 s (Auto), idêntico ao `main`. A 1ª versão de P3, sem exigir janela limpa, **nunca** re-travava nesse teste e foi descartada.

### P4 — ½ em Auto (`b1f942b`)

1 de 84 linhas muda; as outras 83 idênticas (Auto 135 continua em 135: 270 está fora da faixa).

| BPM | Faixa | Cenário | Recall | Erro BPM | Trava após | ½/×2 |
|---:|---|---|---|---|---|---|
| 175 | Auto 80–220 | cold start | 0,51 → **0,96** | −87,49 → **+0,00** | 4,1 → **3,1 s** | ½ → **não** |

De carona: `troca_de_musica_148_175` em Auto passou de 8,29 s para 7,26 s. Teste novo `auto_sem_meio_tempo` (falha sem P4 com 87,51).

### P2 — kick sem baixo perdia a borda (`e3c0028`)

36 de 84 linhas mudam, nenhuma piora (precisão igual em todas).

| BPM | Faixa | Cenário | Recall antes → depois | Trava antes → depois |
|---:|---|---|---|---|
| 135 / 140 / 148 / 160 | gênero e Auto | limpo | 0,85 / 0,84 / 0,91 / 0,89 → **1,00** | igual ou até −0,4 s |
| 175 | Dark | baixo rolante | 0,97 → **1,00** | 3,8 → 2,8 s |
| 175 | Auto | baixo rolante | 0,96 → **1,00** | 5,5 → 2,8 s |
| 220 | Hi-tech e Auto | breakdown | 0,99 → **1,00** | igual |
| 26 outras | — | — | igual | trava chega antes (até −1,4 s): kicks do aquecimento que se perdiam agora entram |

Teste novo `limpo_sem_baixo` (falha sem P2: 160 BPM → 0,87).

### P1 — ruído alto mascarava o click (`e4612f2`)

14 de 84 linhas mudam (todas "ruído alto"), nenhuma piora; as outras 70 idênticas.

| BPM | 135 | 140 | 148 | 160 | 175 | 200 | 220 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Recall antes | 0,73 | 0,66 | 0,69 | 0,87 | 0,78 | 0,83 | 0,77 |
| Recall depois | 0,97 | 0,97 | 0,98 | 0,99 | 0,99 | 0,99 | 0,99 |

Gênero e Auto iguais; 160 BPM: precisão 0,98 → 0,99. Atraso mediano no ruído até +1,3 ms (kick fraco recuperado dispara 1 hop depois). Estresse avulso com 280 faixas (breakdown × ruído baixo/alto × com/sem baixo): falsos 33 → 31, recall 0,903 → 0,983. Teste novo `ruido_alto` (falha sem P1: 140 BPM → 0,82).

### P7 — grade no contratempo (`97ff6ea`)

84 linhas principais idênticas; no estresse só os cenários com chimbal mudam.

| Cenário | Precisão | Recall | Quedas de trava | Grade no contratempo |
|---|---|---|---|---|
| chimbal no contratempo | 0,984 → **1,000** | 0,982 → **1,000** | 0 → 0 | 1 → **0** |
| chimbal + breakdown | 0,962 → **0,998** | 0,957 → **0,996** | 7 → **4** | 2 → **0** |

Troca de música igual (7,26 s); P3 (`drop_breakdown`) verde.

### Resíduo do breakdown (`0e0558c`)

84 linhas principais idênticas; estresse: breakdown quedas 2 → **0**, chimbal + breakdown quedas 4 → **0**; o resto idêntico. Estresse avulso hostil (chimbal 0,3–0,6 × ruído × breakdown): quedas 3/1/1 → 0/0/0, falsos iguais.

### Estresse (10 sementes × 7 BPM), detector do DK-008 → atual

| Cenário | Precisão | Recall | Quedas de trava | Grade no contratempo |
|---|---|---|---|---|
| limpo | 1,000 → 1,000 | 0,942 → **1,000** | 0 → 0 | 0 → 0 |
| baixo rolante | 1,000 → 1,000 | 0,998 → **1,000** | 0 → 0 | 0 → 0 |
| breakdown | 0,998 → 0,998 | 0,977 → **0,997** | 70 → **0** | 0 → 0 |
| ruído alto | 0,999 → 0,999 | 0,764 → **0,982** | 2 → **0** | 0 → 0 |
| chimbal no contratempo | 0,947 → **1,000** | 0,946 → **1,000** | 0 → 0 | 2 → **0** |
| chimbal + breakdown | 0,939 → **0,998** | 0,913 → **0,996** | 66 → **0** | 2 → **0** |

### P6 — medido duas vezes, não entrou

Re-trava na troca 148 → 175: 7,26 → 4,51 s com bench e estresse idênticos, mas reprovado na guarda com chimbal + ruído + breakdown (22 quedas, 3× os falsos); a versão que passa na guarda não ajuda (7,94 s). Detalhes em 4.6.

## 9. Indicadores de energia musical (DK-031)

Campos aditivos no `Frame` (TS: `energy?`, `contrast?`, `stability?`, `kickRate?` em `src/lib/types.ts`), calculados no `Analyzer` a cada hop:

| Campo | Definição |
|---|---|
| `energy` | (rms + banda média + banda ≥ 6 kHz)/3 em nível **absoluto**, suavizado em ~1 compasso. As `bands` do `Frame` são normalizadas pelo pico de 4 s e apagariam um build-up. |
| `contrast` | média dos últimos 4 blocos ÷ 4 anteriores; bloco = compasso da grade travada, 2 s sem trava. Blocos parciais (< 75 %) não entram. Zera (1,0) com 1 s de silêncio ou período travado mudando > 3 %. |
| `stability` | (1 − jitter/20 ms) × rampa de 8 beats desde a trava; 0 sem trava. Jitter = desvio dos kicks em torno da grade no último ajuste (`Beat.jitter`). |
| `kickRate` | kicks aceitos nos últimos 8 beats ÷ 2 (por compasso); sem período ainda, kicks nos últimos 2 s. |

**Resultados** (tabela "Indicadores de energia" na seção 3; build-up = 8 compassos de groove, 16 de breakdown com ruído subindo de 0 a 0,25 nos 8 últimos, 8 de groove):

| Medida | Meta (DK-031) | Medido |
|---|---|---|
| contraste máx. no groove | < 1,1 | **1,00–1,01** (7 BPM) |
| contraste máx. no build-up | > 1,2 | **1,38–1,40**; passa de 1,2 por volta do 5º compasso do riser |
| kicks/compasso no groove | ~4 | 3,5–4,0 |
| kicks/compasso no breakdown | 0 | **0** (a partir de ~8 beats sem kick) |
| estabilidade no groove (mín. após 8 s) | — | 0,91–0,92 (0,83 a 200 BPM) |
| estabilidade na troca 148 → 175 | cai e volta | 1,00 → **0** → 0,92 |
| contraste depois de 1 s de silêncio | zera | 1,0 |

Os blocos parciais importavam: antes de descartá-los, o groove a 135 BPM chegava a contraste 1,10 (na troca de blocos de 2 s para compassos, quando a grade trava, o primeiro compasso começa no meio).

**Custo:** `Trend::step` isolado = **40,8 ns por hop** (1 milhão de chamadas, mínimo de 7), ~1 % dos ~4 µs do `Analyzer::process`. O A/B do `process` inteiro (40 rodadas intercaladas, base × nova) ficou abaixo do ruído desta máquina carregada: mínimo +5,4 %, percentil 10 −1,4 %, mediana −10 %. O hop dura 5 333 µs; o `process` usa < 0,1 % dele.

**Limitações:** energia e contraste foram validados só com o synth (riser de ruído branco); com música real o build-up também sobe em filtro/tom, o que `energy` não mede. O limiar de 20 ms do jitter é escolha, não medida (jitter do synth ≈ 1,5 ms). Testes: `indicadores_build_groove_breakdown` (inclui o contrato JSON em camelCase) e `indicadores_estabilidade_e_reset`.
