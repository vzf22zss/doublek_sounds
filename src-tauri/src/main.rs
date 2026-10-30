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

/// Música vinda de um Show Pack, com id já definido (DK-014): `replace` mantém o id do pacote, `new` usa o gerado
/// na importação. Corpo = bytes; cabeçalho `x-id` = id (`<nome>.<ext>`). Nunca sobrescreve: se o id já existe,
/// não grava e devolve `false` (o importador então não apaga esse arquivo num rollback).
#[tauri::command]
fn put_track(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Envie o arquivo como bytes".into()) };
    let id = request.headers().get("x-id").and_then(|v| v.to_str().ok()).unwrap_or("");
    let path = track_path(&app, id)?; // valida o id (track::check_id)
    track::check_upload(id.rsplit('.').next().unwrap_or(""), bytes.len())?;
    use std::io::Write;
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => {
            if let Err(e) = f.write_all(bytes) {
                drop(f);
                let _ = std::fs::remove_file(&path);
                return Err(e.to_string());
            }
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

const BACKUPS_KEPT: usize = 5;
const MAX_BACKUP: usize = (2 << 30) + (64 << 20); // 2 GiB de assets (limite do manifesto) + folga para os JSONs

/// Nome de arquivo seguro para o backup: só [A-Za-z0-9_-], até 60 caracteres, sem a extensão.
fn backup_name(raw: &str) -> String {
    let base = raw.strip_suffix(".doublekshow").unwrap_or(raw);
    let s: String = base.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(60).collect();
    let s = s.trim_matches('-');
    if s.is_empty() { "backup".into() } else { s.into() }
}

/// Backup do show atual antes de importar outro (DK-014). Corpo = bytes do `.doublekshow`; cabeçalho `x-name` =
/// nome sugerido. Grava em `app_data/backups/`, nunca por cima de outro, mantém os 5 mais recentes e devolve o caminho.
#[tauri::command]
fn save_backup(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Envie o backup como bytes".into()) };
    if bytes.is_empty() || bytes.len() > MAX_BACKUP { return Err("Backup vazio ou grande demais".into()) }
    let name = backup_name(request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or(""));
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut path = dir.join(format!("{name}.doublekshow"));
    for n in 2.. {
        if !path.exists() { break }
        path = dir.join(format!("{name}-{n}.doublekshow"));
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    // rotação: só os mais recentes (por data de modificação); falha ao apagar um antigo não derruba o backup novo
    let mut old: Vec<_> = std::fs::read_dir(&dir).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "doublekshow"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    old.sort_by(|a, b| b.cmp(a));
    for (_, p) in old.into_iter().skip(BACKUPS_KEPT) { let _ = std::fs::remove_file(p); }
    Ok(path.display().to_string())
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
    let (params, emit) = (engine.params.clone(), engine.broadcast());
    std::thread::spawn(move || audio::run(device, channel, params, rx, stop, emit));
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

// ---------- OSC (DK-091): servidor local; a UI liga/desliga em DK-092 ----------

static OSC: Mutex<Option<doublek_lib::osc::Server>> = Mutex::new(None);

#[derive(Serialize)]
struct OscStatus {
    running: bool,
    bind: String,
    received: u64,
    dropped: u64,  // limite de taxa
    rejected: u64, // pacotes malformados
}

/// Liga o servidor OSC (um por vez). `bind` vazio = 127.0.0.1 (só esta máquina); 0.0.0.0 abre para a rede local.
/// Cada mensagem vira o evento `osc` `{ addr, args }` na janela de controle. Devolve o endereço em uso.
#[tauri::command]
fn osc_start(app: AppHandle, bind: String, port: u16) -> Result<String, String> {
    let mut cur = OSC.lock().unwrap();
    if let Some(s) = &*cur {
        return Err(format!("O OSC já está ligado em {}: desligue antes de trocar a porta", s.addr));
    }
    if port == 0 {
        return Err("Porta OSC de 1 a 65535".into());
    }
    let ip: std::net::IpAddr = if bind.trim().is_empty() { [127, 0, 0, 1].into() } else { bind.trim().parse().map_err(|_| format!("Endereço inválido: {bind}"))? };
    let srv = doublek_lib::osc::serve((ip, port).into(), move |m| { let _ = app.emit_to("control", "osc", m); })?;
    let addr = srv.addr.to_string();
    *cur = Some(srv);
    Ok(addr)
}

#[tauri::command]
fn osc_stop() {
    let srv = OSC.lock().unwrap().take();
    if let Some(s) = srv {
        s.stop();
    }
}

#[tauri::command]
fn osc_status() -> OscStatus {
    match &*OSC.lock().unwrap() {
        Some(s) => OscStatus {
            running: true,
            bind: s.addr.to_string(),
            received: s.stats.received.load(Relaxed),
            dropped: s.stats.dropped.load(Relaxed),
            rejected: s.stats.rejected.load(Relaxed),
        },
        None => OscStatus { running: false, bind: String::new(), received: 0, dropped: 0, rejected: 0 },
    }
}

// ---------- celular / remoto (DK-081): HTTP local com pareamento; a UI liga/desliga ----------

static REMOTE: Mutex<Option<doublek_lib::remote::Server>> = Mutex::new(None);

#[derive(Serialize)]
struct RemoteStatus {
    running: bool,
    bind: String,
    clients: usize,
    received: u64,
    rejected: u64,
}

#[derive(Serialize)]
struct PairCode {
    code: String,
    url: String, // onde o celular abre (IP da rede local quando aberto para a rede)
    secs: u64,
}

/// Liga o serviço remoto (um por vez). `bind` vazio = 127.0.0.1; 0.0.0.0 abre para a rede local.
/// Eventos na janela de controle: `remote` `{ addr, args, client }`, `remote-paired` (nome), `remote-revoked`.
#[tauri::command]
fn remote_start(app: AppHandle, bind: String, port: u16) -> Result<String, String> {
    use doublek_lib::remote::Event;
    let mut cur = REMOTE.lock().unwrap();
    if let Some(s) = &*cur {
        return Err(format!("O remoto já está ligado em {}: desligue antes de trocar a porta", s.addr));
    }
    if port == 0 {
        return Err("Porta de 1 a 65535".into());
    }
    let ip: std::net::IpAddr = if bind.trim().is_empty() { [127, 0, 0, 1].into() } else { bind.trim().parse().map_err(|_| format!("Endereço inválido: {bind}"))? };
    let srv = doublek_lib::remote::serve((ip, port).into(), move |e| {
        let _ = match e {
            Event::Cmd(v) => app.emit_to("control", "remote", v),
            Event::Paired(c) => app.emit_to("control", "remote-paired", c),
            Event::Revoked => app.emit_to("control", "remote-revoked", ()),
        };
    })?;
    let addr = srv.addr.to_string();
    *cur = Some(srv);
    Ok(addr)
}

/// Desliga e desconecta todo mundo (os tokens só existem na memória do servidor).
#[tauri::command]
fn remote_stop() {
    let srv = REMOTE.lock().unwrap().take();
    if let Some(s) = srv {
        s.stop();
    }
}

#[tauri::command]
fn remote_status() -> RemoteStatus {
    match &*REMOTE.lock().unwrap() {
        Some(s) => RemoteStatus {
            running: true,
            bind: s.addr.to_string(),
            clients: s.shared.clients(),
            received: s.shared.received.load(Relaxed),
            rejected: s.shared.rejected.load(Relaxed),
        },
        None => RemoteStatus { running: false, bind: String::new(), clients: 0, received: 0, rejected: 0 },
    }
}

/// Código novo de 6 dígitos (2 min, uso único) e o endereço para abrir no celular.
#[tauri::command]
fn remote_pair_code() -> Result<PairCode, String> {
    let cur = REMOTE.lock().unwrap();
    let s = cur.as_ref().ok_or("Ligue o remoto primeiro")?;
    let ip = if s.addr.ip().is_unspecified() { doublek_lib::remote::lan_ip().map_or("<IP deste computador>".into(), |ip| ip.to_string()) } else { s.addr.ip().to_string() };
    Ok(PairCode { code: s.shared.pair_code(), url: format!("http://{ip}:{}", s.addr.port()), secs: doublek_lib::remote::CODE_SECS })
}

#[tauri::command]
fn remote_revoke_all() {
    if let Some(s) = &*REMOTE.lock().unwrap() {
        s.shared.revoke_all();
    }
}

/// O que o celular vê em `GET /state` (a janela de controle manda 1×/s com o remoto ligado).
#[tauri::command]
fn remote_set_state(state: serde_json::Value) {
    if let Some(s) = &*REMOTE.lock().unwrap() {
        s.shared.set_state(state);
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
            add_track,
            remove_track,
            put_track,
            save_backup,
            load_track,
            play_track,
            list_outputs,
            set_params,
            beat,
            list_monitors,
            open_output,
            close_output,
            midi_devices,
            osc_start,
            osc_stop,
            osc_status,
            remote_start,
            remote_stop,
            remote_status,
            remote_pair_code,
            remote_revoke_all,
            remote_set_state
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o app");
}
