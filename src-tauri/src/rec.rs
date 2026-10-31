//! Gravação da saída visual (DK-072): o telão grava o próprio canvas (MediaRecorder) e manda pedaços de ~1 s;
//! aqui eles vão direto para o arquivo, em ordem, sem juntar o vídeo na memória. Para sozinho a 4 GiB ou com
//! menos de 1 GiB livre no disco (a gravação termina inteira, só que mais curta). Abortar apaga o parcial.
//! O espaço livre entra como parâmetro: os testes simulam disco cheio sem encher disco nenhum.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_BYTES: u64 = 4 << 30; // 4 GiB por gravação
pub const MIN_FREE: u64 = 1 << 30; // deixa pelo menos 1 GiB livre no disco
pub const EXTS: [&str; 2] = ["mp4", "webm"];

struct Active {
    id: String,
    path: PathBuf,
    file: File,
    bytes: u64,
    stopped: Option<String>, // motivo da parada automática (limite); chunks seguintes são recusados
}

#[derive(Default)]
pub struct Recorder {
    cur: Option<Active>,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Chunk {
    pub total: u64,
    /// Preenchido quando a gravação precisa parar (limite de tamanho ou de disco): o telão para o MediaRecorder.
    pub stop: Option<String>,
}

#[derive(Debug, PartialEq, serde::Serialize)]
pub struct Done {
    pub path: String,
    pub bytes: u64,
}

/// Nome = `<AAAAMMDD>T<HHMMSS>.<mp4|webm>` gerado pelo app; mesmo alfabeto seguro das faixas (`track::check_id`).
pub fn check_name(id: &str) -> Result<(), String> {
    crate::track::check_id(id).map_err(|_| "Nome de gravação inválido".to_string())?;
    let ext = id.rsplit('.').next().unwrap_or("");
    if !EXTS.contains(&ext) {
        return Err(format!("Formato de gravação não aceito (.{ext})"));
    }
    Ok(())
}

fn too_low(free: Option<u64>, extra: u64) -> bool {
    free.is_some_and(|f| f < MIN_FREE.saturating_add(extra))
}

impl Recorder {
    pub fn active(&self) -> Option<&str> {
        self.cur.as_ref().map(|a| a.id.as_str())
    }

    /// Cria o arquivo novo em `dir` (nunca por cima de outro). Uma gravação esquecida aberta (telão fechado no meio)
    /// é fechada antes, inteira. `free` = bytes livres no disco (None = não deu para medir: não bloqueia).
    pub fn start(&mut self, dir: &Path, id: &str, free: Option<u64>) -> Result<PathBuf, String> {
        check_name(id)?;
        if too_low(free, 0) {
            return Err("Pouco espaço em disco para gravar (menos de 1 GiB livre)".into());
        }
        if let Some(old) = self.cur.take() {
            let _ = old.file.sync_all();
        }
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let path = dir.join(id);
        let file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| format!("Não consegui criar a gravação: {e}"))?;
        self.cur = Some(Active { id: id.into(), path: path.clone(), file, bytes: 0, stopped: None });
        Ok(path)
    }

    /// Acrescenta um pedaço, em ordem. Se ele estourar o limite (tamanho ou disco), não escreve e pede para parar.
    pub fn chunk(&mut self, id: &str, data: &[u8], free: Option<u64>) -> Result<Chunk, String> {
        let a = self.cur.as_mut().filter(|a| a.id == id).ok_or("Nenhuma gravação com esse nome em andamento")?;
        if let Some(why) = &a.stopped {
            return Ok(Chunk { total: a.bytes, stop: Some(why.clone()) });
        }
        let len = data.len() as u64;
        let why = if a.bytes + len > MAX_BYTES {
            Some("limite de 4 GiB por gravação".to_string())
        } else if too_low(free, len) {
            Some("menos de 1 GiB livre no disco".to_string())
        } else {
            None
        };
        if let Some(w) = why {
            a.stopped = Some(w.clone());
            return Ok(Chunk { total: a.bytes, stop: Some(w) });
        }
        a.file.write_all(data).map_err(|e| format!("Falha ao gravar no disco: {e}"))?;
        a.bytes += len;
        Ok(Chunk { total: a.bytes, stop: None })
    }

    /// Fecha o arquivo (com sync) e devolve caminho e tamanho.
    pub fn stop(&mut self, id: &str) -> Result<Done, String> {
        if self.active() != Some(id) {
            return Err("Nenhuma gravação com esse nome em andamento".into());
        }
        let a = self.cur.take().expect("conferido acima");
        a.file.sync_all().map_err(|e| e.to_string())?;
        Ok(Done { path: a.path.display().to_string(), bytes: a.bytes })
    }

    /// Cancela e apaga o parcial.
    pub fn abort(&mut self, id: &str) -> Result<(), String> {
        if self.active() != Some(id) {
            return Err("Nenhuma gravação com esse nome em andamento".into());
        }
        let a = self.cur.take().expect("conferido acima");
        drop(a.file);
        std::fs::remove_file(&a.path).map_err(|e| e.to_string())
    }
}

/// Bytes livres para este usuário no disco de `dir` (GetDiskFreeSpaceExW). None fora do Windows ou se falhar.
pub fn free_bytes(dir: &Path) -> Option<u64> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(dir: *const u16, avail: *mut u64, total: *mut u64, free: *mut u64) -> i32;
        }
        let w: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut avail = 0u64;
        // SAFETY: string UTF-16 terminada em 0; ponteiro válido para um u64 (ULARGE_INTEGER); os outros podem ser nulos
        let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut()) };
        if ok != 0 { Some(avail) } else { None }
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("doublek-rec-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }
    const GB: u64 = 1 << 30;

    #[test]
    fn writes_chunks_in_order_and_closes() {
        let d = tmp("ordem");
        let mut r = Recorder::default();
        let p = r.start(&d, "20261030T235901.mp4", Some(50 * GB)).unwrap();
        for i in 0..5u8 {
            assert_eq!(r.chunk("20261030T235901.mp4", &[i; 1000], Some(50 * GB)).unwrap(), Chunk { total: (i as u64 + 1) * 1000, stop: None });
        }
        let done = r.stop("20261030T235901.mp4").unwrap();
        assert_eq!(done.bytes, 5000);
        let got = std::fs::read(&p).unwrap();
        assert_eq!(got.len(), 5000);
        assert!(got.chunks(1000).enumerate().all(|(i, c)| c.iter().all(|&b| b == i as u8)), "pedaços em ordem");
        assert!(r.active().is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn abort_deletes_partial() {
        let d = tmp("abort");
        let mut r = Recorder::default();
        let p = r.start(&d, "20261030T000000.webm", None).unwrap();
        r.chunk("20261030T000000.webm", b"abc", None).unwrap();
        r.abort("20261030T000000.webm").unwrap();
        assert!(!p.exists());
        assert!(r.abort("20261030T000000.webm").is_err(), "nada para abortar");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn size_and_disk_limits_stop_without_writing() {
        let d = tmp("limite");
        let mut r = Recorder::default();
        r.start(&d, "20261030T000001.mp4", Some(50 * GB)).unwrap();
        r.chunk("20261030T000001.mp4", &[1; 100], Some(50 * GB)).unwrap();
        // simula estar perto dos 4 GiB
        r.cur.as_mut().unwrap().bytes = MAX_BYTES - 50;
        let c = r.chunk("20261030T000001.mp4", &[2; 100], Some(50 * GB)).unwrap();
        assert_eq!(c.stop.as_deref(), Some("limite de 4 GiB por gravação"));
        assert_eq!(c.total, MAX_BYTES - 50, "o pedaço que estoura não é escrito");
        // depois de parar, os próximos pedaços também são recusados (o telão ainda pode mandar o último)
        assert!(r.chunk("20261030T000001.mp4", &[3; 10], Some(50 * GB)).unwrap().stop.is_some());
        let done = r.stop("20261030T000001.mp4").unwrap();
        assert_eq!(std::fs::metadata(&done.path).unwrap().len(), 100, "arquivo inteiro com o que coube");

        r.start(&d, "20261030T000002.mp4", Some(50 * GB)).unwrap();
        let c = r.chunk("20261030T000002.mp4", &[1; 1000], Some(GB + 500)).unwrap();
        assert_eq!(c.stop.as_deref(), Some("menos de 1 GiB livre no disco"));
        r.stop("20261030T000002.mp4").unwrap();
        assert!(r.start(&d, "20261030T000003.mp4", Some(GB - 1)).unwrap_err().contains("Pouco espaço"));
        assert!(r.start(&d, "20261030T000004.mp4", None).is_ok(), "sem medida de disco não bloqueia");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn bad_names_and_wrong_id_refused() {
        let d = tmp("nomes");
        let mut r = Recorder::default();
        for bad in ["../x.mp4", "a/b.mp4", "x.exe", "semponto", "a b.mp4", "C:x.mp4", "", "x..mp4"] {
            assert!(r.start(&d, bad, None).is_err(), "{bad}");
        }
        r.start(&d, "20261030T000005.webm", None).unwrap();
        assert!(r.chunk("outro.webm", b"x", None).is_err());
        assert!(r.stop("outro.webm").is_err());
        // nunca por cima de um arquivo que já existe
        r.stop("20261030T000005.webm").unwrap();
        assert!(r.start(&d, "20261030T000005.webm", None).unwrap_err().contains("Não consegui criar"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn forgotten_recording_is_closed_by_next_start() {
        let d = tmp("esquecida");
        let mut r = Recorder::default();
        let p1 = r.start(&d, "20261030T000006.mp4", None).unwrap();
        r.chunk("20261030T000006.mp4", b"12345", None).unwrap();
        r.start(&d, "20261030T000007.mp4", None).unwrap();
        assert_eq!(std::fs::metadata(&p1).unwrap().len(), 5, "a anterior ficou inteira");
        assert_eq!(r.active(), Some("20261030T000007.mp4"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn free_bytes_reads_this_disk() {
        let f = free_bytes(&std::env::temp_dir());
        if cfg!(windows) {
            assert!(f.is_some_and(|b| b > 0));
        }
    }
}
