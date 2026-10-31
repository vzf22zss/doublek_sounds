#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use doublek_lib::analysis::{BeatCmd, Params};
use doublek_lib::{audio, midi, track};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{mpsc, Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

type Subs = Arc<Mutex<Vec<(String, Channel<audio::Msg>)>>>;

#[derive(Default)]
struct Engine {
    params: Arc<Mutex<Params>>,
    run: Mutex<Option<(Arc<AtomicBool>, mpsc::Sender<BeatCmd>)>>,
    subs: Subs, // uma assinatura por janela (controle, saída)
    midi_devices: Arc<Mutex<Vec<String>>>,
    clock: Arc<Mutex<midi::MidiClock>>, // MIDI Clock (pulsos da thread MIDI, lido pela análise)
    track: Mutex<Option<Arc<track::Track>>>, // faixa do roteiro carregada (pronta para tocar)
}

impl Engine {
    /// Para o que estiver tocando/ouvindo e devolve o novo par (stop, comandos) já registrado.
    fn restart(&self) -> (Arc<AtomicBool>, mpsc::Receiver<BeatCmd>) {
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = mpsc::channel();
        if let Some((old, _)) = self.run.lock().unwrap().replace((stop.clone(), tx)) {
            old.store(true, Relaxed);
        }
        (stop, rx)
    }

    fn broadcast(&self) -> impl FnMut(audio::Msg) -> bool {
        let subs = self.subs.clone();
        move |m| {
            subs.lock().unwrap().retain(|(_, c)| c.send(m.clone()).is_ok());
            true
        }
    }
}

/// As músicas do roteiro ficam copiadas na pasta do app: o roteiro não quebra se o original sumir.
fn track_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    track::check_id(id)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("tracks");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(id))
}

/// Corpo = bytes do arquivo; cabeçalho `x-ext` = extensão. Devolve o id (nome do arquivo guardado).
#[tauri::command]
fn add_track(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Envie o arquivo como bytes".into()) };
    let ext = request.headers().get("x-ext").and_then(|v| v.to_str().ok()).unwrap_or("");
    let ext = track::check_upload(ext, bytes.len())?; // extensão aceita + tamanho (o front já filtrou, mas o comando é a borda)
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    let id = format!("{stamp:x}.{ext}");
    std::fs::write(track_path(&app, &id)?, bytes).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn remove_track(app: AppHandle, id: String) -> Result<(), String> {
    std::fs::remove_file(track_path(&app, &id)?).map_err(|e| e.to_string())
}

/// Decodifica, reamostra para a saída escolhida e analisa (BPM, 1º beat, forma de onda).
#[tauri::command]
async fn load_track(engine: State<'_, Engine>, app: AppHandle, id: String, lo: f32, hi: f32, output: Option<String>) -> Result<track::Info, String> {
    let path = track_path(&app, &id)?;
    if !path.exists() {
        return Err("A música deste roteiro não está mais no app: suba o arquivo de novo".into());
    }
    let sr = audio::output_rate(output.as_deref())?;
    let (t, info) = tauri::async_runtime::spawn_blocking(move || track::load(&path, sr, lo, hi)).await.map_err(|e| e.to_string())??;
    *engine.track.lock().unwrap() = Some(Arc::new(t));
    Ok(info)
}

/// O app toca a faixa carregada a partir de `from` (s), com a grade (âncora, período) do roteiro.
#[tauri::command]
fn play_track(engine: State<Engine>, from: f64, anchor: f64, period: f64, output: Option<String>) -> Result<(), String> {
    let t = engine.track.lock().unwrap().clone().ok_or("Carregue a faixa primeiro")?;
    let (stop, rx) = engine.restart();
    let (params, emit) = (engine.params.clone(), engine.broadcast());
    std::thread::spawn(move || audio::play(t, from, output, Some((anchor, period)), params, rx, stop, emit));
    Ok(())
}

#[tauri::command]
async fn list_outputs() -> Vec<String> {
    audio::list_outputs()
}

#[derive(Serialize)]
struct Monitor {
    name: String,
    width: u32,
    height: u32,
}

#[tauri::command]
async fn list_inputs() -> Vec<String> {
    audio::list_inputs()
}

#[tauri::command]
fn subscribe(engine: State<Engine>, window: WebviewWindow, on_msg: Channel<audio::Msg>) {
    let mut subs = engine.subs.lock().unwrap();
    subs.retain(|(label, _)| label != window.label());
    subs.push((window.label().to_string(), on_msg));
}

#[tauri::command]
fn start_input(engine: State<Engine>, device: Option<String>, channel: usize) {
    let (stop, rx) = engine.restart();
    let (params, emit, clock) = (engine.params.clone(), engine.broadcast(), engine.clock.clone());
    std::thread::spawn(move || audio::run(device, channel, params, clock, rx, stop, emit));
}

#[tauri::command]
fn set_params(engine: State<Engine>, params: Params) {
    *engine.params.lock().unwrap() = params;
}

#[tauri::command]
fn beat(engine: State<Engine>, cmd: BeatCmd) {
    if let Some((_, tx)) = &*engine.run.lock().unwrap() {
        let _ = tx.send(cmd);
    }
}

#[tauri::command]
fn list_monitors(app: AppHandle) -> Vec<Monitor> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| Monitor { name: m.name().cloned().unwrap_or_default(), width: m.size().width, height: m.size().height })
        .collect()
}

/// Abre (ou move) a janela de saída em tela cheia no monitor escolhido.
#[tauri::command]
async fn open_output(app: AppHandle, monitor: usize) -> Result<(), String> {
    let mons = app.available_monitors().map_err(|e| e.to_string())?;
    let m = mons.get(monitor).ok_or("Monitor não encontrado")?;
    let win = match app.get_webview_window("output") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(&app, "output", WebviewUrl::App("output.html".into()))
            .title("DoubleK — Saída")
            .decorations(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?,
    };
    let e = |e: tauri::Error| e.to_string();
    win.set_fullscreen(false).map_err(e)?;
    win.set_position(*m.position()).map_err(e)?;
    win.set_fullscreen(true).map_err(e)?;
    win.show().map_err(e)?;
    Ok(())
}

#[tauri::command]
fn midi_devices(engine: State<Engine>) -> Vec<String> {
    engine.midi_devices.lock().unwrap().clone()
}

#[tauri::command]
fn close_output(app: AppHandle) {
    if let Some(w) = app.get_webview_window("output") {
        let _ = w.close();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Engine::default())
        .setup(|app| {
            let (h1, h2) = (app.handle().clone(), app.handle().clone());
            let devs = app.state::<Engine>().midi_devices.clone();
            let clock = app.state::<Engine>().clock.clone();
            std::thread::spawn(move || {
                midi::watch(
                    move |m| { let _ = h1.emit_to("control", "midi", m); },
                    move |d| {
                        *devs.lock().unwrap() = d.clone();
                        let _ = h2.emit_to("control", "midi-devices", d);
                    },
                    clock,
                )
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_inputs,
            subscribe,
            start_input,
            add_track,
            remove_track,
            load_track,
            play_track,
            list_outputs,
            set_params,
            beat,
            list_monitors,
            open_output,
            close_output,
            midi_devices
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o app");
}
