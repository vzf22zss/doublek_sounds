# Segurança

## Relatar um problema

Encontrou uma falha de segurança? **Não abra uma issue pública.**

<!-- MANTENEDOR: preencha um dos dois canais abaixo e apague o outro. -->

- **E-mail:** `[PREENCHER: e-mail do mantenedor]`
- **Relato privado no GitHub:** aba *Security* → *Report a vulnerability* `[PREENCHER: confirmar se está habilitado em Settings → Security → Private vulnerability reporting]`

Inclua o que aconteceu, como reproduzir, a versão do app e, se tiver, o JSON do Diagnóstico (veja abaixo). Prazo de resposta: `[PREENCHER]`.

Para bugs que não são de segurança, use os modelos de issue em `.github/ISSUE_TEMPLATE/`.

## Versões suportadas

Só a **última versão publicada** recebe correção. O app avisa no rodapé quando há versão nova; atualize antes do show.

| Versão | Suportada |
|---|---|
| última Release | sim |
| anteriores | não |

## O que o app faz e não faz

- **Funciona offline.** Nada do show depende de internet.
- **Só abre porta de rede se o operador ligar.** Há dois servidores, ambos **desligados por padrão** e, ligados, só em `127.0.0.1`, a menos que o operador marque **Abrir para a rede local**: o **OSC** (UDP, porta 9000, sem autenticação; [docs/OSC.md](docs/OSC.md)) e o **celular** (HTTP, porta 8008, pareamento por código e token, sem TLS; [docs/REMOTO.md](docs/REMOTO.md)). Na rede local, use só rede confiável. A saída Spout é local (placa de vídeo), não é rede.
- **Não envia dados.** O único acesso externo automático é, ao abrir, a consulta do arquivo `latest.json` nas Releases do GitHub para saber se há versão nova. Sem internet, a consulta falha em silêncio e o app segue normal. **Relatar problema** só salva o Diagnóstico, copia um resumo e abre a página do GitHub no navegador: nada é enviado sozinho. A atualização nunca é instalada sozinha e fica bloqueada com o telão aberto.
- **Só aceita atualização assinada** com a chave privada do mantenedor, que fica fora do repositório.

### Onde os dados ficam

Tudo local, na máquina do operador ([BASELINE.md, seção 6](docs/quality/BASELINE.md)):

| Dado | Onde |
|---|---|
| Ajustes de áudio, visual, cenas e bancos, transição, mapa MIDI, lista de vídeos, roteiros, mapa de automação, presets importados, lista de efeitos da comunidade | `localStorage` do WebView2 (chaves `doublek.*`, envelope versionado) |
| Logo, foto, vídeos de fundo e o código dos efeitos da comunidade | IndexedDB `doublek` |
| Músicas dos roteiros | `%APPDATA%\com.doublek.visuals\tracks\` |

| Gravações do telão, gravações da análise (só números) e backups de antes de abrir um Show Pack | pastas `recordings\`, `analysis\` e `backups\` em `%APPDATA%\com.doublek.visuals\` |

Presets (`.doublekpreset`) e roteiros exportados não levam mídia nem música. O Show Pack (`.doublekshow`) leva logo, foto e vídeos; músicas, por enquanto, nunca.

### CSP e limites de arquivo

Desde o DK-005 ([BASELINE.md, seção 7](docs/quality/BASELINE.md)):

- **CSP** restritiva nas duas janelas: `default-src 'self'`, sem script ou estilo inline, `connect-src` só o IPC do Tauri, `object-src 'none'`, `frame-src 'none'`.
- **Limites de importação**, checados no front e de novo no Rust, na borda do comando: imagem até 25 MB (png/jpg/jpeg/webp/gif/bmp/svg), vídeo até 600 MB (mp4/webm/mov/m4v), música até 300 MB e 20 minutos (mp3/wav/flac/m4a/aac/ogg), JSON até 2 MB. Nome de arquivo é validado antes de ir para o disco.
- **Importação inválida não derruba o app:** dado corrompido ou de versão futura volta ao padrão e o bruto fica guardado em `<chave>.bak`.

### Diagnóstico

Clicar na **pílula de saúde** no topo da janela de controle → **Salvar diagnóstico** salva um `.json` com versão do app, ajustes, estatísticas do telão, monitores, nomes dos dispositivos de áudio e MIDI, estado do OSC, do celular e da gravação, roteiro em uso, histórico de comandos e os últimos 200 eventos do diário. **Não contém áudio** nem a logo, foto, vídeos ou músicas. Pode ser anexado a um relato sem expor o set.

## Instalador e aviso do SmartScreen

O `.msi` **não tem assinatura de código paga**. Ao instalar, o Windows mostra "O Windows protegeu o computador"; clique em **Mais informações → Executar assim mesmo**. O aviso é esperado e não indica vírus. Cada Release publica o hash SHA-256 do `.msi` em `SHA256SUMS.txt` (como conferir: [docs/RELEASE.md](docs/RELEASE.md)). Assinatura com certificado real depende de decisão do mantenedor.

Baixe o instalador **só das Releases** de <https://github.com/vzf22zss/doublek_sounds/releases>.

## Dependências

O inventário de licenças e as vulnerabilidades conhecidas e aceitas estão em [BASELINE.md, seção 9](docs/quality/BASELINE.md). Reavaliar a cada atualização do Tauri.
