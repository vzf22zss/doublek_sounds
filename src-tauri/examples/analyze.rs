//! Afinação com faixas reais: cargo run --example analyze -- faixa.wav [bpm_min bpm_max]

use doublek_lib::analysis::{Analyzer, Params, HOP};

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("uso: analyze faixa.wav [bpm_min bpm_max]");
    let lo: f32 = args.next().map_or(80.0, |s| s.parse().unwrap());
    let hi: f32 = args.next().map_or(220.0, |s| s.parse().unwrap());

    let mut r = hound::WavReader::open(&path).expect("não consegui abrir o WAV");
    let spec = r.spec();
    let ch = spec.channels as usize;
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().map(Result::unwrap).collect(),
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|s| s.unwrap() as f32 * scale).collect()
        }
    };
    let mono: Vec<f32> = samples.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect();

    let sr = spec.sample_rate as f32;
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
}
