//! Análise de áudio por blocos de HOP amostras (~5 ms a 48 kHz), independente da taxa de quadros.
//!
//! Kick = subida brusca no sub (35–100 Hz) junto com o "click" do ataque (2–6 kHz).
//! O baixo rolante do psytrance tem sub mas quase não tem click, então não dispara.
//! Com o andamento travado, candidatos fora da grade precisam ser bem mais fortes.

use crate::beat::Beat;
use crate::midi::ExtClock;
use realfft::{num_complex::Complex, RealFftPlanner, RealToComplex};
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;
use std::collections::VecDeque;
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
    // indicadores de energia musical (DK-031), aditivos
    pub energy: f32,    // (rms + médio + agudo)/3 em nível absoluto, suavizado em ~1 compasso
    pub contrast: f32,  // energia média dos últimos 4 compassos ÷ 4 anteriores (1 = estável; sem trava, blocos de 2 s)
    pub stability: f32, // 0..1: quanto o relógio do beat é confiável (jitter dos kicks × tempo desde a trava)
    pub kick_rate: f32, // kicks por compasso nos últimos 8 beats (0 no breakdown, ~4 no groove)
    pub clock: &'static str, // quem manda no relógio do beat: "audio" | "midi" (DK-112)
}

/// Indicadores de energia musical por compasso (DK-031), para o show-engine escolher cenas.
/// Compasso = 4 beats da grade travada; sem trava, blocos de 2 s.
struct Trend {
    energy: f32,
    blk: (bool, i64), // bloco atual: (é compasso?, índice)
    blk_sum: f32,
    blk_n: u32,
    blk_t0: f64,           // início do bloco atual
    blocks: VecDeque<f32>, // médias dos últimos 8 blocos
    quiet: f64,            // início do silêncio atual (-1 = não está em silêncio)
    per_ref: f64,          // período com que os blocos foram medidos (troca de música zera)
    locked_since: f64,
    was_locked: bool,
    kicks: VecDeque<f64>,
    contrast: f32,
    stability: f32,
    kick_rate: f32,
}

impl Default for Trend {
    fn default() -> Self {
        Self {
            energy: 0.0,
            blk: (false, i64::MIN),
            blk_sum: 0.0,
            blk_n: 0,
            blk_t0: 0.0,
            blocks: VecDeque::new(),
            quiet: -1.0,
            per_ref: 0.0,
            locked_since: 0.0,
            was_locked: false,
            kicks: VecDeque::new(),
            contrast: 1.0,
            stability: 0.0,
            kick_rate: 0.0,
        }
    }
}

impl Trend {
    fn step(&mut self, t: f64, dt: f32, e: f32, silent: bool, beat: &Beat) {
        let p = beat.period;
        let bar = if p > 0.0 { 4.0 * p } else { 2.0 };
        self.energy += (e - self.energy) * (1.0 - (-(dt as f64) / bar).exp()) as f32;

        // o histórico não vale depois de troca de música (período travado mudou > 3 %) ou de 1 s de silêncio
        let tempo_changed = beat.locked && self.per_ref > 0.0 && (p - self.per_ref).abs() > 0.03 * self.per_ref;
        if beat.locked && (tempo_changed || self.per_ref == 0.0) {
            self.per_ref = p;
        }
        if silent && self.quiet < 0.0 {
            self.quiet = t;
        } else if !silent {
            self.quiet = -1.0;
        }
        if tempo_changed || (self.quiet >= 0.0 && t - self.quiet > 1.0) {
            self.blocks.clear();
            self.blk_n = 0;
            self.blk_sum = 0.0;
        }

        let id = if beat.locked && p > 0.0 { (true, beat.at(t).2.div_euclid(4)) } else { (false, (t / 2.0).floor() as i64) };
        if id != self.blk {
            // bloco parcial (começou no meio: trava, troca de bloco de 2 s para compasso, reset) não
            // entra — a média de meio compasso depende de quantos kicks caíram nele
            if self.blk_n > 0 && t - self.blk_t0 >= 0.75 * bar {
                self.blocks.push_back(self.blk_sum / self.blk_n as f32);
                if self.blocks.len() > 8 {
                    self.blocks.pop_front();
                }
            }
            self.blk = id;
            self.blk_t0 = t;
            self.blk_sum = 0.0;
            self.blk_n = 0;
        }
        self.blk_sum += e;
        self.blk_n += 1;
        self.contrast = if self.blocks.len() == 8 {
            let old: f32 = self.blocks.iter().take(4).sum();
            let new: f32 = self.blocks.iter().skip(4).sum();
            if old > 1e-6 { new / old } else { 1.0 }
        } else {
            1.0
        };

        // estabilidade: jitter dos kicks em torno da grade (20.0 ms = 0) × rampa de 8 beats desde a trava
        if beat.locked && !self.was_locked {
            self.locked_since = t;
        }
        self.was_locked = beat.locked;
        self.stability = if beat.locked && p > 0.0 {
            let j = (1.0 - beat.jitter * 1000.0 / 20.0).clamp(0.0, 1.0);
            let age = ((t - self.locked_since) / (8.0 * p)).min(1.0);
            (j * age) as f32
        } else {
            0.0
        };

        // kicks por compasso nos últimos 8 beats; sem período ainda, kicks nos últimos 2 s
        let w = if p > 0.0 { 8.0 * p } else { 2.0 };
        while self.kicks.front().is_some_and(|&k| k < t - w) {
            self.kicks.pop_front();
        }
        self.kick_rate = if p > 0.0 { self.kicks.len() as f32 / 2.0 } else { self.kicks.len() as f32 };
    }
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
    no_click: bool, // o cruzamento atual do sub foi recusado só por falta de click
    pend: Vec<(f64, f32)>, // candidatos com click acumulando o punch (30 ms) para a fase da grade
    orphans: Vec<f64>,     // candidatos com click recusados fora da grade desde o último kick aceito
    last_click: f64,
    last_soft_click: f64, // click mais fraco, só vale no beat previsto
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
    last_low: f64,   // último hop com grave (low_on)
    last_quiet: f64, // último hop em silêncio digital
    pub beat: Beat,
    /// Relógio externo (MIDI Clock) já no tempo da análise; `None` = o áudio manda.
    pub ext: Option<ExtClock>,
    trend: Trend,
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
            no_click: false,
            pend: vec![],
            orphans: vec![],
            last_click: -1.0,
            last_soft_click: -1.0,
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
            last_low: 0.0,
            last_quiet: 0.0,
            beat: Beat::default(),
            ext: None,
            trend: Trend::default(),
            ring: vec![0.0; FFT],
            ring_pos: 0,
            win: (0..FFT).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / FFT as f32).cos()).collect(),
            fin: fft.make_input_vec(),
            fout: fft.make_output_vec(),
            fft,
        }
    }

    /// Instante (s) do fim do último hop processado.
    pub fn time(&self) -> f64 {
        self.t
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
        let had_low = self.last_low; // antes deste hop: o grave do kick atual ainda não subiu
        self.low_on = self.rms >= p.gate && ratio > if self.low_on { 0.7 * p.drop_thr } else { p.drop_thr };
        if self.low_on {
            self.last_low = t;
        }

        let e = (self.rms + ms[2].sqrt() + ms[4].sqrt()) / 3.0;
        self.trend.step(t, dt, e, self.rms < p.gate, &self.beat);

        let k = (2.6 - 0.7 * p.sens).max(0.3);
        let (dc, tc) = self.on_click.step(ms[3], k);
        if dc > tc {
            self.last_click = t;
        }
        if dc > 0.75 * tc {
            self.last_soft_click = t;
        }
        let (ds, ts) = self.on_sub.step(ms[0], k);
        self.beat.external = self.ext.is_some();
        if let Some(e) = self.ext {
            self.beat.follow(t, e.period, e.beat);
        }
        self.beat.tick(t);
        let grid = self.beat.on_grid(t);
        // perto do beat previsto o limiar cai: pega kicks fracos sob o baixo rolante
        let thr = if grid == Some(true) { (ts * 0.6).max(MIN_RISE) } else { ts };
        self.flux = ds;
        self.thr = thr;
        let over = ds > thr;
        let click_now = t - self.last_click < 0.017;
        // borda nova, ou o mesmo cruzamento que foi recusado só por falta de click e agora tem click:
        // a subida do sub às vezes passa o limiar 1 hop antes do click do kick chegar
        let rising = over && (!self.sub_over || (self.no_click && click_now));
        self.sub_over = over;
        if !over {
            self.no_click = false;
        }

        // "punch" (energia da banda de 160 Hz nos 30 ms depois de cada candidato com click), para o
        // Beat escolher a fase da grade: kick × chimbal + baixo. Antes do refratário, porque o
        // candidato do contratempo cai nele.
        for c in &mut self.pend {
            c.1 += ms[1];
        }
        if rising && click_now && pk >= p.gate {
            self.pend.push((t, ms[1]));
        }
        while self.pend.first().is_some_and(|c| t - c.0 > 0.03) {
            let (ct, cp) = self.pend.remove(0);
            self.beat.score(ct, cp);
        }

        let (lo, hi) = (p.bpm_min.min(p.bpm_max) as f64, p.bpm_min.max(p.bpm_max) as f64);
        // depois de silêncio digital (zeros, não só baixo: −20 dB fica abaixo do gate entre kicks), o
        // próprio ruído de fundo voltando sobe dezenas de vezes e tem
        // "click": não é kick (e roubaria o refratário do kick de verdade logo depois)
        if self.rms < 1e-5 {
            self.last_quiet = t;
        }
        if !rising || pk < p.gate || t - self.last_kick < 0.6 * 60.0 / hi || t - self.last_quiet < 0.02 {
            return None;
        }
        let click_ok = !p.need_click || click_now;
        let strong = ds > 2.0 * ts;
        let accept = match grid {
            // no beat previsto aceita click mais fraco: com ruído alto o click do kick fica perto do piso
            Some(true) => click_ok || strong || (p.need_click && t - self.last_soft_click < 0.017),
            Some(false) => click_ok && strong,
            None => click_ok,
        };
        if !accept {
            self.no_click = !click_ok;
            if grid == Some(false) && click_ok && p.need_click {
                self.orphan(t);
            }
            return None;
        }
        self.no_click = false;
        self.orphans.clear();
        // fase pulou: kick forte fora da grade depois de ≥ 1 compasso sem kick ou sem grave
        // (pausa, corte; um falso no ruído da pausa não liga o grave)
        let gap = 4.0 * self.beat.period;
        if grid == Some(false) && (t - self.last_kick > gap || t - had_low > gap) {
            self.beat.jump(t); // fase pulou depois de pausa/corte (P8)
        }
        self.last_kick = t;
        self.trend.kicks.push_back(t);
        self.beat.on_kick(t, lo, hi, p.lock || self.ext.is_some());
        Some((0.5 + (ds / thr - 1.0) * 0.5).clamp(0.3, 1.0))
    }

    /// Pausa e a faixa voltou com outra fase (ou corte em que o kick volta defasado): a grade
    /// travada segura até 30 s (`HOLD`, feito para o breakdown) e os kicks novos, fora dela, são
    /// recusados. Se há grave tocando, nenhum kick aceito há mais de 1 compasso e ≥ 3
    /// candidatos com click recusados fora da grade com espaçamento de beats inteiros, a grade
    /// não explica mais a música: recomeça a partir desses candidatos. No groove há kick aceito
    /// a cada beat e no breakdown não há grave nem candidato, então nenhum dos dois dispara.
    fn orphan(&mut self, t: f64) {
        let p = self.beat.period;
        if !self.beat.locked || p <= 0.0 {
            return;
        }
        self.orphans.retain(|&o| o > t - 8.0 * p);
        if self.orphans.last().is_some_and(|&o| t - o < 0.25 * p) {
            return; // o mesmo kick pode virar candidato 2× (borda + click que chegou depois)
        }
        self.orphans.push(t);
        if !self.low_on || t - self.last_kick < 4.0 * p || self.orphans.len() < 3 {
            return;
        }
        let regular = self.orphans.windows(2).filter(|w| {
            let x = (w[1] - w[0]) / p;
            x.round() >= 1.0 && (x - x.round()).abs() < 0.12
        });
        if regular.count() * 4 >= (self.orphans.len() - 1) * 3 {
            let ks = std::mem::take(&mut self.orphans);
            self.beat.restart(&ks);
        }
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
            energy: self.trend.energy,
            contrast: self.trend.contrast,
            stability: self.trend.stability,
            kick_rate: self.trend.kick_rate,
            clock: if self.ext.is_some() { "midi" } else { "audio" },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::synth::Synth;

    fn track(bpm: f64, secs: f64, sr: f32, rolling: bool) -> (Vec<f32>, Vec<f64>) {
        Synth { bpm, secs, sr, rolling, ..Default::default() }.render()
    }

    fn check(bpm: f64, lo: f32, hi: f32) {
        check_synth(Synth { bpm, secs: 20.0, ..Default::default() }, lo, hi);
    }

    fn check_synth(s: Synth, lo: f32, hi: f32) {
        let (sr, secs, bpm) = (s.sr, s.secs, s.bpm);
        let (x, truth) = s.render();
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

    /// Troca de música no meio (148 → 175 BPM, sem breakdown): a trava da faixa velha não pode
    /// segurar o andamento antigo para sempre. Hoje re-trava em ~7,3 s (a janela de 8 s do
    /// ajuste precisa esvaziar dos kicks velhos); o limite de 9 s é esse comportamento, não meta.
    #[test]
    fn troca_de_musica_148_175() {
        let sr = 48000.0;
        let (a, _) = Synth { bpm: 148.0, secs: 15.0, sr, ..Default::default() }.render();
        let (b, _) = Synth { bpm: 175.0, secs: 15.0, sr, seed: 2, ..Default::default() }.render();
        let x: Vec<f32> = a.into_iter().chain(b).collect();
        for (lo, hi) in [(145.0, 185.0), (80.0, 220.0)] {
            let mut an = Analyzer::new(sr);
            let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
            let mut novo = None;
            for (i, c) in x.chunks_exact(HOP).enumerate() {
                let t = (i + 1) as f64 * HOP as f64 / sr as f64;
                an.process(c, &p);
                if t > 15.0 && novo.is_none() && an.beat.locked && (an.beat.at(t).0 - 175.0).abs() < 0.5 {
                    novo = Some(t - 15.0);
                }
            }
            let (est, _, _) = an.beat.at(30.0);
            let dt = novo.unwrap_or_else(|| panic!("{lo}–{hi}: não re-travou em 175 (final {est:.2})"));
            println!("{lo}–{hi}: re-travou em 175 após {dt:.2} s; final {est:.2}");
            assert!(an.beat.locked && (est - 175.0).abs() < 0.5, "{lo}–{hi}: final {est}");
            assert!(dt < 9.0, "{lo}–{hi}: re-trava demorou {dt:.2} s");
        }
    }

    /// Auto (80–220) com 2 s de silêncio antes: a mediana dos intervalos caía em 2 beats e
    /// travava em 87,5 (DETECCAO.md §4.4). E o inverso: 90 BPM de verdade não pode dobrar.
    #[test]
    fn auto_sem_meio_tempo() {
        for (bpm, start) in [(175.0, 2.0), (90.0, 0.05), (100.0, 2.0)] {
            let s = Synth { bpm, secs: 30.0, start, ..Default::default() };
            let (x, _) = s.render();
            let mut an = Analyzer::new(s.sr);
            let p = Params { bpm_min: 80.0, bpm_max: 220.0, ..Default::default() };
            for c in x.chunks_exact(HOP) {
                an.process(c, &p);
            }
            let (est, _, _) = an.beat.at(30.0);
            println!("Auto {bpm} (início {start} s): {est:.2}");
            assert!(an.beat.locked && (est as f64 - bpm).abs() < 0.5, "Auto {bpm}: estimou {est}");
        }
    }

    /// Só kick, sem baixo rolante: a subida do sub passava o limiar 1 hop antes do click e
    /// travava a borda, perdendo ~15 % dos kicks (DETECCAO.md §4.2).
    #[test]
    fn limpo_sem_baixo() {
        check_synth(Synth { bpm: 140.0, secs: 20.0, rolling: false, ..Default::default() }, 135.0, 150.0);
        check_synth(Synth { bpm: 160.0, secs: 20.0, rolling: false, ..Default::default() }, 145.0, 185.0);
    }

    /// Ruído branco alto (−14 dBFS) com baixo rolante: o click do kick fica perto do piso do
    /// limiar e um em cada três kicks se perdia mesmo no beat previsto (DETECCAO.md §4.1).
    #[test]
    fn ruido_alto() {
        check_synth(Synth { bpm: 140.0, secs: 20.0, noise: 0.2, ..Default::default() }, 135.0, 150.0);
        check_synth(Synth { bpm: 175.0, secs: 20.0, noise: 0.2, ..Default::default() }, 145.0, 185.0);
    }

    /// Termina travado em `bpm` com a grade nos kicks reais (não no contratempo)?
    fn grade_nos_kicks(s: Synth, lo: f32, hi: f32) -> (bool, f32, f64) {
        let (x, truth) = s.render();
        let mut an = Analyzer::new(s.sr);
        let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
        for c in x.chunks_exact(HOP) {
            an.process(c, &p);
        }
        let fase = (truth[0] - an.beat.anchor) / an.beat.period;
        let fase = (fase - fase.round()).abs();
        (an.beat.locked && fase < 0.15, an.beat.at(s.secs).0, fase)
    }

    /// Chimbal no contratempo + nota do baixo: têm click e sub e passavam como kick antes da
    /// trava; se a âncora caísse neles, a grade ficava meio beat fora a música inteira
    /// (DETECCAO.md §4.7). 175/semente 3 e kick a meio volume falhavam sem a escolha de fase.
    #[test]
    fn contratempo_com_chimbal() {
        for (seed, kick) in [(3, 1.0), (1, 0.5), (2, 0.5)] {
            let s = Synth { bpm: 175.0, secs: 30.0, hats: 0.15, kick, seed, ..Default::default() };
            let (ok, bpm, fase) = grade_nos_kicks(s, 145.0, 185.0);
            println!("175 chimbal, semente {seed}, kick {kick}: {bpm:.2} BPM, fase {fase:.2}");
            assert!(ok && (bpm - 175.0).abs() < 0.5, "semente {seed}, kick {kick}: {bpm} BPM, fase {fase:.2}");
        }
    }

    /// Espelho: a escolha de fase não pode inverter uma grade certa. Chimbal 4× mais alto com o
    /// kick a meio volume, e kick fraco sem chimbal (sem candidato no contratempo, nada vira).
    /// Limite conhecido: com o kick a ≤ 0,3 do volume (≈ −10 dB) ele nem é detectado sob o baixo
    /// (sem chimbal não trava); com chimbal a grade trava no único evento com click, o contratempo,
    /// com ou sem a escolha de fase (DETECCAO.md §4.7).
    #[test]
    fn contratempo_espelho() {
        for (hats, kick) in [(0.6, 0.5), (0.0, 0.4)] {
            for seed in 1..=3 {
                let s = Synth { bpm: 175.0, secs: 30.0, hats, kick, seed, ..Default::default() };
                let (ok, bpm, fase) = grade_nos_kicks(s, 145.0, 185.0);
                assert!(ok && (bpm - 175.0).abs() < 0.5, "chimbal {hats}, kick {kick}, semente {seed}: {bpm} BPM, fase {fase:.2}");
            }
        }
    }

    /// Volta do drop com 4-5 kicks: o período estimado só com eles oscila mais de 3 % (a detecção
    /// varia ~1 hop) e a trava caía mesmo com todos os kicks na grade (140/sementes 8 e 10 do
    /// estresse, DETECCAO.md §4.8).
    #[test]
    fn breakdown_nao_solta_a_trava() {
        for seed in [8, 10] {
            let s = Synth { bpm: 140.0, secs: 30.0, seed, breakdown: Some((10.0, 18.0)), ..Default::default() };
            let (x, _) = s.render();
            let mut an = Analyzer::new(s.sr);
            let p = Params { bpm_min: 135.0, bpm_max: 150.0, ..Default::default() };
            let (mut was, mut drops) = (false, 0);
            for c in x.chunks_exact(HOP) {
                an.process(c, &p);
                drops += (was && !an.beat.locked) as usize;
                was = an.beat.locked;
            }
            assert_eq!(drops, 0, "semente {seed}: a trava caiu {drops}×");
        }
    }

    /// Roda a faixa e devolve um Frame por hop (com o instante), para olhar os indicadores.
    fn frames(x: &[f32], lo: f32, hi: f32) -> Vec<(f64, Frame)> {
        let mut an = Analyzer::new(48000.0);
        let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
        let mut out = vec![];
        for (i, c) in x.chunks_exact(HOP).enumerate() {
            an.process(c, &p);
            if i % 2 == 1 {
                out.push(((i + 1) as f64 * HOP as f64 / 48000.0, an.snapshot()));
            }
        }
        out
    }

    /// DK-031: build-up (8 compassos de ruído subindo no fim do breakdown) passa de 1,2 de
    /// contraste; groove estável fica < 1,1; ~4 kicks por compasso no groove e 0 no breakdown.
    #[test]
    fn indicadores_build_groove_breakdown() {
        let (bpm, bar) = (148.0, 4.0 * 60.0 / 148.0);
        let build = Synth { bpm, secs: 32.0 * bar, breakdown: Some((8.0 * bar, 24.0 * bar)), riser: Some((16.0 * bar, 24.0 * bar)), ..Default::default() };
        let f = frames(&build.render().0, 135.0, 150.0);
        let max_build = f.iter().filter(|(t, _)| (16.0 * bar..24.0 * bar).contains(t)).map(|(_, f)| f.contrast).fold(0.0, f32::max);
        let rate_break = f.iter().filter(|(t, _)| (10.0 * bar..24.0 * bar).contains(t)).map(|(_, f)| f.kick_rate).fold(0.0, f32::max);
        let groove = frames(&Synth { bpm, secs: 30.0, ..Default::default() }.render().0, 135.0, 150.0);
        let max_groove = groove.iter().map(|(_, f)| f.contrast).fold(0.0, f32::max);
        let rates: Vec<f32> = groove.iter().filter(|(t, _)| *t > 8.0).map(|(_, f)| f.kick_rate).collect();
        println!("contraste máx: build {max_build:.2}, groove {max_groove:.2}; kicks/compasso groove {:.1}–{:.1}, breakdown máx {rate_break}", rates.iter().copied().fold(9.0, f32::min), rates.iter().copied().fold(0.0, f32::max));
        assert!(max_build > 1.2, "build: contraste {max_build}");
        assert!(max_groove < 1.1, "groove: contraste {max_groove}");
        assert!(rates.iter().all(|&r| (3.5..=4.5).contains(&r)), "groove: kicks/compasso fora de 3,5–4,5");
        assert_eq!(rate_break, 0.0, "breakdown: ainda conta kick");
        // contrato com src/lib/types.ts: o Frame vai inteiro para o front, em camelCase
        let j = serde_json::to_value(&f[0].1).unwrap();
        for k in ["energy", "contrast", "stability", "kickRate"] {
            assert!(j.get(k).is_some(), "Frame sem {k}");
        }
    }

    /// DK-031: a estabilidade cai na queda de trava (troca de música 148 → 175) e volta depois;
    /// 1 s de silêncio zera o histórico do contraste.
    #[test]
    fn indicadores_estabilidade_e_reset() {
        let mut x = Synth { bpm: 148.0, secs: 15.0, ..Default::default() }.render().0;
        x.extend(Synth { bpm: 175.0, secs: 20.0, seed: 2, ..Default::default() }.render().0);
        let f = frames(&x, 145.0, 185.0);
        let at = |a: f64, b: f64| f.iter().filter(move |(t, _)| (a..b).contains(t)).map(|(_, f)| f.stability);
        let (antes, durante, depois) = (at(10.0, 15.0).fold(1.0, f32::min), at(15.0, 25.0).fold(1.0, f32::min), at(32.0, 35.0).fold(1.0, f32::min));
        println!("estabilidade: antes {antes:.2}, mínima na troca {durante:.2}, no fim {depois:.2}");
        assert!(antes > 0.9 && durante == 0.0 && depois > 0.9, "estabilidade {antes} / {durante} / {depois}");

        let mut x = Synth { bpm: 148.0, secs: 20.0, ..Default::default() }.render().0;
        x.extend(vec![0.0; 3 * 48000]);
        x.extend(Synth { bpm: 148.0, secs: 10.0, seed: 2, ..Default::default() }.render().0);
        let f = frames(&x, 135.0, 150.0);
        let pre = f.iter().find(|(t, _)| *t > 19.0).unwrap().1.contrast;
        let reset = f.iter().filter(|(t, _)| (21.5..23.0).contains(t)).all(|(_, f)| f.contrast == 1.0);
        assert!(pre > 0.0 && reset, "silêncio não zerou o contraste");
    }

    /// P8: pausa de 3 s (silêncio digital ou só ruído de fundo) e a mesma faixa voltando com
    /// outra fase. A grade velha segurava até 30 s e os kicks novos, fora dela, eram recusados
    /// (recall ~0 nos 20 s seguintes). Agora a grade pula para o kick forte fora dela ou recomeça
    /// pelos candidatos recusados (DETECCAO.md §4.9).
    #[test]
    fn pausa_e_faixa_defasada() {
        for noisy in [false, true] {
            let mut x = Synth { bpm: 148.0, secs: 20.0, ..Default::default() }.render().0;
            if noisy {
                x.extend(Synth { bpm: 148.0, secs: 3.0, start: 99.0, seed: 3, ..Default::default() }.render().0);
            } else {
                x.extend(vec![0.0; 3 * 48000]);
            }
            let (b, truth) = Synth { bpm: 148.0, secs: 20.0, seed: 2, ..Default::default() }.render();
            x.extend(b);
            let truth: Vec<f64> = truth.iter().map(|t| t + 23.0).collect();
            let mut an = Analyzer::new(48000.0);
            let p = Params { bpm_min: 135.0, bpm_max: 150.0, ..Default::default() };
            let (mut det, mut relock) = (vec![], None);
            for (i, c) in x.chunks_exact(HOP).enumerate() {
                let t = (i + 1) as f64 * HOP as f64 / 48000.0;
                if an.process(c, &p).is_some() && t > 23.0 {
                    det.push(t);
                }
                let fase = (truth[0] - an.beat.anchor) / an.beat.period;
                if t > 23.0 && relock.is_none() && an.beat.locked && (fase - fase.round()).abs() < 0.15 {
                    relock = Some(t - 23.0);
                }
            }
            let recall = truth.iter().filter(|&&k| det.iter().any(|&d| (d - k).abs() < 0.03)).count() as f64 / truth.len() as f64;
            println!("pausa (ruído {noisy}): recall {recall:.2}, re-trava {relock:?}");
            assert!(recall >= 0.9, "ruído {noisy}: recall {recall:.2}");
            assert!(relock.is_some_and(|r| r <= 4.0), "ruído {noisy}: re-trava {relock:?}");
        }
    }

    /// DK-112: com MIDI Clock o andamento é o dele (o áudio toca a 148, o clock manda 140) e o
    /// Frame diz "midi"; sem clock (`ext` = None, como 2 s depois do último pulso) o áudio volta
    /// a mandar e re-trava no andamento da música.
    #[test]
    fn relogio_midi_manda_e_devolve() {
        let (x, _) = Synth { bpm: 148.0, secs: 30.0, ..Default::default() }.render();
        let mut an = Analyzer::new(48000.0);
        let p = Params { bpm_min: 135.0, bpm_max: 150.0, ..Default::default() };
        let (mut midi_ok, mut volta) = (true, None);
        for (i, c) in x.chunks_exact(HOP).enumerate() {
            let t = (i + 1) as f64 * HOP as f64 / 48000.0;
            an.ext = (t < 10.0).then_some(ExtClock { period: 60.0 / 140.0, beat: None });
            an.process(c, &p);
            let f = an.snapshot();
            if (1.0..10.0).contains(&t) {
                midi_ok &= f.clock == "midi" && (f.bpm - 140.0).abs() < 0.01 && f.locked;
            }
            if t > 10.0 && volta.is_none() && f.clock == "audio" && f.locked && (f.bpm - 148.0).abs() < 0.5 {
                volta = Some(t - 10.0);
            }
        }
        assert!(midi_ok, "com MIDI Clock o andamento tem de ser o dele");
        let volta = volta.expect("o áudio não voltou a mandar");
        println!("áudio re-travou em 148 {volta:.2} s depois do MIDI Clock sumir");
        assert!(volta < 6.0, "demorou {volta:.2} s");

        // com Start a fase também é a do MIDI (beat 0 em 0,123 s), não a dos kicks do áudio
        let mut an = Analyzer::new(48000.0);
        let e = ExtClock { period: 60.0 / 140.0, beat: Some((0.123, 0)) };
        for (i, c) in x.chunks_exact(HOP).enumerate().take(2000) {
            let t = (i + 1) as f64 * HOP as f64 / 48000.0;
            an.ext = Some(e);
            an.process(c, &p);
            let f = an.snapshot();
            let x = (t - 0.123) / e.period;
            assert!((f.beat_phase as f64 - x.rem_euclid(1.0)).abs() < 1e-3 && f.beat == x.floor() as i64, "{t:.2}: fase {} beat {}", f.beat_phase, f.beat);
        }
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
