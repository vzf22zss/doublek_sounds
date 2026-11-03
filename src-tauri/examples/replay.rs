//! Resumo de um diário de análise (DK-144) para a calibração:
//!   cargo run --release --example replay -- caminho\do\diario.jsonl
//! Só números (o arquivo não tem áudio). O estado do show-engine é refeito do lado TS, que é
//! onde as regras moram; aqui ficam os números brutos (ver docs/quality/CALIBRACAO.md).

use doublek_lib::diary::{read, summarize, MATCH};
use std::path::Path;

fn main() {
    let path = std::env::args().nth(1).expect("uso: replay <diario.jsonl>");
    let (lines, cut) = read(Path::new(&path)).unwrap_or_else(|e| panic!("não consegui ler {path}: {e}"));
    let s = summarize(&lines);
    println!("# Diário {path}\n");
    println!("| Medida | Valor |\n|---|---:|");
    let secs = s.secs.round() as u64; // arredonda antes: 119,95 s não vira "1 min 60 s"
    println!("| Duração | {} min {} s ({} amostras) |", secs / 60, secs % 60, s.samples);
    println!("| Tempo travado | {:.1} % |", s.locked_pct);
    println!("| Quedas de trava | {} |", s.unlocks);
    println!("| Saltos de fase (P8) / recomeços | {} / {} |", s.jumps, s.restarts);
    println!("| Tempo com contraste > 1,2 (build) | {:.1} % |", s.build_pct);
    println!("| Marcas \"drop\" do operador | {} |", s.marks);
    println!("| … com drop detectado a ±{MATCH:.0} s | {} (atraso médio {:+.2} s) |", s.drop_hits, s.drop_delay_mean);
    println!("| … sem drop detectado (perdidos) | {} |", s.drop_missed);
    println!("| Drops detectados sem marca (falsos ou não marcados) | {} |", s.drop_false);
    if cut {
        println!("| Última linha cortada (ignorada) | sim |");
    }
    println!("\n## Kicks por compasso, por minuto\n\n| Minuto | Kicks/compasso |\n|---:|---:|");
    for (m, k) in &s.kick_rate_by_min {
        println!("| {m:.0} | {k:.2} |");
    }
}
