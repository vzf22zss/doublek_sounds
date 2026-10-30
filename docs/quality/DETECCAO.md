# Detecção de kick/BPM — benchmark sintético e latência (DK-008)

> **Tarefa:** DK-008 do [roadmap](../DOUBLEK_VISUALS_PLANO_AGENTICO_ROADMAP.md) · **Data:** 2026-10-30 · **Branch:** `feat/dk-008-benchmark`  
> Tudo aqui vem de **faixas sintéticas** (`src-tauri/src/synth.rs`). Nenhum número abaixo foi medido com música real, interface de áudio, projetor ou pessoa: ver a seção 6.  
> Parâmetros e algoritmo de detecção **não foram alterados** nesta tarefa. Os achados viram propostas (seção 7).

## 1. Como regenerar

```powershell
cd src-tauri
cargo run --release --example bench            # ≈ 7 s na máquina de desenvolvimento (i5-11400H), fora a compilação
cargo run --release --example bench -- 60      # faixas de 60 s em vez de 30 s
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
- **Obs.:** "perdeu a trava N×" = `locked` caiu de verdadeiro para falso N vezes; "não travou" = nunca travou.

## 3. Resultados (gerado em 2026-10-30, `main` @ `443a8a4` + synth)
<!-- gerado por `cargo run --release --example bench` (src-tauri); faixas de 30 s a 48 kHz, HOP 256, janela ±30 ms, medido após 3 s -->

### Faixa de andamento do gênero

| BPM | Faixa | Cenário | Precisão | Recall | Erro BPM | Trava após | Atraso | ½/×2 | Obs. |
|---:|---|---|---:|---:|---:|---:|---:|:---:|---|
| 135 | Psy 135–150 | limpo | 1.00 | 0.85 | -0.01 | 2.2 s | 3.3 ms | não |  |
| 135 | Psy 135–150 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Psy 135–150 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não | perdeu a trava 1× |
| 135 | Psy 135–150 | ruído alto (−14 dBFS) | 1.00 | 0.73 | +0.00 | 2.7 s | 6.9 ms | não |  |
| 135 | Psy 135–150 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Psy 135–150 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.1 s | 7.1 ms | não |  |
| 140 | Psy 135–150 | limpo | 1.00 | 0.84 | +0.02 | 2.6 s | 4.5 ms | não |  |
| 140 | Psy 135–150 | baixo rolante | 1.00 | 1.00 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Psy 135–150 | breakdown 10–18 s | 1.00 | 1.00 | -0.01 | 2.2 s | 6.8 ms | não | perdeu a trava 1× |
| 140 | Psy 135–150 | ruído alto (−14 dBFS) | 1.00 | 0.66 | -0.02 | 3.0 s | 6.0 ms | não |  |
| 140 | Psy 135–150 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Psy 135–150 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.00 | 2.1 s | 6.5 ms | não |  |
| 148 | Psy 135–150 | limpo | 1.00 | 0.91 | +0.03 | 2.0 s | 4.5 ms | não |  |
| 148 | Psy 135–150 | baixo rolante | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Psy 135–150 | breakdown 10–18 s | 1.00 | 0.98 | -0.07 | 2.4 s | 8.0 ms | não | perdeu a trava 1× |
| 148 | Psy 135–150 | ruído alto (−14 dBFS) | 1.00 | 0.69 | -0.05 | 2.0 s | 7.2 ms | não | perdeu a trava 1× |
| 148 | Psy 135–150 | volume −20 dB | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Psy 135–150 | cold start (2 s de silêncio) | 1.00 | 0.98 | +0.03 | 3.7 s | 7.9 ms | não |  |
| 160 | Dark 145–185 | limpo | 1.00 | 0.89 | -0.02 | 2.3 s | 4.3 ms | não |  |
| 160 | Dark 145–185 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.3 s | 7.7 ms | não |  |
| 160 | Dark 145–185 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 1.9 s | 7.7 ms | não | perdeu a trava 1× |
| 160 | Dark 145–185 | ruído alto (−14 dBFS) | 0.98 | 0.87 | -0.09 | 2.6 s | 8.0 ms | não |  |
| 160 | Dark 145–185 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.3 s | 7.7 ms | não |  |
| 160 | Dark 145–185 | cold start (2 s de silêncio) | 1.00 | 0.97 | +0.01 | 3.0 s | 7.3 ms | não |  |
| 175 | Dark 145–185 | limpo | 1.00 | 1.00 | -0.01 | 2.1 s | 4.9 ms | não |  |
| 175 | Dark 145–185 | baixo rolante | 1.00 | 0.97 | +0.00 | 3.8 s | 7.9 ms | não |  |
| 175 | Dark 145–185 | breakdown 10–18 s | 1.00 | 0.96 | +0.00 | 2.8 s | 7.9 ms | não | perdeu a trava 1× |
| 175 | Dark 145–185 | ruído alto (−14 dBFS) | 1.00 | 0.78 | +0.01 | 3.1 s | 8.7 ms | não |  |
| 175 | Dark 145–185 | volume −20 dB | 1.00 | 0.99 | +0.00 | 3.4 s | 7.9 ms | não |  |
| 175 | Dark 145–185 | cold start (2 s de silêncio) | 1.00 | 0.96 | +0.00 | 3.1 s | 8.4 ms | não |  |
| 200 | Hi-tech 175–220 | limpo | 1.00 | 1.00 | -0.01 | 2.7 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | baixo rolante | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | breakdown 10–18 s | 1.00 | 0.95 | -0.01 | 2.4 s | 11.3 ms | não | perdeu a trava 1× |
| 200 | Hi-tech 175–220 | ruído alto (−14 dBFS) | 1.00 | 0.83 | -0.01 | 2.4 s | 10.0 ms | não |  |
| 200 | Hi-tech 175–220 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Hi-tech 175–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.0 s | 10.7 ms | não |  |
| 220 | Hi-tech 175–220 | limpo | 1.00 | 1.00 | -0.00 | 3.6 s | 6.2 ms | não |  |
| 220 | Hi-tech 175–220 | baixo rolante | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Hi-tech 175–220 | breakdown 10–18 s | 1.00 | 0.99 | -0.02 | 1.4 s | 4.3 ms | não | perdeu a trava 1× |
| 220 | Hi-tech 175–220 | ruído alto (−14 dBFS) | 1.00 | 0.77 | -0.01 | 1.9 s | 4.3 ms | não |  |
| 220 | Hi-tech 175–220 | volume −20 dB | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Hi-tech 175–220 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.02 | 1.4 s | 4.1 ms | não |  |

### Faixa Auto (80–220)

| BPM | Faixa | Cenário | Precisão | Recall | Erro BPM | Trava após | Atraso | ½/×2 | Obs. |
|---:|---|---|---:|---:|---:|---:|---:|:---:|---|
| 135 | Auto 80–220 | limpo | 1.00 | 0.85 | -0.01 | 2.2 s | 3.3 ms | não |  |
| 135 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não | perdeu a trava 1× |
| 135 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.73 | +0.00 | 2.7 s | 6.9 ms | não |  |
| 135 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.2 s | 6.9 ms | não |  |
| 135 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.1 s | 7.1 ms | não |  |
| 140 | Auto 80–220 | limpo | 1.00 | 0.84 | +0.02 | 2.6 s | 4.5 ms | não |  |
| 140 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | -0.01 | 2.2 s | 6.8 ms | não | perdeu a trava 1× |
| 140 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.66 | -0.02 | 3.0 s | 6.0 ms | não |  |
| 140 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.6 s | 6.8 ms | não |  |
| 140 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.00 | 2.1 s | 6.5 ms | não |  |
| 148 | Auto 80–220 | limpo | 1.00 | 0.91 | +0.03 | 2.0 s | 4.5 ms | não |  |
| 148 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Auto 80–220 | breakdown 10–18 s | 1.00 | 0.98 | -0.07 | 2.4 s | 8.0 ms | não | perdeu a trava 1× |
| 148 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.69 | -0.05 | 2.0 s | 7.2 ms | não | perdeu a trava 1× |
| 148 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.05 | 2.0 s | 7.0 ms | não |  |
| 148 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | +0.03 | 3.7 s | 7.9 ms | não |  |
| 160 | Auto 80–220 | limpo | 1.00 | 0.89 | -0.02 | 2.3 s | 4.3 ms | não |  |
| 160 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | +0.00 | 2.3 s | 7.7 ms | não |  |
| 160 | Auto 80–220 | breakdown 10–18 s | 1.00 | 1.00 | +0.00 | 1.9 s | 7.7 ms | não | perdeu a trava 1× |
| 160 | Auto 80–220 | ruído alto (−14 dBFS) | 0.98 | 0.87 | -0.09 | 2.6 s | 8.0 ms | não |  |
| 160 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | +0.00 | 2.3 s | 7.7 ms | não |  |
| 160 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.97 | +0.01 | 3.0 s | 7.3 ms | não |  |
| 175 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.01 | 2.1 s | 4.9 ms | não |  |
| 175 | Auto 80–220 | baixo rolante | 1.00 | 0.96 | +0.00 | 5.5 s | 7.9 ms | não |  |
| 175 | Auto 80–220 | breakdown 10–18 s | 1.00 | 0.96 | +0.00 | 2.8 s | 7.9 ms | não | perdeu a trava 1× |
| 175 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.78 | +0.01 | 3.1 s | 8.7 ms | não |  |
| 175 | Auto 80–220 | volume −20 dB | 1.00 | 0.99 | +0.00 | 4.1 s | 7.9 ms | não |  |
| 175 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.51 | -87.49 | 4.1 s | 8.4 ms | ½ |  |
| 200 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.01 | 2.7 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | breakdown 10–18 s | 1.00 | 0.95 | -0.01 | 2.4 s | 11.3 ms | não | perdeu a trava 1× |
| 200 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.83 | -0.01 | 2.4 s | 10.0 ms | não |  |
| 200 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.01 | 2.1 s | 11.3 ms | não |  |
| 200 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 0.98 | -0.01 | 3.0 s | 10.7 ms | não |  |
| 220 | Auto 80–220 | limpo | 1.00 | 1.00 | -0.00 | 3.6 s | 6.2 ms | não |  |
| 220 | Auto 80–220 | baixo rolante | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Auto 80–220 | breakdown 10–18 s | 1.00 | 0.99 | -0.02 | 1.4 s | 4.3 ms | não | perdeu a trava 1× |
| 220 | Auto 80–220 | ruído alto (−14 dBFS) | 1.00 | 0.77 | -0.01 | 1.9 s | 4.3 ms | não |  |
| 220 | Auto 80–220 | volume −20 dB | 1.00 | 1.00 | -0.02 | 1.4 s | 4.3 ms | não |  |
| 220 | Auto 80–220 | cold start (2 s de silêncio) | 1.00 | 1.00 | +0.02 | 1.4 s | 4.1 ms | não |  |

### Casos fora da meta (precisão/recall < 0,95, |erro| > 0,5 BPM, sem trava ou ½/×2)

- 135 BPM · Psy · limpo: precisão 1.00, recall 0.85, erro -0.01 BPM, ½/×2 não
- 135 BPM · Psy · ruído alto (−14 dBFS): precisão 1.00, recall 0.73, erro +0.00 BPM, ½/×2 não
- 140 BPM · Psy · limpo: precisão 1.00, recall 0.84, erro +0.02 BPM, ½/×2 não
- 140 BPM · Psy · ruído alto (−14 dBFS): precisão 1.00, recall 0.66, erro -0.02 BPM, ½/×2 não
- 148 BPM · Psy · limpo: precisão 1.00, recall 0.91, erro +0.03 BPM, ½/×2 não
- 148 BPM · Psy · ruído alto (−14 dBFS): precisão 1.00, recall 0.69, erro -0.05 BPM, ½/×2 não
- 160 BPM · Dark · limpo: precisão 1.00, recall 0.89, erro -0.02 BPM, ½/×2 não
- 160 BPM · Dark · ruído alto (−14 dBFS): precisão 0.98, recall 0.87, erro -0.09 BPM, ½/×2 não
- 175 BPM · Dark · ruído alto (−14 dBFS): precisão 1.00, recall 0.78, erro +0.01 BPM, ½/×2 não
- 200 BPM · Hi-tech · ruído alto (−14 dBFS): precisão 1.00, recall 0.83, erro -0.01 BPM, ½/×2 não
- 220 BPM · Hi-tech · ruído alto (−14 dBFS): precisão 1.00, recall 0.77, erro -0.01 BPM, ½/×2 não
- 135 BPM · Auto · limpo: precisão 1.00, recall 0.85, erro -0.01 BPM, ½/×2 não
- 135 BPM · Auto · ruído alto (−14 dBFS): precisão 1.00, recall 0.73, erro +0.00 BPM, ½/×2 não
- 140 BPM · Auto · limpo: precisão 1.00, recall 0.84, erro +0.02 BPM, ½/×2 não
- 140 BPM · Auto · ruído alto (−14 dBFS): precisão 1.00, recall 0.66, erro -0.02 BPM, ½/×2 não
- 148 BPM · Auto · limpo: precisão 1.00, recall 0.91, erro +0.03 BPM, ½/×2 não
- 148 BPM · Auto · ruído alto (−14 dBFS): precisão 1.00, recall 0.69, erro -0.05 BPM, ½/×2 não
- 160 BPM · Auto · limpo: precisão 1.00, recall 0.89, erro -0.02 BPM, ½/×2 não
- 160 BPM · Auto · ruído alto (−14 dBFS): precisão 0.98, recall 0.87, erro -0.09 BPM, ½/×2 não
- 175 BPM · Auto · ruído alto (−14 dBFS): precisão 1.00, recall 0.78, erro +0.01 BPM, ½/×2 não
- 175 BPM · Auto · cold start (2 s de silêncio): precisão 1.00, recall 0.51, erro -87.49 BPM, ½/×2 ½
- 200 BPM · Auto · ruído alto (−14 dBFS): precisão 1.00, recall 0.83, erro -0.01 BPM, ½/×2 não
- 220 BPM · Auto · ruído alto (−14 dBFS): precisão 1.00, recall 0.77, erro -0.01 BPM, ½/×2 não

## 4. Leitura dos resultados e casos degradados

Resumo: **precisão é 1,00 em 82 das 84 combinações** (0,98 nas outras duas) — o baixo rolante e o pad do breakdown não geram kicks falsos. O erro de BPM depois de travado fica **abaixo de 0,1 BPM** em todos os casos sem ½/×2. A trava chega em **1,4–3,8 s** depois do primeiro kick (5,5 s num caso Auto). O atraso algorítmico mediano é **3–11 ms** (seção 5). Os problemas estão no **recall** e num **½ em Auto**. Cada caso abaixo foi conferido hop a hop com um exemplo descartável que imprimia `flux`, `thr`, bandas e estado da trava.

### 4.1. Ruído alto: recall 0,66–0,87 em todos os BPM (pior em 135–148)

Com ruído de −14 dBFS, (a) o piso da banda de sub sobe e a subida logarítmica do kick cai de ≈ 11 para ≈ 4–5; (b) o click do kick se perde no ruído da banda de 2–6 kHz, então `click_ok` falha. Na grade o candidato só passa com `click_ok || strong`, e `strong` exige `ds > 2 × ts` (o limiar **não** abaixado), que o kick ruidoso não atinge. Resultado: um em cada três kicks é descartado mesmo estando exatamente no beat previsto. A precisão continua 1,00 porque as notas do baixo (fora da grade) continuam exigindo `click && strong`.

### 4.2. "Limpo" (sem baixo rolante): recall 0,84–0,91 em 135–160 BPM

Contraintuitivo: sem o baixo, o detector perde mais kicks do que com ele. Mecanismo visto no traço (140 BPM, kick real em 8,193 s): no hop que termina em 8,192 s o `flux` da banda de sub oscila para 2,94, um pouco acima do limiar abaixado da grade (2,56), **sem** click ainda → candidato recusado, mas `sub_over` fica travado em verdadeiro; no hop seguinte (8,197 s) chega o kick de verdade, `flux` 12,08 e click presente, mas `rising` é falso porque `sub_over` já era verdadeiro → kick perdido. Ou seja: o disparo por borda em `sub_over` deixa um pré-candidato fraco "engolir" o kick real. Com o baixo rolante o piso de sub antes do kick é a cauda suave da nota, não ruído, e a oscilação não acontece. Acima de 175 BPM o kick anterior (200 ms de decaimento) ainda ocupa a banda, o piso não é ruído e o recall é 1,00.

### 4.3. Breakdown: a trava cai 1× ao voltar o drop, em **todas** as 14 combinações

`Beat::tick` só solta a trava depois de `HOLD` = 30 s sem kick, então ela sobrevive aos 8 s de breakdown. Mas quando o drop volta, os kicks antigos já saíram da janela de 8 s do ajuste; no 4º kick novo `on_kick` refaz o ajuste com n = 4 e grava `locked = n >= 6 && …` → **falso**. A trava só volta no 6º kick, ≈ 3 beats depois (148 BPM: cai em 19,5 s, volta em 20,7 s). Efeito no show: por ~1,2 s logo no drop, `Frame.locked` é falso → o renderer deixa de prever a fase (`predicting()`) e volta a pulsar pelo kick detectado; e, sem grade, o limiar não abaixa no beat e um kick fraco sob o baixo se perde (`perdidos: 19,91 s` no traço). O BPM e a fase em si não mudam.

### 4.4. ½ em Auto: 175 BPM, cold start → 87,5 BPM, recall 0,51

Sequência no traço: 2 s de silêncio deixam o limiar baixo; o 1º kick sobe 12 (enorme, porque o piso era silêncio) e infla a variância do limiar adaptativo (`thr` 2,7 → 3,5); os kicks seguintes, já com o baixo rolante entre eles, sobem só 2,6–3,9 e alguns ficam abaixo → só kicks alternados são detectados → IOI de 2 beats → `median_ioi` aceita 0,686 s (87,5 BPM) porque está dentro de 80–220 → trava em ½ → fora da grade os kicks do meio precisam de `click && strong` e são recusados → o ½ se realimenta e o erro fica **−87,5 BPM** até o fim. Na faixa Dark (145–185) o mesmo intervalo é dobrado por `median_ioi` e trava em 175. Só aconteceu em 175 porque depende de **quais** kicks se perdem no aquecimento; o mesmo mecanismo pode atingir qualquer BPM ≥ 160 em Auto (metade ≥ 80 cai dentro da faixa).

### 4.5. Outras observações

- **Atraso maior em 200 BPM (≈ 11 ms):** o kick anterior ainda está decaindo quando o próximo chega; a subida de sub fica mais lenta e a detecção escorrega 1 hop.
- **Volume −20 dB: sem diferença** — tudo é logarítmico/normalizado; o `gate` (0,003 de pico) ainda está bem abaixo.
- **Cold start nas faixas do gênero:** trava em 1,4–3,7 s após o 1º kick, recall ≥ 0,96; o problema é só na faixa Auto.
- **Drift de relógio:** em 30 s o erro fica ≤ 0,09 BPM; o bench não mede horas de set. Para drift real é preciso música real (seção 6).

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
2. Uma única semente por cenário; "limpo" e "ruído" mostram sensibilidade a ruído, então rodar com outras sementes mudaria os decimais (não as conclusões — os mecanismos estão nos traços).
3. 30 s por faixa: não cobre drift de relógio, nem breakdown > 30 s (quando `HOLD` solta a trava de propósito).
4. Métrica após 3 s; nada é dito sobre os 3 primeiros segundos além do tempo até travar.
5. O atraso é medido contra o instante em que o kick **começa** na faixa; com música real o "início" do kick é ambíguo em alguns ms.

## 7. Propostas (não implementadas; cada uma precisa rodar este bench antes/depois)

| # | Caso | Proposta | Risco |
|---|---|---|---|
| P1 | 4.1 ruído | Na grade, aceitar candidato sem click se `ds` passar o limiar abaixado com folga (por exemplo `ds > 1,3 × thr`), em vez de `strong` usar o limiar cheio | mais falsos se o baixo rolante cair na grade; o cenário "baixo rolante" é a guarda |
| P2 | 4.2 limpo | Não travar `sub_over` quando o candidato é **recusado**, ou manter o candidato pendente por 2 hops esperando o click (janela de click simétrica, ±17 ms, em vez de "click antes") | kick duplo se o click vier 2 hops depois; o refratário de 0,6 beat já cobre |
| P3 | 4.3 breakdown | Em `Beat::on_kick`, não rebaixar `locked` enquanto o período novo for compatível com o anterior (≤ 3 %) e a trava ainda estiver dentro de `HOLD`; exigir n ≥ 6 só para **mudar** de andamento | manter trava num andamento errado por mais 2 beats se a música mudou no breakdown (raro; `median_ioi` corrige) |
| P4 | 4.4 ½ Auto | Em `on_kick`, quando p e p/2 couberem na faixa, testar o ajuste com p/2 e preferi-lo se tiver ≥ 60 % de inliers; e/ou limitar a subida que alimenta a variância do `Onset` (clip em ~6) para o 1º kick não inflar o limiar | psy sempre tem kick em todo beat, então preferir o mais rápido é seguro no gênero; em Auto com outros estilos pode errar ×2 |
| P5 | drift/real | Gravar 3–4 trechos reais (line-in e mic) rotulados no Rekordbox e acrescentar ao bench como fixtures opcionais (`examples/analyze` já lê mp3/wav) | tamanho do repo; licença das faixas (DEC-01) |

**Limites de regressão propostos** a partir destes dados (para o CI, quando o bench entrar como teste): precisão ≥ 0,98 em tudo; recall ≥ 0,95 em "baixo rolante", "breakdown", "−20 dB" e "cold start" nas faixas do gênero; erro de BPM ≤ 0,2; zero ½/×2 nas faixas do gênero. "Limpo" e "ruído" ficam como **conhecidos** até P1/P2.
