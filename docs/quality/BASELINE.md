# Baseline técnica — DoubleK Visuals v0.3.1

> **Tarefa:** DK-001 do [roadmap](../DOUBLEK_VISUALS_PLANO_AGENTICO_ROADMAP.md)  
> **Data:** 2026-10-30 · **Commit:** `main` @ `09a7677` (tag de versão: `package.json` 0.3.1)  
> **Máquina:** a de desenvolvimento do mantenedor (abaixo). Não é a máquina de referência de show (DEC-02).  
> Tudo o que exige áudio real, controlador, projetor ou medição em palco está marcado **NÃO VERIFICADO**.

## 1. Versões

| Item | Versão |
|---|---|
| App | 0.3.1 (MSI `DoubleK Visuals_0.3.1_x64_pt-BR.msi`, 5,3 MiB, assinado para o updater) |
| Rust | rustc 1.99.1 · cargo 1.99.1 |
| Node / npm | 24.16.0 / 11.13.0 |
| Tauri | CLI 2.12.4 · `@tauri-apps/api` 2.12.4 · plugins `updater` 2.14.1, `process` 2.4.0 |
| Svelte / Vite / TS | 5.57 / 8 / 5 (svelte-check 4) |
| WebView2 (runtime da máquina) | 156.0.4314.50 |
| Windows | 11 Home Single Language 10.0.26200 |

**Máquina de desenvolvimento:** Intel i5-11400H, 32 GB RAM, NVIDIA RTX 3050 Laptop 4 GB (driver 32.0.15.8180) + Intel UHD (driver 30.0.100.9864), 3 monitores. Não se sabe qual GPU o WebView2 escolhe para o app; registrar em DK-003.

## 2. Resultados dos testes (2026-10-30)

| Comando | Resultado | Tempo |
|---|---|---|
| `cargo test --release` | **9/9 ok**: `psy_140`, `psy_148`, `dark_175`, `hitech_200`, `auto_range_148`, `drop_breakdown`, `parses_cc_and_notes`, `grade_da_faixa_inteira`, `wav_ida_e_volta_com_reamostragem` | 35 s (compilação) + 0,55 s |
| `npm run check` | ok (43 asserts: blend, sanitizeLook, drop, pickColors, roteiro) | 1,3 s |
| `npm run typecheck` | 226 arquivos, 0 erros, 0 avisos | 7,3 s |
| `npm run build` | ok | 1,3 s |
| `npm audit` | 2 low, só em devDependencies; **0 em produção** | — |

Build de release com assinatura (`npm run tauri build` com `TAURI_SIGNING_PRIVATE_KEY`) feito hoje: ok.

## 3. Tamanho do código

| Área | Linhas |
|---|---|
| `src-tauri/src` (Rust: analysis, beat, audio, track, midi, main) | 1 435 |
| `src/control` (Svelte: App, Performance, Timeline, RoteiroPanel, Analyzer, Knob, Slider, midi, roteiro) | 1 770 |
| `src/lib` (settings, assets, roteiro, types, check) | 554 |
| `src/render` (renderer + shaders) | 409 |
| `src/output` | 39 |

## 4. Fluxo de áudio

```
entrada (cpal/WASAPI, callback só copia) ──► rtrb SPSC ──► thread de análise, HOP = 256 (~5 ms @ 48 kHz)
                                                              │ filtros RBJ por banda · onset · kick = sub ∧ click ∧ grade
                                                              │ Beat (regressão sobre kicks, hold 30 s) · low (grave, histerese)
                                                              ▼
                                               Msg::Frame a cada 2 hops (~94 Hz) ──► Channel por janela (control, output)
```

- **Modo arquivo (roteiro):** `audio::play` lê `Track` (i16 estéreo já na taxa da saída), empurra para um ring de saída (cpal output) e alimenta o **mesmo** `Analyzer`; `Beat::set_grid` trava a grade da análise do arquivo; `Frame.pos` = amostras já tocadas pela saída.
- `set_params` troca `Params` por mutex; `beat` manda `BeatCmd` (tap/half/double/nudge) pelo mpsc.
- Reconexão da entrada a cada 1 s se o stream falhar.

## 5. Fluxo de render

```
Renderer (WebGL2, 1 classe, telão e preview) ──► passe 1 cena: fundo (cor/degradê/foto/vídeo) + flash + anéis + espectros + logo/glow/chroma
                                            ──► passe 2 feedback (ping-pong) se trail > 0
                                            ──► passe 3 pós: vinheta, scanlines, grão, shake, strobe, blackout
```

- Fontes de modulação por efeito (`VISUAL.mod`): auto/kick/sub/bass/mid/hats/beat/bar/lfo.
- "Só no drop" (`VISUAL.drop`): envelope `dropEnv` segue `Frame.low` com `dropFade` beats.
- `react:false` (modo só roteiro): fontes de áudio e espectro valem 0; relógio do beat continua.
- Vídeo: textura própria, `texImage2D` só quando `requestVideoFrameCallback` avisa quadro novo; desfoque por viés de mipmap.
- Preview roda a 30 fps com `renderScale 0.5`; telão a 60 com `renderScale` do usuário.

## 6. Persistência (tudo local; desde DK-002 cada chave `doublek.*` tem envelope `{ v, data }` versionado via `src/lib/store.ts`)

| Dado | Onde | Chave |
|---|---|---|
| Ajustes de áudio (device, gain, gate, sens, range, lock, needClick, monitor, dropThr) | localStorage | `doublek.settings` |
| Visual atual (`Visual`, inclui `mod`, `drop`, `bgVideo`, `react`) | localStorage | `doublek.visual` |
| 8 cenas (`Scene[]`, 8 fixo) | localStorage | `doublek.scenes` |
| Transição padrão | localStorage | `doublek.trans` |
| Mapeamento MIDI (`key → {id,label,min,max,step}`) | localStorage | `doublek.midi` |
| Lista de vídeos (`{id,name}[]`) | localStorage | `doublek.videos` |
| Roteiros (`Roteiro[]`) | localStorage | `doublek.roteiros` |
| Logo, foto, vídeos (Blob) | IndexedDB `doublek` / store `kv` | `logo`, `bg`, `video:<id>` |
| Músicas dos roteiros | disco | `%APPDATA%\com.doublek.visuals\tracks\<id>.<ext>` |
| Chave do updater (pública) | `tauri.conf.json` | `plugins.updater.pubkey` |

Exportações existentes: preset JSON (visual + 8 cenas, sem mídia) e roteiro JSON (sem música). Carregamento passa por `store.load` (migra v0→v1; valida com `validVisual`/`validScenes`/`validRoteiros`/`validMidiMap`/`validVideos`/`shaped`; inválido ou versão futura → padrão e o bruto vai para `<chave>.bak`). `sanitizeLook`/`sanitizeRoteiro` validam importações de arquivo.

## 7. Comandos Tauri e eventos

**Comandos** (`main.rs`): `list_inputs`, `list_outputs`, `subscribe`, `start_input`, `set_params`, `beat`, `list_monitors`, `open_output`, `close_output`, `midi_devices`, `add_track` (corpo binário + header `x-ext`), `remove_track`, `load_track`, `play_track`.

**Eventos:** control → output: `visual`, `assets`, `preload`; output → control: `telemetry` (fps, p50/p95/p99, drops, lost; substituiu `fps` em DK-003), `output-log`; Rust → control: `midi`, `midi-devices`.

**Capabilities:** `core:default`, `updater:default`, `process:allow-restart` para as janelas `control` e `output`. **CSP: `null`** (lacuna, DK-005).

## 8. Inventário de testes

| Camada | O que cobre | O que não cobre |
|---|---|---|
| Rust (`cargo test`) | detecção de kick/BPM em faixa sintética (5 BPMs), drop/breakdown, parse MIDI, grade da faixa inteira, decodificação WAV + reamostragem | áudio real, cpal, reprodução, reconexão |
| TS (`npm run check`) | blend/crossfade, sanitize de presets, `drop`, `pickColors`, regras do roteiro (due/stateAt/ramp/snap/sanitize); **store** (migração v0→v1, inválidos, versão futura, roundtrip, ids de roteiro); **telemetry** (percentis, resumo por segundo, diário) | UI, renderer, IPC |
| Tipos | `svelte-check` sobre tudo | — |
| Manual/mock | capturas da documentação via mock do Tauri em Edge headless (fora do repo) | app real |

CI em push/PR: `.github/workflows/ci.yml` (desde DK-002); release: `release.yml`.

## 9. Licenças

**npm (produção, 3 pacotes):** todos `MIT OR Apache-2.0`.

**Rust (527 crates sem dev-deps):** 242 `MIT OR Apache-2.0`, 114 `MIT`, 36 `Apache-2.0 OR MIT`, 19 `MPL-2.0`, 18 `Unicode-3.0`, demais permissivas. Sem GPL/AGPL. Casos com `AND` (a revisar em DK-004, todos permissivos): `brotli` (BSD-3 AND MIT), `dpi` (Apache AND MIT), `encoding_rs` ((Apache OR MIT) AND BSD-3), `ring` (Apache AND ISC), `unicode-ident`, `webpki-root-certs` (CDLA-Permissive-2.0). `MPL-2.0` (19 crates, via symphonia e option-ext) exige disponibilizar modificações **desses** arquivos, não do app.

**O repositório em si não tem licença** (DEC-01).

## 10. Divergências encontradas entre o roadmap original e o código

| Roadmap dizia | Código tem |
|---|---|
| Versão 0.1.0 | 0.3.1 |
| Sem importação de loops de vídeo | Biblioteca de vídeos, loop, velocidade, cenas, drop |
| Sem workflows | `release.yml` (push em `prod`) + updater no app |
| Detecção de energia a criar | `Frame.low` (presença de grave) já existe |
| Nenhum roteiro mencionado | Roteiro completo (app toca / DJ GO / 3 modos / A/B) |
| Export JSON sem logo/foto | Também sem vídeos, roteiros, músicas e MIDI |

Tudo isso foi corrigido no roadmap em `e011daf`.

## 11. Lacunas e riscos

1. **Roteiro nunca rodou com áudio real** (DK-141).
2. **Nenhuma Release publicada; secret de assinatura não cadastrado** → updater inerte (DEC-10).
3. ~~Sem CI~~ **resolvido em DK-002** (`ci.yml`; 1ª execução verde: run 41108914633, 2026-10-30).
4. ~~Sem schema versionado~~ **resolvido em DK-002** (`src/lib/store.ts`: envelope `{v, data}`, migrações por chave, validadores, `.bak`).
5. **CSP null**; comandos nativos sem limite de tamanho (`add_track` aceita qualquer arquivo).
6. **Vídeo decodificado duas vezes** (telão + preview) e sem detecção de codec.
7. **Cenas fixas em 8**; `Performance.svelte` e `settings.ts` assumem o tamanho.
8. **Sem licença no repositório.**
9. Chave privada do updater existe em **uma** máquina (`%USERPROFILE%\.tauri\doublek.key`); perda = apps instalados nunca mais atualizam.

## 12. NÃO VERIFICADO (precisa de hardware/pessoa)

| Item | Como verificar | Tarefa |
|---|---|---|
| Detecção de kick/BPM com música real (line-in e mic) | 3–4 faixas, comparar com Rekordbox; `cargo run --release --example analyze` | DK-008 |
| Offset visual no projetor | vídeo de metrônomo, ajustar até colar | DK-008 |
| Roteiro: BPM/1º beat de mp3 real, pontos no tempo, saída de áudio, GO | ver DK-141 | DK-141 |
| Controlador MIDI físico (learn, "(ocupado)", reconexão) | plugar nanoKONTROL/LPD8 | DK-003 |
| FPS no telão 1080p, p95 frametime, GPU usada | 30 min cena de stress; o **Diagnóstico** (bolinhas) já exporta fps/p50/p95/p99/drops | DK-003 (ferramenta pronta) → medir em DK-141/DEC-02 |
| Sessão de 2 h sem vazamento | Gerenciador de Tarefas + `control.jsHeapMB` do Diagnóstico | DK-003 (NÃO VERIFICADO) |
| Instalação MSI em PC limpo (sem Rust/Node) | outro PC/perfil | DK-004 |
| Perda de contexto WebGL, GPU reset | **simulado no mock** com `WEBGL_lose_context` (bolinha vermelha, diário, renderer recriado ao restaurar); GPU real: forçar via driver | DK-003 (software ✓; hardware NÃO VERIFICADO) |
| Wake lock no Windows (tela não apaga) | deixar 15 min | DK-003 |

## 13. Modelo da matriz de máquinas (DEC-02, a preencher)

| Papel | CPU | GPU | RAM | Windows | Áudio | Resultado FPS 1080p | Observações |
|---|---|---|---|---|---|---|---|
| Desenvolvimento | i5-11400H | RTX 3050 4 GB / UHD | 32 GB | 11 26200 | — | NÃO MEDIDO | esta máquina |
| Notebook do DJ (alvo) | ? | ? | ? | ? | interface USB ? | NÃO MEDIDO | definir com o mantenedor |
| Mínimo suportado | ? | iGPU | 8 GB? | 10 | mic | NÃO MEDIDO | fixar após medir |
