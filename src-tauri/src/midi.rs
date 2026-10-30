//! Entradas MIDI: conecta em todos os controladores e reconecta quando a lista muda
//! (plugou/desplugou no meio do set). Só repassa CC e notas; o mapeamento fica na UI.

use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;
use std::time::Duration;

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
pub fn watch<F>(on_msg: F, mut on_devices: impl FnMut(Vec<String>))
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
                    mi.connect(&port, "doublek-in", move |_, b, _| {
                        if let Some(m) = parse(b) {
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
}
