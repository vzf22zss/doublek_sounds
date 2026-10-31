//! Diário de análise (DK-144): grava os números da análise de um set, sem áudio nenhum, para
//! calibrar a detecção com música real (D-02, D-12, D-16) sem precisar de fixtures licenciadas.
//!
//! Uma linha JSONL a cada 50 ms (tempo da análise) com o estado do relógio e da energia, mais
//! eventos no instante (`lock`, `unlock`, `jump`, `restart`, `drop_on`, `drop_off`) e marcas do
//! operador (`{"t":…,"mark":"drop"}`). A thread de análise só faz `try_send` num canal limitado:
//! canal cheio descarta a linha e conta, nunca bloqueia. Uma thread escreve o arquivo, com teto
//! de 200 MB e parada se o disco ficar com menos de 1 GiB livre.

use crate::analysis::Analyzer;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const STEP: f64 = 0.05; // uma amostra a cada 50 ms
pub const MAX_BYTES: u64 = 200 << 20;
pub const MIN_FREE: u64 = 1 << 30;
const CAPACITY: usize = 1024; // linhas no canal (~50 s de amostras)

fn r3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Estado da análise num instante (arredondado a 3 casas).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub t: f64,
    pub bpm: f64,
    pub locked: bool,
    pub holding: bool,
    pub phase: f64,
    pub beat: i64,
    pub kick: f64, // maior força de kick nos últimos 50 ms (0 = nenhum)
    pub low: bool, // grave tocando (drop)
    pub energy: f64,
    pub contrast: f64,
    pub stability: f64,
    pub kick_rate: f64,
    pub clock: String,
    pub bands: [f64; 5],
}

impl Sample {
    #[allow(clippy::too_many_arguments)]
    pub fn new(t: f64, bpm: f32, locked: bool, holding: bool, phase: f32, beat: i64, kick: f32, low: bool, energy: f32, contrast: f32, stability: f32, kick_rate: f32, clock: &str, bands: [f32; 5]) -> Self {
        Self {
            t: r3(t),
            bpm: r3(bpm as f64),
            locked,
            holding,
            phase: r3(phase as f64),
            beat,
            kick: r3(kick as f64),
            low,
            energy: r3(energy as f64),
            contrast: r3(contrast as f64),
            stability: r3(stability as f64),
            kick_rate: r3(kick_rate as f64),
            clock: clock.to_string(),
            bands: bands.map(|b| r3(b as f64)),
        }
    }
}

/// Uma linha do arquivo.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Line {
    Event { t: f64, event: String },
    Mark { t: f64, mark: String },
    Sample(Sample),
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub path: String,
    pub lines: u64,
    pub bytes: u64,
    pub dropped: u64, // linhas descartadas porque o canal estava cheio
    pub last_error: Option<String>,
}

#[derive(Default)]
struct Shared {
    status: Mutex<Status>,
    dropped: AtomicU64,
}

/// Diário aberto. `hop` é chamado pela thread de análise a cada hop; nunca bloqueia.
pub struct Diary {
    tx: Option<SyncSender<Line>>,
    shared: Arc<Shared>,
    writer: Option<JoinHandle<()>>,
    next: f64,         // próxima amostra (tempo da análise)
    kick: f32,         // maior kick desde a última amostra
    last_t: f64,       // tempo da análise no último hop
    last_at: Instant,  // e quando ele chegou (para as marcas, que vêm de outra thread)
}

impl Diary {
    /// Abre `<dir>/<AAAA-MM-DD>T<HH-MM-SS>Z.jsonl` (UTC; ":" não vale em nome de arquivo).
    pub fn start(dir: &Path) -> Result<Self, String> {
        Self::start_with(dir, MAX_BYTES, MIN_FREE, CAPACITY, Duration::ZERO)
    }

    /// `slow`: pausa por linha na escrita (só para testar o canal cheio).
    pub fn start_with(dir: &Path, max_bytes: u64, min_free: u64, capacity: usize, slow: Duration) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| format!("Pasta do diário: {e}"))?;
        if free_bytes(dir).is_some_and(|f| f < min_free) {
            return Err("Menos de 1 GiB livre no disco: o diário não foi aberto".into());
        }
        let path = dir.join(format!("{}.jsonl", stamp(SystemTime::now())));
        let file = std::fs::File::create(&path).map_err(|e| format!("Arquivo do diário: {e}"))?;
        let shared = Arc::new(Shared::default());
        *shared.status.lock().unwrap() = Status { running: true, path: path.display().to_string(), ..Default::default() };
        let (tx, rx) = sync_channel(capacity);
        let (s, d) = (shared.clone(), dir.to_path_buf());
        let writer = std::thread::Builder::new()
            .name("diario".into())
            .spawn(move || write_loop(rx, file, &d, &s, max_bytes, min_free, slow))
            .map_err(|e| e.to_string())?;
        Ok(Self { tx: Some(tx), shared, writer: Some(writer), next: 0.0, kick: 0.0, last_t: 0.0, last_at: Instant::now() })
    }

    fn send(&self, l: Line) {
        if let Some(tx) = &self.tx {
            if let Err(TrySendError::Full(_)) = tx.try_send(l) {
                self.shared.dropped.fetch_add(1, Relaxed);
            }
        }
    }

    /// Chamado depois de cada `Analyzer::process` (com o kick que ele devolveu).
    pub fn hop(&mut self, an: &Analyzer, kick: Option<f32>) {
        let t = an.time();
        (self.last_t, self.last_at) = (t, Instant::now());
        self.kick = self.kick.max(kick.unwrap_or(0.0));
        for &e in an.events() {
            self.send(Line::Event { t: r3(t), event: e.to_string() });
        }
        if t >= self.next {
            let k = std::mem::take(&mut self.kick);
            self.send(Line::Sample(an.sample(k)));
            // grade fixa de 50 ms (com `t + STEP` o intervalo arredondaria para 10 hops = 53 ms)
            self.next += STEP;
            if self.next < t {
                self.next = t + STEP; // ficou para trás (pausa na entrada): recomeça a grade
            }
        }
    }

    /// Marca do operador (ex.: "drop" na tecla M), no tempo da análise.
    pub fn mark(&self, label: &str) {
        let t = self.last_t + self.last_at.elapsed().as_secs_f64();
        self.send(Line::Mark { t: r3(t), mark: label.to_string() });
    }

    pub fn status(&self) -> Status {
        let mut s = self.shared.status.lock().unwrap().clone();
        s.dropped = self.shared.dropped.load(Relaxed);
        s
    }

    /// Fecha o canal, espera a escrita terminar e devolve o estado final.
    pub fn stop(mut self) -> Status {
        self.finish();
        self.status()
    }

    fn finish(&mut self) {
        self.tx = None;
        if let Some(w) = self.writer.take() {
            let _ = w.join();
        }
        self.shared.status.lock().unwrap().running = false;
    }
}

impl Drop for Diary {
    fn drop(&mut self) {
        self.finish();
    }
}

fn write_loop(rx: Receiver<Line>, file: std::fs::File, dir: &Path, s: &Shared, max_bytes: u64, min_free: u64, slow: Duration) {
    let mut w = std::io::BufWriter::new(file);
    let mut checked = Instant::now();
    let err = |e: String| {
        let mut g = s.status.lock().unwrap();
        g.running = false;
        g.last_error = Some(e);
    };
    for l in rx {
        if !slow.is_zero() {
            std::thread::sleep(slow);
        }
        let Ok(mut line) = serde_json::to_vec(&l) else { continue };
        line.push(b'\n');
        let total = s.status.lock().unwrap().bytes + line.len() as u64;
        if total > max_bytes {
            err(format!("Diário parou no limite de {} MB por arquivo", max_bytes >> 20));
            break;
        }
        if checked.elapsed() > Duration::from_secs(2) {
            checked = Instant::now();
            if free_bytes(dir).is_some_and(|f| f < min_free) {
                err("Diário parou: menos de 1 GiB livre no disco".into());
                break;
            }
        }
        if let Err(e) = w.write_all(&line) {
            err(format!("Erro ao gravar o diário: {e}"));
            break;
        }
        let mut g = s.status.lock().unwrap();
        g.bytes = total;
        g.lines += 1;
    }
    let _ = w.flush();
}

/// Nome do arquivo a partir do relógio do sistema, em UTC: AAAA-MM-DDTHH-MM-SSZ.
fn stamp(now: SystemTime) -> String {
    let secs = now.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // dias → data civil (algoritmo de Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}-{:02}-{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Bytes livres no disco de `dir`. Cópia de `rec::free_bytes` (sessão 22), que não existe nesta
/// base: na integração, trocar por `crate::rec::free_bytes`.
fn free_bytes(dir: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(dir: *const u16, avail: *mut u64, total: *mut u64, free: *mut u64) -> i32;
        }
        let w: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut avail = 0u64;
        // SAFETY: string UTF-16 terminada em 0; ponteiro válido para um u64; os outros podem ser nulos
        let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok != 0 { Some(avail) } else { None }
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        None
    }
}

// ---------------- leitura e resumo (examples/replay.rs) ----------------

pub fn read(path: &Path) -> Result<Vec<Line>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .enumerate()
        .map(|(i, l)| serde_json::from_str(l).map_err(|e| format!("linha {}: {e}", i + 1)))
        .collect()
}

/// Resumo para a calibração. O estado que o show-engine teria escolhido NÃO é refeito aqui: as
/// regras moram em TS (`src/lib/show-engine`) e mudam lá; duplicar os limiares em Rust divergiria.
/// O replay de estados lê este mesmo JSONL do lado TS. Aqui ficam só os números brutos.
#[derive(Debug, Default, PartialEq)]
pub struct Summary {
    pub secs: f64,
    pub samples: usize,
    pub locked_pct: f64,
    pub unlocks: usize,
    pub jumps: usize,
    pub restarts: usize,
    pub build_pct: f64, // tempo com contraste > 1,2 (o limiar de build do DK-031)
    pub kick_rate_by_min: Vec<(f64, f64)>, // (minuto, média de kicks/compasso)
    pub marks: usize,
    pub drop_hits: usize,
    pub drop_missed: usize,      // marca "drop" sem drop_on detectado a ±4 s
    pub drop_false: usize,       // drop_on sem marca a ±4 s
    pub drop_delay_mean: f64,    // drop_on − marca (s), média dos acertos
}

pub const MATCH: f64 = 4.0;

pub fn summarize(lines: &[Line]) -> Summary {
    let samples: Vec<&Sample> = lines.iter().filter_map(|l| if let Line::Sample(s) = l { Some(s) } else { None }).collect();
    let events = |name: &str| lines.iter().filter_map(|l| matches!(l, Line::Event { event, .. } if event == name).then(|| if let Line::Event { t, .. } = l { *t } else { 0.0 })).collect::<Vec<f64>>();
    let marks: Vec<f64> = lines.iter().filter_map(|l| if let Line::Mark { t, mark } = l { (mark == "drop").then_some(*t) } else { None }).collect();
    let drops = events("drop_on");
    let n = samples.len().max(1) as f64;
    let mut by_min: Vec<(f64, f64, usize)> = vec![];
    for s in &samples {
        let m = (s.t / 60.0).floor();
        match by_min.last_mut() {
            Some(b) if b.0 == m => {
                b.1 += s.kick_rate;
                b.2 += 1;
            }
            _ => by_min.push((m, s.kick_rate, 1)),
        }
    }
    let mut delays = vec![];
    let mut used = vec![false; drops.len()];
    for &m in &marks {
        let best = drops.iter().enumerate().filter(|(i, &d)| !used[*i] && (d - m).abs() <= MATCH).min_by(|a, b| (a.1 - m).abs().total_cmp(&(b.1 - m).abs()));
        if let Some((i, &d)) = best {
            used[i] = true;
            delays.push(d - m);
        }
    }
    Summary {
        secs: samples.last().map_or(0.0, |s| s.t) - samples.first().map_or(0.0, |s| s.t),
        samples: samples.len(),
        locked_pct: 100.0 * samples.iter().filter(|s| s.locked).count() as f64 / n,
        unlocks: events("unlock").len(),
        jumps: events("jump").len(),
        restarts: events("restart").len(),
        build_pct: 100.0 * samples.iter().filter(|s| s.contrast > 1.2).count() as f64 / n,
        kick_rate_by_min: by_min.into_iter().map(|(m, s, c)| (m, s / c as f64)).collect(),
        marks: marks.len(),
        drop_hits: delays.len(),
        drop_missed: marks.len() - delays.len(),
        drop_false: used.iter().filter(|u| !**u).count(),
        drop_delay_mean: if delays.is_empty() { f64::NAN } else { delays.iter().sum::<f64>() / delays.len() as f64 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{Params, HOP};
    use crate::synth::Synth;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("doublek-diario-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn run(diary: &mut Diary, s: &Synth, lo: f32, hi: f32) {
        let (x, _) = s.render();
        let mut an = Analyzer::new(s.sr);
        let p = Params { bpm_min: lo, bpm_max: hi, ..Default::default() };
        for c in x.chunks_exact(HOP) {
            let k = an.process(c, &p);
            diary.hop(&an, k);
        }
    }

    /// Synth 148 com breakdown → JSONL: ~20 amostras/s, 3 casas, eventos de trava e de drop nos
    /// lugares certos, marca do operador, e tudo lê de volta com serde.
    #[test]
    fn grava_e_le_o_diario() {
        let dir = tmp("grava");
        let mut d = Diary::start(&dir).unwrap();
        run(&mut d, &Synth { bpm: 148.0, secs: 30.0, breakdown: Some((10.0, 18.0)), ..Default::default() }, 135.0, 150.0);
        d.mark("drop");
        let st = d.stop();
        assert!(!st.running && st.last_error.is_none() && st.dropped == 0, "{st:?}");
        let lines = read(Path::new(&st.path)).unwrap();
        assert_eq!(lines.len() as u64, st.lines);
        let samples: Vec<&Sample> = lines.iter().filter_map(|l| if let Line::Sample(s) = l { Some(s) } else { None }).collect();
        assert!((590..=610).contains(&samples.len()), "{} amostras em 30 s", samples.len());
        let text = std::fs::read_to_string(&st.path).unwrap();
        assert!(!text.contains("e-") && text.lines().all(|l| l.split(|c: char| !c.is_ascii_digit() && c != '.').all(|n| n.split('.').nth(1).map_or(true, |f| f.len() <= 3))), "mais de 3 casas");
        let ev = |name: &str| lines.iter().filter_map(|l| if let Line::Event { t, event } = l { (event == name).then_some(*t) } else { None }).collect::<Vec<f64>>();
        assert!(ev("lock").first().is_some_and(|&t| t < 5.0), "lock {:?}", ev("lock"));
        assert!(ev("drop_off").iter().any(|&t| (10.0..11.5).contains(&t)), "drop_off {:?}", ev("drop_off"));
        assert!(ev("drop_on").iter().any(|&t| (18.0..18.6).contains(&t)), "drop_on {:?}", ev("drop_on"));
        assert!(matches!(lines.last(), Some(Line::Mark { mark, .. }) if mark == "drop"));
        let s = samples.iter().find(|s| s.t > 20.0).unwrap();
        assert!(s.locked && (s.bpm - 148.0).abs() < 0.5 && s.clock == "audio" && s.low, "{s:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn para_no_limite_de_tamanho() {
        let dir = tmp("limite");
        let mut d = Diary::start_with(&dir, 20_000, 0, CAPACITY, Duration::ZERO).unwrap();
        run(&mut d, &Synth { bpm: 148.0, secs: 10.0, ..Default::default() }, 135.0, 150.0);
        let st = d.stop();
        assert!(st.last_error.as_deref().is_some_and(|e| e.contains("limite")), "{st:?}");
        let size = std::fs::metadata(&st.path).unwrap().len();
        assert!(size <= 20_000 && size == st.bytes, "{size} bytes");
        assert!(read(Path::new(&st.path)).is_ok(), "arquivo cortado no meio de uma linha");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Escrita lenta e canal pequeno: `hop`/`mark` não esperam (descartam e contam).
    #[test]
    fn canal_cheio_descarta_sem_bloquear() {
        let dir = tmp("cheio");
        let d = Diary::start_with(&dir, MAX_BYTES, 0, 4, Duration::from_millis(5)).unwrap();
        let t0 = Instant::now();
        for _ in 0..2000 {
            d.mark("x");
        }
        let took = t0.elapsed();
        let st = d.stop();
        assert!(took < Duration::from_millis(200), "mark bloqueou: {took:?}");
        assert!(st.dropped > 1900 && st.lines + st.dropped == 2000, "{st:?}");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Log sintético: marcas do operador em 10 s e 40 s, drop_on em 10,3 s, 40,5 s e 70 s
    /// (o último sem marca) → 2 acertos, atraso médio 0,4 s, 1 falso, nenhum perdido.
    #[test]
    fn replay_compara_marcas_e_drops() {
        let mut lines = vec![];
        for i in 0..=1800 {
            let t = i as f64 * 0.05;
            let locked = !(50.0..55.0).contains(&t);
            lines.push(Line::Sample(Sample::new(t, 148.0, locked, false, 0.0, 0, 0.0, true, 0.1, if (30.0..33.0).contains(&t) { 1.3 } else { 1.0 }, 1.0, 4.0, "audio", [0.0; 5])));
        }
        for (t, m) in [(10.0, "drop"), (40.0, "drop")] {
            lines.push(Line::Mark { t, mark: m.into() });
        }
        for (t, e) in [(10.3, "drop_on"), (40.5, "drop_on"), (70.0, "drop_on"), (50.0, "unlock")] {
            lines.push(Line::Event { t, event: e.into() });
        }
        let s = summarize(&lines);
        assert_eq!((s.marks, s.drop_hits, s.drop_missed, s.drop_false, s.unlocks), (2, 2, 0, 1, 1));
        assert!((s.drop_delay_mean - 0.4).abs() < 1e-9, "{s:?}");
        assert!((s.locked_pct - 100.0 * 1700.0 / 1801.0).abs() < 0.2, "{}", s.locked_pct);
        assert!((s.build_pct - 100.0 * 60.0 / 1801.0).abs() < 0.2, "{}", s.build_pct);
        assert_eq!(s.kick_rate_by_min.len(), 2);
    }

    #[test]
    fn nome_do_arquivo_em_utc() {
        assert_eq!(stamp(UNIX_EPOCH + Duration::from_secs(1_793_398_503)), "2026-10-30T22-15-03Z");
        assert_eq!(stamp(UNIX_EPOCH), "1970-01-01T00-00-00Z");
    }
}
