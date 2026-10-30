#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use doublek_lib::analysis::{BeatCmd, Params};
use doublek_lib::{audio, midi};
use serde::Serialize;
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
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel();
    if let Some((old, _)) = engine.run.lock().unwrap().replace((stop.clone(), tx)) {
        old.store(true, Relaxed);
    }
    let (params, subs) = (engine.params.clone(), engine.subs.clone());
    std::thread::spawn(move || {
        audio::run(device, channel, params, rx, stop, move |m| {
            subs.lock().unwrap().retain(|(_, c)| c.send(m.clone()).is_ok());
            true
        })
    });
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
            std::thread::spawn(move || {
                midi::watch(
                    move |m| { let _ = h1.emit_to("control", "midi", m); },
                    move |d| {
                        *devs.lock().unwrap() = d.clone();
                        let _ = h2.emit_to("control", "midi-devices", d);
                    },
                )
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_inputs,
            subscribe,
            start_input,
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
