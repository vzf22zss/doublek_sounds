//! Faixa sintética estilo psy para testes e benchmark, sem áudio real.
//!
//! Kick = varredura de sub (170 → 50 Hz) com "click" de ruído no ataque. Baixo rolante opcional
//! nas 3 semicolcheias seguintes (sub sem click, como o baixo do psytrance). Ruído branco de
//! fundo, ganho global, trecho de breakdown (só um pad médio) e jitter uniforme nos kicks.
//! Determinística: o mesmo `seed` gera a mesma faixa.

use std::f32::consts::PI;

#[derive(Clone, Debug)]
pub struct Synth {
    pub bpm: f64,
    pub secs: f64,
    pub sr: f32,
    pub start: f64,                    // instante do primeiro kick (antes só há ruído de fundo)
    pub rolling: bool,                 // baixo rolante entre os kicks
    pub noise: f32,                    // amplitude do ruído branco de fundo
    pub gain: f32,                     // volume da faixa inteira (0,1 = −20 dB)
    pub breakdown: Option<(f64, f64)>, // [início, fim) sem kick nem baixo, só um pad em 880 Hz
    pub jitter_ms: f64,                // cada kick desloca ± até isto (uniforme)
    pub hats: f32,                     // chimbal no contratempo (ruído agudo de 30 ms): pico; 0 = sem
    pub seed: u32,
}

impl Default for Synth {
    fn default() -> Self {
        Self { bpm: 140.0, secs: 20.0, sr: 48000.0, start: 0.05, rolling: true, noise: 0.02, gain: 1.0, breakdown: None, jitter_ms: 0.0, hats: 0.0, seed: 1 }
    }
}

impl Synth {
    /// Mono + instantes reais dos kicks (já com jitter), em segundos.
    pub fn render(&self) -> (Vec<f32>, Vec<f64>) {
        let sr = self.sr;
        let mut out = vec![0f32; (self.secs * sr as f64) as usize];
        let mut rng = self.seed;
        let mut noise = move || {
            rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
            (rng >> 8) as f32 / (1 << 24) as f32 * 2.0 - 1.0
        };
        let beat = 60.0 / self.bpm;
        let in_break = |t: f64| self.breakdown.is_some_and(|(a, b)| t >= a && t < b);
        let mut kicks = vec![];
        let mut t0 = self.start;
        while t0 + 0.4 < self.secs {
            if !in_break(t0) {
                let tk = t0 + noise() as f64 * self.jitter_ms / 1000.0;
                kicks.push(tk);
                let s0 = (tk * sr as f64) as usize;
                let mut ph = 0f32;
                for i in 0..(0.3 * sr) as usize {
                    let tt = i as f32 / sr;
                    ph += 2.0 * PI * (50.0 + 120.0 * (-tt / 0.03).exp()) / sr;
                    out[s0 + i] += 0.9 * ph.sin() * (-tt / 0.2).exp() + 0.4 * noise() * (-tt / 0.004).exp();
                }
                if self.hats > 0.0 {
                    let h0 = ((t0 + beat / 2.0) * sr as f64) as usize;
                    let mut prev = 0f32;
                    for i in 0..((0.03 * sr) as usize).min(out.len() - h0) {
                        let n = noise();
                        // diferença de ruído = passa-altas: chimbal sem grave
                        out[h0 + i] += self.hats * (n - prev) * (-(i as f32 / sr) / 0.01).exp();
                        prev = n;
                    }
                }
                if self.rolling {
                    for j in 1..4 {
                        let b0 = ((t0 + j as f64 * beat / 4.0) * sr as f64) as usize;
                        let len = (beat / 4.0 * 0.9 * sr as f64) as usize;
                        for i in 0..len.min(out.len() - b0) {
                            let tt = i as f32 / sr;
                            let w = 2.0 * PI * 55.0 * tt;
                            let fade = ((len - i) as f32 / (0.005 * sr)).min(1.0); // sem corte seco (que vira click)
                            out[b0 + i] += 0.7 * (tt / 0.003).min(1.0) * (-tt / 0.05).exp() * fade * (w.sin() + 0.3 * (2.0 * w).sin());
                        }
                    }
                }
            }
            t0 += beat;
        }
        if let Some((a, b)) = self.breakdown {
            let (i0, i1) = ((a * sr as f64) as usize, ((b * sr as f64) as usize).min(out.len()));
            for i in i0..i1 {
                out[i] += 0.15 * (2.0 * PI * 880.0 * (i - i0) as f32 / sr).sin();
            }
        }
        for s in &mut out {
            *s = (*s + self.noise * noise()) * self.gain;
        }
        (out, kicks)
    }

    /// Estéreo intercalado (os dois canais iguais), como `track::analyze` espera.
    pub fn stereo(&self) -> (Vec<f32>, Vec<f64>) {
        let (m, k) = self.render();
        (m.iter().flat_map(|&s| [s, s]).collect(), k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn determinista_e_respeita_breakdown_jitter_ganho() {
        let s = Synth { bpm: 150.0, secs: 12.0, breakdown: Some((4.0, 8.0)), jitter_ms: 5.0, gain: 0.5, ..Default::default() };
        let (a, ka) = s.render();
        let (b, kb) = s.render();
        assert_eq!(a, b);
        assert_eq!(ka, kb);
        assert_eq!(a.len(), 12 * 48000);
        assert!(ka.iter().all(|&t| !(4.0..8.0).contains(&t)), "kick dentro do breakdown");
        let beat = 60.0 / 150.0;
        let esperados = (0..).map(|n| 0.05 + n as f64 * beat).take_while(|&t| t + 0.4 < 12.0).filter(|&t| !(4.0..8.0).contains(&t)).count();
        assert_eq!(ka.len(), esperados);
        let desvio = |t: f64| { let d = (t - 0.05) % beat; d.min(beat - d) };
        let max_jit = ka.iter().map(|&t| desvio(t)).fold(0.0, f64::max);
        assert!(max_jit > 0.0005 && max_jit <= 0.0051, "jitter {max_jit}");
        let pico = a.iter().fold(0f32, |m, x| m.max(x.abs()));
        assert!(pico < 0.75, "ganho não aplicado: pico {pico}");
        let (sem_ganho, _) = Synth { gain: 1.0, ..s }.render();
        assert!(sem_ganho.iter().fold(0f32, |m, x| m.max(x.abs())) > pico);
        let (st, _) = Synth::default().stereo();
        assert_eq!(st.len(), 2 * 20 * 48000);
        assert_eq!(st[100], st[101]);
    }
}
