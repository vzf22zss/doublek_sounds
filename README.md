# DoubleK Visuals

App desktop (Windows) que escuta o set e faz a logo pulsar no telão. Tauri 2 + Rust (áudio) + Svelte/WebGL (tela).

## Rodar

```
npm install
npm run tauri dev
```

Requer Rust (rustup) e Visual Studio Build Tools com C++.

## Ao vivo

| Tecla | Ação |
|---|---|
| Espaço | tap tempo |
| ← → | ajuste fino da fase (5 ms) |
| 1–8 | chamar cena (crossfade começa no próximo beat) |
| Shift+clique na cena | gravar o visual atual nela |
| B | blackout |
| L | só a logo, sem efeitos |
| F | abrir/fechar o telão |

Knobs: arrastar (Shift = fino), roda do mouse, duplo clique = padrão.

## MIDI

1. Clique em **MIDI** na barra de cima (o LED pisca quando chega mensagem).
2. Clique num controle da tela: knob, slider, cena, TAP, ½, ×2, ◀ ▶, BLACKOUT ou Só logo.
3. Mexa no knob ou aperte o pad do controlador. Pronto: o controle mostra o CC/nota.
4. **Concluir** ou Esc para sair.

O controlador pode ser plugado com o app aberto. No Windows a entrada MIDI costuma ser
exclusiva: se o Rekordbox/Serato já estiver usando o controlador, ele aparece como
"(ocupado)" — use um controlador separado para o visual.

## Instalador

```
npm run tauri build
```

Gera `src-tauri/target/release/bundle/msi/DoubleK Visuals_<versão>_x64_pt-BR.msi`.

## Checagens

```
npm run typecheck
npm run check
```

## Afinar a detecção com faixas reais

```
cd src-tauri
cargo run --release --example analyze -- faixa.wav 135 150
cargo test --release
```

## Plano B

O app antigo em HTML está em `legacy/logo-pulsante-2.0.html` (abre direto no Chrome/Edge)
e também na tag git `html-original`.
