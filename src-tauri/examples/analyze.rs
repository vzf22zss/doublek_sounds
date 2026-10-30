//! Afinação com faixas reais: cargo run --release --example analyze -- faixa.mp3 [bpm_min bpm_max]
//! (mp3, wav, flac, m4a, ogg)

use doublek_lib::analysis::{Analyzer, Params, HOP};

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("uso: analyze faixa.mp3 [bpm_min bpm_max]");
    let lo: f32 = args.next().map_or(80.0, |s| s.parse().unwrap());
    let hi: f32 = args.next().map_or(220.0, |s| s.parse().unwrap());

    let (stereo, sr) = doublek_lib::track::decode(std::path::Path::new(&path)).expect("não consegui abrir o arquivo");
    let mono: Vec<f32> = stereo.chunks_exact(2).map(|f| 0.5 * (f[0] + f[1])).collect();

    let sr = sr as f32;
    let mut an = Analyzer::new(sr);
    let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
    let per_10s = (10.0 * sr) as usize / HOP;
    let (mut kicks, mut first_lock) = (0, None);
    for (i, c) in mono.chunks_exact(HOP).enumerate() {
        let t = (i + 1) as f32 * HOP as f32 / sr;
        if an.process(c, &p).is_some() {
            kicks += 1;
        }
        if first_lock.is_none() && an.beat.locked {
            first_lock = Some(t);
        }
        if i % per_10s == 0 {
            let (bpm, _, _) = an.beat.at(t as f64);
            println!("{:>6.1}s  BPM {:>6.2}  {}", t, bpm, if an.beat.locked { "travado" } else { "-" });
        }
    }
    let secs = mono.len() as f32 / sr;
    let (bpm, _, _) = an.beat.at(secs as f64);
    println!("\nfinal: {bpm:.2} BPM · {kicks} kicks em {secs:.0} s · travou em {first_lock:?} s");
    let g = doublek_lib::track::analyze(&stereo, sr as u32, lo, hi);
    println!("grade da faixa inteira (roteiro): {:.3} BPM, 1º beat em {:.3} s", g.bpm, g.anchor);
}
