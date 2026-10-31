//! Entradas MIDI: conecta em todos os controladores e reconecta quando a lista muda
//! (plugou/desplugou no meio do set). Repassa CC e notas para a UI (o mapeamento fica lá) e
//! entrega o MIDI Clock (0xF8 pulso, 0xFA start, 0xFB continue, 0xFC stop) ao `MidiClock`.

use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Relógio comum (s) entre a thread do MIDI e a da análise.
pub fn now() -> f64 {
    static T0: OnceLock<Instant> = OnceLock::new();
    T0.get_or_init(Instant::now).elapsed().as_secs_f64()
}

const PPQN: i64 = 24; // pulsos por beat (semínima)
const WINDOW: usize = 96; // pulsos na regressão do andamento (4 beats)
pub const QUIET: f64 = 2.0; // sem pulso por isso, o áudio volta a mandar no relógio

/// Andamento (e, depois de um Start, a fase) vindos de fora.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ExtClock {
    pub period: f64,              // s por beat
    pub beat: Option<(f64, i64)>, // instante de um beat e o índice dele (só depois de Start)
}

impl ExtClock {
    /// Mesmo relógio, com os instantes deslocados (do relógio do MIDI para o da análise).
    pub fn shifted(self, dt: f64) -> Self {
        Self { beat: self.beat.map(|(a, k)| (a + dt, k)), ..self }
    }
}

/// MIDI Clock: cada pulso ganha um índice (pulsos perdidos contam pelo intervalo; pulso fora do
/// lugar é descartado) e o andamento sai da regressão instante × índice dos últimos 96. Troca de
/// andamento: se o último beat de pulsos foge > 3 % da regressão, a janela recomeça nele.
/// Start: o próximo pulso é o beat 0 e a fase passa a valer. Continue/Stop não mudam nada (sem
/// Song Position não se sabe onde a música está; quem para de mandar pulsos devolve ao áudio).
#[derive(Default)]
pub struct MidiClock {
    ticks: VecDeque<(f64, i64)>,
    zero: bool,    // veio Start: o próximo pulso é o beat 0
    started: bool, // a fase vale (houve Start desde que estes pulsos começaram)
}

impl MidiClock {
    pub fn event(&mut self, status: u8, t: f64) {
        match status {
            0xF8 => self.tick(t),
            0xFA => self.zero = true,
            _ => {}
        }
    }

    fn tick(&mut self, t: f64) {
        if self.zero || self.ticks.back().is_some_and(|&(lt, _)| t - lt > QUIET) {
            self.ticks.clear();
            self.started = std::mem::take(&mut self.zero);
        }
        let idx = match self.ticks.back() {
            None => 0,
            Some(&(lt, li)) => {
                // período local (últimos 6 pulsos): numa troca brusca de andamento a regressão
                // longa ainda está no velho e contaria errado os pulsos perdidos
                let n = self.ticks.len();
                let local: VecDeque<(f64, i64)> = self.ticks.iter().skip(n.saturating_sub(6)).copied().collect();
                let tp = fit(&local).map_or(t - lt, |f| f.0);
                let x = (t - lt) / tp;
                let k = x.round().max(1.0);
                if (x - k).abs() > 0.4 {
                    return; // pulso fora do lugar (duplicado, jitter grosso)
                }
                li + k as i64
            }
        };
        self.ticks.push_back((t, idx));
        while self.ticks.len() > WINDOW {
            self.ticks.pop_front();
        }
        let n = self.ticks.len();
        if n >= 2 * PPQN as usize {
            let recent: VecDeque<(f64, i64)> = self.ticks.iter().skip(n - PPQN as usize).copied().collect();
            if let (Some((all, _)), Some((last, _))) = (fit(&self.ticks), fit(&recent)) {
                if (last / all - 1.0).abs() > 0.03 {
                    self.ticks = recent;
                }
            }
        }
    }

    /// `None` antes de 1 beat de pulsos ou 2 s depois do último: o relógio volta para o áudio.
    pub fn state(&self, t: f64) -> Option<ExtClock> {
        let &(lt, li) = self.ticks.back()?;
        if self.ticks.len() < PPQN as usize || t - lt > QUIET {
            return None;
        }
        let (tp, a) = fit(&self.ticks)?;
        let beat = self.started.then(|| {
            let k = li.div_euclid(PPQN);
            (a + tp * (k * PPQN) as f64, k)
        });
        Some(ExtClock { period: tp * PPQN as f64, beat })
    }
}

/// Regressão t = a + tp·índice. Devolve (tp, a).
fn fit(ts: &VecDeque<(f64, i64)>) -> Option<(f64, f64)> {
    if ts.len() < 3 {
        return None;
    }
    let n = ts.len() as f64;
    let (mut si, mut st, mut sii, mut sit) = (0.0, 0.0, 0.0, 0.0);
    for &(t, i) in ts {
        let i = i as f64;
        si += i;
        st += t;
        sii += i * i;
        sit += i * t;
    }
    let den = n * sii - si * si;
    if den.abs() < 1e-9 {
        return None;
    }
    let tp = (n * sit - si * st) / den;
    (tp > 0.0).then_some((tp, (st - tp * si) / n))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MidiMsg {
    pub kind: &'static str, // "cc" | "note"
    pub ch: u8,
    pub num: u8,
    pub val: u8, // note off chega como note com val 0
}

pub fn parse(b: &[u8]) -> Option<MidiMsg> {
    let (&st, d) = b.split_first()?;
    let ch = st & 0x0f;
    match (st & 0xf0, d) {
        (0xB0, [n, v, ..]) => Some(MidiMsg { kind: "cc", ch, num: *n, val: *v }),
        (0x90, [n, v, ..]) => Some(MidiMsg { kind: "note", ch, num: *n, val: *v }),
        (0x80, [n, _, ..]) => Some(MidiMsg { kind: "note", ch, num: *n, val: 0 }),
        _ => None,
    }
}

fn port_names() -> Vec<String> {
    MidiInput::new("doublek-scan")
        .map(|m| m.ports().iter().filter_map(|p| m.port_name(p).ok()).collect())
        .unwrap_or_default()
}

/// Roda para sempre (numa thread própria). `on_devices` recebe os nomes; "(ocupado)" = outro
/// programa abriu o controlador antes (no Windows a entrada MIDI costuma ser exclusiva).
pub fn watch<F>(on_msg: F, mut on_devices: impl FnMut(Vec<String>), clock: Arc<Mutex<MidiClock>>)
where
    F: FnMut(MidiMsg) + Send + Clone + 'static,
{
    let mut names: Vec<String> = vec![];
    let mut conns: Vec<MidiInputConnection<()>> = vec![];
    loop {
        let now = port_names();
        if now != names {
            conns.clear(); // fecha as conexões antigas antes de reabrir
            let mut shown = vec![];
            for (i, name) in now.iter().enumerate() {
                let conn = MidiInput::new("doublek").ok().and_then(|mi| {
                    let port = mi.ports().get(i)?.clone();
                    let mut f = on_msg.clone();
                    let clock = clock.clone();
                    mi.connect(&port, "doublek-in", move |_, b, _| {
                        if let Some(&st @ (0xF8 | 0xFA | 0xFB | 0xFC)) = b.first() {
                            if let Ok(mut c) = clock.lock() {
                                c.event(st, crate::midi::now()); // `now` aqui é a lista de portas
                            }
                        } else if let Some(m) = parse(b) {
                            f(m)
                        }
                    }, ())
                    .ok()
                });
                shown.push(if conn.is_some() { name.clone() } else { format!("{name} (ocupado)") });
                conns.extend(conn);
            }
            names = now;
            on_devices(shown);
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cc_and_notes() {
        assert_eq!(parse(&[0xB1, 21, 64]), Some(MidiMsg { kind: "cc", ch: 1, num: 21, val: 64 }));
        assert_eq!(parse(&[0x90, 36, 100]), Some(MidiMsg { kind: "note", ch: 0, num: 36, val: 100 }));
        assert_eq!(parse(&[0x80, 36, 64]), Some(MidiMsg { kind: "note", ch: 0, num: 36, val: 0 }));
        assert_eq!(parse(&[0xF8]), None); // clock
        assert_eq!(parse(&[0xB0, 21]), None); // mensagem cortada
    }

    /// Pulsos sintéticos: Start em 1 s, 140 BPM por 10 s, depois 175 BPM por 6 s (sem novo
    /// Start), jitter ±2 ms, 10 % dos pulsos perdidos, um pulso duplicado; Stop no meio; e o
    /// relógio solta 2 s depois do último pulso.
    #[test]
    fn midi_clock_jitter_perda_start_troca() {
        let mut rng = 5u32;
        let mut rnd = move || {
            rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
            (rng >> 8) as f64 / (1u32 << 24) as f64
        };
        // instante real (sem jitter) de cada pulso
        let (tp1, tp2) = (60.0 / 140.0 / 24.0, 60.0 / 175.0 / 24.0);
        let n1 = (10.0 / tp1) as i64;
        let real = |i: i64| if i <= n1 { 1.0 + i as f64 * tp1 } else { 1.0 + n1 as f64 * tp1 + (i - n1) as f64 * tp2 };
        let mut c = MidiClock::default();
        c.event(0xFA, 0.99);
        let total = n1 + (6.0 / tp2) as i64;
        let mut last = 0.0;
        for i in 0..=total {
            if i > 0 && i != n1 - 1 && i != total && rnd() < 0.1 {
                continue; // pulso perdido
            }
            let t = real(i) + (rnd() - 0.5) * 0.004;
            c.event(0xF8, t);
            if i == 500 {
                c.event(0xF8, t + 0.0005); // duplicado
                c.event(0xFC, t + 0.001); // Stop: o andamento segue
            }
            last = t;
            let check = |c: &MidiClock, bpm: f64, tp: f64| {
                let s = c.state(t).expect("relógio ativo");
                assert!((60.0 / s.period - bpm).abs() < 0.3, "{i}: {:.2} BPM, esperado {bpm}", 60.0 / s.period);
                let (a, k) = s.beat.expect("fase depois do Start");
                assert_eq!(k, i / 24, "{i}: beat {k}");
                assert!((a - real(k * 24)).abs() < 0.003, "{i}: beat {k} em {a:.4}, real {:.4}", real(k * 24));
                let _ = tp;
            };
            if i == n1 - 1 {
                check(&c, 140.0, tp1);
            }
            if i == total {
                check(&c, 175.0, tp2);
            }
        }
        assert!(c.state(last + 1.9).is_some());
        assert_eq!(c.state(last + 2.1), None, "solta 2 s depois do último pulso");
        // pulsos voltando sem Start: só andamento, sem fase
        for i in 0..48 {
            c.event(0xF8, last + 3.0 + i as f64 * tp1);
        }
        let s = c.state(last + 3.0 + 47.0 * tp1).unwrap();
        assert!((60.0 / s.period - 140.0).abs() < 0.3 && s.beat.is_none());
    }
}
