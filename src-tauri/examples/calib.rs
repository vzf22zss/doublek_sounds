//! Calibração com uma faixa real (docs/quality/DETECCAO.md §4.10):
//!   cargo run --release --example calib -- faixa.mp3 pasta_de_saida [bpm_min bpm_max]
//! Grava em `pasta_de_saida`:
//! - `frames.jsonl`: os quadros do motor como no roteiro (`audio::play`: mapa da faixa, um quadro a cada 2 hops);
//! - `live.jsonl`: os mesmos quadros sem o mapa, como ao vivo (o detector acha a grade sozinho); com `DK_MIC=1`, o som
//!   passa antes por um "microfone ouvindo a caixa": passa-altas 150 Hz, passa-baixas 8 kHz, −15 dB e ruído de fundo;
//! - `truth.json`: a "verdade" tirada do áudio inteiro, sem pressa e olhando para frente: inícios de kick, chimbal e
//!   baixo, e energia por banda em blocos de 10 ms (para o espectrograma e os trechos).
//! O resto (comparar, desenhar) é do `scripts/calib/`.

use doublek_lib::analysis::{Analyzer, Params, HOP};
use std::io::Write;

const BLK: f64 = 0.002; // s: resolução dos envelopes da verdade
const SPEC_DT: f64 = 0.01; // s: coluna do espectrograma
const SPEC_BANDS: usize = 48; // 30 Hz–16 kHz, log

/// Filtro de 1 polo (passa-baixas; passa-altas = x − lp).
struct Lp(f32, f32);
impl Lp {
    fn new(fc: f32, sr: f32) -> Self {
        Self(1.0 - (-2.0 * std::f32::consts::PI * fc / sr).exp(), 0.0)
    }
    fn run(&mut self, x: f32) -> f32 {
        self.1 += self.0 * (x - self.1);
        self.1
    }
}

/// Picos da subida de um envelope (não causal): máximo local em ±`win` s acima de `k` × mediana móvel de 2 s + piso.
fn onsets(rise: &[f32], dt: f64, win: f64, k: f32, floor: f32) -> Vec<(f64, f32)> {
    let w = (win / dt) as usize;
    let m = (1.0 / dt) as usize;
    let mut out = vec![];
    for i in w..rise.len().saturating_sub(w) {
        let r = rise[i];
        if r <= floor || rise[i - w..=i + w].iter().any(|&x| x > r) {
            continue;
        }
        let lo = i.saturating_sub(m);
        let hi = (i + m).min(rise.len());
        let mut v: Vec<f32> = rise[lo..hi].to_vec();
        v.sort_by(|a, b| a.total_cmp(b));
        if r > k * v[v.len() / 2] + floor {
            out.push((i as f64 * dt, r));
        }
    }
    out
}

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let (path, out) = (&a[0], std::path::Path::new(&a[1]));
    let lo: f32 = a.get(2).map_or(80.0, |s| s.parse().unwrap());
    let hi: f32 = a.get(3).map_or(220.0, |s| s.parse().unwrap());
    std::fs::create_dir_all(out).unwrap();
    let (stereo, sr) = doublek_lib::track::decode(std::path::Path::new(path)).expect("não consegui abrir a faixa");
    let info = doublek_lib::track::analyze(&stereo, sr, lo, hi);
    let mono: Vec<f32> = stereo.chunks_exact(2).map(|f| 0.5 * (f[0] + f[1])).collect();
    eprintln!("{:.0} s, {sr} Hz, mapa: {:?}", mono.len() as f64 / sr as f64, info.tempo);

    // 1) quadros do motor, como em `audio::play` (o corte de ruído fica no padrão)
    let mut an = Analyzer::new(sr as f32);
    an.beat.set_map(info.tempo.iter().filter(|s| s.bpm > 0.0).map(|s| (s.t, s.anchor, 60.0 / s.bpm)).collect());
    let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
    let mut w = std::io::BufWriter::new(std::fs::File::create(out.join("frames.jsonl")).unwrap());
    let mut kick = 0f32;
    for (i, c) in mono.chunks_exact(HOP).enumerate() {
        if let Some(k) = an.process(c, &p) {
            kick = kick.max(k);
        }
        if i % 2 == 1 {
            let t = (i + 1) as f64 * HOP as f64 / sr as f64;
            let mut f = an.snapshot();
            f.kick = std::mem::take(&mut kick);
            f.pos = t;
            (f.bpm, f.beat_phase, f.beat) = an.beat.at(t);
            let mut v = serde_json::to_value(&f).unwrap();
            v.as_object_mut().unwrap().remove("spectrum");
            writeln!(w, "{v}").unwrap();
        }
    }
    drop(w);
    // ... e como ao vivo (microfone/placa): o mesmo áudio sem o mapa, o detector acha a grade sozinho
    let mut an = Analyzer::new(sr as f32);
    let mut w = std::io::BufWriter::new(std::fs::File::create(out.join("live.jsonl")).unwrap());
    let live: Vec<f32> = if std::env::var("DK_MIC").is_ok() {
        // 2 polos de passa-altas em 150 Hz (caixa pequena), 1 de passa-baixas em 8 kHz (microfone), −15 dB, ruído −60 dB
        let (mut h1, mut h2, mut l1) = (Lp::new(150.0, sr as f32), Lp::new(150.0, sr as f32), Lp::new(8000.0, sr as f32));
        let mut seed = 7u32;
        mono.iter()
            .map(|&x| {
                let a = x - h1.run(x);
                let b = a - h2.run(a);
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                0.18 * l1.run(b) + 0.001 * ((seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5)
            })
            .collect()
    } else {
        mono.clone()
    };
    for (i, c) in live.chunks_exact(HOP).enumerate() {
        if let Some(k) = an.process(c, &p) {
            kick = kick.max(k);
        }
        if i % 2 == 1 {
            let mut f = an.snapshot();
            f.kick = std::mem::take(&mut kick);
            f.pos = (i + 1) as f64 * HOP as f64 / sr as f64;
            let mut v = serde_json::to_value(&f).unwrap();
            v.as_object_mut().unwrap().remove("spectrum");
            writeln!(w, "{v}").unwrap();
        }
    }
    drop(w);

    // 2) envelopes por banda em blocos de 2 ms: sub < 100, baixo 100–250, médio 250–2k, click 2–6k, ar > 6k
    let srf = sr as f32;
    let (mut s1, mut s2, mut b1, mut c1, mut c2, mut a1) =
        (Lp::new(100.0, srf), Lp::new(100.0, srf), Lp::new(250.0, srf), Lp::new(2000.0, srf), Lp::new(6000.0, srf), Lp::new(6000.0, srf));
    let n = (BLK * sr as f64) as usize;
    let mut env: Vec<[f32; 5]> = vec![];
    let mut sm = [0f32; 5];
    let att = 1.0 - (-(BLK as f32) / 0.004).exp();
    let rel = 1.0 - (-(BLK as f32) / 0.03).exp();
    for c in mono.chunks(n) {
        let mut e = [0f32; 5];
        for &x in c {
            let sub = s2.run(s1.run(x));
            let low = b1.run(x);
            let lp2k = c1.run(x);
            let lp6k = c2.run(x);
            let hp6k = x - a1.run(x);
            let v = [sub, low - sub, lp2k - low, lp6k - lp2k, hp6k];
            for j in 0..5 {
                e[j] += v[j] * v[j];
            }
        }
        for j in 0..5 {
            let r = (e[j] / c.len() as f32).sqrt();
            sm[j] += (r - sm[j]) * if r > sm[j] { att } else { rel };
        }
        env.push(sm);
    }
    // subida em 10 ms (5 blocos), só a parte positiva
    let rise = |j: usize| -> Vec<f32> { (0..env.len()).map(|i| (env[i][j] - env[i.saturating_sub(5)][j]).max(0.0)).collect() };
    let (rs, rb, rc, ra) = (rise(0), rise(1), rise(3), rise(4));
    let pct = |v: &[f32], q: f32| {
        let mut s: Vec<f32> = v.iter().copied().filter(|&x| x > 0.0).collect();
        s.sort_by(|a, b| a.total_cmp(b));
        s.get(((s.len() as f32 * q) as usize).min(s.len().saturating_sub(1))).copied().unwrap_or(1e-6)
    };
    // kick: subida do sub com click junto (±12 ms); baixo: subida de 100–250 sem click; chimbal: subida do ar
    let sub_on = onsets(&rs, BLK, 0.06, 2.0, 0.05 * pct(&rs, 0.99));
    let click_near = |t: f64| {
        let i = (t / BLK) as usize;
        rc[i.saturating_sub(6)..(i + 6).min(rc.len())].iter().fold(0f32, |m, &x| m.max(x))
    };
    let cref = pct(&rc, 0.99);
    let sref = pct(&rs, 0.99);
    let kicks: Vec<(f64, f32, f32)> = sub_on.iter().map(|&(t, r)| (t, r / sref, click_near(t) / cref)).collect();
    let bass = onsets(&rb, BLK, 0.04, 2.0, 0.05 * pct(&rb, 0.99));
    let hats = onsets(&ra, BLK, 0.03, 2.5, 0.05 * pct(&ra, 0.99));
    let bref = pct(&rb, 0.99);
    let aref = pct(&ra, 0.99);

    // 3) espectrograma (FFT de 2048 a cada 10 ms) e energia por banda nessas colunas
    let fft_n = 2048;
    let fft = realfft::RealFftPlanner::<f32>::new().plan_fft_forward(fft_n);
    let hop = (SPEC_DT * sr as f64) as usize;
    let win: Vec<f32> = (0..fft_n).map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / fft_n as f32).cos()).collect();
    let bin_hz = sr as f32 / fft_n as f32;
    let edge = |j: usize| ((30.0 * (16000.0f32 / 30.0).powf(j as f32 / SPEC_BANDS as f32)) / bin_hz) as usize;
    let mut spec: Vec<Vec<u8>> = vec![];
    let (mut inp, mut buf) = (fft.make_input_vec(), fft.make_output_vec());
    let mut i = 0;
    while i + fft_n <= mono.len() {
        for k in 0..fft_n {
            inp[k] = mono[i + k] * win[k];
        }
        fft.process(&mut inp, &mut buf).unwrap();
        spec.push(
            (0..SPEC_BANDS)
                .map(|j| {
                    let (a, b) = (edge(j).max(1), edge(j + 1).max(edge(j).max(1) + 1).min(fft_n / 2 + 1));
                    let m: f32 = buf[a..b].iter().map(|c| c.norm()).fold(0.0, f32::max) * 4.0 / fft_n as f32;
                    (((20.0 * (m + 1e-9).log10() + 90.0) / 80.0).clamp(0.0, 1.0) * 255.0) as u8
                })
                .collect(),
        );
        i += hop;
    }
    let bands: Vec<[f32; 5]> = env.iter().step_by((SPEC_DT / BLK) as usize).copied().collect();

    let j = serde_json::json!({
        "sr": sr, "duration": mono.len() as f64 / sr as f64, "tempo": info.tempo,
        "kicks": kicks.iter().map(|k| [k.0, k.1 as f64, k.2 as f64]).collect::<Vec<_>>(),
        "bass": bass.iter().map(|b| [b.0, (b.1 / bref) as f64]).collect::<Vec<_>>(),
        "hats": hats.iter().map(|h| [h.0, (h.1 / aref) as f64]).collect::<Vec<_>>(),
        "specDt": SPEC_DT, "spec": spec, "bandsDt": SPEC_DT, "bands": bands,
    });
    std::fs::write(out.join("truth.json"), j.to_string()).unwrap();
    eprintln!("verdade: {} inícios de sub, {} de baixo, {} de chimbal", kicks.len(), bass.len(), hats.len());
}
