//! Faixa do roteiro: decodifica (symphonia), reamostra para a taxa da saída (rubato) e acha a
//! grade do BPM na faixa inteira + a forma de onda para a timeline. Quem toca é `audio::play`.

use crate::analysis::{Analyzer, Params, HOP};
use crate::beat;
use serde::Serialize;
use std::path::Path;
use symphonia::core::{audio::SampleBuffer, codecs::DecoderOptions, errors::Error as SymErr, io::MediaSourceStream, probe::Hint};

/// Áudio pronto para tocar: estéreo intercalado na taxa da saída (i16 = metade da memória).
pub struct Track {
    pub sr: u32,
    pub pcm: Vec<i16>,
}

impl Track {
    pub fn frames(&self) -> usize {
        self.pcm.len() / 2
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub duration: f64,
    pub bpm: f64,     // 0 = não achou
    pub anchor: f64,  // instante (s) do primeiro beat
    pub peaks: Vec<u8>, // um ponto a cada WAVE_DT: pico
    pub lows: Vec<u8>,  // ... e quanto daquilo é grave (para colorir)
}

pub const WAVE_DT: f64 = 0.02;

/// Qualquer formato que o symphonia conhece (mp3, wav, flac, m4a/aac, ogg) → estéreo f32 + taxa.
pub fn decode(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, MediaSourceStream::new(Box::new(file), Default::default()), &Default::default(), &Default::default())
        .map_err(|e| format!("Formato não suportado: {e}"))?;
    let mut fmt = probed.format;
    let tr = fmt.default_track().ok_or("O arquivo não tem áudio")?;
    let (id, mut sr) = (tr.id, tr.codec_params.sample_rate.unwrap_or(44100));
    let mut dec = symphonia::default::get_codecs().make(&tr.codec_params, &DecoderOptions::default()).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    loop {
        let pkt = match fmt.next_packet() {
            Ok(p) => p,
            Err(SymErr::IoError(_)) => break, // fim do arquivo
            Err(e) => return Err(e.to_string()),
        };
        if pkt.track_id() != id {
            continue;
        }
        let d = match dec.decode(&pkt) {
            Ok(d) => d,
            Err(SymErr::DecodeError(_)) => continue, // pacote ruim: pula, como os players fazem
            Err(e) => return Err(e.to_string()),
        };
        let spec = *d.spec();
        sr = spec.rate;
        let ch = spec.channels.count().max(1);
        let mut b = SampleBuffer::<f32>::new(d.capacity() as u64, spec);
        b.copy_interleaved_ref(d);
        for fr in b.samples().chunks_exact(ch) {
            out.push(fr[0]);
            out.push(if ch > 1 { fr[1] } else { fr[0] });
        }
    }
    if out.is_empty() {
        return Err("O arquivo não tem áudio".into());
    }
    Ok((out, sr))
}

pub fn resample(x: Vec<f32>, from: u32, to: u32) -> Result<Vec<f32>, String> {
    use rubato::{audioadapter_buffers::direct::InterleavedSlice, Fft, FixedSync, Resampler};
    if from == to {
        return Ok(x);
    }
    let frames = x.len() / 2;
    let input = InterleavedSlice::new(&x, 2, frames).map_err(|e| e.to_string())?;
    let mut r = Fft::<f32>::new(from as usize, to as usize, 1024, 2, FixedSync::Input).map_err(|e| e.to_string())?;
    Ok(r.process_all(&input, frames, None).map_err(|e| e.to_string())?.take_data())
}

/// Decodifica, reamostra para `out_sr` e analisa.
pub fn load(path: &Path, out_sr: u32, lo: f32, hi: f32) -> Result<(Track, Info), String> {
    let (x, sr) = decode(path)?;
    let x = resample(x, sr, out_sr)?;
    let info = analyze(&x, out_sr, lo, hi);
    let pcm = x.iter().map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16).collect();
    Ok((Track { sr: out_sr, pcm }, info))
}

/// Grade da faixa inteira com o mesmo detector de kick do ao vivo + forma de onda.
pub fn analyze(stereo: &[f32], sr: u32, lo: f32, hi: f32) -> Info {
    let mono: Vec<f32> = stereo.chunks_exact(2).map(|f| 0.5 * (f[0] + f[1])).collect();
    let mut an = Analyzer::new(sr as f32);
    let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
    let mut kicks = vec![];
    for (i, c) in mono.chunks_exact(HOP).enumerate() {
        if an.process(c, &p).is_some() {
            kicks.push((i + 1) as f64 * HOP as f64 / sr as f64);
        }
    }
    let (bpm, anchor) = grid(&kicks, an.beat.period).map_or((0.0, 0.0), |(p, a)| (60.0 / p, a.rem_euclid(p)));

    // forma de onda: pico e fração de grave (passa-baixas de 1 polo em ~150 Hz) por bloco
    let n = (WAVE_DT * sr as f64) as usize;
    let k = 1.0 - (-2.0 * std::f32::consts::PI * 150.0 / sr as f32).exp();
    let (mut lp, mut peaks, mut lows) = (0f32, vec![], vec![]);
    for c in mono.chunks(n) {
        let (mut pk, mut e, mut el) = (0f32, 1e-12f32, 0f32);
        for &s in c {
            lp += k * (s - lp);
            pk = pk.max(s.abs());
            e += s * s;
            el += lp * lp;
        }
        peaks.push((pk.min(1.0) * 255.0) as u8);
        lows.push(((el / e).min(1.0) * 255.0) as u8);
    }
    Info { duration: mono.len() as f64 / sr as f64, bpm, anchor, peaks, lows }
}

/// Ajuste global t = a + p·n. Cresce a janela aos poucos (16 s, 32 s…), partindo do ajuste
/// anterior: com o período só do começo, o erro acumulado no fim da faixa trocaria o índice dos beats.
fn grid(kicks: &[f64], p0: f64) -> Option<(f64, f64)> {
    let (t0, t1) = (*kicks.first()?, *kicks.last()?);
    if p0 <= 0.0 {
        return None;
    }
    let (mut p, mut a, mut span) = (p0, None, 16.0);
    loop {
        let win: Vec<f64> = kicks.iter().copied().filter(|&t| t <= t0 + span).collect();
        if let Some((pp, aa, _, _)) = beat::fit(&win, p, a, false) {
            (p, a) = (pp, Some(aa));
        }
        if t0 + span >= t1 {
            break;
        }
        span *= 2.0;
    }
    Some((p, a?))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kicks (sweep + click) a `bpm` a partir de `start`, com baixo rolante — estéreo.
    fn synth(bpm: f64, secs: f64, start: f64, sr: u32) -> Vec<f32> {
        let sr_f = sr as f32;
        let mut m = vec![0f32; (secs * sr as f64) as usize];
        let beat = 60.0 / bpm;
        let mut t0 = start;
        let mut rng = 7u32;
        while t0 + 0.4 < secs {
            let s0 = (t0 * sr as f64) as usize;
            let mut ph = 0f32;
            for i in 0..(0.3 * sr_f) as usize {
                let tt = i as f32 / sr_f;
                ph += 2.0 * std::f32::consts::PI * (50.0 + 120.0 * (-tt / 0.03).exp()) / sr_f;
                rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
                let nz = (rng >> 8) as f32 / (1 << 24) as f32 * 2.0 - 1.0;
                m[s0 + i] += 0.8 * ph.sin() * (-tt / 0.2).exp() + 0.35 * nz * (-tt / 0.004).exp();
            }
            for j in 1..4 {
                let b0 = ((t0 + j as f64 * beat / 4.0) * sr as f64) as usize;
                for i in 0..(beat / 4.0 * 0.8 * sr as f64) as usize {
                    let tt = i as f32 / sr_f;
                    m[b0 + i] += 0.5 * (tt / 0.003).min(1.0) * (-tt / 0.05).exp() * (2.0 * std::f32::consts::PI * 55.0 * tt).sin();
                }
            }
            t0 += beat;
        }
        m.iter().flat_map(|&s| [s, s]).collect()
    }

    #[test]
    fn grade_da_faixa_inteira() {
        let (bpm, start) = (147.3, 0.37);
        let x = synth(bpm, 180.0, start, 48000);
        let info = analyze(&x, 48000, 135.0, 150.0);
        println!("bpm {:.3} âncora {:.4}", info.bpm, info.anchor);
        assert!((info.bpm - bpm).abs() < 0.05, "bpm {}", info.bpm);
        let p = 60.0 / bpm;
        let off = (info.anchor - start).rem_euclid(p);
        let off = off.min(p - off);
        assert!(off < 0.02, "âncora fora do kick: {:.1} ms", off * 1000.0);
        assert_eq!(info.peaks.len(), (180.0 / WAVE_DT).ceil() as usize);
    }

    #[test]
    fn wav_ida_e_volta_com_reamostragem() {
        let path = std::env::temp_dir().join("doublek_teste.wav");
        let spec = hound::WavSpec { channels: 2, sample_rate: 44100, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(&path, spec).unwrap();
        for i in 0..44100 * 2 {
            let s = ((i as f32 * 440.0 * 2.0 * std::f32::consts::PI / 44100.0).sin() * 10000.0) as i16;
            w.write_sample(s).unwrap();
            w.write_sample(s).unwrap();
        }
        w.finalize().unwrap();
        let (t, info) = load(&path, 48000, 80.0, 220.0).unwrap();
        assert_eq!(t.sr, 48000);
        assert!((t.frames() as i64 - 96000).abs() < 200, "frames {}", t.frames());
        assert!((info.duration - 2.0).abs() < 0.01);
        let _ = std::fs::remove_file(path);
    }
}
