# DoubleK Visuals

App desktop (Windows) que escuta o set e faz a logo pulsar no telão. Tauri 2 + Rust (áudio) + Svelte/WebGL (tela).

## Rodar

```
npm install
npm run tauri dev
```

Requer Rust (rustup) e Visual Studio Build Tools com C++.

## Afinar a detecção com faixas reais

```
cd src-tauri
cargo run --release --example analyze -- faixa.wav 135 150
cargo test --release
```

## Plano B

O app antigo em HTML está em `legacy/logo-pulsante-2.0.html` (abre direto no Chrome/Edge)
e também na tag git `html-original`.
