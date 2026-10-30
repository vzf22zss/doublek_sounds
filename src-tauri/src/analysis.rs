//! Análise de áudio por blocos de HOP amostras (~5 ms a 48 kHz), independente da taxa de quadros.
//!
//! Kick = subida brusca no sub (35–100 Hz) junto com o "click" do ataque (2–6 kHz).
//! O baixo rolante do psytrance tem sub mas quase não tem click, então não dispara.
//! Com o andamento travado, candidatos fora da grade precisam ser bem mais fortes.

use crate::beat::Beat;
use realfft::{num_complex::Complex, RealFftPlanner, RealToComplex};
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;
use std::sync::Arc;

pub const HOP: usize = 256;
const FFT: usize = 2048;
const SPEC_BINS: usize = 64;
const MIN_RISE: f32 = 0.7; // ~3 dB: abaixo disso nunca é ataque

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Params {
    pub gain: f32,
    pub gate: f32,
    pub sens: f32,
    pub bpm_min: f32,
    pub bpm_max: f32,
    pub lock: bool,
    pub need_click: bool,
    pub drop_thr: f32, // grave atual / grave de referência acima disso = "tem grave" (drop)
}

impl Default for Params {
    fn default() -> Self {
        Self { gain: 1.0, gate: 0.003, sens: 1.4, bpm_min: 80.0, bpm_max: 220.0, lock: false, need_click: true, drop_thr: 0.35 }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BeatCmd {
    Tap,
    Half,
    Double,
    Nudge(f64),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub peak: f32,
    pub rms: f32,
    pub bands: [f32; 5], // sub, bass, mid, click, air — 0..1 (normalizado pelo pico recente)
    pub kick: f32,       // força do kick desde o último frame (0 = nenhum)
    pub bpm: f32,
    pub locked: bool,
    pub holding: bool,
    pub beat_phase: f32,
    pub beat: i64,
    pub flux: f32, // subida do sub e limiar atual, para o analisador
    pub thr: f32,
    pub spectrum: Vec<f32>,
    pub low: f32, // 1 = grave tocando (drop), 0 = breakdown sem grave
    pub pos: f64, // posição na faixa tocada pelo app (s); -1 = entrada ao vivo
}

#[derive(Clone, Copy)]
enum Kind {
    Lp,
    Hp,
    Bp,
}

/// Biquad RBJ (forma direta transposta II).
#[derive(Clone, Copy)]
struct Biquad {
    b: [f32; 3],
    a: [f32; 2],
    z: [f32; 2],
}

impl Biquad {
    fn new(kind: Kind, sr: f32, f: f32, q: f32) -> Self {
        let (s, c) = (2.0 * PI * f / sr).sin_cos();
        let al = s / (2.0 * q);
        let b = match kind {
            Kind::Lp => [(1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0],
            Kind::Hp => [(1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0],
            Kind::Bp => [al, 0.0, -al],
        };
        let a0 = 1.0 + al;
        Self { b: b.map(|x| x / a0), a: [-2.0 * c / a0, (1.0 - al) / a0], z: [0.0; 2] }
    }

    fn run(&mut self, x: f32) -> f32 {
        let y = self.b[0] * x + self.z[0];
        self.z[0] = self.b[1] * x - self.a[0] * y + self.z[1];
        self.z[1] = self.b[2] * x - self.a[1] * y;
        y
    }
}

/// Subida da energia (log) sobre os últimos 3 hops, com limiar adaptativo média + k·desvio.
#[derive(Default)]
struct Onset {
    hist: [f32; 3],
    mean: f32,
    var: f32,
}

impl Onset {
    fn step(&mut self, energy: f32, k: f32) -> (f32, f32) {
        let le = (energy + 1e-10).ln();
        let base = self.hist.iter().copied().fold(f32::INFINITY, f32::min);
        let rise = (le - base).max(0.0);
        let thr = (self.mean + k * self.var.sqrt()).max(MIN_RISE);
        const A: f32 = 0.005; // ~1 s
        let d = rise - self.mean;
        self.mean += A * d;
        self.var = (1.0 - A) * (self.var + A * d * d);
        self.hist = [self.hist[1], self.hist[2], le];
        (rise, thr)
    }
}

pub struct Analyzer {
    sr: f32,
    t: f64,
    pre: Biquad,
    filt: [Biquad; 7], // sub (2 estágios), bass, mid, click (2 estágios), air
    on_sub: Onset,
    on_click: Onset,
    sub_over: bool,
    last_click: f64,
    last_kick: f64,
    env: [f32; 5],
    env_peak: [f32; 5],
    peak: f32,
    rms: f32,
    flux: f32,
    thr: f32,
    low_lvl: f32, // grave (sub+bass) suavizado
    low_ref: f32, // maior grave recente, decai em ~1 min
    low_on: bool,
    pub beat: Beat,
    ring: Vec<f32>,
    ring_pos: usize,
    fft: Arc<dyn RealToComplex<f32>>,
    win: Vec<f32>,
    fin: Vec<f32>,
    fout: Vec<Complex<f32>>,
}

impl Analyzer {
    pub fn new(sr: f32) -> Self {
        let fft = RealFftPlanner::<f32>::new().plan_fft_forward(FFT);
        Self {
            sr,
            t: 0.0,
            pre: Biquad::new(Kind::Hp, sr, 25.0, 0.707),
            filt: [
                Biquad::new(Kind::Lp, sr, 100.0, 0.707),
                Biquad::new(Kind::Lp, sr, 100.0, 0.707),
                Biquad::new(Kind::Bp, sr, 160.0, 1.0),
                Biquad::new(Kind::Bp, sr, 700.0, 0.6),
                // click: passa-altas de 4ª ordem — com 2ª ordem o baixo alto vaza e parece ataque
                Biquad::new(Kind::Hp, sr, 2000.0, 0.707),
                Biquad::new(Kind::Hp, sr, 2000.0, 0.707),
                Biquad::new(Kind::Hp, sr, 6000.0, 0.707),
            ],
            on_sub: Onset::default(),
            on_click: Onset::default(),
            sub_over: false,
            last_click: -1.0,
            last_kick: -1.0,
            env: [0.0; 5],
            env_peak: [1e-4; 5],
            peak: 0.0,
            rms: 0.0,
            flux: 0.0,
            thr: 0.0,
            low_lvl: 0.0,
            low_ref: 1e-4,
            low_on: false,
            beat: Beat::default(),
            ring: vec![0.0; FFT],
            ring_pos: 0,
            win: (0..FFT).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / FFT as f32).cos()).collect(),
            fin: fft.make_input_vec(),
            fout: fft.make_output_vec(),
            fft,
        }
    }

    pub fn command(&mut self, c: BeatCmd) {
        match c {
            BeatCmd::Tap => self.beat.tap(self.t),
            BeatCmd::Half => self.beat.scale_tempo(0.5),
            BeatCmd::Double => self.beat.scale_tempo(2.0),
            BeatCmd::Nudge(dt) => self.beat.nudge(dt),
        }
    }

    /// Processa um hop. Devolve a força do kick (0.3..1) se detectou um.
    pub fn process(&mut self, x: &[f32], p: &Params) -> Option<f32> {
        let n = x.len() as f32;
        let (mut ms, mut pk, mut sq) = ([0f32; 5], 0f32, 0f32);
        for &s in x {
            let s = self.pre.run(s * p.gain);
            pk = pk.max(s.abs());
            sq += s * s;
            self.ring[self.ring_pos] = s;
            self.ring_pos = (self.ring_pos + 1) % FFT;
            let f = &mut self.filt;
            let sub = f[0].run(s);
            let sub = f[1].run(sub);
            let click = f[4].run(s);
            let b = [sub, f[2].run(s), f[3].run(s), f[5].run(click), f[6].run(s)];
            for i in 0..5 {
                ms[i] += b[i] * b[i];
            }
        }
        ms.iter_mut().for_each(|m| *m /= n);
        let dt = n / self.sr;
        self.t += dt as f64;
        let t = self.t;
        self.peak = pk;
        self.rms = (sq / n).sqrt();

        // envelopes por banda: ataque 5 ms, release 120 ms, normalizados pelo pico dos últimos ~4 s
        for i in 0..5 {
            let r = ms[i].sqrt();
            let tau = if r > self.env[i] { 0.005 } else { 0.12 };
            self.env[i] += (r - self.env[i]) * (1.0 - (-dt / tau).exp());
            self.env_peak[i] = r.max(self.env_peak[i] * (-dt / 4.0).exp()).max(1e-4);
        }

        // tem grave? comparado com o grave do último minuto, não dos últimos 4 s (senão o breakdown vira "drop")
        let r = (ms[0] + ms[1]).sqrt();
        self.low_lvl += (r - self.low_lvl) * (1.0 - (-dt / 0.25).exp());
        self.low_ref = self.low_lvl.max(self.low_ref * (-dt / 60.0).exp()).max(1e-4);
        let ratio = self.low_lvl / self.low_ref;
        self.low_on = self.rms >= p.gate && ratio > if self.low_on { 0.7 * p.drop_thr } else { p.drop_thr };

        let k = (2.6 - 0.7 * p.sens).max(0.3);
        let (dc, tc) = self.on_click.step(ms[3], k);
        if dc > tc {
            self.last_click = t;
        }
        let (ds, ts) = self.on_sub.step(ms[0], k);
        self.beat.tick(t);
        let grid = self.beat.on_grid(t);
        // perto do beat previsto o limiar cai: pega kicks fracos sob o baixo rolante
        let thr = if grid == Some(true) { (ts * 0.6).max(MIN_RISE) } else { ts };
        self.flux = ds;
        self.thr = thr;
        let over = ds > thr;
        let rising = over && !self.sub_over;
        self.sub_over = over;

        let (lo, hi) = (p.bpm_min.min(p.bpm_max) as f64, p.bpm_min.max(p.bpm_max) as f64);
        if !rising || pk < p.gate || t - self.last_kick < 0.6 * 60.0 / hi {
            return None;
        }
        let click_ok = !p.need_click || t - self.last_click < 0.017;
        let strong = ds > 2.0 * ts;
        let accept = match grid {
            Some(true) => click_ok || strong,
            Some(false) => click_ok && strong,
            None => click_ok,
        };
        if !accept {
            return None;
        }
        self.last_kick = t;
        self.beat.on_kick(t, lo, hi, p.lock);
        Some((0.5 + (ds / thr - 1.0) * 0.5).clamp(0.3, 1.0))
    }

    /// Estado atual para a UI/render (inclui espectro de 64 faixas log, 30 Hz–16 kHz).
    pub fn snapshot(&mut self) -> Frame {
        for i in 0..FFT {
            self.fin[i] = self.ring[(self.ring_pos + i) % FFT] * self.win[i];
        }
        let _ = self.fft.process(&mut self.fin, &mut self.fout);
        let (norm, bin_hz) = (4.0 / FFT as f32, self.sr / FFT as f32);
        let edge = |j: usize| 30.0 * (16000.0f32 / 30.0).powf(j as f32 / SPEC_BINS as f32) / bin_hz;
        let spectrum = (0..SPEC_BINS)
            .map(|j| {
                let a = (edge(j) as usize).max(1);
                let b = (edge(j + 1) as usize).max(a + 1).min(self.fout.len());
                let m = self.fout[a..b].iter().map(|c| c.norm()).fold(0.0, f32::max) * norm;
                ((20.0 * (m + 1e-9).log10() + 90.0) / 70.0).clamp(0.0, 1.0)
            })
            .collect();
        let (bpm, beat_phase, beat) = self.beat.at(self.t);
        Frame {
            peak: self.peak,
            rms: self.rms,
            bands: std::array::from_fn(|i| (self.env[i] / self.env_peak[i]).min(1.0)),
            kick: 0.0,
            bpm,
            locked: self.beat.locked,
            holding: self.beat.holding(self.t),
            beat_phase,
            beat,
            flux: self.flux,
            thr: self.thr,
            spectrum,
            low: if self.low_on { 1.0 } else { 0.0 },
            pos: -1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Faixa sintética estilo psy: kick (sweep + click) em 4/4 e, opcionalmente,
    /// baixo rolante nas 3 semicolcheias seguintes (sub sem click), mais ruído.
    fn track(bpm: f64, secs: f64, sr: f32, rolling: bool) -> (Vec<f32>, Vec<f64>) {
        let mut out = vec![0f32; (secs * sr as f64) as usize];
        let mut rng = 1u32;
        let mut noise = move || {
            rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
            (rng >> 8) as f32 / (1 << 24) as f32 * 2.0 - 1.0
        };
        let beat = 60.0 / bpm;
        let mut kicks = vec![];
        let mut t0 = 0.05;
        while t0 + 0.4 < secs {
            kicks.push(t0);
            let s0 = (t0 * sr as f64) as usize;
            let mut ph = 0f32;
            for i in 0..(0.3 * sr) as usize {
                let tt = i as f32 / sr;
                ph += 2.0 * PI * (50.0 + 120.0 * (-tt / 0.03).exp()) / sr;
                out[s0 + i] += 0.9 * ph.sin() * (-tt / 0.2).exp() + 0.4 * noise() * (-tt / 0.004).exp();
            }
            if rolling {
                for j in 1..4 {
                    let b0 = ((t0 + j as f64 * beat / 4.0) * sr as f64) as usize;
                    let len = (beat / 4.0 * 0.9 * sr as f64) as usize;
                    for i in 0..len {
                        let tt = i as f32 / sr;
                        let w = 2.0 * PI * 55.0 * tt;
                        let fade = ((len - i) as f32 / (0.005 * sr)).min(1.0); // sem corte seco (que vira click)
                        out[b0 + i] += 0.7 * (tt / 0.003).min(1.0) * (-tt / 0.05).exp() * fade * (w.sin() + 0.3 * (2.0 * w).sin());
                    }
                }
            }
            t0 += beat;
        }
        for s in &mut out {
            *s += 0.02 * noise();
        }
        (out, kicks)
    }

    fn check(bpm: f64, lo: f32, hi: f32) {
        let sr = 48000.0;
        let secs = 20.0;
        let (x, truth) = track(bpm, secs, sr, true);
        let mut an = Analyzer::new(sr);
        let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
        let (mut det, mut last_beat) = (vec![], i64::MIN);
        for (i, c) in x.chunks_exact(HOP).enumerate() {
            let t = (i + 1) as f64 * HOP as f64 / sr as f64;
            if an.process(c, &p).is_some() {
                det.push(t);
            }
            if an.beat.locked {
                let (_, _, b) = an.beat.at(t);
                assert!(b >= last_beat, "{bpm}: índice do beat voltou ({last_beat} → {b}) em {t:.2}s");
                last_beat = b;
            }
        }
        let near = |a: f64, b: f64| (a - b).abs() < 0.03;
        // acerto medido depois de 3 s: antes disso o limiar ainda está aprendendo
        let truth: Vec<f64> = truth.into_iter().filter(|&t| t > 3.0).collect();
        let det: Vec<f64> = det.into_iter().filter(|&d| d > 3.0).collect();
        let hits = truth.iter().filter(|&&t| det.iter().any(|&d| near(d, t))).count();
        let false_hits = det.iter().filter(|&&d| !truth.iter().any(|&t| near(d, t))).count();
        let (est, _, _) = an.beat.at(secs);
        let recall = hits as f64 / truth.len() as f64;
        let false_rate = false_hits as f64 / det.len().max(1) as f64;
        println!("{bpm} BPM: estimado {est:.2}, acerto {recall:.2}, falsos {false_rate:.2}");
        assert!(an.beat.locked, "{bpm}: não travou");
        assert!((est as f64 - bpm).abs() < 0.5, "{bpm}: estimou {est}");
        assert!(recall >= 0.95, "{bpm}: acerto {recall}");
        assert!(false_rate < 0.05, "{bpm}: falsos {false_rate}");
    }

    /// Faixa 10 s → breakdown 8 s (sem kick nem baixo; só um pad médio e ruído) → drop 8 s.
    #[test]
    fn drop_breakdown() {
        let sr = 48000.0;
        let (a, _) = track(148.0, 10.0, sr, true);
        let (b, _) = track(148.0, 8.0, sr, true);
        let pad: Vec<f32> = (0..(8.0 * sr) as usize).map(|i| 0.15 * (2.0 * PI * 880.0 * i as f32 / sr).sin()).collect();
        let x: Vec<f32> = a.into_iter().chain(pad).chain(b).collect();
        let mut an = Analyzer::new(sr);
        let p = Params { bpm_min: 135.0, bpm_max: 150.0, ..Default::default() };
        let (mut first_on_after_drop, mut wrong) = (None, vec![]);
        for (i, c) in x.chunks_exact(HOP).enumerate() {
            let t = (i + 1) as f64 * HOP as f64 / sr as f64;
            an.process(c, &p);
            let low = an.snapshot().low > 0.5;
            let expect = if t > 2.0 && t < 10.0 { Some(true) } else if t > 11.0 && t < 18.0 { Some(false) } else { None };
            if expect.is_some_and(|e| e != low) {
                wrong.push(t);
            }
            if t >= 18.0 && low && first_on_after_drop.is_none() {
                first_on_after_drop = Some(t - 18.0);
            }
        }
        assert!(wrong.is_empty(), "drop errado em {} hops, ex.: {:.2}s", wrong.len(), wrong[0]);
        let dt = first_on_after_drop.expect("o drop não voltou");
        println!("drop voltou {:.0} ms depois do primeiro kick", dt * 1000.0);
        assert!(dt < 60.0 / 148.0, "drop demorou {dt:.2}s");
    }

    #[test]
    fn psy_140() {
        check(140.0, 135.0, 150.0);
    }
    #[test]
    fn psy_148() {
        check(148.0, 135.0, 150.0);
    }
    #[test]
    fn dark_175() {
        check(175.0, 145.0, 185.0);
    }
    #[test]
    fn hitech_200() {
        check(200.0, 175.0, 220.0);
    }
    #[test]
    fn auto_range_148() {
        check(148.0, 80.0, 220.0);
    }
}
