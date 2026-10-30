//! Relógio de beat: a partir dos kicks detectados, ajusta uma grade t = âncora + período·n
//! (regressão linear só com os kicks que caem na grade). Continua girando durante os
//! breakdowns, então o visual segue no tempo mesmo sem kick.

use std::collections::VecDeque;

const WINDOW: f64 = 8.0; // segundos de kicks usados no ajuste
const HOLD: f64 = 30.0; // quanto tempo a grade segura sem kick (breakdown)
const TOL: f64 = 0.12; // fração do beat que um kick pode estar fora da grade
const FLIP: f32 = 1.5; // o contratempo precisa de 1.5× mais punch para virar a fase
const FLIP_MIN: usize = 3; // candidatos em cada fase antes de comparar

#[derive(Default)]
pub struct Beat {
    kicks: VecDeque<f64>,
    taps: Vec<f64>,
    pub period: f64, // segundos; 0 = desconhecido
    pub anchor: f64, // instante de um beat
    pub locked: bool,
    last: f64,
    count: i64, // mantém o índice do beat contínuo quando a âncora muda
    fixed: bool, // grade vinda da análise do arquivo: os kicks não mexem nela
    scored: VecDeque<(f64, f32)>, // candidatos com click (aceitos ou não): instante e punch
}

impl Beat {
    pub fn on_kick(&mut self, t: f64, lo: f64, hi: f64, freeze: bool) {
        self.last = t;
        if self.fixed {
            return;
        }
        self.kicks.push_back(t);
        while self.kicks.front().is_some_and(|&k| k < t - WINDOW) {
            self.kicks.pop_front();
        }
        if self.kicks.len() < 4 {
            return;
        }
        let ks = self.kicks.make_contiguous();
        // primeiro tenta manter o andamento atual; se a música mudou, recomeça pela mediana
        let tries = [(self.period > 0.0).then_some(self.period), median_ioi(ks, lo, hi)];
        for p0 in tries.into_iter().flatten() {
            let Some((mut p, mut a, mut n, mut sd)) = fit(ks, p0, None, freeze) else { continue };
            // ½ errado: kick perdido só alonga intervalos, então a mediana pode cair em 2 beats. Se a
            // metade do período cabe na faixa (só em faixas largas, como Auto) e a grade com ela
            // explica mais kicks (os do contratempo), é ela. Sem isso o ½ se realimenta: depois de
            // travar, os kicks fora da grade são recusados.
            if !freeze && 120.0 / p <= hi * 1.03 {
                if let Some(h) = fit(ks, p / 2.0, Some(a), false).filter(|h| h.2 > n) {
                    (p, a, n, sd) = h;
                }
            }
            let bpm = 60.0 / p;
            let in_range = freeze || (bpm >= lo * 0.97 && bpm <= hi * 1.03);
            if in_range && n * 10 >= ks.len() * 6 {
                // volta do drop: a janela tem poucos kicks (o breakdown esvaziou), mas todos caem na
                // grade que já estava travada → mantém a trava em vez de esperar o 6º kick. Só com a
                // janela limpa (n == todos): numa troca de música há kicks fora da grade velha.
                let same = self.locked && n == ks.len() && sd < 0.035 * p && (p - self.period).abs() < 0.03 * self.period && {
                    let x = (a - self.anchor) / self.period;
                    (x - x.round()).abs() < TOL
                };
                self.rebase(a, p);
                self.locked = same || (n >= 6 && sd < 0.035 * p);
                return;
            }
        }
    }

    /// Fase da grade: candidatos com click na fase e no contratempo (meio beat) com o "punch".
    /// Chimbal + nota do baixo também têm click e sub, e antes de travar passam como kick; se a
    /// âncora cair neles, os kicks reais ficam fora da grade (e no refratário) e a grade se
    /// realimenta no contratempo. O que separa os dois não é o sub (a nota do baixo tem tanto
    /// quanto o kick) e sim o "punch": a varredura do kick passa por 100–200 Hz nos primeiros
    /// 30 ms. Se o contratempo tiver consistentemente mais punch que a fase atual, a grade anda
    /// meio beat. Vale também com a grade já travada errada.
    pub fn score(&mut self, t: f64, peak: f32) {
        self.scored.push_back((t, peak));
        while self.scored.front().is_some_and(|&(s, _)| s < t - WINDOW) {
            self.scored.pop_front();
        }
        if self.fixed || self.period <= 0.0 {
            return;
        }
        let (mut on, mut anti) = (vec![], vec![]);
        for &(s, pk) in &self.scored {
            let f = ((s - self.anchor) / self.period).rem_euclid(1.0);
            if f < TOL || f > 1.0 - TOL {
                on.push((s, pk));
            } else if (f - 0.5).abs() < TOL {
                anti.push((s, pk));
            }
        }
        let mean = |v: &[(f64, f32)]| v.iter().map(|x| x.1).sum::<f32>() / v.len().max(1) as f32;
        if on.len() >= FLIP_MIN && anti.len() >= FLIP_MIN && mean(&anti) > FLIP * mean(&on) {
            let p = self.period;
            self.rebase(self.anchor + p / 2.0, p);
            // a janela do ajuste passa a ser os candidatos da fase nova (os kicks de verdade)
            self.kicks = anti.iter().map(|x| x.0).collect();
            self.scored.clear();
        }
    }

    /// Chamar a cada hop: solta a grade depois de muito tempo sem kick.
    pub fn tick(&mut self, t: f64) {
        if self.locked && !self.fixed && t - self.last > HOLD {
            self.locked = false;
        }
    }

    /// `Some(true)` se `t` cai perto de um beat previsto; `None` se ainda não travou.
    pub fn on_grid(&self, t: f64) -> Option<bool> {
        if !self.locked {
            return None;
        }
        let x = (t - self.anchor) / self.period;
        Some((x - x.round()).abs() < TOL)
    }

    pub fn holding(&self, t: f64) -> bool {
        self.locked && !self.fixed && t - self.last > 1.5 * self.period
    }

    /// Grade conhecida (análise do arquivo inteiro): trava e não se ajusta mais pelos kicks.
    pub fn set_grid(&mut self, anchor: f64, period: f64) {
        *self = Self { anchor, period, locked: true, fixed: true, ..Default::default() };
    }

    /// (bpm, fase 0..1 dentro do beat, índice do beat)
    pub fn at(&self, t: f64) -> (f32, f32, i64) {
        if self.period <= 0.0 {
            return (0.0, 0.0, 0);
        }
        let x = (t - self.anchor) / self.period;
        ((60.0 / self.period) as f32, (x - x.floor()) as f32, self.count + x.floor() as i64)
    }

    fn rebase(&mut self, anchor: f64, period: f64) {
        if self.period > 0.0 {
            self.count += ((anchor - self.anchor) / self.period).round() as i64;
        }
        self.anchor = anchor;
        self.period = period;
    }

    pub fn tap(&mut self, t: f64) {
        if self.taps.last().is_some_and(|&l| t - l > 2.0) {
            self.taps.clear();
        }
        self.taps.push(t);
        if self.taps.len() < 4 {
            return;
        }
        let mut d: Vec<f64> = self.taps.windows(2).map(|w| w[1] - w[0]).collect();
        d.sort_by(f64::total_cmp);
        if let Some((p, a, _, _)) = fit(&self.taps, d[d.len() / 2], None, false) {
            self.rebase(a, p);
            self.locked = true;
            self.last = t;
            self.kicks.clear();
        }
    }

    pub fn nudge(&mut self, dt: f64) {
        self.anchor += dt;
    }

    pub fn scale_tempo(&mut self, factor: f64) {
        if self.period > 0.0 {
            self.period /= factor;
            self.kicks.clear();
        }
    }
}

/// Mediana dos intervalos entre kicks, dobrados/divididos para cair na faixa de BPM.
fn median_ioi(ks: &[f64], lo: f64, hi: f64) -> Option<f64> {
    let (pmin, pmax) = (60.0 / hi * 0.93, 60.0 / lo * 1.07);
    let mut v: Vec<f64> = ks
        .windows(2)
        .filter_map(|w| {
            let iv = w[1] - w[0];
            [1.0, 0.5, 1.0 / 3.0, 0.25, 2.0].iter().map(|m| iv * m).find(|x| (pmin..=pmax).contains(x))
        })
        .collect();
    if v.len() < 3 {
        return None;
    }
    v.sort_by(f64::total_cmp);
    Some(v[v.len() / 2])
}

/// Ajusta t = a + p·n aos instantes que caem na grade. Devolve (p, a, inliers, desvio).
/// Sem âncora inicial, parte do último instante.
pub(crate) fn fit(ts: &[f64], p0: f64, a0: Option<f64>, freeze: bool) -> Option<(f64, f64, usize, f64)> {
    let (mut p, mut a) = (p0, a0.or(ts.last().copied())?);
    let mut pts = Vec::with_capacity(ts.len());
    for _ in 0..3 {
        pts.clear();
        for &t in ts {
            let x = (t - a) / p;
            let n = x.round();
            if ((x - n) * p).abs() < TOL * p {
                pts.push((n, t));
            }
        }
        if pts.len() < 3 {
            return None;
        }
        let m = pts.len() as f64;
        if freeze {
            a = pts.iter().map(|(n, t)| t - p * n).sum::<f64>() / m;
            continue;
        }
        let (mut sn, mut st, mut snn, mut snt) = (0.0, 0.0, 0.0, 0.0);
        for &(n, t) in &pts {
            sn += n;
            st += t;
            snn += n * n;
            snt += n * t;
        }
        let den = m * snn - sn * sn;
        if den.abs() < 1e-9 {
            return None;
        }
        p = (m * snt - sn * st) / den;
        a = (st - p * sn) / m;
    }
    let sd = (pts.iter().map(|(n, t)| (t - a - p * n).powi(2)).sum::<f64>() / pts.len() as f64).sqrt();
    Some((p, a, pts.len(), sd))
}
