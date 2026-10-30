//! Captura (cpal/WASAPI) → ring buffer → análise, numa thread própria.
//! O callback de áudio só copia amostras; toda a análise roda fora dele.

use crate::analysis::{Analyzer, BeatCmd, Frame, Params, HOP};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SizedSample};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
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
