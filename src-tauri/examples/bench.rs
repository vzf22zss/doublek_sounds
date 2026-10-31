//! Benchmark de detecção de kick/BPM em faixas sintéticas (DK-008):
//!   cargo run --release --example bench            → tabelas Markdown no stdout
//!   cargo run --release --example bench -- 30      → duração de cada faixa em segundos (padrão 30)
//!   cargo run --release --example bench -- custo   → só o custo do Analyzer::process (µs por hop)
//! No fim, um estresse com 10 sementes por cenário: uma semente só esconde casos que dependem
//! de quais kicks se perdem no aquecimento (ex.: grade no contratempo com chimbal).
//! Só mede; não muda parâmetros nem algoritmo. O relatório fica em docs/quality/DETECCAO.md.

use doublek_lib::analysis::{Analyzer, Params, HOP};
use doublek_lib::synth::Synth;
use std::time::Instant;

const BPMS: [f64; 7] = [135.0, 140.0, 148.0, 160.0, 175.0, 200.0, 220.0];
const TOL: f64 = 0.030; // ±30 ms conta como acerto
const WARMUP: f64 = 3.0; // antes disso o limiar ainda está aprendendo
const BREAK: (f64, f64) = (10.0, 18.0);

/// Faixa de andamento do app coerente com o BPM (App.svelte: Psy 135–150, Dark 145–185, Hi-tech 175–220).
fn genre(bpm: f64) -> (&'static str, f32, f32) {
    if bpm <= 150.0 {
        ("Psy", 135.0, 150.0)
    } else if bpm <= 185.0 {
        ("Dark", 145.0, 185.0)
    } else {
        ("Hi-tech", 175.0, 220.0)
    }
}

fn scenarios(bpm: f64, secs: f64) -> Vec<(&'static str, Synth)> {
    let base = Synth { bpm, secs, ..Default::default() };
    vec![
        ("limpo", Synth { rolling: false, ..base.clone() }),
        ("baixo rolante", base.clone()),
        ("breakdown 10–18 s", Synth { breakdown: Some(BREAK), ..base.clone() }),
        ("ruído alto (−14 dBFS)", Synth { noise: 0.2, ..base.clone() }),
        ("volume −20 dB", Synth { gain: 0.1, ..base.clone() }),
        ("cold start (2 s de silêncio)", Synth { start: 2.0, ..base.clone() }),
    ]
}

struct Res {
    precision: f64,
    recall: f64,
    est: f64,
    lock_after: Option<f64>, // segundos entre o 1º kick e a trava
    delay_ms: f64,           // mediana de (detectado − real) nos acertos
    unlocks: usize,          // quantas vezes a trava caiu
    false_in_break: usize,
    offbeat: bool,                     // travou com a grade meio beat fora dos kicks reais
    counts: (usize, usize, usize, usize), // detectados, falsos, acertos, kicks reais (após WARMUP)
}

fn measure(s: &Synth, lo: f32, hi: f32) -> Res {
    let (x, truth) = s.render();
    let sr = s.sr;
    let mut an = Analyzer::new(sr);
    let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
    let (mut det, mut lock_at, mut was_locked, mut unlocks) = (vec![], None, false, 0);
    for (i, c) in x.chunks_exact(HOP).enumerate() {
        let t = (i + 1) as f64 * HOP as f64 / sr as f64;
        if an.process(c, &p).is_some() {
            det.push(t);
        }
        if an.beat.locked && lock_at.is_none() {
            lock_at = Some(t);
        }
        if was_locked && !an.beat.locked {
            unlocks += 1;
        }
        was_locked = an.beat.locked;
    }
    let offbeat = an.beat.locked && an.beat.period > 0.0 && {
        let x = (truth[0] - an.beat.anchor) / an.beat.period;
        (x - x.round()).abs() > 0.35
    };
    let truth: Vec<f64> = truth.into_iter().filter(|&t| t > WARMUP).collect();
    let det: Vec<f64> = det.into_iter().filter(|&d| d > WARMUP).collect();
    let near = |a: f64, b: f64| (a - b).abs() < TOL;
    let mut delays: Vec<f64> = truth.iter().filter_map(|&t| det.iter().find(|&&d| near(d, t)).map(|d| (d - t) * 1000.0)).collect();
    delays.sort_by(f64::total_cmp);
    let hits = delays.len();
    let falses: Vec<f64> = det.iter().copied().filter(|&d| !truth.iter().any(|&t| near(d, t))).collect();
    let (est, _, _) = an.beat.at(s.secs);
    Res {
        precision: if det.is_empty() { 0.0 } else { (det.len() - falses.len()) as f64 / det.len() as f64 },
        recall: if truth.is_empty() { 0.0 } else { hits as f64 / truth.len() as f64 },
        est: est as f64,
        lock_after: lock_at.map(|t| t - s.start),
        delay_ms: delays.get(hits / 2).copied().unwrap_or(f64::NAN),
        unlocks,
        false_in_break: s.breakdown.map_or(0, |(a, b)| falses.iter().filter(|&&d| d >= a && d < b).count()),
        offbeat,
        counts: (det.len(), falses.len(), hits, truth.len()),
    }
}

/// Indicadores de energia (DK-031) por BPM, faixa do gênero. Build-up = 8 compassos de groove,
/// 16 de breakdown com ruído subindo nos 8 últimos, 8 de groove. Groove = baixo rolante, 30 s.
fn indicators() {
    let frames = |s: &Synth, lo: f32, hi: f32| {
        let (x, _) = s.render();
        let mut an = Analyzer::new(s.sr);
        let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
        let mut out = vec![];
        for (i, c) in x.chunks_exact(HOP).enumerate() {
            an.process(c, &p);
            if i % 2 == 1 {
                out.push(((i + 1) as f64 * HOP as f64 / s.sr as f64, an.snapshot()));
            }
        }
        out
    };
    println!("
### Indicadores de energia (DK-031)
");
    println!("| BPM | Faixa | Contraste máx. groove | Contraste máx. no build-up | Kicks/compasso groove | Kicks/compasso breakdown (máx.) | Estabilidade groove (mín. após 8 s) |");
    println!("|---:|---|---:|---:|---:|---:|---:|");
    for &bpm in &BPMS {
        let (name, lo, hi) = genre(bpm);
        let bar = 4.0 * 60.0 / bpm;
        let g = frames(&Synth { bpm, secs: 30.0, ..Default::default() }, lo, hi);
        let b = frames(&Synth { bpm, secs: 32.0 * bar, breakdown: Some((8.0 * bar, 24.0 * bar)), riser: Some((16.0 * bar, 24.0 * bar)), ..Default::default() }, lo, hi);
        let late = || g.iter().filter(|(t, _)| *t > 8.0).map(|(_, f)| f);
        let (rmin, rmax) = late().fold((9f32, 0f32), |(a, z), f| (a.min(f.kick_rate), z.max(f.kick_rate)));
        println!(
            "| {bpm:.0} | {name} | {:.2} | {:.2} | {rmin:.1}–{rmax:.1} | {:.1} | {:.2} |",
            g.iter().map(|(_, f)| f.contrast).fold(0.0, f32::max),
            b.iter().filter(|(t, _)| (16.0 * bar..24.0 * bar).contains(t)).map(|(_, f)| f.contrast).fold(0.0, f32::max),
            b.iter().filter(|(t, _)| (10.0 * bar..24.0 * bar).contains(t)).map(|(_, f)| f.kick_rate).fold(0.0, f32::max),
            late().map(|f| f.stability).fold(1.0, f32::min),
        );
    }
}

/// Pausa de 3 s (silêncio digital ou só ruído de fundo) e a mesma faixa voltando com outra fase:
/// recall nos 20 s depois da pausa e tempo até travar de novo na fase nova (meta: ≥ 0,9 e ≤ 4 s).
fn pause() {
    println!("
### Pausa de 3 s + mesma faixa defasada (faixa do gênero)
");
    println!("| BPM | Pausa | Recall nos 20 s depois | Re-trava na fase nova | Fase final (beats) |");
    println!("|---:|---|---:|---:|---:|");
    for &bpm in &BPMS {
        let (_, lo, hi) = genre(bpm);
        for (name, noisy) in [("silêncio digital", false), ("ruído de fundo", true)] {
            let r = pause_run(bpm, lo, hi, noisy);
            println!(
                "| {bpm:.0} | {name} | {:.2} | {} | {:.2} |",
                r.0,
                r.1.map_or("**não**".to_string(), |t| format!("{t:.1} s")),
                r.2
            );
        }
    }
}

/// (recall depois da pausa, segundos até travar na fase nova, distância da grade aos kicks no fim)
fn pause_run(bpm: f64, lo: f32, hi: f32, noisy: bool) -> (f64, Option<f64>, f64) {
    let mut x = Synth { bpm, secs: 20.0, ..Default::default() }.render().0;
    if noisy {
        x.extend(Synth { bpm, secs: 3.0, start: 99.0, seed: 3, ..Default::default() }.render().0);
    } else {
        x.extend(vec![0.0; 3 * 48000]);
    }
    let t0 = x.len() as f64 / 48000.0;
    let (b, truth) = Synth { bpm, secs: 20.0, seed: 2, ..Default::default() }.render();
    x.extend(b);
    let truth: Vec<f64> = truth.iter().map(|t| t + t0).collect();
    let mut an = Analyzer::new(48000.0);
    let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
    let (mut det, mut relock) = (vec![], None);
    let on_new = |an: &Analyzer| {
        let x = (truth[0] - an.beat.anchor) / an.beat.period;
        an.beat.locked && (x - x.round()).abs() < 0.15
    };
    for (i, c) in x.chunks_exact(HOP).enumerate() {
        let t = (i + 1) as f64 * HOP as f64 / 48000.0;
        if an.process(c, &p).is_some() && t > t0 {
            det.push(t);
        }
        if t > t0 && relock.is_none() && on_new(&an) {
            relock = Some(t - t0);
        }
    }
    let hits = truth.iter().filter(|&&k| det.iter().any(|&d| (d - k).abs() < TOL)).count();
    let x = (truth[0] - an.beat.anchor) / an.beat.period;
    (hits as f64 / truth.len() as f64, relock, (x - x.round()).abs())
}

/// Custo do `Analyzer::process` por hop: a mesma faixa (148 BPM, baixo rolante, 30 s) 7 vezes,
/// fica a menor (a máquina tem outros processos; a mínima é a mais estável entre execuções).
fn cost() -> f64 {
    let (x, _) = Synth { bpm: 148.0, secs: 30.0, ..Default::default() }.render();
    let p = Params { bpm_min: 135.0, bpm_max: 150.0, ..Default::default() };
    let hops = x.len() / HOP;
    (0..7)
        .map(|_| {
            let mut an = Analyzer::new(48000.0);
            let t0 = Instant::now();
            for c in x.chunks_exact(HOP) {
                std::hint::black_box(an.process(c, &p));
            }
            t0.elapsed().as_nanos() as f64 / hops as f64 / 1000.0
        })
        .fold(f64::INFINITY, f64::min)
}

/// Mesmos cenários com 10 sementes × 7 BPM, faixa do gênero. Conta tudo junto e lista as faixas
/// com problema como BPM/semente (para reproduzir: `Synth { bpm, seed, .. }`).
fn stress(secs: f64) {
    const SEEDS: u32 = 10;
    type Fam = (&'static str, fn(Synth) -> Synth);
    let fams: [Fam; 6] = [
        ("limpo", |s| Synth { rolling: false, ..s }),
        ("baixo rolante", |s| s),
        ("breakdown 10–18 s", |s| Synth { breakdown: Some(BREAK), ..s }),
        ("ruído alto (−14 dBFS)", |s| Synth { noise: 0.2, ..s }),
        ("chimbal no contratempo", |s| Synth { hats: 0.15, ..s }),
        ("chimbal + breakdown", |s| Synth { hats: 0.15, breakdown: Some(BREAK), ..s }),
    ];
    println!("\n### Estresse: {SEEDS} sementes × {} BPM por cenário (faixa do gênero)\n", BPMS.len());
    println!("| Cenário | Precisão | Recall | Quedas de trava | Grade no contratempo | Pior erro BPM | Faixas com problema (BPM/semente) |");
    println!("|---|---:|---:|---:|---:|---:|---|");
    for (name, f) in fams {
        let (mut c, mut unl, mut off, mut worst_err, mut bad) = ((0, 0, 0, 0), 0, 0, 0f64, vec![]);
        for &bpm in &BPMS {
            let (_, lo, hi) = genre(bpm);
            for seed in 1..=SEEDS {
                let r = measure(&f(Synth { bpm, secs, seed, ..Default::default() }), lo, hi);
                c = (c.0 + r.counts.0, c.1 + r.counts.1, c.2 + r.counts.2, c.3 + r.counts.3);
                unl += r.unlocks;
                off += r.offbeat as usize;
                worst_err = worst_err.max((r.est - bpm).abs());
                if r.precision < 0.95 || r.recall < 0.95 || r.unlocks > 0 || r.offbeat || (r.est - bpm).abs() > 0.5 {
                    bad.push(format!("{bpm:.0}/s{seed}"));
                }
            }
        }
        let more = if bad.len() > 12 { format!(" … (+{})", bad.len() - 12) } else { String::new() };
        println!(
            "| {name} | {:.3} | {:.3} | {unl} | {off} | {worst_err:.2} | {}{more} |",
            (c.0 - c.1) as f64 / c.0.max(1) as f64,
            c.2 as f64 / c.3.max(1) as f64,
            if bad.is_empty() { "—".to_string() } else { bad.iter().take(12).cloned().collect::<Vec<_>>().join(" ") }
        );
    }
}

/// "½" ou "×2" se a estimativa ficou perto da metade ou do dobro (±3 %); "⅔"/"3/2" para os outros erros clássicos.
fn ratio_error(est: f64, bpm: f64) -> &'static str {
    let r = est / bpm;
    let close = |x: f64| (r - x).abs() < 0.03 * x;
    if close(0.5) {
        "½"
    } else if close(2.0) {
        "×2"
    } else if close(2.0 / 3.0) || close(1.5) || close(4.0 / 3.0) || close(0.75) {
        "outra razão"
    } else {
        "não"
    }
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("custo") {
        println!("{:.3}", cost()); // só o custo, para comparar binários lado a lado
        return;
    }
    let secs: f64 = std::env::args().nth(1).map_or(30.0, |a| a.parse().expect("duração em segundos"));
    println!("<!-- gerado por `cargo run --release --example bench` (src-tauri); faixas de {secs:.0} s a 48 kHz, HOP {HOP}, janela ±{:.0} ms, medido após {WARMUP:.0} s -->", TOL * 1000.0);
    let mut worst: Vec<String> = vec![];
    fn auto(_: f64) -> (&'static str, f32, f32) {
        ("Auto", 80.0, 220.0)
    }
    let tables: [(&str, fn(f64) -> (&'static str, f32, f32)); 2] = [("Faixa de andamento do gênero", genre), ("Faixa Auto (80–220)", auto)];
    for (title, pick) in tables {
        println!("\n### {title}\n");
        println!("| BPM | Faixa | Cenário | Precisão | Recall | Erro BPM | Trava após | Atraso | ½/×2 | Obs. |");
        println!("|---:|---|---|---:|---:|---:|---:|---:|:---:|---|");
        for &bpm in &BPMS {
            let (name, lo, hi) = pick(bpm);
            for (scen, s) in scenarios(bpm, secs) {
                let r = measure(&s, lo, hi);
                let err = r.est - bpm;
                let ratio = ratio_error(r.est, bpm);
                let mut obs = vec![];
                if r.lock_after.is_none() {
                    obs.push("**não travou**".to_string());
                }
                if r.unlocks > 0 {
                    obs.push(format!("perdeu a trava {}×", r.unlocks));
                }
                if r.false_in_break > 0 {
                    obs.push(format!("{} falsos no breakdown", r.false_in_break));
                }
                if r.offbeat {
                    obs.push("**grade no contratempo**".to_string());
                }
                let bad = r.precision < 0.95 || r.recall < 0.95 || err.abs() > 0.5 || r.lock_after.is_none() || ratio != "não" || r.offbeat;
                if bad {
                    worst.push(format!("{bpm:.0} BPM · {name} · {scen}: precisão {:.2}, recall {:.2}, erro {err:+.2} BPM, ½/×2 {ratio}", r.precision, r.recall));
                }
                println!(
                    "| {bpm:.0} | {name} {lo:.0}–{hi:.0} | {scen} | {:.2} | {:.2} | {err:+.2} | {} | {} | {ratio} | {} |",
                    r.precision,
                    r.recall,
                    r.lock_after.map_or("—".to_string(), |t| format!("{t:.1} s")),
                    if r.delay_ms.is_nan() { "—".to_string() } else { format!("{:.1} ms", r.delay_ms) },
                    obs.join("; ")
                );
            }
        }
    }
    println!("\n### Casos fora da meta (precisão/recall < 0,95, |erro| > 0,5 BPM, sem trava ou ½/×2)\n");
    if worst.is_empty() {
        println!("Nenhum.");
    }
    for w in worst {
        println!("- {w}");
    }
    stress(secs);
    indicators();
    pause();
    println!("
Custo do `Analyzer::process`: **{:.2} µs por hop** (mínimo de 7 passadas; o hop dura {:.0} µs a 48 kHz).", cost(), HOP as f64 / 48.0 * 1000.0);
}
