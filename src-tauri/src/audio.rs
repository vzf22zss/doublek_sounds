//! Captura (cpal/WASAPI) → ring buffer → análise, numa thread própria.
//! O callback de áudio só copia amostras; toda a análise roda fora dele.

use crate::analysis::{Analyzer, BeatCmd, Frame, Params, HOP};
use crate::track::Track;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::{mpsc::Receiver, Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Serialize)]
#[serde(tag = "t", content = "v", rename_all = "camelCase")]
pub enum Msg {
    Frame(Frame),
    Status(String),
}

pub fn list_inputs() -> Vec<String> {
    cpal::default_host()
        .input_devices()
        .map(|ds| ds.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

pub fn list_outputs() -> Vec<String> {
    cpal::default_host()
        .output_devices()
        .map(|ds| ds.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

fn output_device(name: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    match name {
        Some(n) => host
            .output_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().is_ok_and(|x| x == n))
            .ok_or_else(|| format!("Saída \"{n}\" não encontrada")),
        None => host.default_output_device().ok_or_else(|| "Nenhuma saída de áudio".to_string()),
    }
}

/// Taxa da saída: a faixa é reamostrada para ela ao carregar.
pub fn output_rate(name: Option<&str>) -> Result<u32, String> {
    Ok(output_device(name)?.default_output_config().map_err(|e| e.to_string())?.sample_rate().0)
}

/// O app toca a faixa: empurra o áudio para a saída e, junto, para o mesmo Analyzer do ao vivo.
/// `grid` = (âncora, período) da análise do arquivo: o relógio do beat fica exato desde o 1º beat.
/// `Frame.pos` vem do que a saída já tocou (não do que foi analisado), então o roteiro segue o som.
#[allow(clippy::too_many_arguments)]
pub fn play(
    track: Arc<Track>,
    from: f64,
    output: Option<String>,
    grid: Option<(f64, f64)>,
    params: Arc<Mutex<Params>>,
    cmds: Receiver<BeatCmd>,
    stop: Arc<AtomicBool>,
    mut emit: impl FnMut(Msg) -> bool,
) {
    let opened = output_device(output.as_deref()).and_then(|dev| {
        let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
        let sr = cfg.sample_rate().0;
        if sr != track.sr {
            return Err(format!("A saída está em {sr} Hz e a faixa foi preparada em {} Hz: carregue a faixa de novo", track.sr));
        }
        let (tx, rx) = rtrb::RingBuffer::new(4096); // ~40 ms de folga, estéreo
        let (played, failed) = (Arc::new(AtomicU64::new(0)), Arc::new(AtomicBool::new(false)));
        let (sc, ch): (cpal::StreamConfig, usize) = (cfg.clone().into(), cfg.channels() as usize);
        let (p, f) = (played.clone(), failed.clone());
        let stream = match cfg.sample_format() {
            cpal::SampleFormat::F32 => build_out::<f32>(&dev, &sc, rx, ch, p, f),
            cpal::SampleFormat::I16 => build_out::<i16>(&dev, &sc, rx, ch, p, f),
            cpal::SampleFormat::I32 => build_out::<i32>(&dev, &sc, rx, ch, p, f),
            cpal::SampleFormat::U16 => build_out::<u16>(&dev, &sc, rx, ch, p, f),
            other => Err(format!("Formato de áudio {other} não suportado")),
        }?;
        stream.play().map_err(|e| e.to_string())?;
        Ok((stream, tx, played, failed, sr, dev.name().unwrap_or_default()))
    });
    let (stream, mut tx, played, failed, sr, name) = match opened {
        Ok(o) => o,
        Err(e) => {
            emit(Msg::Status(e));
            return;
        }
    };
    if !emit(Msg::Status(format!("Tocando a faixa em: {name}"))) {
        return;
    }
    let mut an = Analyzer::new(sr as f32);
    if let Some((a, p)) = grid.filter(|g| g.1 > 0.0) {
        an.beat.set_grid(a - from, p);
    }
    let (mut pos, mut mono, mut n, mut kick) = ((from.max(0.0) * sr as f64) as usize, [0f32; HOP], 0u64, 0f32);
    while !stop.load(Relaxed) && !failed.load(Relaxed) {
        if pos + HOP > track.frames() {
            // fim: deixa a saída tocar o que falta antes de soltar o stream
            for _ in 0..50 {
                if tx.slots() == tx.buffer().capacity() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            emit(Msg::Status("Fim da faixa".into()));
            break;
        }
        if tx.slots() < 2 * HOP {
            std::thread::sleep(Duration::from_millis(1));
            continue;
        }
        for (i, m) in mono.iter_mut().enumerate() {
            let (l, r) = (track.pcm[2 * (pos + i)] as f32 / 32768.0, track.pcm[2 * (pos + i) + 1] as f32 / 32768.0);
            let _ = tx.push(l);
            let _ = tx.push(r);
            *m = 0.5 * (l + r);
        }
        pos += HOP;
        while let Ok(c) = cmds.try_recv() {
            an.command(c);
        }
        let p = *params.lock().unwrap();
        if let Some(k) = an.process(&mono, &p) {
            kick = kick.max(k);
        }
        n += 1;
        if n % 2 == 0 {
            let mut f = an.snapshot();
            f.kick = std::mem::take(&mut kick);
            let t = played.load(Relaxed) as f64 / sr as f64;
            f.pos = from + t;
            if grid.is_some() {
                (f.bpm, f.beat_phase, f.beat) = an.beat.at(t);
            }
            if !emit(Msg::Frame(f)) {
                return;
            }
        }
    }
    drop(stream);
}

fn build_out<T>(
    dev: &cpal::Device,
    cfg: &cpal::StreamConfig,
    mut rx: rtrb::Consumer<f32>,
    chans: usize,
    played: Arc<AtomicU64>,
    failed: Arc<AtomicBool>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    dev.build_output_stream(
        cfg,
        move |data: &mut [T], _| {
            for fr in data.chunks_mut(chans) {
                let (l, r) = if rx.slots() >= 2 {
                    played.fetch_add(1, Relaxed);
                    (rx.pop().unwrap_or(0.0), rx.pop().unwrap_or(0.0))
                } else {
                    (0.0, 0.0) // faltou áudio: silêncio em vez de travar
                };
                for (i, s) in fr.iter_mut().enumerate() {
                    *s = T::from_sample(match (chans, i) {
                        (1, _) => 0.5 * (l + r),
                        (_, 0) => l,
                        (_, 1) => r,
                        _ => 0.0,
                    });
                }
            }
        },
        move |_| failed.store(true, Relaxed),
        None,
    )
    .map_err(|e| e.to_string())
}

/// Roda até `stop`. Se a interface for desplugada, tenta reabrir a cada 1 s.
/// `channel`: 0 = soma dos canais, 1..n = só aquele canal.
pub fn run(
    device: Option<String>,
    channel: usize,
    params: Arc<Mutex<Params>>,
    cmds: Receiver<BeatCmd>,
    stop: Arc<AtomicBool>,
    mut emit: impl FnMut(Msg) -> bool,
) {
    while !stop.load(Relaxed) {
        match open(device.as_deref(), channel) {
            Ok((stream, mut rx, sr, failed, name)) => {
                if !emit(Msg::Status(format!("Ouvindo: {name} · {sr} Hz"))) {
                    return;
                }
                let mut an = Analyzer::new(sr as f32);
                let (mut buf, mut n, mut kick) = ([0f32; HOP], 0u64, 0f32);
                while !stop.load(Relaxed) && !failed.load(Relaxed) {
                    if rx.slots() < HOP {
                        std::thread::sleep(Duration::from_millis(1));
                        continue;
                    }
                    for s in &mut buf {
                        *s = rx.pop().unwrap_or(0.0);
                    }
                    while let Ok(c) = cmds.try_recv() {
                        an.command(c);
                    }
                    let p = *params.lock().unwrap();
                    if let Some(k) = an.process(&buf, &p) {
                        kick = kick.max(k);
                    }
                    n += 1;
                    if n % 2 == 0 {
                        let mut f = an.snapshot();
                        f.kick = std::mem::take(&mut kick);
                        if !emit(Msg::Frame(f)) {
                            return;
                        }
                    }
                }
                drop(stream);
                if failed.load(Relaxed) && !emit(Msg::Status("Entrada perdida — reconectando…".into())) {
                    return;
                }
            }
            Err(e) => {
                if !emit(Msg::Status(e)) {
                    return;
                }
            }
        }
        if !stop.load(Relaxed) {
            std::thread::sleep(Duration::from_secs(1));
        }
    }
}

type Opened = (cpal::Stream, rtrb::Consumer<f32>, u32, Arc<AtomicBool>, String);

fn open(name: Option<&str>, channel: usize) -> Result<Opened, String> {
    let host = cpal::default_host();
    let dev = match name {
        Some(n) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().is_ok_and(|x| x == n))
            .ok_or_else(|| format!("Entrada \"{n}\" não encontrada"))?,
        None => host.default_input_device().ok_or_else(|| "Nenhuma entrada de áudio".to_string())?,
    };
    let cfg = dev.default_input_config().map_err(|e| e.to_string())?;
    let sr = cfg.sample_rate().0;
    let chans = cfg.channels() as usize;
    let (tx, rx) = rtrb::RingBuffer::new(sr as usize);
    let failed = Arc::new(AtomicBool::new(false));
    let sc: cpal::StreamConfig = cfg.clone().into();
    let f = failed.clone();
    let stream = match cfg.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(&dev, &sc, tx, chans, channel, f),
        cpal::SampleFormat::I16 => build::<i16>(&dev, &sc, tx, chans, channel, f),
        cpal::SampleFormat::I32 => build::<i32>(&dev, &sc, tx, chans, channel, f),
        cpal::SampleFormat::U16 => build::<u16>(&dev, &sc, tx, chans, channel, f),
        other => Err(format!("Formato de áudio {other} não suportado")),
    }?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, rx, sr, failed, dev.name().unwrap_or_default()))
}

fn build<T>(
    dev: &cpal::Device,
    cfg: &cpal::StreamConfig,
    mut tx: rtrb::Producer<f32>,
    chans: usize,
    channel: usize,
    failed: Arc<AtomicBool>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let pick = channel.min(chans);
    dev.build_input_stream(
        cfg,
        move |data: &[T], _| {
            for fr in data.chunks(chans) {
                let s = if pick == 0 {
                    fr.iter().map(|&x| f32::from_sample(x)).sum::<f32>() / chans as f32
                } else {
                    f32::from_sample(fr[pick - 1])
                };
                let _ = tx.push(s); // buffer cheio = análise atrasada; descarta em vez de travar o áudio
            }
        },
        move |_| failed.store(true, Relaxed),
        None,
    )
    .map_err(|e| e.to_string())
}
