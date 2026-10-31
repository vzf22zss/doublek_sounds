# Spike DK-101: saída Spout a partir do telão WebGL2/WebView2

> **Data:** 2026-10-30 · **Spike:** `spike/dk-101-spout` (descartável; as POCs e `spout-readpixels.html` ficaram lá) · **Implementação:** `feat/dk-102-spout` (seção 5) · **Máquina:** i5-11400H, RTX 3050 Laptop + Intel UHD, Windows 11 26200.
> Os números são desta máquina. Nenhum receptor Spout real foi usado: a compatibilidade com Resolume e SpoutReceiver está **NÃO VERIFICADA**.

## 1. Licenças (para DEC-05; a licença do próprio DoubleK segue pendente, D-01)

| Item | Licença | App fechado pode distribuir? |
|---|---|---|
| Spout2 SDK ([leadedge/Spout2](https://github.com/leadedge/Spout2/blob/master/LICENSE)) | BSD 2-Clause, © Lynn Jarvis | Sim. Em binário, reproduzir o aviso de copyright e o disclaimer na documentação ou nos "créditos". |
| `spout-rs` 0.2.0 ([docs.rs](https://docs.rs/crate/spout-rs/latest)) | BSD 2-Clause; a opção `vendored` compila o Spout2 junto (sem `Spout.dll` para distribuir) | Sim, mesmo aviso. Exige compilador C++ (MSVC) no build e no CI. A API publicada é orientada a OpenGL. |
| Protocolo Spout implementado em Rust (a POC deste spike) | Só o crate `windows` (MIT/Apache, já vem pelo Tauri) | Sim. Recomendo manter o aviso BSD do Spout por cortesia: o layout foi lido do código dele. |
| NDI SDK ([licenciamento](https://docs.ndi.video/docs/sdk/licensing), [distribuição](https://docs.ndi.video/docs/sdk/software-distribution)) | Proprietária, gratuita | Sim, com condições: link para ndi.video perto de onde o NDI aparece, no site e na documentação; atribuição "NDI® is a registered trademark of Vizrt NDI AB"; DLLs na pasta do app (ou link para o runtime). O Advanced SDK exige vendor ID. |

## 2. Caminhos técnicos e medidas

| Caminho | Medido (1080p) | Veredito |
|---|---|---|
| **(a) `readPixels` → Rust → textura DX11 compartilhada** | `readPixels` síncrono no Edge/WebView2: **7,3–7,6 ms** (mediana), 10–12 ms (p95) na RTX 3050; **13,9 ms** / 18,1 ms na Intel UHD. A versão assíncrona com PBO ficou pior (13,5 e 18,4 ms). Cópia de 8,3 MB em JS: 3,6–4,7 ms. No Rust, memcpy 1,9 ms + `UpdateSubresource` até a GPU ficar pronta 2,3 ms (p95 6,1). O IPC de 8,3 MB por quadro (≈ 500 MB/s a 60 fps) **não foi medido**. | **Não fecha 60 fps**: só o `readPixels` come metade (dGPU) ou quase todo (iGPU) o orçamento de 16,7 ms, na thread do render. Serve como plano B a 30 fps ou 720p. |
| **(b) sem cópia, direto da textura do WebView2** | — | **Não existe.** O WebView2 compõe por DirectComposition em outro processo e não expõe a textura renderizada. A API experimental de textura (`ICoreWebView2ExperimentalTexture`) vai do host para a página, não o contrário. |
| **(b′) Windows Graphics Capture da janela do telão → cópia GPU→GPU para a textura do Spout** | POC `wgc_poc` (capturando o monitor 1920×1080): cópia GPU→GPU **0,27–0,30 ms** (mediana), p95 5,5–6,0 ms. Do DWM compor até o quadro chegar: **11–16 ms** (mediana), p95 23–27 ms. `IsBorderRequired = false` aceito (Windows 11). | **Viável.** Nada passa pela CPU, e o custo é de cerca de 1 quadro de atraso. Os picos do p95 parecem disputa entre iGPU e dGPU (a captura e o device estão em adaptadores diferentes); medir com a janela do telão no projetor. |
| **(c) NDI** | Não medido (exige SDK e DLL) | Possível, mas comprime na CPU (SpeedHQ) e tem condições de marca. Mais pesado e com mais obrigações que o Spout para a mesma máquina. Fica para quando houver pedido de saída **por rede**. |

## 3. POC

- `src-tauri/examples/spout_poc.rs`: sender Spout DX11 **sem o SDK**, escrevendo o protocolo do Spout2:
  - mapa `SpoutSenderNames` (64 × 256 bytes);
  - mapa `ActiveSenderName`;
  - mapa com o nome do sender contendo `SharedTextureInfo` de 280 bytes (handle legado de 32 bits, largura, altura, formato 87 = `B8G8R8A8_UNORM`, caminho do executável).

  Envia uma textura 1920×1080 animada. No fim, um "receptor" em outro device D3D11 acha o sender pelos mapas, abre a textura pelo handle registrado e confere um pixel: **OK**.
- `src-tauri/examples/wgc_poc.rs`: captura do monitor por Windows Graphics Capture e cópia GPU→GPU para uma textura compartilhável (as medidas de (b′)).
- `docs/quality/spout-readpixels.html`: a medida de (a). Rode no Edge com GPU:

```powershell
cd src-tauri
cargo run --release --example spout_poc -- 60      # sender "DoubleK POC" por 60 s
cargo run --release --example wgc_poc -- 120       # 120 quadros do monitor principal
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --force_high_performance_gpu --dump-dom "file:///<repo>/docs/quality/spout-readpixels.html"
```

**Para provar com um receptor real (NÃO VERIFICADO):** com o `spout_poc` rodando, abra o *SpoutReceiver* do pacote de releases do Spout2 (ou o Resolume → Sources → Spout) e escolha "DoubleK POC". A POC **não** cria os mutex/semáforo de acesso e de contagem de quadros que o SDK usa: os nomes não foram confirmados no código lido. Um receptor pode exibir a textura sem saber quando há quadro novo, ou exigir esses objetos. É o primeiro teste do DK-102.

## 4. Recomendação para DK-102

**Viável pelo caminho (b′).** Capturar a janela do telão (HWND da `WebviewWindow` de saída) com Windows Graphics Capture, copiar GPU→GPU para uma textura DX11 compartilhada e registrar o sender Spout.

- **Dependência:** o crate `windows` (0.62, que o Tauri já puxa) como dependência direta, com as features de Direct3D11, Dxgi, Graphics.Capture e WinRT. Nenhum crate novo. Alternativa: `spout-rs` com `vendored` (BSD-2), que exige compilador C++ no CI e cuja API é OpenGL.
- **Recomendo o protocolo em Rust** (~200 linhas, como a POC), completando o mutex de acesso e o semáforo de contagem de quadros depois de lidos no `SpoutSharedMemory.cpp` e `SpoutFrameCount.cpp`, e validando com o SpoutReceiver e o Resolume.
- **Custo estimado:** 2–3 dias de agente (captura da janela do telão numa thread própria, sender com reconexão e nome configurável, chave na UI, medidas) + **teste do mantenedor** com Resolume por 30 min (aceite do DK-100).
- **Riscos:**
  1. Compatibilidade do protocolo sem o SDK (mitigação: validar cedo e, se falhar, usar `spout-rs`).
  2. Notebooks com duas GPUs: captura e textura em adaptadores diferentes geram picos (p95 5–6 ms). Criar o device no adaptador do monitor do telão.
  3. A janela do telão precisa existir e não estar minimizada (o WGC captura janela coberta, mas não minimizada).
  4. Borda amarela no Windows 10 anterior ao 2104, onde `IsBorderRequired` não existe.
  5. Mais 1 quadro de atraso no Spout em relação ao telão.
- **Fallback:** a saída por monitor continua como hoje, e Spout é opcional.

## 5. Implementação (DK-102)

Caminho (b′), recurso **desligado por padrão**: `src-tauri/src/spout.rs`, comandos `spout_start(name)`, `spout_stop` e `spout_status` (`{running, name, width, height, fps, frames, lastError}`). O `close_output` desliga o Spout.

- **Captura:** Windows Graphics Capture do HWND da janela `output` do Tauri, numa thread própria. Nada toca na thread de áudio. O device D3D11 é criado no **adaptador DXGI que mostra o monitor do telão** (`MonitorFromWindow` → `EnumAdapters1/EnumOutputs`). Borda amarela desligada quando o Windows permite, cursor fora da captura, e mudança de tamanho da janela recria o pool e a textura.
- **Sender, protocolo do Spout2 lido em `SPOUTSDK/SpoutGL`** (leadedge/Spout2, master). O fetch não trouxe números de linha, então cito arquivo e função:
  - `SpoutSharedMemory.cpp` `Create`/`Open`/`Lock`: cada mapa tem o mutex `<mapa>_mutex` (CreateMutexA sem dono inicial; espera de 67 ms).
  - `SpoutSenderNames.cpp`:
    - `RegisterSenderName`/`UpdateSender`/`SetSenderInfo`: `SpoutSenderNames` (64 × 256 bytes) e `ActiveSenderName` (256), mais um mapa com o nome do sender contendo `SharedTextureInfo` de 280 bytes. Nome repetido vira `nome_1`, `nome_2`.
    - `ReleaseSenderName`: sai da lista, e o "ativo" passa para o primeiro que sobrou.
  - `SpoutFrameCount.cpp`:
    - `CreateAccessMutex`/`CheckAccess`/`AllowAccess`: `<nome>_SpoutAccessMutex`, 67 ms.
    - `EnableFrameCount`/`SetNewFrame`: `<nome>_Count_Semaphore`, inicial 1 e máximo LONG_MAX; por quadro, Wait(0) + Release(2).
    - O receptor só usa a contagem com `HKCU\Software\Leading Edge\Spout\Framecount = 1`; sem isso, copia todo quadro.
  - `SpoutDX.cpp` `SendTexture`: CopyResource + Flush + contador **dentro** do mutex; quadro descartado se o lock falhar.
  - `SpoutDirectX.cpp` `CreateSharedDX11Texture`: `D3D11_RESOURCE_MISC_SHARED` (handle legado, `GetSharedHandle`), `RENDER_TARGET | SHADER_RESOURCE`, `B8G8R8A8_UNORM`.
- **Dependência:** `windows` 0.62.2, a mesma que o Tauri já puxa. O `Cargo.lock` só ganha a referência; não entra uma 2ª cópia. Features: Graphics.Capture, DirectX, Direct3D11, Dxgi, Gdi, Memory, Threading, WinRT e WindowsAndMessaging.
- **Falhas:** Windows sem WGC, janela fechada ou erro de GPU desligam o sender (`running = false`, `lastError` com a mensagem). O telão segue.

**Custo medido** (teste `bench_send_1080p`, 600 quadros 1920×1080 na GPU do monitor principal):

| | Mediana | p95 |
|---|---:|---:|
| CPU do `send` (mutex + CopyResource + Flush + contador) | 0,03 ms | 0,11–0,19 ms |
| Até a GPU terminar a cópia | 0,065 ms | 0,35–0,40 ms |

Somado ao WGC (seção 2: o quadro chega ~1 quadro depois de composto), o Spout custa < 0,5 ms de GPU por quadro e nada de CPU relevante.

**Testes** (`cargo test --release`):
- `sender_registra_envia_e_libera`: um receptor com handles novos, como outro processo, acha o nome na lista e no ativo, abre a textura pelo handle do mapa e lê o pixel enviado. Também lê a contagem de 3 quadros como o `GetNewFrame` do SDK. Depois do drop, nome, mapa e mutex de acesso somem.
- `captura_janela_e_libera` (`--ignored`: abre uma janela de 320×200 verde por ~2 s): captura real por WGC; o receptor lê o verde da janela; `stop` libera mapa, mutex e lista.
- `bench_send_1080p` (`--ignored`).

**Roteiro de aceite para o mantenedor** (NÃO VERIFICADO aqui: não baixamos nem rodamos binários de terceiros):
1. Instale o Spout2 (release oficial em github.com/leadedge/Spout2) ou use o Resolume.
2. No DoubleK, projete o telão e ligue **Spout** na aba Saída (nome padrão "DoubleK Visuals").
3. No *SpoutReceiver* (ou Resolume → Sources → Spout), escolha "DoubleK Visuals". A imagem deve igualar a do telão.
4. Rode por 30 min (aceite do DK-100) e anote fps/quadros do status. Feche e reabra o receptor: o DoubleK não pode cair, e o sender continua listado.
5. Teste também com `Framecount = 1` no registro do Spout (SpoutSettings), para o receptor usar a contagem de quadros.
6. Num notebook com duas GPUs, projete no monitor ligado na dGPU e confira o fps.

**Limitações:**
- A janela do telão não pode ficar **minimizada**: o WGC para de entregar quadros. Coberta por outra janela, ela continua sendo capturada.
- Mover o telão para outro monitor com o Spout ligado mantém o device do adaptador antigo. Desligue e ligue de novo.
- Windows 10 anterior ao 2104 mostra a borda amarela de captura.
- O nome do sender não é salvo entre sessões (DÍVIDA: persistir no `store` quando a UI entrar).

