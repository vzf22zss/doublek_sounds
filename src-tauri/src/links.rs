//! Links externos (DK-007, "Relatar problema"): o app só abre no navegador páginas do próprio repositório.
//! Sem plugin `opener`/`shell`: um comando mínimo com esta checagem na frente.

pub const REPO: &str = "https://github.com/vzf22zss/doublek_sounds/";

/// Aceita só URLs que começam com `REPO`, até 4 KiB, só ASCII visível, sem aspas, barra invertida nem `..`
/// (nem `%2e`, que o navegador também lê como ponto): `\` e `..` levariam para fora do repositório.
pub fn check_repo_url(url: &str) -> Result<(), String> {
    let ok = url.starts_with(REPO)
        && url.len() <= 4096
        && url.bytes().all(|b| b.is_ascii_graphic() && b != b'"' && b != b'\\')
        && !url.contains("..")
        && !url.to_ascii_lowercase().contains("%2e");
    if ok { Ok(()) } else { Err("Só abro páginas do repositório do DoubleK".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_abre_o_repositorio() {
        for good in [
            "https://github.com/vzf22zss/doublek_sounds/issues/new?template=bug_report.md&title=%5Bbug%5D%200.3.9%3A%20&body=%23%23%20O%20que",
            "https://github.com/vzf22zss/doublek_sounds/",
        ] {
            assert_eq!(check_repo_url(good), Ok(()), "{good}");
        }
        for bad in [
            "https://github.com/vzf22zss/doublek_sounds", // sem a barra: doublek_sounds-malicioso passaria
            "https://github.com/vzf22zss/doublek_sounds-x/issues",
            "https://github.com/outro/repo/",
            "http://github.com/vzf22zss/doublek_sounds/",
            "https://github.com.evil.com/vzf22zss/doublek_sounds/",
            "https://evil.com/?https://github.com/vzf22zss/doublek_sounds/",
            "https://github.com/vzf22zss/doublek_sounds/../../outro/repo",
            "https://github.com/vzf22zss/doublek_sounds/%2e%2e/outro", // o navegador lê %2e como ponto
            "https://github.com/vzf22zss/doublek_sounds/%2E./outro",
            "https://github.com/vzf22zss/doublek_sounds/x\\..\\y",
            "https://github.com/vzf22zss/doublek_sounds/ x",
            "https://github.com/vzf22zss/doublek_sounds/\"&calc.exe",
            "https://github.com/vzf22zss/doublek_sounds/\nfile:///C:/Windows",
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "",
        ] {
            assert!(check_repo_url(bad).is_err(), "devia recusar {bad:?}");
        }
        assert!(check_repo_url(&format!("{REPO}{}", "a".repeat(5000))).is_err(), "longa demais");
    }
}
