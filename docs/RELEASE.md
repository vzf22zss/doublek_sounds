# Como sai uma release

## Fluxo

1. Na `main`, a seção da versão nova no `CHANGELOG.md` precisa estar preenchida: `## [x.y.z] - AAAA-MM-DD`, com o que mudou. Sem ela, a release não sai.
2. Suba o número com `npm version patch` (ou `minor`) e faça o commit.
3. Mande a `main` para a `prod`. O push na `prod` dispara `.github/workflows/release.yml`.

Para conferir as notas antes, rode:

```powershell
node scripts/release-notes.mjs 0.3.8      # imprime as notas; sai com erro se a seção faltar ou estiver vazia
npm run check:scripts                     # testes do gerador de notas (também roda no CI)
```

## O que o workflow publica

| Passo | Se falhar |
|---|---|
| Versão ainda não publicada (tag `vX.Y.Z` não existe) | Nada é publicado. Suba o número na `main` e mande de novo. |
| Notas da Release a partir da seção do `CHANGELOG.md` | Nada é publicado. Escreva a seção e mande de novo. |
| Compilar, assinar e publicar (`tauri-action`): tag `vX.Y.Z`, Release "DoubleK Visuals vX.Y.Z" com as notas, o `.msi`, a assinatura `.msi.sig` e o `latest.json`, que é o que o app instalado consulta para se atualizar | Erro de build: nada é publicado. |
| `SHA256SUMS.txt`: baixa o `.msi` da própria Release, confere que é o mesmo compilado no job e anexa o hash | A Release já está no ar, sem o arquivo de hash. Gere e anexe à mão (abaixo). |

Gerar e anexar o `SHA256SUMS.txt` à mão:

```powershell
gh release download vX.Y.Z --pattern *.msi --dir dl
Get-ChildItem dl\*.msi | ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" } | Set-Content SHA256SUMS.txt
gh release upload vX.Y.Z SHA256SUMS.txt
```

## Como verificar o download (Windows)

```powershell
Get-FileHash .\DoubleK.Visuals_X.Y.Z_x64_pt-BR.msi -Algorithm SHA256
```

O valor tem de ser igual ao da linha do `.msi` no `SHA256SUMS.txt` da Release. A comparação não diferencia maiúsculas de minúsculas. Se diferir, não instale.

## Se a chave de assinatura se perder (dívida D-07)

O app instalado só aceita atualização assinada pela chave privada que corresponde à `pubkey` embutida nele (`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`). A chave fica em `%USERPROFILE%\.tauri\doublek.key` e no secret `TAURI_SIGNING_PRIVATE_KEY` do GitHub. A senha fica em `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

- **Agora:** guarde duas cópias fora deste PC: no gerenciador de senhas e num pendrive guardado. A senha vai separada.
- **Se perder:** quem já instalou continua usando o app normalmente, mas **nunca mais** recebe atualização automática. Para voltar a publicar:
  1. Gere uma chave nova: `npm run tauri signer generate -- -w %USERPROFILE%\.tauri\doublek.key`.
  2. Troque a `pubkey` no `tauri.conf.json`.
  3. Atualize os dois secrets.
  4. Publique uma release cujas notas digam com destaque: **"baixe e instale esta versão manualmente"**. A partir dela, as atualizações voltam a ser automáticas.
