# Vídeo de fundo — spike de codecs e provas (DK-061/062)

> **Medido no Edge 156.0.4314.50 headless**, o mesmo Chromium do WebView2 instalado (Runtime 156.0.4314.50).
> No app real (janela do Tauri, GPU e drivers desta máquina): **NÃO VERIFICADO**. Data: 2026-10-30.

## 1. O que este Windows toca

`canPlayType` e `mediaCapabilities.decodingInfo` (1080p, 30 fps, 8 Mb/s):

| Formato | canPlayType | mediaCapabilities 1080p30 |
|---|---|---|
| MP4 H.264 (Baseline e High) | probably | sim · fluido · econômico |
| MP4 HEVC (H.265) | *(vazio)* | não |
| MP4 AV1 | probably | sim · fluido · econômico |
| WebM VP8 | probably | sim · fluido · **não** econômico |
| WebM VP9 | probably | sim · fluido · econômico |
| WebM AV1 | probably | sim · fluido · econômico |
| MOV (QuickTime) | *(vazio)* | não |
| MKV (Matroska) | maybe | não |
| AVI | *(vazio)* | não |

Teste real: clipes de 2 s, 640×360, gerados nesta máquina com `MediaRecorder`, porque não há ffmpeg instalado. Mais o
`teste.webm` da sessão de coordenação.

| Arquivo | Abriu | Tocou 1 s |
|---|---|---|
| WebM VP8 · WebM VP9 · WebM AV1 | sim | sim |
| MP4 H.264 · MP4 AV1 | sim | sim |
| `teste.webm` (2,95 s) | sim | sim |
| MP4 H.264 renomeado para `.mov` (`video/quicktime`) | sim | sim |
| Arquivo corrompido com nome `.mp4` | não (erro em ~0,4 s) | — |

HEVC não foi testado com arquivo real, porque o `MediaRecorder` desta máquina não grava HEVC: **NÃO VERIFICADO**. Pela
tabela, deve ser recusado na importação.

**Recomendação para o DJ:** MP4 H.264 ou WebM VP9. AV1 também toca aqui, mas em PCs mais antigos pode não ter
decodificação por hardware.

## 2. O que a importação faz

A importação abre o arquivo de verdade e espera o 1º quadro, com limite de 8 s, antes de guardar. Se não abrir, recusa
na hora com: *"… não toca neste Windows (formato … sem suporte): converta para MP4 H.264 ou WebM VP9."*

Por que não só o `canPlayType`: ele diz "não" para `.mov` com H.264 dentro, que toca, e "talvez" para MP4 com HEVC,
que não toca. Recusar só pelo `canPlayType` barraria `.mov` que o app aceita hoje. O resultado do `canPlayType` aparece
na mensagem quando vem vazio.

## 3. Comportamento do vídeo no telão (DK-062)

- **Início e fim do loop por vídeo**, na biblioteca (aba Fundo). Fim 0 = até o fim do arquivo. O arquivo inteiro usa o
  loop do próprio `<video>`, sem custo. Com janela, a volta acontece no quadro (`requestVideoFrameCallback`).
- **Fallback:** se o vídeo não abre, dá erro ou fica 2 s sem avançar com a janela visível, o fundo volta sozinho para a
  foto/cor e o diário recebe a mensagem. Só tenta de novo quando escolherem outro vídeo.
- **No máximo 1 tocando + 1 pré-carregado por janela.** O pré-carregado é o próximo vídeo do roteiro a partir da
  posição atual. Os outros são pausados e soltam o arquivo.
- **Reiniciar no compasso**, por vídeo: ao entrar na tela, volta ao início no próximo 1º tempo. Sem BPM travado, volta
  na hora.

## 4. Provas no mock (Edge headless, swiftshader)

| Prova | Resultado |
|---|---|
| Importar arquivo corrompido | recusado em ~0,4 s, com a mensagem acima |
| Importar H.264 como `.mov` | aceito |
| Importar WebM VP9 | aceito |
| Vídeo corrompido já na biblioteca | diário: *"… não abriu: o telão voltou para a foto/cor."*; nenhum `<video>` vivo; fundo de cor |
| Vídeo que não anda (`play()` bloqueado) | diário: *"… travou (2 s sem avançar)…"*; fundo de cor |
| Janela 0,5–1,2 s num clipe de 2 s | `currentTime` entre 0,5 e 1,208 s; 6 voltas em 4 s |
| Só início 1,0 s | entre 1,0 e 1,995 s; 4 voltas em 4 s |
| Pré-carregar v2, depois v3, depois v3 na tela | carregados: `v1` → `v1,v2` → `v1,v3` → `v3` |
| Reiniciar no compasso (148 BPM) | salto ao início 1600 ms depois da troca; o 1º tempo previsto era 1578 ms |
| Sem reiniciar no compasso | nenhum salto até o fim natural do clipe (2017 ms) |
| Sem vídeo (tudo padrão) | imagem idêntica pixel a pixel à referência da DK-021 |

Na janela de controle em 2º plano, o Chromium adia o carregamento de mídia. A prova de importação precisa da janela na
frente, como ela fica quando alguém importa.

## 5. Dívidas

- **Pré-carregamento só para o roteiro:** a próxima cena não é previsível sem o Program/Preview (DK-040).
- **Reiniciar no compasso só na troca de vídeo:** cenas seguidas com o mesmo vídeo não reiniciam.
- **Fallback no preview:** é silencioso; quem avisa é o telão.
- **Medir no app real:** decodificação de 1080p/4K e uso de GPU com vídeo + Psy Engine.
