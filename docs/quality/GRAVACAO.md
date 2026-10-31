# Gravação da saída visual (DK-071 spike + DK-072)

**Data:** 2026-10-30 · **Máquina:** Windows 11, Intel UHD Graphics + NVIDIA RTX 3050 Laptop · **WebView2 Runtime 156.0.4314.50** (o Edge instalado é a mesma versão: o spike rodou no Edge headless com GPU, sem SwiftShader, como substituto fiel do motor do WebView2).

## 1. Spike (DK-071): o que este Chromium grava

`MediaRecorder.isTypeSupported`:

| Tipo | Suporte |
|---|---|
| `video/webm;codecs=vp9` | sim |
| `video/webm;codecs=vp8` | sim |
| `video/webm;codecs=av01` | sim |
| `video/webm;codecs=h264` | sim |
| `video/mp4;codecs=avc1.42E01E` / `avc1.640028` | sim |
| `video/mp4`, `video/x-matroska;codecs=avc1` | sim |

`VideoEncoder.isConfigSupported` (1920×1080, 60 fps, 8 Mbps):

| Codec | Hardware | Software |
|---|---|---|
| H.264 (avc1.640028) | **sim** | sim |
| VP9 | não | sim |
| VP8 | não | sim |
| AV1 | não | sim |

Gravação real de 2 s de um canvas WebGL 1920×1080 (`canvas.captureStream` + MediaRecorder, 8 Mbps): VP9, VP8 e MP4/H.264 geraram arquivo que o `<video>` carrega a 1920×1080.

**Achado que muda a implementação — MP4 sem keyframe periódico não sai em pedaços.** Com `start(1000)` (um pedaço por segundo), 5 s de gravação:

| Configuração | Pedaços que chegaram (tempo: tamanho) |
|---|---|
| MP4, padrão | 4265 ms: 0 KB · **5030 ms: 118 KB** (tudo no fim) |
| MP4, `videoKeyFrameIntervalDuration: 1000` | 2115 ms: 134 KB · 3117: 68 · 4165: 101 · 5024: 73 |
| WebM VP9, padrão | 2749 ms: 70 KB · 3791: 14 · 4813: 45 · 5004: 5 |
| WebM VP9, keyframe 1 s | 2334 ms: 94 KB · 3339: 36 · 4380: 46 · 5030: 38 |

O MP4 do Chromium é fragmentado por keyframe: sem pedir keyframe a cada 1 s, um show inteiro ficaria na memória até o fim. Por isso a gravação sempre pede `videoKeyFrameIntervalDuration: 1000` (custa um pouco de compressão; ganha pedaços de 1 s e arquivo navegável). Se um WebView ignorar a opção e o MP4 não entregar nada em 3,5 s, a gravação para com aviso e as próximas usam WebM.

## 2. Proposta para a DEC-04 (codec/container padrão)

**MP4 / H.264** via `MediaRecorder`, keyframe a cada 1 s: codificador de **hardware** neste WebView2 (menos custo no telão do que VP9 por software) e toca em qualquer player comum do Windows e em redes sociais. Nível do H.264 escolhido pelo FPS (4.0 = até 1080p30; 4.2 para 60). **Alternativa automática:** WebM VP9 → VP8 → WebM genérico, se o MP4 não existir ou não fragmentar. Sem áudio (DK-070: áudio é etapa posterior e opt-in). WebCodecs fica para uma exportação offline futura (controle fino de keyframe/bitrate), não para o ao vivo.

## 3. Como funciona (DK-072)

- **Quem grava é o telão** (`src/output/record.ts`): `canvas.captureStream(fps)` do canvas real (o que o público vê, inclusive o BLACKOUT, que também zera o canvas no shader) + MediaRecorder. Comandado pela janela de controle por evento (`rec-start` / `rec-stop`); responde `rec-started`, `rec-progress`, `rec-done`, `rec-error`.
- **Pedaços de 1 s vão direto para o disco** pelo comando Rust `rec_chunk` (corpo binário + cabeçalho `x-id`), numa fila que preserva a ordem. O Rust (`src-tauri/src/rec.rs`) só acrescenta ao arquivo `app_data/recordings/<AAAAMMDD>T<HHMMSS>.<mp4|webm>`; nada junta o vídeo inteiro na memória. Nome validado pelo `track::check_id` (só letras, números e um ponto) e criado com `create_new` (nunca por cima de outro).
- **Limites:** para sozinha a **4 GiB** ou quando sobrar **menos de 1 GiB** livre no disco (`GetDiskFreeSpaceExW` por FFI, consultado a cada pedaço). O pedaço que estouraria não é escrito; o arquivo fecha inteiro, mais curto, e a mensagem diz o motivo. Começar com menos de 1 GiB livre é recusado.
- **Falhas:** erro ao gravar no disco ou no codificador → `rec_abort` apaga o parcial e a linha de status avisa "A gravação parou: … O telão segue normal". Nada disso passa pelo laço de desenho. Telão fechado no meio: o telão fecha o arquivo ao sair (`pagehide`) e o controle percebe pelo vigia (5 s sem pedaço). Uma gravação esquecida aberta é fechada inteira pelo próximo `rec_start`.
- **Aviso de desempenho:** se o p95 do quadro do telão passar de 1,3× o valor de antes de gravar (depois de 3 s), uma vez: "A gravação está pesando no telão (p95 X → Y ms): baixe para 30 fps ou qualidade Leve".
- **UI:** aba **Saída** → seção **Gravação**: qualidade (Leve 4 / Média 8 / Alta 16 Mbps), FPS 30/60, Gravar/Parar, indicador `● REC mm:ss · MB` (só a bolinha pisca), "Abrir pasta das gravações" (comando `rec_open_dir`: Explorer só nessa pasta). Bolinha vermelha discreta no **rodapé** enquanto grava (o header de 1280 px não mudou).

## 4. Testes

| Camada | O que cobre | Resultado |
|---|---|---|
| Rust `rec::tests` (6) | pedaços em ordem e fechamento; abortar apaga; limite de 4 GiB e de disco param sem escrever e mantêm o arquivo; nomes inválidos e id errado recusados; nunca por cima de arquivo existente; gravação esquecida fechada pelo próximo início; `free_bytes` lê o disco | 6/6 · `cargo test` total 37/37 |
| TS `recorder.check.ts` | escolha do codec por FPS e fallback (inclusive "MP4 não fragmenta"); nome aceito pelo Rust; máquina de estados (começar, pedaços, parar duas vezes, último pedaço durante a finalização, parada automática, erro, eventos fora de hora); aviso de desempenho (3 s, +30%, uma vez, sem telemetria não compara) | ok |
| Mock headless (Edge com GPU; telão em janela própria; `rec_*` simulados guardando os pedaços) | 5 s gravando: 4 pedaços, 1,1 MB, começa com `ftyp`, `<video>` carrega (5,8 s); indicador `REC 00:05 · 0.9 MB`; bolinha no rodapé; ordem start → chunk×N → stop; falha no 3º pedaço → abort, telão segue e grava de novo; limite → "parou sozinha"; telão fechado → vigia; página cabe em 1280 | 16/16 |

## 5. Não verificado

- **App real (exe):** não rodado — disco com 3,7 GB livres, e o build release precisa de mais do que isso com folga. Comandos Rust compilam e passam nos testes; o caminho de eventos e o `invoke` binário são os mesmos do Show Pack/put_track.
- **Custo no telão em hardware de show** (p95 com e sem gravação, 1080p60 Alta): o aviso automático existe, a medida real não (DEC-02).
- Abrir o MP4 gravado em player externo (Filmes e TV/VLC): o arquivo do mock começa com `ftyp` e o Chromium toca; player externo não testado.
- DK-073 (vertical 9:16) fora desta entrega.
