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
    let mut tempo = map_for(&kicks, an.beat.period, lo as f64, hi as f64);
    rephase(&mut tempo, &mono, sr);
    let (bpm, anchor) = tempo.first().map_or((0.0, 0.0), |s| (s.bpm, s.anchor));

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

/// Mapa de andamento dos kicks da faixa inteira; `p_end` = período do detector no fim da faixa. A grade global só
/// vale sem trecho nenhum com grade (poucos kicks).
fn map_for(kicks: &[f64], p_end: f64, lo: f64, hi: f64) -> Vec<Seg> {
    let Some((p, a)) = grid(kicks, p_end) else { return vec![] };
    tempo_map(kicks, lo, hi).unwrap_or(vec![Seg { t: 0.0, bpm: 60.0 / p, anchor: a.rem_euclid(p) }])
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
const RELATED: f64 = 0.01; // razão 3/2, 2… a menos de 1 %: mesmo andamento com outro padrão de kick

/// Mapa de andamento. Corta onde a grade do trecho atual (regressão que cresce kick a kick) para de
/// explicar `MISS` kicks seguidos, descarta trechos curtos e junta vizinhos de mesmo andamento.
/// `None` = nenhum trecho com grade (poucos kicks): aí vale a grade global.
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
    // trecho a 3/2, 2/3, 2× ou ½ do andamento principal (o mais longo) é outro padrão de kick (tercina, meio tempo)
    // na mesma música, não outro andamento: a música não salta nessas razões. Sai do mapa como um trecho curto, e a
    // grade do vizinho cobre o lugar dele (refazer a grade com os kicks dele punha o drop fora de fase)
    // andamento principal: o de mais tempo somado (o trecho longo pode chegar aqui em vários pedaços do mesmo BPM)
    let span = |p: &(usize, usize, (f64, f64))| kicks[p.1 - 1] - kicks[p.0];
    let total = |g: (f64, f64)| parts.iter().filter(|q| ((q.2 .0 - g.0) / g.0).abs() < SAME).map(span).sum::<f64>();
    let main = parts.iter().max_by(|a, b| total(a.2).total_cmp(&total(b.2)).then(span(a).total_cmp(&span(b)))).map(|p| p.2);
    if let Some(gd) = main {
        let pd = gd.0;
        parts.retain(|p| ![2.0 / 3.0, 1.5, 0.5, 2.0].iter().any(|r| (p.2 .0 / pd / r - 1.0).abs() < RELATED));
        // ... e trecho cujos kicks o período principal explica quase tão bem quanto o dele (na melhor fase: o detector
        // pode ter pego a nota do baixo num trecho e o kick no outro) não é outro andamento: é um trecho curto ou de
        // virada ajustado torto (chapati.mp3: 146,5 e 147,4 em trechos de uma música a 145)
        let on = |g: (f64, f64), ks: &[f64]| ks.iter().filter(|&&t| res(t, g) < beat::TOL).count();
        let best = |p: f64, ks: &[f64]| ks.iter().map(|&a| on((p, a), ks)).max().unwrap_or(0);
        parts.retain(|p| ((p.2 .0 - pd) / pd).abs() < SAME || (best(pd, &kicks[p.0..p.1]) as f64) < 0.8 * on(p.2, &kicks[p.0..p.1]) as f64);
    }
    let mut merged: Vec<(usize, usize, (f64, f64))> = vec![];
    for p in parts {
        match merged.last_mut() {
            Some(m) if ((p.2 .0 - m.2 .0) / m.2 .0).abs() < SAME => m.1 = p.1,
            _ => merged.push(p),
        }
    }
    // um trecho só também sai daqui, com a grade dos kicks dele. A grade global (todos os kicks) partia do período do
    // detector no FIM da faixa e da intro: a regressão travava torta e explicava 1 kick em 4 (Peyote, 148, saía 148,64;
    // Invasion, 145, saía 146,45) e a grade escorregava 1 beat a cada ~40 s
    if merged.is_empty() {
        return None;
    }
    // 4) trechos: cada um começa no 1º beat da grade dele no 1º kick; o índice continua o do trecho anterior
    let mut out: Vec<Seg> = vec![];
    for (i0, i1, g) in merged {
        let (p, a) = lock(&kicks[i0..i1], g.0).unwrap_or(g);
        let seg = match out.last() {
            None => Seg { t: 0.0, bpm: 60.0 / p, anchor: a.rem_euclid(p) },
            Some(prev) => {
                let t = a + ((kicks[i0] - a) / p).round() * p;
                let v = (t - prev.anchor) * prev.bpm / 60.0;
                // ≥ v − ¼: o índice volta no máximo ¼ de beat (o roteiro tolera, `jumped`), e na troca sem pausa v já é inteiro
                Seg { t, bpm: 60.0 / p, anchor: t - (v - 0.25).ceil() * p }
            }
        };
        out.push(seg);
    }
    Some(out)
}

/// Grade de um trecho pelos kicks dele: o período (±1 % em volta de `p0`) e a fase em que os kicks mais se
/// concentram (vetor médio), depois a regressão nos kicks dessa grade. A `grid` crescendo a partir de um kick qualquer
/// travava torta quando ele era uma nota do baixo fora do beat (Peyote, 148: 147,87).
fn lock(ks: &[f64], p0: f64) -> Option<(f64, f64)> {
    let tau = 2.0 * std::f64::consts::PI;
    let (mut r, mut p, mut ph) = (0.0, p0, 0.0);
    for i in -200..=200 {
        let q = p0 * (1.0 + i as f64 * 5e-5); // passo de 0,005 %: 1/40 de beat em ~500 beats
        let (c, s) = ks.iter().fold((0.0, 0.0), |(c, s), &t| (c + (tau * t / q).cos(), s + (tau * t / q).sin()));
        if c.hypot(s) > r {
            (r, p, ph) = (c.hypot(s), q, s.atan2(c));
        }
    }
    beat::fit(ks, p, Some(ph / tau * p), false).map(|(p, a, _, _)| (p, a))
}

const PH_BINS: usize = 40;

/// Fase (em beats, −½..½) em que o grave (< 250 Hz) mais sobe, dobrada sobre a grade do mapa: onde o kick cai de fato.
fn kick_phase(mono: &[f32], sr: u32, tempo: &[Seg]) -> f64 {
    let blk = (0.002 * sr as f64) as usize;
    let k = 1.0 - (-2.0 * std::f32::consts::PI * 250.0 / sr as f32).exp();
    let a = 1.0 - (-2.0f32 / 15.0).exp(); // envelope de ~15 ms sobre blocos de 2 ms
    let (mut lp, mut env, mut prev, mut acc) = (0f32, 0f32, 0f32, [0f64; PH_BINS]);
    for (i, c) in mono.chunks(blk).enumerate() {
        let mut e = 0f32;
        for &s in c {
            lp += k * (s - lp);
            e += lp * lp;
        }
        env += (e / c.len() as f32 - env) * a;
        let r = env.sqrt();
        let t = (i * blk) as f64 / sr as f64;
        if let Some(s) = tempo.iter().rev().find(|s| s.t <= t).or(tempo.first()) {
            let x = ((t - s.anchor) * s.bpm / 60.0).rem_euclid(1.0);
            acc[(x * PH_BINS as f64) as usize % PH_BINS] += (r - prev).max(0.0) as f64;
        }
        prev = r;
    }
    let sm = |b: usize| acc[(b + PH_BINS - 1) % PH_BINS] + 2.0 * acc[b] + acc[(b + 1) % PH_BINS];
    let x = ((0..PH_BINS).max_by(|&a, &b| sm(a).total_cmp(&sm(b))).unwrap_or(0) as f64 + 0.5) / PH_BINS as f64;
    if x > 0.5 { x - 1.0 } else { x }
}

/// No psy o detector às vezes trava na última nota do baixo rolante antes do kick, e o kick de verdade cai no
/// refratário dela: a grade inteira fica ~¼ de beat adiantada e a logo pulsa antes do kick. Com a faixa inteira à
/// mão, a fase do kick sai da subida do grave dobrada sobre a grade. Mais de ⅛ de beat fora: desloca o mapa todo
/// (o mesmo Δ em cada trecho: os índices dos beats não mudam).
fn rephase(tempo: &mut [Seg], mono: &[f32], sr: u32) {
    let Some(p) = tempo.first().map(|s| 60.0 / s.bpm) else { return };
    let d = kick_phase(mono, sr, tempo);
    if d.abs() > 0.125 {
        for (i, s) in tempo.iter_mut().enumerate() {
            s.anchor += d * p;
            if i > 0 {
                s.t += d * p;
            }
        }
    }
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
            // a mesma grade (não os mesmos bits: a grade do trecho sai da fase dos kicks, a antiga da regressão global)
            let same = |s: &Seg| s.t == 0.0 && (s.bpm - bpm).abs() < 0.005 && (s.anchor - anchor).abs() < 0.002;
            assert!(info.tempo.len() == 1 && same(&info.tempo[0]), "{} BPM: {:?} × {bpm} {anchor}", s.bpm, info.tempo);
            assert_eq!((info.bpm, info.anchor), (info.tempo[0].bpm, info.tempo[0].anchor));
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

    /// Kicks que `analyze` acha (detector sem mapa) numa faixa real inteira de psy a 145 BPM constante (chapati.mp3), com
    /// intro de kick em tercina (a cada ⅔ de beat = "217 BPM") e depois a cada 2 beats: o mapa dava 217 até os 55 s e
    /// a logo pulsava 3× por kick; depois, trechos espúrios de 146,5 e 147,4 no breakdown. Agora é a música toda a 145.
    #[test]
    fn mapa_nao_troca_para_tercina_nem_meio_tempo() {
        const KS: &str = concat!(
            "0.213 0.629 1.045 1.323 1.600 1.867 2.144 2.421 2.699 2.976 3.253 3.531 4.085 4.352 4.629 6.837 7.392 7.659 ",
            "7.936 8.491 8.768 9.045 9.323 9.600 9.867 10.144 10.699 11.819 13.461 15.680 15.947 17.323 17.600 18.453 ",
            "19.200 19.968 20.213 20.491 20.907 21.184 21.611 21.867 22.144 22.421 22.848 23.115 23.392 26.560 28.256 ",
            "28.501 29.195 31.104 31.520 33.611 34.005 35.531 36.096 38.155 39.605 39.829 40.843 41.664 41.899 42.293 ",
            "42.720 43.947 44.139 44.352 44.565 45.397 48.011 50.389 54.293 54.699 54.976 55.253 55.531 55.808 56.213 ",
            "56.491 57.888 59.243 60.352 60.928 61.173 61.749 62.016 62.560 62.848 63.403 63.680 64.235 64.491 65.067 ",
            "65.312 65.749 68.235 68.651 69.056 69.472 70.027 70.293 70.603 72.224 72.512 73.344 73.611 73.920 74.443 ",
            "74.837 75.264 75.680 76.085 76.491 76.917 77.312 77.749 78.144 78.581 78.976 79.403 79.797 80.224 80.651 ",
            "81.451 81.888 82.283 82.720 83.125 83.947 84.800 86.037 86.421 86.848 87.243 87.680 88.075 88.491 88.907 ",
            "89.312 89.728 90.144 90.560 90.976 91.552 91.968 92.352 92.789 93.205 93.611 94.027 94.443 94.859 95.275 ",
            "95.669 96.096 96.491 96.928 97.333 97.760 98.165 98.560 98.976 99.403 99.829 100.235 100.640 101.056 101.461 ",
            "101.888 102.283 102.699 103.136 103.531 103.968 104.352 104.779 105.600 106.027 106.453 106.859 107.285 ",
            "107.701 108.117 108.480 108.939 110.592 111.424 111.829 112.629 113.749 114.165 114.581 114.997 115.403 ",
            "115.819 116.213 116.373 116.651 117.056 117.451 117.888 118.304 118.709 119.125 119.531 119.936 120.352 ",
            "120.768 121.195 121.611 122.027 122.432 122.848 123.243 123.680 124.075 124.512 124.917 125.333 125.728 ",
            "126.155 126.560 126.976 127.381 127.819 128.213 128.629 129.045 129.451 129.888 130.283 130.720 131.125 ",
            "131.541 131.947 132.352 132.779 133.173 133.611 134.005 134.432 134.859 135.253 135.659 136.491 137.323 ",
            "137.728 138.560 139.392 139.808 140.213 140.629 141.045 141.461 141.877 142.283 142.699 143.115 143.531 ",
            "143.936 146.005 146.443 146.837 147.243 147.659 148.053 148.491 148.853 149.312 149.675 150.144 150.581 ",
            "150.965 151.819 152.235 154.293 155.125 155.541 155.957 156.779 158.987 159.243 159.691 160.096 160.501 ",
            "160.907 161.355 161.728 162.165 162.560 163.381 163.819 164.213 164.672 165.045 165.472 165.867 166.304 ",
            "166.699 167.115 167.520 167.947 168.352 168.779 169.173 170.005 170.432 170.837 171.659 172.096 172.491 ",
            "172.907 173.312 173.749 174.144 174.603 174.976 175.403 175.797 176.235 176.629 177.035 177.451 177.877 ",
            "178.283 178.720 179.104 179.520 179.936 180.352 180.768 180.928 181.323 181.760 182.165 182.560 182.987 ",
            "183.392 183.819 184.213 184.629 185.045 185.483 186.251 187.072 187.488 187.893 188.267 188.747 189.120 ",
            "189.440 190.293 190.635 190.901 191.381 191.691 192.960 194.624 194.933 196.203 197.131 198.389 198.763 ",
            "199.541 200.480 200.949 203.093 203.435 203.605 204.053 204.277 204.565 205.355 205.899 206.347 207.232 ",
            "207.499 208.416 209.771 210.101 210.613 211.957 215.883 216.704 217.013 217.525 218.357 218.560 219.499 ",
            "220.011 220.213 220.533 220.832 221.056 221.355 221.664 221.877 222.176 222.485 222.709 223.008 223.317 ",
            "223.531 223.840 224.149 224.352 224.661 224.971 225.184 226.325 226.741 226.944 227.147 227.467 227.669 ",
            "228.277 229.632 229.941 230.155 230.784 231.072 231.285 231.723 233.355 234.400 234.592 235.733 236.363 ",
            "236.565 237.387 237.717 240.512 240.928 241.344 242.155 242.581 242.997 243.360 243.808 244.224 245.045 ",
            "245.451 245.899 246.283 246.688 247.104 247.552 247.936 248.384 249.600 250.005 250.432 251.264 251.669 ",
            "252.107 252.523 252.939 253.312 253.728 253.931 254.144 254.357 254.560 256.032 258.304 258.741 260.555 ",
            "262.005 263.029 263.349 263.563 263.765 264.384 264.907 265.227 265.643 266.059 266.368 266.880 267.296 ",
            "267.712 268.128 268.533 268.949 269.323 269.771 270.155 270.539 271.019 271.787 272.256 272.640 273.088 ",
            "273.504 273.920 274.325 274.741 275.157 275.573 275.989 276.363 276.811 277.227 277.643 282.187 282.571 ",
            "283.019 283.435 283.851 284.672 285.067 285.515 285.920 286.325 286.741 287.157 287.979 288.427 290.869 ",
            "292.117 292.949 293.365 293.771 294.187 294.603 295.019 295.851 296.256 296.672 297.088 297.504 298.325 ",
            "299.157 299.989 300.811 301.227 301.643 302.048 302.464 302.880 303.296 303.712 304.128 304.533 305.355 ",
            "306.187 306.603 307.435 307.840 308.256 309.088 309.909 310.325 310.741 311.563 313.227 313.643 314.037 ",
            "314.869 316.523 317.355 317.760 319.019 319.424 319.840 320.256 320.672 321.088 321.504 322.325 322.741 ",
            "323.157 323.563 323.979 324.395 324.811 325.184 325.632 326.048 326.464 326.880 327.285 327.701 328.117 ",
            "328.949 329.355 329.771 330.187 330.603 332.672 333.493 333.909 334.325 334.741 335.563 335.979 336.395 ",
            "336.811 337.227 338.869 339.285 339.701 340.117 340.523 340.939 341.355 342.187 342.592 343.008 343.424 ",
            "343.840 344.256 344.672 345.088 345.493 345.941 346.325 346.741 347.147 347.531 347.979 348.363 348.811 ",
            "349.184 350.016 350.859 351.285 351.648 353.365 354.187 355.019 355.808 356.672 357.504 359.989 360.395 ",
            "360.811 361.216 361.632 362.048 362.464 362.880 363.253 363.701 364.117 364.544 364.960 365.365 365.781 ",
            "366.187 366.603 367.029 367.424 367.840 368.256 369.099 369.920 372.021 373.653 374.496 375.093 375.499 ",
            "375.883 376.309 376.672 377.067"
        );
        let ks: Vec<f64> = KS.split(' ').map(|s| s.parse().unwrap()).collect();
        let segs = tempo_map(&ks, 80.0, 220.0).unwrap_or_else(|| vec![Seg { t: 0.0, bpm: 60.0 / grid(&ks, 60.0 / 145.0).unwrap().0, anchor: 0.0 }]);
        assert!(segs.iter().all(|s| (s.bpm - 145.0).abs() < 0.3), "{segs:?}");
        // andamento de verdade diferente (140 → 146) continua virando dois trechos
        let mut ks: Vec<f64> = (0..200).map(|i| i as f64 * 60.0 / 140.0).collect();
        let t = ks.last().unwrap() + 60.0 / 146.0;
        ks.extend((0..200).map(|i| t + i as f64 * 60.0 / 146.0));
        assert_eq!(tempo_map(&ks, 80.0, 220.0).map(|s| s.len()), Some(2));
    }

    /// Grade ~0,3 beat antes do kick (o que o detector fez com chapati.mp3, travado no baixo rolante): `rephase` põe o
    /// mapa de volta no kick. Grade já certa não mexe.
    #[test]
    fn mapa_volta_para_o_kick() {
        let s = crate::synth::Synth { bpm: 145.0, secs: 60.0, start: 0.4, ..Default::default() };
        let (x, truth) = s.stereo();
        let mono: Vec<f32> = x.chunks_exact(2).map(|f| 0.5 * (f[0] + f[1])).collect();
        let p = 60.0 / 145.0;
        let certa = vec![Seg { t: 0.0, bpm: 145.0, anchor: truth[0] }];
        let mut t = certa.clone();
        rephase(&mut t, &mono, 48000);
        assert_eq!(t, certa, "grade certa mudou");
        for off in [-0.3, 0.3, 0.45] {
            let mut t = vec![Seg { t: 0.0, bpm: 145.0, anchor: truth[0] + off * p }, Seg { t: 30.0, bpm: 145.0, anchor: truth[0] + off * p }];
            rephase(&mut t, &mono, 48000);
            let err = |a: f64| ((a - truth[0]) / p + 0.5).rem_euclid(1.0) - 0.5;
            assert!(err(t[0].anchor).abs() < 0.06 && err(t[1].anchor).abs() < 0.06, "{off}: {t:?}");
            assert!((t[1].t - (30.0 - off * p)).abs() < 0.06 * p, "{off}: trecho 2 não andou junto: {t:?}");
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

    /// TAP, ½×, 2× e ±fase durante a reprodução pelo app: `play_track` manda sempre um mapa (1 trecho se o BPM é
    /// constante) e os comandos têm de valer como valiam com a grade fixa de antes.
    #[test]
    fn comandos_do_operador_valem_com_o_mapa() {
        type Cmd = fn(&mut beat::Beat);
        let cmds: [(&str, Cmd); 4] = [
            ("nudge", |b| b.nudge(0.05)),
            ("2×", |b| b.scale_tempo(2.0)),
            ("½×", |b| b.scale_tempo(0.5)),
            ("tap", |b| [10.0, 10.4, 10.8, 11.2].into_iter().for_each(|t| b.tap(t))),
        ];
        for (nome, cmd) in cmds {
            let (mut antes, mut mapa) = (beat::Beat::default(), beat::Beat::default());
            antes.set_grid(0.1, 0.42);
            mapa.set_map(vec![(0.0, 0.1, 0.42)]);
            for b in [&mut antes, &mut mapa] {
                b.tick(5.0);
                cmd(b);
            }
            for t in [12.0, 30.0, 61.3] {
                antes.tick(t);
                mapa.tick(t);
                assert_eq!(mapa.at(t), antes.at(t), "{nome} em {t} s");
            }
        }
        // com 2 trechos, ±fase arrasta o mapa inteiro
        let mut b = beat::Beat::default();
        b.set_map(vec![(0.0, 0.1, 0.42), (20.0, 20.0 - 47.0 * 0.4, 0.4)]);
        b.nudge(0.05);
        b.tick(30.0);
        let x: f64 = (30.0 - (20.05 - 47.0 * 0.4)) / 0.4;
        assert!((b.at(30.0).1 as f64 - (x - x.floor())).abs() < 1e-4, "nudge não arrastou o 2º trecho: {:?}", b.at(30.0));
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

    /// Kicks que `analyze` acha numa faixa real de psy a 148 BPM constante (Peyote, GMS Remix): o mapa saía com um trecho
    /// só e caía na grade global, que parte do período do detector no fim da faixa (148,585, no outro) e da intro; a
    /// regressão travava em 148,64 explicando 1 kick em 4, e a grade escorregava 1 beat a cada ~40 s.
    #[test]
    fn mapa_de_um_trecho_usa_a_grade_dos_kicks_dele() {
        const KS: &[&str] = &[
            "0.046 2.159 3.634 4.888 5.492 5.666 6.072 6.362 6.548 6.745 7.755 7.988 8.429 9.392 9.718 11.006 11.180 ",
            "12.086 13.166 13.328 13.839 14.002 14.640 17.473 18.460 19.470 20.283 20.503 20.689 21.095 21.537 21.908 ",
            "25.972 26.297 26.703 26.993 27.214 27.609 28.015 28.421 28.828 29.234 29.594 29.826 30.047 30.232 30.453 ",
            "30.813 31.103 31.451 31.660 31.858 32.067 32.264 32.485 32.670 33.088 33.297 33.576 33.890 34.099 34.296 ",
            "34.505 34.702 34.911 35.097 35.318 35.515 36.014 36.316 36.525 36.722 37.129 37.349 37.535 37.756 37.953 ",
            "38.394 38.754 38.963 39.160 39.369 39.567 39.776 39.962 40.380 40.588 40.879 41.181 41.390 41.587 41.808 ",
            "41.993 42.214 42.400 42.620 42.818 43.305 43.619 43.828 44.025 44.234 44.431 44.640 44.826 45.047 45.244 ",
            "45.720 46.022 46.219 46.428 46.626 46.858 47.032 47.462 47.659 47.856 48.158 48.367 48.565 48.866 49.075 ",
            "49.273 49.482 49.679 49.888 50.085 50.283 50.596 50.898 51.096 51.328 51.897 52.152 52.338 52.651 53.058 ",
            "53.464 53.766 53.963 54.172 54.370 54.579 54.764 54.985 55.171 55.577 55.983 56.390 56.796 57.098 57.609 ",
            "58.015 58.421 58.642 58.828 59.037 59.234 59.443 59.629 59.838 60.360 60.767 61.068 61.254 61.475 61.661 ",
            "62.067 62.473 62.880 63.274 63.681 64.087 64.493 64.900 65.306 65.712 66.119 66.525 66.932 67.326 67.733 ",
            "68.139 68.545 68.952 69.358 69.764 70.171 70.577 70.983 71.390 71.796 72.202 72.597 73.004 73.410 73.816 ",
            "74.223 74.629 75.035 75.442 75.836 76.243 76.637 77.137 77.334 77.845 78.274 78.681 79.087 79.494 79.900 ",
            "80.295 80.713 81.119 81.525 81.932 82.326 82.733 83.139 83.545 83.952 84.358 84.764 85.159 85.577 85.983 ",
            "86.390 86.796 87.203 87.597 88.004 88.410 88.816 89.223 89.629 90.035 90.442 90.848 91.254 91.661 92.067 ",
            "92.462 92.868 93.275 93.681 94.087 94.494 94.900 95.306 95.713 96.119 96.525 96.932 97.326 97.733 98.151 ",
            "98.557 98.952 99.358 99.765 100.159 100.554 100.960 101.367 101.796 103.793 104.223 104.629 105.024 105.430 ",
            "105.848 106.255 106.661 107.067 107.462 107.868 108.275 108.681 109.087 109.494 109.900 110.306 110.713 ",
            "111.119 111.525 111.932 112.327 112.733 113.139 113.546 113.952 114.358 114.765 115.159 115.577 115.984 ",
            "116.390 116.796 117.597 118.004 118.410 118.817 119.223 119.629 120.036 120.442 120.848 121.255 121.661 ",
            "122.067 122.462 122.868 123.275 123.693 124.087 124.494 124.900 125.306 125.713 126.119 126.526 126.932 ",
            "127.327 127.745 128.139 128.522 128.952 129.347 130.148 130.566 130.961 131.367 131.773 132.145 132.574 ",
            "132.981 133.410 133.817 134.223 134.629 135.024 135.430 135.848 136.243 136.661 137.067 137.462 137.868 ",
            "138.275 138.681 139.088 139.494 139.889 140.295 140.713 141.119 141.526 141.932 142.327 142.733 143.139 ",
            "143.546 143.952 144.765 145.160 145.578 145.984 146.390 146.785 147.191 147.598 148.004 148.410 148.817 ",
            "149.223 149.629 150.024 150.442 150.848 151.255 151.661 152.056 152.474 152.880 153.287 153.658 154.088 ",
            "154.471 154.865 155.272 155.713 156.085 156.514 156.920 157.315 158.128 158.523 158.929 160.148 160.554 ",
            "160.961 161.355 161.762 162.075 162.470 162.783 162.981 163.190 163.596 164.003 164.606 165.407 165.849 ",
            "166.255 166.661 167.068 167.462 167.869 168.275 168.681 169.088 169.494 169.889 170.307 170.713 171.119 ",
            "171.526 171.932 172.327 172.733 173.140 173.546 173.952 174.359 174.765 175.171 175.578 175.984 176.390 ",
            "176.797 177.191 177.598 178.004 178.411 178.817 179.223 179.630 180.024 180.442 180.849 181.255 181.661 ",
            "182.056 182.462 182.880 183.287 183.681 184.088 184.494 184.900 185.307 185.713 186.120 186.526 186.932 ",
            "187.339 187.745 188.151 188.558 189.347 189.753 190.195 190.578 190.949 191.367 191.797 192.192 192.598 ",
            "193.004 193.411 193.817 194.223 194.618 195.024 195.442 195.849 196.255 196.476 196.661 197.056 197.462 ",
            "197.869 198.275 198.682 199.088 199.494 199.901 200.307 200.713 201.108 201.526 201.921 202.327 202.733 ",
            "203.546 203.952 204.336 205.172 205.578 205.973 206.391 206.797 207.192 207.598 208.004 208.411 208.817 ",
            "209.212 209.630 210.024 210.849 211.255 211.661 212.056 212.463 212.881 213.275 213.682 214.088 214.483 ",
            "214.901 215.307 215.888 216.085 216.491 217.339 218.546 218.953 219.359 219.754 220.172 220.578 220.984 ",
            "221.391 221.797 222.192 222.598 223.004 223.411 223.817 224.223 224.630 225.036 225.443 225.849 226.255 ",
            "226.662 227.056 227.463 228.275 228.682 229.494 229.912 230.284 231.120 231.526 231.921 232.327 232.734 ",
            "233.140 233.546 233.953 234.359 234.754 235.160 235.578 235.984 236.391 236.785 237.203 237.598 238.016 ",
            "238.411 238.817 239.224 239.618 240.025 240.431 240.826 241.232 241.638 242.033 242.463 242.881 243.287 ",
            "244.866 245.319 245.690 246.491 247.316 248.036 248.361 250.207 251.379 252.145 252.540 252.738 253.713 ",
            "254.189 254.467 254.758 255.002 255.919 257.022 257.474 257.904 258.334 258.728 259.123 259.495 260.214 ",
            "260.551 260.876 261.190 261.503 262.107 262.385 262.653 262.908 263.163 263.396 263.628 265.474 265.648 ",
            "265.903 266.182 266.414 266.867 267.343 267.981 268.353 268.550 268.748 268.992 269.201 270.443 270.663 ",
            "270.849 271.070 271.256 271.476 271.662 271.882 272.068 272.382 272.881 273.101 273.287 273.496 273.694 ",
            "273.903 274.088 274.297 274.495 274.901 275.307 275.528 275.714 275.934 276.120 276.341 276.526 276.735 ",
            "276.933 277.339 277.745 278.152 278.547 278.953 279.359 279.754 280.172 280.578 280.985 281.391 281.786 ",
            "282.169 282.598 283.005 283.411 283.818 284.224 284.630 285.037 285.443 285.849 286.256 286.662 287.057 ",
            "287.475 287.869 288.287 288.682 289.088 289.495 289.901 290.307 290.714 291.120 291.503 291.921 292.328 ",
            "292.734 293.129 293.930 294.348 294.754 295.149 295.578 295.985 296.391 296.786 297.192 297.599 298.005 ",
            "298.411 298.818 299.224 299.619 300.037 300.443 300.849 301.256 301.650 302.057 302.463 302.869 303.276 ",
            "303.682 304.089 304.483 304.890 305.308 305.714 306.120 306.515 306.921 307.328 307.734 308.117 308.547 ",
            "308.953 309.359 309.766 310.172 310.579 310.985 311.380 311.786 312.192 312.599 313.005 313.411 313.818 ",
            "314.224 314.619 315.037 315.443 315.849 316.244 316.651 317.057 317.475 317.870 318.253 318.682 319.077 ",
            "319.460 319.866 320.284 320.714 321.120 321.527 321.921 322.328 322.734 323.140 323.547 323.953 324.348 ",
            "324.754 325.172 325.579 325.985 326.391 326.786 327.192 327.599 328.005 328.411 328.818 329.224 329.630 ",
            "330.037 330.443 330.838 331.256 331.651 332.057 332.463 332.870 333.276 333.682 334.065 334.495 335.308 ",
            "335.702 336.120 336.527 336.922 337.328 337.746 338.141 338.547 338.942 339.348 339.766 340.172 340.579 ",
            "340.985 341.391 341.786 342.192 342.599 343.005 343.412 343.818 344.224 344.631 345.037 345.443 347.069 ",
            "347.463 347.870 348.276 348.682 349.089 349.484 349.901 350.308 350.714 351.121 351.515 351.922 352.328 ",
            "352.734 353.141 353.547 353.953 354.348 354.766 355.579 355.985 356.391 356.786 357.193 357.599 358.005 ",
            "358.412 358.818 359.224 360.002 360.443 360.850 361.256 361.651 362.057 362.463 362.870 363.276 363.683 ",
            "364.089 364.495 364.902 365.308 365.714 366.121 366.515 366.922 367.328 367.734 368.141 368.547 368.953 ",
            "369.348 369.755 370.173 370.567 370.974 371.380 372.216 372.576 372.982 373.412 373.818 374.224 374.619 ",
            "375.037 375.443 375.850 376.256 376.651 377.057 377.464 377.870 378.276 378.683 379.089 379.484 379.902 ",
            "380.308 380.714 381.121 381.515 381.922 382.328 382.735 383.141 383.547 383.954 384.348 384.766 385.173 ",
            "385.579 385.985 386.392 386.786 387.193 387.599 388.005 388.412 388.818 389.224 389.631 390.037 390.444 ",
            "390.850 391.256 391.651 392.057 392.475 392.870 393.288 393.683 394.089 394.495 394.902 395.308 395.714 ",
            "396.109 396.527 396.934 397.328 397.746 398.129 398.547 399.766 400.161 400.567 401.369 401.821 402.588 ",
            "402.994 403.400 404.573",
        ];
        let ks: Vec<f64> = KS.iter().flat_map(|l| l.split_whitespace()).map(|s| s.parse().unwrap()).collect();
        let m = map_for(&ks, 60.0 / 148.585, 80.0, 220.0);
        assert_eq!(m.len(), 1, "{m:?}");
        assert!((m[0].bpm - 148.0).abs() < 0.02, "{m:?}");
        // na grade do mapa, 3 em 4 kicks a menos de 0,12 beat (com 148,64 eram 26 %)
        let p = 60.0 / m[0].bpm;
        let on = ks.iter().filter(|&&t| { let x = (t - m[0].anchor) / p; (x - x.round()).abs() < 0.12 }).count();
        assert!(on * 4 >= ks.len() * 3, "{on}/{}", ks.len());
    }
}
