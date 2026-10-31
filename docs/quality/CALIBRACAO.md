# Calibração com o diário de análise (DK-144)

A detecção de kick, BPM e drop foi afinada com faixas sintéticas (`docs/quality/DETECCAO.md`). Para calibrar com música de verdade sem precisar de faixas licenciadas (D-01), o próprio DJ grava a **análise** de um set: só os números que o DoubleK calcula, **nenhum áudio**.

## Como gravar (5 passos)

1. Abra o DoubleK e comece a ouvir a entrada de áudio, como num show.
2. Na aba **Áudio**, clique em **Gravar análise**. Fica desligado ao abrir o app: precisa ligar a cada set.
3. Toque o set normalmente. A cada **drop** (o grave voltando depois de um breakdown), aperte **M** no momento em que ouvir o drop. Isso grava uma marca "drop aqui" que depois é comparada com o que o app detectou.
4. No fim, clique em **Parar gravação**. O status mostra o caminho do arquivo e quantas linhas foram gravadas.
5. Mande o arquivo `.jsonl` para análise, junto com 1 linha sobre o set: gênero, BPM aproximado, se a entrada era line-in ou microfone, e se teve MIDI Clock.

## O que o arquivo contém

`%APPDATA%\com.doublek.visuals\analysis\AAAA-MM-DDTHH-MM-SSZ.jsonl` (horário UTC no nome). Uma linha JSON por registro, números com no máximo 3 casas:

| Registro | Quando | Campos |
|---|---|---|
| Amostra | a cada 50 ms (20 por segundo) | `t` (s desde que a entrada abriu), `bpm`, `locked`, `holding`, `phase`, `beat`, `kick` (força do maior kick nos 50 ms), `low` (grave tocando), `energy`, `contrast`, `stability`, `kickRate`, `clock` (`audio`/`midi`), `bands` (5 bandas 0..1) |
| Evento | no instante | `{"t":…,"event":"lock"}`, também `unlock`, `jump`, `restart` (correções de fase do P8) e `drop_on`/`drop_off` (grave entrou ou saiu) |
| Marca do operador | tecla M | `{"t":…,"mark":"drop"}` |

**Não há áudio, nome de faixa, nem nada além desses números.** Cerca de 270 KB por minuto (16 MB por hora). O arquivo para sozinho em 200 MB (~12 h) ou se o disco ficar com menos de 1 GiB livre. A gravação nunca atrasa a análise: se o disco travar, linhas são descartadas e contadas no status (`dropped`).

## Como ler

```powershell
cd src-tauri
cargo run --release --example replay -- C:\caminho\do\arquivo.jsonl
```

O resumo traz: duração, % do tempo travado, quedas de trava, saltos e recomeços de fase, % do tempo com contraste > 1,2 (build), kicks por compasso a cada minuto, e as marcas "drop" do operador × `drop_on` detectados a ±4 s (acertos com atraso médio, perdidos e detectados sem marca).

Um `drop_on` sem marca nem sempre é erro: o grave entrando no começo do set ou numa emenda de faixas também conta. Por isso o número precisa ser lido junto com o operador.

O estado que o show-engine teria escolhido não é refeito no replay em Rust: as regras moram em TS (`src/lib/show-engine`) e mudam lá. O replay de estados deve ler este mesmo JSONL do lado TS.

## O que vamos calibrar com isso

| Dívida | Pergunta | O que olhar no diário |
|---|---|---|
| **D-02** (detecção com música real, line-in e microfone) | O BPM trava rápido e fica travado com música real? | % travado, quedas de trava, `stability`, `kickRate` ≈ 4 nos trechos com kick |
| **D-12** (drop/breakdown com música real) | O `drop_on` chega junto com o drop que o DJ ouve? Quantos drops perdidos e quantos falsos? | Marcas × `drop_on`: atraso médio, perdidos e falsos. Ajustar o limiar do grave (`dropThr`) e a histerese. |
| **D-16** (recall 0,89 depois de pausa + faixa defasada) | Em trocas de faixa reais, a re-trava acontece e em quanto tempo? | Eventos `jump`/`restart` e `unlock`/`lock` perto das trocas; `kickRate` antes e depois |

Com 3–4 sets de gêneros diferentes (psy, dark, hi-tech), e pelo menos um com microfone, dá para definir limites de regressão reais no lugar dos sintéticos.
