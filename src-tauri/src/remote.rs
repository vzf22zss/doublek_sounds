//! Controle remoto local (DK-081): servidor HTTP/1.1 mínimo, só com a std, base para o celular (DK-082).
//! Desligado por padrão; 127.0.0.1 a menos que o operador abra para a rede. Pareamento: o app mostra um código de
//! 6 dígitos (2 min); `POST /pair` troca o código por um token de sessão (só na memória: desligar ou reiniciar o app
//! desconecta todo mundo). Comandos no mesmo formato do OSC, `{ addr, args }`: o mapa é o `oscToCommand` do front.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const DEFAULT_PORT: u16 = 8008;
pub const MAX_BODY: usize = 4096;
const MAX_HEAD: usize = 8192;
/// Pedidos por segundo por token (um celular mandando fader + /state sobra).
pub const MAX_PER_SEC: u32 = 20;
pub const CODE_SECS: u64 = 120;
const MAX_FAILS: u32 = 5;
const BLOCK: Duration = Duration::from_secs(60);
const MAX_CONNS: usize = 32;
// tela do celular (DK-082): HTML + JS + CSS embutidos no exe, servidos como arquivos separados para a CSP ficar
// estrita (nada inline); sem framework, funciona offline
const PAGE: &str = include_str!("remote.html");
const JS: &str = include_str!("remote.js");
const CSS: &str = include_str!("remote.css");

#[derive(Debug)]
pub struct Req {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>, // nomes em minúsculas
    pub body: Vec<u8>,
}

impl Req {
    fn header(&self, k: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
    }
}

fn find(b: &[u8], pat: &[u8]) -> Option<usize> {
    b.windows(pat.len()).position(|w| w == pat)
}

/// Lê um pedido HTTP/1.x: cabeçalho até 8 KB, corpo até 4 KB por Content-Length (sem chunked).
/// Erro = (status HTTP, motivo). Genérico em `Read` para testar sem rede.
pub fn read_request(r: &mut impl Read) -> Result<Req, (u16, &'static str)> {
    let (mut buf, mut chunk) = (Vec::with_capacity(1024), [0u8; 1024]);
    let head_end = loop {
        if let Some(i) = find(&buf, b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return Err((431, "cabeçalho grande demais"));
        }
        let n = r.read(&mut chunk).map_err(|_| (408, "pedido incompleto (tempo esgotado)"))?;
        if n == 0 {
            return Err((400, "pedido cortado"));
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    if head_end > MAX_HEAD {
        return Err((431, "cabeçalho grande demais"));
    }
    let head = std::str::from_utf8(&buf[..head_end]).map_err(|_| (400, "cabeçalho não é texto"))?;
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, path) = match (first.next(), first.next(), first.next(), first.next()) {
        (Some(m), Some(p), Some(v), None) if !m.is_empty() && p.starts_with('/') && v.starts_with("HTTP/1.") => (m, p),
        _ => return Err((400, "linha de pedido inválida")),
    };
    let mut headers = vec![];
    for l in lines {
        let (k, v) = l.split_once(':').ok_or((400, "cabeçalho sem dois-pontos"))?;
        headers.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
    }
    let mut req = Req { method: method.into(), path: path.split('?').next().unwrap_or(path).into(), headers, body: vec![] };
    if req.header("transfer-encoding").is_some() {
        return Err((501, "Transfer-Encoding não suportado: mande Content-Length"));
    }
    let len = match req.header("content-length") {
        None => 0,
        Some(v) => v.parse::<usize>().map_err(|_| (400, "Content-Length inválido"))?,
    };
    if len > MAX_BODY {
        return Err((413, "corpo grande demais (máximo 4 KB)"));
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = r.read(&mut chunk).map_err(|_| (408, "pedido incompleto (tempo esgotado)"))?;
        if n == 0 {
            return Err((400, "corpo cortado"));
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(len);
    req.body = body;
    Ok(req)
}

pub struct Resp {
    pub status: u16,
    pub ctype: &'static str,
    pub body: String,
}

impl Resp {
    fn json(status: u16, v: Value) -> Resp {
        Resp { status, ctype: "application/json", body: v.to_string() }
    }
    fn err(status: u16, msg: &str) -> Resp {
        Resp::json(status, json!({ "error": msg }))
    }
    fn bytes(&self) -> Vec<u8> {
        let reason = match self.status {
            200 => "OK", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found",
            405 => "Method Not Allowed", 408 => "Request Timeout", 413 => "Payload Too Large", 429 => "Too Many Requests",
            431 => "Request Header Fields Too Large", 501 => "Not Implemented", _ => "Error",
        };
        // sem Access-Control-Allow-*: navegador de outra origem não lê nada e não passa do preflight (OPTIONS = 405)
        format!(
            "HTTP/1.1 {} {reason}\r\nContent-Type: {}; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\
             Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\n\
             Content-Security-Policy: {CSP}\r\n\r\n{}",
            self.status, self.ctype, self.body.len(), self.body
        )
        .into_bytes()
    }
}

/// Só arquivos deste servidor, nada inline, sem frames, sem formulário para fora.
const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// O que a janela de controle precisa saber. `Cmd` = `{ addr, args, client }`.
pub enum Event {
    Cmd(Value),
    Paired(String),
    Revoked,
}

#[derive(Default)]
struct Pairing {
    code: Option<(String, Instant)>,
    fails: u32,
    blocked_until: Option<Instant>,
}

struct Client {
    token: String,
    name: String,
    window: Instant,
    count: u32,
}

/// Estado do servidor (pareamento, tokens, estado do show) e as rotas. Sem rede: os testes chamam `handle` direto.
pub struct Shared {
    pair: Mutex<Pairing>,
    clients: Mutex<Vec<Client>>,
    state: Mutex<Value>,
    pub received: AtomicU64,
    pub rejected: AtomicU64,
    next: AtomicU32,
    on_event: Box<dyn Fn(Event) + Send + Sync>,
}

/// Bytes do gerador do sistema (BCryptGenRandom no Windows; /dev/urandom fora dele).
fn random(buf: &mut [u8]) {
    #[cfg(windows)]
    {
        #[link(name = "bcrypt")]
        extern "system" {
            fn BCryptGenRandom(alg: *mut std::ffi::c_void, buf: *mut u8, len: u32, flags: u32) -> i32;
        }
        const BCRYPT_USE_SYSTEM_PREFERRED_RNG: u32 = 2;
        // SAFETY: buffer válido de `len` bytes; sem handle de algoritmo com a flag do RNG do sistema
        let st = unsafe { BCryptGenRandom(std::ptr::null_mut(), buf.as_mut_ptr(), buf.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
        assert!(st == 0, "BCryptGenRandom falhou ({st})");
    }
    #[cfg(not(windows))]
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(buf)).expect("/dev/urandom");
}

/// Comparação em tempo constante (código e token).
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |x, (p, q)| x | (p ^ q)) == 0
}

/// Host precisa ser um IP (ou localhost): página de outro domínio apontado para cá (DNS rebinding) é recusada.
fn host_ok(h: &str) -> bool {
    let name = if let Some(rest) = h.strip_prefix('[') { rest.split(']').next().unwrap_or("") } else { h.rsplit_once(':').map_or(h, |(n, _)| n) };
    name == "localhost" || name.parse::<IpAddr>().is_ok()
}

impl Shared {
    pub fn new(on_event: impl Fn(Event) + Send + Sync + 'static) -> Shared {
        Shared {
            pair: Mutex::default(),
            clients: Mutex::default(),
            state: Mutex::new(json!({})),
            received: AtomicU64::new(0),
            rejected: AtomicU64::new(0),
            next: AtomicU32::new(1),
            on_event: Box::new(on_event),
        }
    }

    /// Código novo de 6 dígitos, válido por 2 min e de uso único. Gerar de novo zera as tentativas e o bloqueio.
    pub fn pair_code(&self) -> String {
        let mut b = [0u8; 4];
        random(&mut b);
        let code = format!("{:06}", u32::from_le_bytes(b) % 1_000_000);
        *self.pair.lock().unwrap() = Pairing { code: Some((code.clone(), Instant::now())), ..Default::default() };
        code
    }

    /// Desconecta todos os clientes (os tokens deixam de valer na hora).
    pub fn revoke_all(&self) {
        self.clients.lock().unwrap().clear();
        (self.on_event)(Event::Revoked);
    }

    pub fn clients(&self) -> usize {
        self.clients.lock().unwrap().len()
    }

    /// O que `GET /state` devolve; a janela de controle atualiza 1×/s.
    pub fn set_state(&self, v: Value) {
        *self.state.lock().unwrap() = v;
    }

    pub fn handle(&self, req: &Req, peer: IpAddr) -> Resp {
        let r = self.route(req, peer);
        if r.status >= 400 {
            self.rejected.fetch_add(1, Relaxed);
        }
        r
    }

    fn route(&self, req: &Req, peer: IpAddr) -> Resp {
        let host = req.header("host").unwrap_or("");
        if !host_ok(host) {
            return Resp::err(403, "Host inválido: use o IP do computador");
        }
        if req.header("origin").is_some_and(|o| o != format!("http://{host}")) {
            return Resp::err(403, "origem não permitida");
        }
        match (req.method.as_str(), req.path.as_str()) {
            ("GET", "/") => Resp { status: 200, ctype: "text/html", body: PAGE.into() },
            ("GET", "/app.js") => Resp { status: 200, ctype: "text/javascript", body: JS.into() },
            ("GET", "/app.css") => Resp { status: 200, ctype: "text/css", body: CSS.into() },
            ("POST", "/pair") => self.pair(req, peer),
            ("POST", "/cmd") => match self.auth(req) {
                Ok(client) => self.cmd(req, client),
                Err(r) => r,
            },
            ("GET", "/state") => match self.auth(req) {
                Ok(_) => Resp::json(200, self.state.lock().unwrap().clone()),
                Err(r) => r,
            },
            (_, "/" | "/app.js" | "/app.css" | "/pair" | "/cmd" | "/state") => Resp::err(405, "método não permitido"),
            _ => Resp::err(404, "não encontrado"),
        }
    }

    fn pair(&self, req: &Req, peer: IpAddr) -> Resp {
        let code = serde_json::from_slice::<Value>(&req.body).ok().and_then(|v| match v.get("code")? {
            Value::String(s) => Some(s.clone()),
            Value::Number(n) => n.as_u64().map(|n| format!("{n:06}")),
            _ => None,
        });
        let Some(code) = code else { return Resp::err(400, "mande {\"code\":\"123456\"}") };
        let now = Instant::now();
        {
            let mut p = self.pair.lock().unwrap();
            if p.blocked_until.is_some_and(|t| now < t) {
                return Resp::err(429, "muitas tentativas: espere 1 minuto");
            }
            let ok = matches!(&p.code, Some((c, at)) if now.duration_since(*at).as_secs() < CODE_SECS && same(c, &code));
            if !ok {
                p.fails += 1;
                if p.fails >= MAX_FAILS {
                    (p.fails, p.blocked_until) = (0, Some(now + BLOCK));
                    return Resp::err(429, "muitas tentativas: espere 1 minuto");
                }
                return Resp::err(401, "código errado ou vencido");
            }
            *p = Pairing::default(); // uso único
        }
        let mut t = [0u8; 32];
        random(&mut t);
        let token: String = t.iter().map(|b| format!("{b:02x}")).collect();
        let name = format!("celular {} ({peer})", self.next.fetch_add(1, Relaxed));
        self.clients.lock().unwrap().push(Client { token: token.clone(), name: name.clone(), window: now, count: 0 });
        (self.on_event)(Event::Paired(name.clone()));
        Resp::json(200, json!({ "token": token, "client": name }))
    }

    /// Token válido + limite de taxa por token → nome do cliente.
    fn auth(&self, req: &Req) -> Result<String, Resp> {
        let t = req.header("authorization").and_then(|h| h.strip_prefix("Bearer ")).ok_or_else(|| Resp::err(401, "sem token: pareie primeiro"))?;
        let mut cs = self.clients.lock().unwrap();
        let c = cs.iter_mut().find(|c| same(&c.token, t)).ok_or_else(|| Resp::err(401, "token inválido ou desconectado"))?;
        if c.window.elapsed() >= Duration::from_secs(1) {
            (c.window, c.count) = (Instant::now(), 0);
        }
        if c.count >= MAX_PER_SEC {
            return Err(Resp::err(429, "devagar: mais de 20 pedidos por segundo"));
        }
        c.count += 1;
        Ok(c.name.clone())
    }

    /// Só a forma (endereço texto, até 16 argumentos `{t,v}` de tipo OSC); o resto quem confere é o `oscToCommand`.
    fn cmd(&self, req: &Req, client: String) -> Resp {
        let v: Value = match serde_json::from_slice(&req.body) {
            Ok(v) => v,
            Err(_) => return Resp::err(400, "corpo precisa ser JSON {addr, args}"),
        };
        let addr = v.get("addr").and_then(Value::as_str).filter(|a| a.starts_with('/') && a.len() <= 256);
        let args = v.get("args").cloned().unwrap_or(json!([]));
        let args_ok = args.as_array().is_some_and(|a| {
            a.len() <= 16 && a.iter().all(|x| x.get("t").and_then(Value::as_str).is_some_and(|t| matches!(t, "i" | "f" | "s" | "b" | "T" | "F")))
        });
        let Some(addr) = addr.filter(|_| args_ok) else { return Resp::err(400, "addr precisa começar com / e args ser lista de {t, v}") };
        self.received.fetch_add(1, Relaxed);
        (self.on_event)(Event::Cmd(json!({ "addr": addr, "args": args, "client": client })));
        Resp::json(200, json!({ "ok": true }))
    }
}

pub struct Server {
    pub addr: SocketAddr,
    pub shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl Server {
    /// Para de aceitar e solta a porta (até ~50 ms). Os tokens morrem junto com o `Shared`.
    pub fn stop(self) {
        self.stop.store(true, Relaxed);
        let _ = self.thread.join();
    }
}

fn serve_conn(mut s: TcpStream, peer: SocketAddr, sh: &Shared) {
    let _ = s.set_nonblocking(false);
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(3)));
    let resp = match read_request(&mut s) {
        Ok(req) => sh.handle(&req, peer.ip()),
        Err((status, msg)) => {
            sh.rejected.fetch_add(1, Relaxed);
            Resp::err(status, msg)
        }
    };
    let _ = s.write_all(&resp.bytes());
    // fecha devagar: lê o que sobrou (ex.: corpo de um 413) para o Windows não mandar RST e engolir a resposta
    let _ = s.shutdown(std::net::Shutdown::Write);
    let _ = s.set_read_timeout(Some(Duration::from_millis(200)));
    let _ = std::io::copy(&mut (&s).take(64 * 1024), &mut std::io::sink());
}

/// Abre a porta já (mesmas mensagens do OSC) e atende numa thread própria; cada conexão numa thread curta
/// (até 32 ao mesmo tempo, 3 s de tempo-limite), uma resposta por conexão.
pub fn serve(bind: SocketAddr, on_event: impl Fn(Event) + Send + Sync + 'static) -> Result<Server, String> {
    let l = TcpListener::bind(bind).map_err(|e| crate::osc::bind_error(bind, e))?;
    l.set_nonblocking(true).map_err(|e| e.to_string())?;
    let addr = l.local_addr().map_err(|e| e.to_string())?;
    let (shared, stop) = (Arc::new(Shared::new(on_event)), Arc::new(AtomicBool::new(false)));
    let (sh, sp, conns) = (shared.clone(), stop.clone(), Arc::new(AtomicUsize::new(0)));
    let thread = std::thread::spawn(move || {
        while !sp.load(Relaxed) {
            match l.accept() {
                Ok((s, peer)) => {
                    if conns.load(Relaxed) >= MAX_CONNS {
                        continue; // derruba a conexão: alguém abrindo conexões demais
                    }
                    conns.fetch_add(1, Relaxed);
                    let (sh, conns) = (sh.clone(), conns.clone());
                    std::thread::spawn(move || {
                        serve_conn(s, peer, &sh);
                        conns.fetch_sub(1, Relaxed);
                    });
                }
                Err(_) => std::thread::sleep(Duration::from_millis(20)), // WouldBlock: ninguém conectando
            }
        }
    });
    Ok(Server { addr, shared, stop, thread })
}

/// IP desta máquina na rede local (para mostrar `http://IP:porta`). UDP `connect` não manda nada pela rede.
pub fn lan_ip() -> Option<IpAddr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip()).filter(|ip| !ip.is_unspecified())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// Leitor que entrega 1 byte por vez (pedido picado pela rede).
    struct Drip<'a>(&'a [u8]);
    impl Read for Drip<'_> {
        fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
            let n = self.0.len().min(1).min(b.len());
            b[..n].copy_from_slice(&self.0[..n]);
            self.0 = &self.0[n..];
            Ok(n)
        }
    }
    fn rq(s: &str) -> Result<Req, (u16, &'static str)> {
        read_request(&mut s.as_bytes())
    }
    fn req(method: &str, path: &str, token: Option<&str>, body: &str) -> Req {
        let mut headers = vec![("host".to_string(), "127.0.0.1:8008".to_string())];
        if let Some(t) = token {
            headers.push(("authorization".into(), format!("Bearer {t}")));
        }
        Req { method: method.into(), path: path.into(), headers, body: body.into() }
    }
    fn shared() -> (Shared, mpsc::Receiver<String>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sh = Shared::new(move |e| {
            let s = match e { Event::Cmd(v) => v.to_string(), Event::Paired(c) => format!("paired {c}"), Event::Revoked => "revoked".into() };
            let _ = tx.lock().unwrap().send(s);
        });
        (sh, rx)
    }
    const IP: IpAddr = IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);
    fn pair(sh: &Shared) -> String {
        let code = sh.pair_code();
        let r = sh.handle(&req("POST", "/pair", None, &format!(r#"{{"code":"{code}"}}"#)), IP);
        assert_eq!(r.status, 200, "{}", r.body);
        serde_json::from_str::<Value>(&r.body).unwrap()["token"].as_str().unwrap().to_string()
    }

    #[test]
    fn le_pedido_http() {
        let r = rq("GET /state?x=1 HTTP/1.1\r\nHost: 127.0.0.1:8008\r\nAuthorization: Bearer abc\r\n\r\n").unwrap();
        assert_eq!((r.method.as_str(), r.path.as_str(), r.header("authorization"), r.body.len()), ("GET", "/state", Some("Bearer abc"), 0));
        let raw = "POST /cmd HTTP/1.1\r\nHOST: x\r\nContent-Length: 11\r\n\r\n{\"a\":12345}sobra";
        let r = read_request(&mut Drip(raw.as_bytes())).unwrap();
        assert_eq!((r.header("host"), r.body.as_slice()), (Some("x"), &b"{\"a\":12345}"[..]));
    }

    #[test]
    fn recusa_pedidos_ruins() {
        assert_eq!(rq("GET / HTTP/1.1\r\nHost: x\r\n").unwrap_err().0, 400); // cabeçalho cortado
        assert_eq!(rq("").unwrap_err().0, 400);
        assert_eq!(rq("POST /cmd HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc").unwrap_err().0, 400); // corpo cortado
        assert_eq!(rq("GET / HTTP/2\r\n\r\n").unwrap_err().0, 400);
        assert_eq!(rq("GET\r\n\r\n").unwrap_err().0, 400);
        assert_eq!(rq("GET relativo HTTP/1.1\r\n\r\n").unwrap_err().0, 400);
        assert_eq!(rq("GET / HTTP/1.1 extra\r\n\r\n").unwrap_err().0, 400);
        assert_eq!(rq("GET / HTTP/1.1\r\nsem-dois-pontos\r\n\r\n").unwrap_err().0, 400);
        assert_eq!(rq("POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n").unwrap_err().0, 400);
        assert_eq!(rq("POST / HTTP/1.1\r\nContent-Length: 4097\r\n\r\n").unwrap_err().0, 413);
        assert_eq!(rq("POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap_err().0, 501);
        assert_eq!(rq(&format!("GET / HTTP/1.1\r\nX: {}\r\n\r\n", "a".repeat(9000))).unwrap_err().0, 431);
        assert_eq!(read_request(&mut [0xffu8, 0xfe, b'\r', b'\n', b'\r', b'\n'].as_slice()).unwrap_err().0, 400);
    }

    #[test]
    fn rotas_metodos_e_origem() {
        let (sh, _rx) = shared();
        let r = sh.handle(&req("GET", "/", None, ""), IP);
        assert!(r.status == 200 && r.ctype == "text/html" && r.body.contains(r#"src="/app.js""#) && r.body.contains(r#"href="/app.css""#));
        let js = sh.handle(&req("GET", "/app.js", None, ""), IP);
        assert!(js.status == 200 && js.ctype == "text/javascript" && js.body.contains("/doublek/v1/"));
        let css = sh.handle(&req("GET", "/app.css", None, ""), IP);
        assert!(css.status == 200 && css.ctype == "text/css");
        assert!(PAGE.len() + JS.len() + CSS.len() <= 40 * 1024, "tela do celular passou de 40 KB");
        assert!(!PAGE.contains("<script>") && !PAGE.contains("<style") && !PAGE.contains(" style=") && !PAGE.contains(" onclick"), "nada inline (CSP)");
        let raw = String::from_utf8(js.bytes()).unwrap();
        assert!(raw.contains("Content-Type: text/javascript; charset=utf-8") && raw.contains("script-src 'self'") && !raw.contains("unsafe-inline"));
        for p in ["/app.js.map", "/remote.rs", "/../Cargo.toml", "/app.css/x", "/favicon.ico"] {
            assert_eq!(sh.handle(&req("GET", p, None, ""), IP).status, 404, "{p}");
        }
        assert_eq!(sh.handle(&req("POST", "/app.js", None, ""), IP).status, 405);
        assert_eq!(sh.handle(&req("PUT", "/", None, ""), IP).status, 405);
        assert_eq!(sh.handle(&req("GET", "/cmd", None, ""), IP).status, 405);
        assert_eq!(sh.handle(&req("OPTIONS", "/cmd", None, ""), IP).status, 405); // preflight de outra origem morre aqui
        assert_eq!(sh.handle(&req("GET", "/etc/passwd", None, ""), IP).status, 404);
        let mut r = req("GET", "/", None, "");
        r.headers[0].1 = "evil.example:8008".into();
        assert_eq!(sh.handle(&r, IP).status, 403); // DNS rebinding
        for h in ["localhost:8008", "192.168.0.10:8008", "[::1]:8008", "10.0.0.2"] {
            r.headers[0].1 = h.into();
            assert_eq!(sh.handle(&r, IP).status, 200, "{h}");
        }
        r.headers[0].1 = "127.0.0.1:8008".into();
        r.headers.push(("origin".into(), "http://evil.example".into()));
        assert_eq!(sh.handle(&r, IP).status, 403);
        r.headers.last_mut().unwrap().1 = "http://127.0.0.1:8008".into();
        assert_eq!(sh.handle(&r, IP).status, 200);
        assert!(String::from_utf8(Resp::err(401, "x").bytes()).unwrap().starts_with("HTTP/1.1 401 Unauthorized\r\n"));
        assert!(!String::from_utf8(Resp::err(200, "x").bytes()).unwrap().contains("Access-Control"));
    }

    #[test]
    fn pareamento_token_e_comando() {
        let (sh, rx) = shared();
        assert_eq!(sh.handle(&req("POST", "/cmd", None, r#"{"addr":"/doublek/v1/tap"}"#), IP).status, 401);
        assert_eq!(sh.handle(&req("POST", "/cmd", Some("ff"), r#"{"addr":"/doublek/v1/tap"}"#), IP).status, 401);
        assert_eq!(sh.handle(&req("GET", "/state", Some("ff"), ""), IP).status, 401);
        assert_eq!(sh.handle(&req("POST", "/pair", None, r#"{"code":"000000"}"#), IP).status, 401, "sem código gerado");
        let t = pair(&sh);
        assert_eq!(t.len(), 64);
        assert!(rx.try_recv().unwrap().starts_with("paired celular 1 (127.0.0.1)"));
        assert_eq!(sh.clients(), 1);
        let r = sh.handle(&req("POST", "/cmd", Some(&t), r#"{"addr":"/doublek/v1/blackout","args":[{"t":"T","v":true}]}"#), IP);
        assert_eq!(r.status, 200);
        let ev: Value = serde_json::from_str(&rx.try_recv().unwrap()).unwrap();
        assert_eq!(ev, json!({ "addr": "/doublek/v1/blackout", "args": [{ "t": "T", "v": true }], "client": "celular 1 (127.0.0.1)" }));
        for bad in ["nada", "{}", r#"{"addr":"tap"}"#, r#"{"addr":"/x","args":"T"}"#, r#"{"addr":"/x","args":[{"t":"d"}]}"#, r#"{"addr":"/x","args":[1]}"#] {
            assert_eq!(sh.handle(&req("POST", "/cmd", Some(&t), bad), IP).status, 400, "{bad}");
        }
        sh.set_state(json!({ "bpm": 145.0, "blackout": true }));
        let r = sh.handle(&req("GET", "/state", Some(&t), ""), IP);
        assert_eq!((r.status, serde_json::from_str::<Value>(&r.body).unwrap()), (200, json!({ "bpm": 145.0, "blackout": true })));
        assert_eq!(sh.received.load(Relaxed), 1);
        // código é de uso único; outro celular precisa de código novo
        let t2 = pair(&sh);
        assert_ne!(t, t2);
        assert_eq!(sh.clients(), 2);
        sh.revoke_all();
        assert_eq!(sh.clients(), 0);
        assert_eq!(sh.handle(&req("GET", "/state", Some(&t), ""), IP).status, 401);
        assert!(rx.try_iter().any(|e| e == "revoked"));
    }

    #[test]
    fn codigo_bloqueia_vence_e_limita_taxa() {
        let (sh, _rx) = shared();
        let code = sh.pair_code();
        let wrong = format!(r#"{{"code":"{:06}"}}"#, (code.parse::<u32>().unwrap() + 1) % 1_000_000);
        for _ in 0..MAX_FAILS - 1 {
            assert_eq!(sh.handle(&req("POST", "/pair", None, &wrong), IP).status, 401);
        }
        assert_eq!(sh.handle(&req("POST", "/pair", None, &wrong), IP).status, 429); // 5ª: bloqueia
        let right = format!(r#"{{"code":"{code}"}}"#);
        assert_eq!(sh.handle(&req("POST", "/pair", None, &right), IP).status, 429, "bloqueado mesmo com o código certo");
        assert_eq!(sh.handle(&req("POST", "/pair", None, "{}"), IP).status, 400);
        // código vencido (2 min)
        let code = sh.pair_code();
        if let Some(old) = Instant::now().checked_sub(Duration::from_secs(CODE_SECS + 1)) {
            sh.pair.lock().unwrap().code.as_mut().unwrap().1 = old;
            assert_eq!(sh.handle(&req("POST", "/pair", None, &format!(r#"{{"code":"{code}"}}"#)), IP).status, 401);
        }
        // código como número, com zero à esquerda preservado
        let code = sh.pair_code();
        let n: u32 = code.parse().unwrap();
        assert_eq!(sh.handle(&req("POST", "/pair", None, &format!(r#"{{"code":{n}}}"#)), IP).status, 200);
        // 20 pedidos/s por token
        let t = pair(&sh);
        for _ in 0..MAX_PER_SEC {
            assert_eq!(sh.handle(&req("GET", "/state", Some(&t), ""), IP).status, 200);
        }
        assert_eq!(sh.handle(&req("GET", "/state", Some(&t), ""), IP).status, 429);
        assert!(sh.rejected.load(Relaxed) >= 8);
    }

    #[test]
    fn servidor_real_em_tcp() {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let srv = serve("127.0.0.1:0".parse().unwrap(), move |e| {
            if let Event::Cmd(v) = e {
                let _ = tx.lock().unwrap().send(v);
            }
        })
        .unwrap();
        let addr = srv.addr;
        let http = |raw: String| {
            let mut s = TcpStream::connect(addr).unwrap();
            s.write_all(raw.as_bytes()).unwrap();
            let mut out = vec![];
            let _ = s.read_to_end(&mut out); // 413 pode fechar antes de ler o corpo inteiro
            String::from_utf8_lossy(&out).into_owned()
        };
        let post = |path: &str, auth: &str, body: &str| {
            http(format!("POST {path} HTTP/1.1\r\nHost: {addr}\r\n{auth}Content-Length: {}\r\n\r\n{body}", body.len()))
        };
        assert!(http(format!("GET / HTTP/1.1\r\nHost: {addr}\r\n\r\n")).starts_with("HTTP/1.1 200 OK"));
        assert!(http(format!("GET /app.js HTTP/1.1\r\nHost: {addr}\r\n\r\n")).contains("Content-Type: text/javascript"));
        assert!(post("/cmd", "", "{}").starts_with("HTTP/1.1 401"));
        let code = srv.shared.pair_code();
        let r = post("/pair", "", &format!(r#"{{"code":"{code}"}}"#));
        let token = serde_json::from_str::<Value>(r.split("\r\n\r\n").nth(1).unwrap()).unwrap()["token"].as_str().unwrap().to_string();
        let r = post("/cmd", &format!("Authorization: Bearer {token}\r\n"), r#"{"addr":"/doublek/v1/blackout"}"#);
        assert!(r.starts_with("HTTP/1.1 200 OK"), "{r}");
        let ev = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(ev["addr"], "/doublek/v1/blackout");
        assert!(post("/cmd", "", &"x".repeat(5000)).starts_with("HTTP/1.1 413"));
        assert!(serve(addr, |_| {}).err().expect("porta ocupada").contains("em uso"));
        srv.stop();
        serve(addr, |_| {}).expect("porta livre depois do stop").stop();
    }
}
