//! Servidor OSC 1.0 local (DK-091): recebe datagramas UDP, decodifica mensagens e bundles e repassa cada
//! mensagem para a UI. Sem dependência: o formato é simples (strings com padding de 4 bytes, inteiros big-endian).
//! O mapeamento endereço → comando fica em `src/lib/osc.ts`; aqui só a borda: parser estrito e limite de taxa.

use serde::Serialize;
use serde_json::{json, Value};
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const DEFAULT_PORT: u16 = 9000;
/// Mensagens por segundo; acima disso descarta e conta (um fader de TouchOSC manda ~60/s).
pub const MAX_PER_SEC: u32 = 200;
const MAX_DEPTH: usize = 8; // bundles dentro de bundles

/// Argumento como a UI recebe: `{ t: "i"|"f"|"s"|"b"|"T"|"F", v }` (T/F levam `v` true/false; blob = lista de bytes).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Arg {
    pub t: &'static str,
    pub v: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OscMsg {
    pub addr: String,
    pub args: Vec<Arg>,
}

struct Rd<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Rd<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.p.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("pacote OSC cortado")?;
        let s = &self.b[self.p..end];
        self.p = end;
        Ok(s)
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    /// String OSC: ASCII até o NUL, completada com NULs até múltiplo de 4.
    fn str(&mut self) -> Result<String, String> {
        let rest = &self.b[self.p..];
        let n = rest.iter().position(|&c| c == 0).ok_or("string OSC sem terminador")?;
        let s = std::str::from_utf8(&rest[..n]).map_err(|_| "string OSC não é texto")?.to_string();
        self.take((n + 4) & !3)?;
        Ok(s)
    }
}

/// Pacote (mensagem ou `#bundle`) → mensagens, na ordem. Pacote malformado = erro, nunca pânico.
/// O timetag dos bundles é ignorado: tudo executa ao chegar.
pub fn parse(b: &[u8]) -> Result<Vec<OscMsg>, String> {
    let mut out = vec![];
    packet(b, 0, &mut out)?;
    Ok(out)
}

fn packet(b: &[u8], depth: usize, out: &mut Vec<OscMsg>) -> Result<(), String> {
    if b.len() % 4 != 0 {
        return Err("pacote OSC com tamanho fora do múltiplo de 4".into());
    }
    if b.starts_with(b"#bundle\0") {
        if depth >= MAX_DEPTH {
            return Err("bundles aninhados demais".into());
        }
        let mut r = Rd { b, p: 16 }; // "#bundle\0" + timetag de 8 bytes
        if b.len() < 16 {
            return Err("pacote OSC cortado".into());
        }
        while r.p < b.len() {
            let n = usize::try_from(r.i32()?).map_err(|_| "tamanho negativo no bundle")?;
            packet(r.take(n)?, depth + 1, out)?;
        }
        return Ok(());
    }
    let mut r = Rd { b, p: 0 };
    let addr = r.str()?;
    if !addr.starts_with('/') {
        return Err(format!("endereço OSC precisa começar com /: {addr:?}"));
    }
    let mut args = vec![];
    if r.p < b.len() {
        let tags = r.str()?;
        let tags = tags.strip_prefix(',').ok_or("type tags OSC precisam começar com vírgula")?;
        for t in tags.chars() {
            args.push(match t {
                'i' => Arg { t: "i", v: json!(r.i32()?) },
                'f' => Arg { t: "f", v: json!(f32::from_bits(r.i32()? as u32)) }, // NaN/infinito viram null
                's' => Arg { t: "s", v: json!(r.str()?) },
                'b' => {
                    let n = usize::try_from(r.i32()?).map_err(|_| "blob com tamanho negativo")?;
                    let v = r.take(n)?.to_vec();
                    r.take((4 - n % 4) % 4)?;
                    Arg { t: "b", v: json!(v) }
                }
                'T' => Arg { t: "T", v: json!(true) },
                'F' => Arg { t: "F", v: json!(false) },
                _ => return Err(format!("tipo OSC não suportado: {t}")),
            });
        }
    }
    out.push(OscMsg { addr, args });
    Ok(())
}

/// Contadores do servidor. `dropped` = descartadas pelo limite de taxa; `rejected` = pacotes malformados.
#[derive(Default)]
pub struct Stats {
    pub received: AtomicU64,
    pub dropped: AtomicU64,
    pub rejected: AtomicU64,
}

pub struct Server {
    pub addr: SocketAddr,
    pub stats: Arc<Stats>,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl Server {
    /// Para e espera a thread soltar a porta (até ~200 ms), para dar para religar na mesma porta em seguida.
    pub fn stop(self) {
        self.stop.store(true, Relaxed);
        let _ = self.thread.join();
    }
}

/// Erro de bind em português, para o operador (também usado pelo servidor remoto).
pub fn bind_error(bind: SocketAddr, e: std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::AddrInUse => format!("A porta {} já está em uso por outro programa: escolha outra", bind.port()),
        std::io::ErrorKind::AddrNotAvailable => format!("O endereço {} não existe nesta máquina", bind.ip()),
        std::io::ErrorKind::PermissionDenied => format!("Sem permissão para a porta {} (reservada pelo Windows?): escolha outra", bind.port()),
        _ => format!("Não deu para abrir {bind}: {e}"),
    }
}

/// Abre a porta já (erro claro se estiver em uso) e escuta numa thread própria até `Server::stop`.
/// `bind` em 127.0.0.1 = só esta máquina; 0.0.0.0 (LAN) só quando o chamador pede.
pub fn serve<F>(bind: SocketAddr, mut on_msg: F) -> Result<Server, String>
where
    F: FnMut(OscMsg) + Send + 'static,
{
    let sock = UdpSocket::bind(bind).map_err(|e| bind_error(bind, e))?;
    sock.set_read_timeout(Some(Duration::from_millis(200))).map_err(|e| e.to_string())?;
    let addr = sock.local_addr().map_err(|e| e.to_string())?;
    let (stats, stop) = (Arc::new(Stats::default()), Arc::new(AtomicBool::new(false)));
    let (st, sp) = (stats.clone(), stop.clone());
    let thread = std::thread::spawn(move || {
        let mut buf = vec![0u8; 65536];
        // ponytail: janela fixa de 1 s (rajada de até 2× no limite da janela); balde de fichas se precisar suavizar
        let (mut window, mut count) = (Instant::now(), 0u32);
        while !sp.load(Relaxed) {
            let n = match sock.recv_from(&mut buf) {
                Ok((n, _)) => n,
                Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
                Err(_) => { std::thread::sleep(Duration::from_millis(10)); continue } // ex.: ICMP "porta fechada" no Windows
            };
            let Ok(msgs) = parse(&buf[..n]) else { st.rejected.fetch_add(1, Relaxed); continue };
            for m in msgs {
                if window.elapsed() >= Duration::from_secs(1) {
                    (window, count) = (Instant::now(), 0);
                }
                if count >= MAX_PER_SEC {
                    st.dropped.fetch_add(1, Relaxed);
                    continue;
                }
                count += 1;
                st.received.fetch_add(1, Relaxed);
                on_msg(m);
            }
        }
    });
    Ok(Server { addr, stats, stop, thread })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn pad(mut v: Vec<u8>) -> Vec<u8> {
        v.push(0);
        while v.len() % 4 != 0 {
            v.push(0);
        }
        v
    }
    fn s(x: &str) -> Vec<u8> {
        pad(x.as_bytes().to_vec())
    }
    /// Mensagem com os bytes dos argumentos já codificados.
    fn msg(addr: &str, tags: &str, args: &[u8]) -> Vec<u8> {
        [s(addr), s(tags), args.to_vec()].concat()
    }
    fn bundle(parts: &[Vec<u8>]) -> Vec<u8> {
        let mut b = [s("#bundle"), vec![0, 0, 0, 0, 0, 0, 0, 1]].concat();
        for p in parts {
            b.extend((p.len() as i32).to_be_bytes());
            b.extend(p);
        }
        b
    }

    #[test]
    fn mensagem_simples_e_inteiro() {
        assert_eq!(parse(&s("/doublek/v1/tap")).unwrap(), vec![OscMsg { addr: "/doublek/v1/tap".into(), args: vec![] }]);
        assert_eq!(parse(&msg("/doublek/v1/tap", ",", &[])).unwrap()[0].args, vec![]);
        let m = parse(&msg("/x", ",iTF", &(-3i32).to_be_bytes())).unwrap();
        assert_eq!(m[0].args, vec![Arg { t: "i", v: json!(-3) }, Arg { t: "T", v: json!(true) }, Arg { t: "F", v: json!(false) }]);
    }

    #[test]
    fn float_string_e_blob() {
        let m = parse(&msg("/x", ",f", &0.5f32.to_be_bytes())).unwrap();
        assert_eq!(m[0].args, vec![Arg { t: "f", v: json!(0.5) }]);
        // "abcd" ocupa 8 bytes (NUL + padding); "abc" ocupa 4
        let m = parse(&msg("/x", ",ss", &[s("abcd"), s("abc")].concat())).unwrap();
        assert_eq!(m[0].args, vec![Arg { t: "s", v: json!("abcd") }, Arg { t: "s", v: json!("abc") }]);
        let m = parse(&msg("/x", ",bi", &[&5i32.to_be_bytes()[..], &[1, 2, 3, 4, 5, 0, 0, 0], &7i32.to_be_bytes()].concat())).unwrap();
        assert_eq!(m[0].args, vec![Arg { t: "b", v: json!([1, 2, 3, 4, 5]) }, Arg { t: "i", v: json!(7) }]);
        let m = parse(&msg("/x", ",f", &f32::NAN.to_be_bytes())).unwrap();
        assert_eq!(m[0].args[0].v, Value::Null); // a UI recusa
        assert_eq!(serde_json::to_string(&m[0].args[0]).unwrap(), r#"{"t":"f","v":null}"#);
    }

    #[test]
    fn bundle_e_aninhado() {
        let a = msg("/a", ",i", &1i32.to_be_bytes());
        let b = s("/b");
        let m = parse(&bundle(&[a.clone(), bundle(&[b]), a])).unwrap();
        assert_eq!(m.iter().map(|m| m.addr.as_str()).collect::<Vec<_>>(), ["/a", "/b", "/a"]);
        assert_eq!(parse(&bundle(&[])).unwrap(), vec![]);
        let mut deep = s("/z");
        for _ in 0..MAX_DEPTH + 1 {
            deep = bundle(&[deep]);
        }
        assert!(parse(&deep).unwrap_err().contains("aninhados"));
    }

    #[test]
    fn recusa_malformados_sem_panico() {
        let ok = msg("/x", ",if", &[1i32.to_be_bytes(), 1f32.to_be_bytes()].concat());
        for n in (0..ok.len()).filter(|&n| n != 4) {
            assert!(parse(&ok[..n]).is_err(), "cortado em {n}"); // em 4 sobra "/x" sem tags: mensagem válida
        }
        assert!(parse(&s("doublek/v1/tap")).unwrap_err().contains("começar com /"));
        assert!(parse(&[s("/x"), s("if")].concat()).unwrap_err().contains("vírgula"));
        assert!(parse(&msg("/x", ",i", &[])).unwrap_err().contains("cortado"));
        assert!(parse(&msg("/x", ",d", &[0; 8])).unwrap_err().contains("não suportado"));
        assert!(parse(&msg("/x", ",b", &(-1i32).to_be_bytes())).unwrap_err().contains("negativo"));
        assert!(parse(&msg("/x", ",b", &100i32.to_be_bytes())).is_err());
        assert!(parse(&[b'/', b'x', 0, 0, 0xff, 0xff]).is_err());
        assert!(parse(&[b'/', b'x', b'y', b'z']).unwrap_err().contains("terminador"));
        assert!(parse(&[s("/"), vec![0xC3, 0x28, 0, 0]].concat()).is_err()); // tags que não são UTF-8
        // bundle com tamanho de elemento mentiroso ou negativo
        let mut b = bundle(&[s("/a")]);
        b[16..20].copy_from_slice(&999i32.to_be_bytes());
        assert!(parse(&b).is_err());
        b[16..20].copy_from_slice(&(-4i32).to_be_bytes());
        assert!(parse(&b).is_err());
        assert!(parse(&s("#bundle")).is_err());
        // lixo pseudoaleatório: só não pode entrar em pânico
        let mut x = 0x2545F491u32;
        for len in 0..512 {
            let g: Vec<u8> = (0..len).map(|_| { x ^= x << 13; x ^= x >> 17; x ^= x << 5; x as u8 }).collect();
            let _ = parse(&g);
            let _ = parse(&[b"#bundle\0".to_vec(), g].concat());
        }
    }

    #[test]
    fn servidor_recebe_limita_e_solta_a_porta() {
        let (tx, rx) = mpsc::channel();
        let srv = serve("127.0.0.1:0".parse().unwrap(), move |m| { let _ = tx.send(m); }).unwrap();
        let addr = srv.addr;
        let c = UdpSocket::bind("127.0.0.1:0").unwrap();
        c.send_to(&msg("/doublek/v1/scene/2", ",f", &4f32.to_be_bytes()), addr).unwrap();
        let m = rx.recv_timeout(Duration::from_secs(2)).expect("callback não chegou");
        assert_eq!(m, OscMsg { addr: "/doublek/v1/scene/2".into(), args: vec![Arg { t: "f", v: json!(4.0) }] });

        c.send_to(b"lixo", addr).unwrap();
        let many: Vec<_> = (0..MAX_PER_SEC + 50).map(|_| s("/doublek/v1/tap")).collect();
        c.send_to(&bundle(&many), addr).unwrap();
        let mut got = 0;
        while rx.recv_timeout(Duration::from_millis(500)).is_ok() {
            got += 1;
        }
        assert_eq!(got, MAX_PER_SEC - 1); // a 1ª mensagem já gastou uma vaga da janela
        assert_eq!(srv.stats.received.load(Relaxed), MAX_PER_SEC as u64);
        assert_eq!(srv.stats.dropped.load(Relaxed), 51);
        assert_eq!(srv.stats.rejected.load(Relaxed), 1);

        assert!(serve(addr, |_| {}).err().expect("porta ocupada").contains("em uso"));
        srv.stop();
        serve(addr, |_| {}).expect("porta livre depois do stop").stop();
    }

    /// DK-083: 10 mil pacotes — mensagens e bundles válidos mutados e lixo puro. Sem pânico, nenhum acima de 50 ms.
    #[test]
    fn fuzz_10_mil() {
        let models = [
            msg("/doublek/v1/scene/2", ",f", &4f32.to_be_bytes()),
            msg("/doublek/v1/blackout", ",T", &[]),
            msg("/x", ",sbi", &[s("abc"), 3i32.to_be_bytes().to_vec(), vec![1, 2, 3, 0], 7i32.to_be_bytes().to_vec()].concat()),
            bundle(&[s("/a"), bundle(&[msg("/b", ",i", &1i32.to_be_bytes())])]),
        ];
        let mut x = 0x2545_F491u32;
        let mut r = move || {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            x
        };
        let (mut worst, mut ok) = (Duration::ZERO, 0);
        for i in 0..10_000 {
            let mut b: Vec<u8> = if i % 10 == 9 { (0..r() % 600).map(|_| r() as u8).collect() } else { models[i % models.len()].clone() };
            for _ in 0..1 + r() % 4 {
                if b.is_empty() {
                    break;
                }
                let p = r() as usize % b.len();
                match r() % 4 {
                    0 => b[p] = r() as u8,
                    1 => b.insert(p, r() as u8),
                    2 => drop(b.remove(p)),
                    _ => b.truncate(p),
                }
            }
            let t = std::time::Instant::now();
            ok += parse(&b).is_ok() as u32;
            worst = worst.max(t.elapsed());
        }
        assert!(worst < Duration::from_millis(50), "pior caso {worst:?}");
        assert!(ok > 100, "algumas mutações precisam continuar válidas ({ok})");
    }
}
