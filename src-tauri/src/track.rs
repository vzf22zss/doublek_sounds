//! Faixa do roteiro: decodifica (symphonia), reamostra para a taxa da saída (rubato) e acha a
//! grade do BPM na faixa inteira (um mapa de andamento, se ele muda no meio) + a forma de onda
//! para a timeline. Quem toca é `audio::play`.

use crate::analysis::{Analyzer, Params, HOP};
use crate::beat;
use serde::{Deserialize, Serialize};
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
    pub tempo: Vec<Seg>, // mapa de andamento: 1 trecho se o BPM é constante; vazio = não achou
    pub peaks: Vec<u8>, // um ponto a cada WAVE_DT: pico
    pub lows: Vec<u8>,  // ... e quanto daquilo é grave (para colorir)
}

/// Trecho do mapa de andamento: a partir de `t` (s), o beat n cai em `anchor + n·60/bpm`. O índice do
/// beat é contínuo entre trechos (a âncora é a do beat 0 extrapolada com o período do trecho).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Seg {
    pub t: f64,
    pub bpm: f64,
    pub anchor: f64,
}

pub const WAVE_DT: f64 = 0.02;

// ---------- limites de entrada (DK-005) ----------
pub const MAX_UPLOAD: usize = 300 << 20; // bytes
pub const MAX_SECS: f64 = 20.0 * 60.0; // uma faixa; um set inteiro não cabe na memória (f32 estéreo ≈ 20 MB/min)
pub const EXTS: [&str; 6] = ["mp3", "wav", "flac", "m4a", "aac", "ogg"]; // o que o symphonia está compilado para abrir

/// Extensão e tamanho do upload. Devolve a extensão normalizada.
pub fn check_upload(ext: &str, len: usize) -> Result<String, String> {
    let e = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    if !EXTS.contains(&e.as_str()) {
        return Err(format!("Formato .{e} não aceito; use {}", EXTS.join(", ")));
    }
    if len == 0 {
        return Err("Arquivo vazio".into());
    }
    if len > MAX_UPLOAD {
        return Err(format!("Arquivo grande demais ({} MB; máximo {} MB)", len >> 20, MAX_UPLOAD >> 20));
    }
    Ok(e)
}

/// Id de faixa = "<hex>.<ext>": só alfanumérico e ponto, sem `..`, curto. É o nome do arquivo em disco.
pub fn check_id(id: &str) -> Result<(), String> {
    let ok = (1..=64).contains(&id.len())
        && id.contains('.')
        && !id.contains("..")
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.');
    if ok { Ok(()) } else { Err("Faixa inválida".into()) }
}

fn too_long(secs: f64) -> String {
    format!("Faixa longa demais ({:.0} min; máximo {:.0} min)", secs / 60.0, MAX_SECS / 60.0)
}

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
    // duração conhecida (wav/flac/m4a): recusa antes de decodificar; mp3 VBR cai na checagem do laço
    if let Some(n) = tr.codec_params.n_frames {
        let secs = n as f64 / sr as f64;
        if secs > MAX_SECS {
            return Err(too_long(secs));
        }
    }
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
        let secs = out.len() as f64 / 2.0 / sr as f64;
        if secs > MAX_SECS {
            return Err(too_long(secs));
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
    let (mut bpm, mut anchor) = grid(&kicks, an.beat.period).map_or((0.0, 0.0), |(p, a)| (60.0 / p, a.rem_euclid(p)));
    let tempo = if bpm > 0.0 { tempo_map(&kicks, lo as f64, hi as f64).unwrap_or(vec![Seg { t: 0.0, bpm, anchor }]) } else { vec![] };
    (bpm, anchor) = (tempo.first().map_or(bpm, |s| s.bpm), tempo.first().map_or(anchor, |s| s.anchor));

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
    Info { duration: mono.len() as f64 / sr as f64, bpm, anchor, tempo, peaks, lows }
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

const MIN_KICKS: usize = 16; // trecho com menos kicks na grade (~7 s) é ruído (virada, breakdown), não andamento
const MISS: usize = 4; // kicks seguidos fora da grade: a música mudou de andamento
const SAME: f64 = 0.003; // trechos vizinhos com períodos a menos de 0,3 % são um só

/// Mapa de andamento. Corta onde a grade do trecho atual (regressão que cresce kick a kick) para de
/// explicar `MISS` kicks seguidos, descarta trechos curtos e junta vizinhos de mesmo andamento.
/// `None` = um trecho só: aí vale a grade global, idêntica à de antes do mapa.
fn tempo_map(kicks: &[f64], lo: f64, hi: f64) -> Option<Vec<Seg>> {
    let res = |t: f64, (p, a): (f64, f64)| {
        let x = (t - a) / p;
        (x - x.round()).abs()
    };
    // 1) trechos [i0, i1) com a grade de cada um
    let mut parts: Vec<(usize, usize, (f64, f64))> = vec![];
    let mut i0 = 0;
    while i0 + MIN_KICKS <= kicks.len() {
        match run(&kicks[i0..], lo, hi) {
            Some((n, g)) => {
                parts.push((i0, i0 + n, g));
                i0 += n;
            }
            None => i0 += 1, // começo sem grade (virada, ruído): pula o kick
        }
    }
    // 2) troca de andamento sem pausa: os primeiros kicks do andamento novo ainda cabiam na tolerância
    // da grade velha. Passam para o trecho seguinte se cabem melhor nele.
    for j in 1..parts.len() {
        let (g0, g1) = (parts[j - 1].2, parts[j].2);
        while parts[j - 1].1 - parts[j - 1].0 > 1 && parts[j - 1].1 == parts[j].0 && res(kicks[parts[j].0 - 1], g1) < res(kicks[parts[j].0 - 1], g0) {
            parts[j - 1].1 -= 1;
            parts[j].0 -= 1;
        }
    }
    // 3) descarta os curtos, junta os de mesmo andamento e refaz a grade de cada um com todos os kicks
    parts.retain(|p| p.1 - p.0 >= MIN_KICKS);
    let mut merged: Vec<(usize, usize, (f64, f64))> = vec![];
    for p in parts {
        match merged.last_mut() {
            Some(m) if ((p.2 .0 - m.2 .0) / m.2 .0).abs() < SAME => m.1 = p.1,
            _ => merged.push(p),
        }
    }
    if merged.len() < 2 {
        return None;
    }
    // 4) trechos: cada um começa no 1º beat da grade dele no 1º kick; o índice continua o do trecho anterior
    let mut out: Vec<Seg> = vec![];
    for (i0, i1, g) in merged {
        let (p, a) = grid(&kicks[i0..i1], g.0).unwrap_or(g);
        let seg = match out.last() {
            None => Seg { t: 0.0, bpm: 60.0 / p, anchor: a.rem_euclid(p) },
            Some(prev) => {
                let t = a + ((kicks[i0] - a) / p).round() * p;
                let v = (t - prev.anchor) * prev.bpm / 60.0;
                // ≥ v − ¼: o índice nunca volta (no máximo encurta um beat), e na troca sem pausa v já é inteiro
                Seg { t, bpm: 60.0 / p, anchor: t - (v - 0.25).ceil() * p }
            }
        };
        out.push(seg);
    }
    Some(out)
}

/// Um trecho a partir de `ks[0]`: grade inicial dos primeiros kicks e regressão que cresce enquanto os
/// kicks caem nela. Devolve quantos kicks ele cobre (até o último na grade) e (período, âncora).
fn run(ks: &[f64], lo: f64, hi: f64) -> Option<(usize, (f64, f64))> {
    let head = &ks[..MIN_KICKS.min(ks.len())];
    let (mut p, mut a, n, _) = beat::fit(head, beat::median_ioi(head, lo, hi)?, Some(head[0]), false)?;
    if n * 10 < head.len() * 6 {
        return None;
    }
    let (a0, mut sums, mut last, mut miss) = (a, [0.0; 5], 0, 0); // n, t, n², n·t, quantos
    for (i, &t) in ks.iter().enumerate() {
        let x = (t - a) / p;
        if (x - x.round()).abs() >= beat::TOL {
            miss += 1;
            if i >= head.len() && miss >= MISS {
                break;
            }
            continue;
        }
        let n = ((t - a0) / p).round();
        for (s, v) in sums.iter_mut().zip([n, t, n * n, n * t, 1.0]) {
            *s += v;
        }
        let [sn, st, snn, snt, m] = sums;
        let den = m * snn - sn * sn;
        if m >= 3.0 && den.abs() > 1e-9 {
            p = (m * snt - sn * st) / den;
            a = (st - p * sn) / m;
        }
        (last, miss) = (i, 0);
    }
    Some((last + 1, (p, a)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synth(bpm: f64, secs: f64, start: f64, sr: u32) -> Vec<f32> {
        crate::synth::Synth { bpm, secs, start, sr: sr as f32, ..Default::default() }.stereo().0
    }

    #[test]
    fn limites_de_upload_e_id() {
        assert_eq!(check_upload("MP3", 1000).unwrap(), "mp3");
        assert_eq!(check_upload(".Flac", 1000).unwrap(), "flac");
        assert!(check_upload("exe", 1000).unwrap_err().contains("não aceito"));
        assert!(check_upload("mp3", 0).unwrap_err().contains("vazio"));
        assert!(check_upload("mp3", MAX_UPLOAD + 1).unwrap_err().contains("máximo 300 MB"));
        assert!(check_upload("mp3", MAX_UPLOAD).is_ok());

        assert!(check_id("18f3a2b.mp3").is_ok());
        for bad in ["", "..", "../x.mp3", "a/b.mp3", "a\\b.mp3", "semponto", "x.mp3\0", &"a".repeat(70)] {
            assert!(check_id(bad).is_err(), "{bad:?} deveria ser recusado");
        }
        assert!(too_long(1500.0).contains("25 min"));
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

    /// Antes do mapa: só a grade global (o mesmo laço de `analyze`).
    fn grade_antiga(x: &[f32], sr: u32, lo: f32, hi: f32) -> (f64, f64) {
        let mono: Vec<f32> = x.chunks_exact(2).map(|f| 0.5 * (f[0] + f[1])).collect();
        let (mut an, p) = (Analyzer::new(sr as f32), Params { bpm_min: lo, bpm_max: hi, ..Default::default() });
        let kicks: Vec<f64> = mono.chunks_exact(HOP).enumerate().filter(|(_, c)| an.process(c, &p).is_some()).map(|(i, _)| (i + 1) as f64 * HOP as f64 / sr as f64).collect();
        grid(&kicks, an.beat.period).map_or((0.0, 0.0), |(p, a)| (60.0 / p, a.rem_euclid(p)))
    }

    #[test]
    fn andamento_constante_da_um_trecho_igual_ao_de_antes() {
        let casos = [
            crate::synth::Synth { bpm: 147.3, secs: 180.0, start: 0.37, ..Default::default() },
            // hostil: jitter, chimbal no contratempo e breakdown de 30 s sem kick
            crate::synth::Synth { bpm: 142.0, secs: 180.0, start: 1.2, jitter_ms: 4.0, hats: 0.4, breakdown: Some((70.0, 100.0)), seed: 7, ..Default::default() },
        ];
        for s in casos {
            let x = s.stereo().0;
            let info = analyze(&x, 48000, 135.0, 150.0);
            let (bpm, anchor) = grade_antiga(&x, 48000, 135.0, 150.0);
            assert_eq!(info.tempo, vec![Seg { t: 0.0, bpm, anchor }], "{} BPM", s.bpm);
            assert_eq!((info.bpm, info.anchor), (bpm, anchor));
        }
    }

    #[test]
    fn mapa_acompanha_troca_de_andamento_sem_pular_beat() {
        let seca = crate::synth::Synth { bpm: 140.0, change: Some((60.0, 146.0)), secs: 150.0, start: 0.37, jitter_ms: 2.0, hats: 0.3, ..Default::default() };
        // a troca acontece no meio de um breakdown sem kick (60–90 s)
        let no_break = crate::synth::Synth { change: Some((75.0, 146.0)), breakdown: Some((60.0, 90.0)), seed: 3, ..seca };
        for s in [seca, no_break] {
            mapa_caso(&s);
        }
    }

    fn mapa_caso(s: &crate::synth::Synth) {
        let (x, truth) = s.stereo();
        let info = analyze(&x, 48000, 135.0, 150.0);
        println!("{:?}", info.tempo);
        assert_eq!(info.tempo.len(), 2, "{:?}", info.tempo);
        assert!((info.tempo[0].bpm - 140.0).abs() < 0.05 && (info.tempo[1].bpm - 146.0).abs() < 0.05, "{:?}", info.tempo);
        let troca = *truth.iter().find(|&&k| k >= s.change.unwrap().0).unwrap();
        assert!((info.tempo[1].t - troca).abs() < 60.0 / 140.0, "trecho começa em {} (troca em {troca})", info.tempo[1].t);
        assert_eq!((info.bpm, info.anchor), (info.tempo[0].bpm, info.tempo[0].anchor));
        // o relógio da reprodução segue o mapa: cada kick cai num beat e o índice anda de 1 em 1
        let mut b = beat::Beat::default();
        b.set_map(info.tempo.iter().map(|g| (g.t, g.anchor, 60.0 / g.bpm)).collect());
        let mut prev: Option<(f64, i64)> = None;
        for &k in &truth {
            b.tick(k);
            let (bpm, ph, i) = b.at(k + 0.03); // logo depois do kick
            let fase = ph as f64 - 0.03 * bpm as f64 / 60.0;
            assert!(fase.abs() < 0.04, "kick {k:.3}: fase {fase:.3}");
            assert!((bpm as f64 - if k < troca { 140.0 } else { 146.0 }).abs() < 0.1 || (k - troca).abs() < 1.0, "kick {k:.3}: {bpm}");
            if let Some((t, p)) = prev.filter(|p| k - p.0 < 1.0) {
                assert_eq!(i, p + 1, "kick {k:.3}: beat pulou de {p} ({t:.3}) para {i}");
            }
            prev = Some((k, i));
        }
        assert!((b.period - 60.0 / 146.0).abs() < 1e-3, "tick não passou ao trecho novo");
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
