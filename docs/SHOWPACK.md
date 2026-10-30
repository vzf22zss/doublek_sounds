# Show Pack (`.doublekshow`) — especificação do formato

**Status:** contrato da DK-011 (schema 1) · **Data:** 2026-10-30 · **Decisões:** ADR 0001, DEC-03 (limites), DEC-09 (música opt-in)
**Código:** `src/lib/showpack/manifest.ts` (tipos + `safeAssetPath` + `validateManifest`) · testes em `manifest.check.ts`

Um Show Pack é **um arquivo ZIP** com extensão `.doublekshow` que leva tudo o que um show precisa para abrir igual em outro computador: visual, cenas, roteiros, logo, foto, vídeos, mapeamento MIDI (opcional) e, só se o DJ escolher, as músicas dos roteiros. Esta página define o **contrato**; exportar (DK-012), importar (DK-013) e a interface (DK-014) implementam em cima dela.

## 1. Layout do ZIP

```text
meu-show.doublekshow
├── manifest.json      obrigatório — metadados, versão e inventário dos assets (seção 2)
├── visual.json        obrigatório — doublek.visual, doublek.trans, doublek.videos
├── scenes.json        obrigatório — doublek.scenes (8 cenas)
├── roteiros.json      obrigatório — doublek.roteiros (pode ser lista vazia)
├── midi.json          opcional    — doublek.midi (só se o DJ marcar "incluir MIDI")
└── assets/            opcional    — um arquivo por asset do manifesto, sem subpastas
    ├── logo.png
    ├── bg.jpg
    ├── k3j2h1g0.mp4
    └── abc123.mp3
```

Regras do contêiner:

- ZIP **só com método STORE** (sem compressão: mídia já vem comprimida e os JSONs são pequenos), sem senha, sem descritor de dados, sem vários volumes e **sem ZIP64**: cada arquivo e o pacote inteiro ficam abaixo de 4 GiB (o manifesto já limita a 2 GiB). Nomes em UTF-8 (bit 11). Escritor e leitor: `src/lib/showpack/zip.ts`, sem dependência.
- O leitor confere assinaturas, cabeçalho local × diretório central, tamanhos e CRC-32 de cada entrada. Qualquer entrada com nome perigoso (`..`, absoluto, letra de unidade, `\`, segmento vazio, caractere de controle) ou compressão recusa **o pacote inteiro**. Entradas com nome seguro fora da lista acima são ignoradas, nunca extraídas.
- Os nomes de arquivo na raiz são fixos e em minúsculas. `assets/` contém exatamente os caminhos do manifesto: asset no manifesto sem arquivo no ZIP, ou arquivo em `assets/` fora do manifesto, é erro.
- Os JSONs de estado respeitam o teto de JSON de `src/lib/limits.ts` (2 MB cada). O manifesto também.

## 2. `manifest.json`

```json
{
  "schemaVersion": 1,
  "appVersion": "0.3.1",
  "createdAt": "2026-10-30T12:00:00Z",
  "name": "Dark forest – set de sábado",
  "includeTracks": false,
  "assets": [
    { "path": "logo.png",     "kind": "logo",  "bytes": 184320,    "sha256": "…64 hex…", "mime": "image/png",  "refId": "logo" },
    { "path": "bg.jpg",       "kind": "bg",    "bytes": 912000,    "sha256": "…64 hex…", "mime": "image/jpeg", "refId": "bg" },
    { "path": "k3j2h1g0.mp4", "kind": "video", "bytes": 52428800,  "sha256": "…64 hex…", "mime": "video/mp4",  "refId": "k3j2h1g0" }
  ]
}
```

| Campo | Tipo | Regra |
|---|---|---|
| `schemaVersion` | inteiro | Versão deste contrato. Hoje **1**. Maior que a conhecida → recusar (seção 7). |
| `appVersion` | texto | Versão do app que exportou (`package.json`). Informativo; 1–40 caracteres. |
| `createdAt` | texto | ISO 8601 com hora e fuso (`2026-10-30T12:00:00Z` ou `…-03:00`). Data impossível é erro. |
| `name` | texto | Nome do show, 1–120 caracteres (espaços nas pontas são removidos). |
| `includeTracks` | boolean | `true` = o DJ escolheu levar as músicas dos roteiros (DEC-09). Se `false`, nenhum asset `track` pode existir. |
| `assets` | lista | Inventário de `assets/`. Pode ser vazia (pacote só de estado). |

Campos desconhecidos no manifesto são ignorados (tolerância para frente dentro do mesmo `schemaVersion`); o validador devolve uma cópia só com os campos conhecidos.

### 2.1. Entrada de asset (`AssetEntry`)

| Campo | Regra |
|---|---|
| `path` | Nome do arquivo **relativo a `assets/`** (sem o prefixo). Ver seção 4. |
| `kind` | `logo` · `bg` · `video` · `track`. Outro valor é erro. |
| `bytes` | Tamanho **descomprimido**, inteiro > 0. Deve bater com o arquivo real (DK-013 confere). |
| `sha256` | SHA-256 do conteúdo, 64 hex. Maiúsculas são aceitas e normalizadas para minúsculas. |
| `mime` | Tipo real do conteúdo (`tipo/subtipo`). Obrigatório; `application/octet-stream` não vale. |
| `refId` | A que o asset corresponde no estado (seção 5). `[A-Za-z0-9._-]{1,64}`, mesmo alfabeto de `track::check_id` no Rust. |

Mapeamento `kind` → tipo de limite (`KIND_LIMIT` em `manifest.ts`): `logo`, `bg` → `image`; `video` → `video`; `track` → `audio`. Extensões, tetos e MIME aceitos por tipo são **os mesmos** de `src/lib/limits.ts` (DK-005): o que não entra pelo botão também não entra pelo pacote.

## 3. Limites (DEC-03 — a confirmar pelo mantenedor)

| Limite | Valor | Origem |
|---|---|---|
| Assets por pacote | **50** | `MAX_ASSETS` |
| Total descomprimido (soma de `bytes`) | **2 GiB** (2 147 483 648 bytes) | `MAX_TOTAL_BYTES` |
| Imagem (`logo`, `bg`) | 25 MB · png, jpg, jpeg, webp, gif, bmp, svg | `limits.ts` |
| Vídeo | 600 MB · mp4, webm, mov, m4v | `limits.ts` |
| Música (`track`) | 300 MB · mp3, wav, flac, m4a, aac, ogg | `limits.ts` |
| JSON de estado e manifesto | 2 MB cada | `limits.ts` |
| `logo` e `bg` | no máximo **um** de cada | `refId` único por tipo |

`validateManifest(x, { maxAssets, maxTotalBytes })` permite apertar os tetos sem mudar o contrato (ex.: máquina com pouco disco). A soma é verificada **a partir do manifesto** antes de descomprimir qualquer coisa: é a primeira defesa contra zip bomb; a segunda é o importador parar de extrair ao passar do `bytes` declarado (DK-013).

## 4. Regras de caminho (`safeAssetPath`)

Um `path` é aceito só se **todas** valem:

- um nome de arquivo só: **sem pasta**, sem `/` nem `\`, sem prefixo `assets/`;
- relativo: não começa com `/`, `\` nem letra de unidade; não contém `..` em lugar nenhum;
- só `[A-Za-z0-9._-]`, não começa com `.`, 1 a 255 caracteres — logo **sem espaço**, sem acento, sem controle;
- não é nome de dispositivo do Windows (`con`, `nul`, `com1`…), com ou sem extensão;
- único dentro do manifesto.

O ZIP pode ter a entrada como `assets/logo.png` **apenas**; a extração escreve só em destino controlado pelo app (IndexedDB ou `app_data/tracks/`), nunca em caminho vindo do arquivo. Qualquer entrada fora de `assets/<path>` é ignorada.

## 5. Como o estado de hoje entra no pacote

Cada chave `doublek.*` (ver `docs/quality/BASELINE.md` §6 e `src/lib/store.ts`) vai para um JSON do pacote **no mesmo envelope `{ v, data }` que já está no `localStorage`**. Assim o importador reaproveita as migrações e validadores de `store.ts` (migra `v` antigo, recusa `v` futuro, cai no padrão se inválido) em vez de ganhar um segundo schema.

| Chave hoje | Onde fica hoje | No pacote | Observação |
|---|---|---|---|
| `doublek.visual` | localStorage | `visual.json` → `"doublek.visual"` | `blackout`/`logoOnly` entram como `false` (já é o comportamento de `validVisual`). |
| `doublek.trans` | localStorage | `visual.json` → `"doublek.trans"` | Transição padrão (beats). |
| `doublek.videos` | localStorage | `visual.json` → `"doublek.videos"` | Biblioteca `{id, name}[]`; cada `id` deve ter um asset `video` com `refId = id`. |
| `doublek.scenes` | localStorage | `scenes.json` → `"doublek.scenes"` | 8 posições, `null` permitido. |
| `doublek.roteiros` | localStorage | `roteiros.json` → `"doublek.roteiros"` | `Roteiro.track` aponta para o asset `track` com `refId = track` **se** `includeTracks`; senão fica como está e o app pede "Trocar música". |
| `doublek.midi` | localStorage | `midi.json` → `"doublek.midi"` | Opcional. Chaves são `cc:<canal>:<nº>`, independentes do nome do dispositivo. |
| `doublek.settings` | localStorage | **não vai** | Dispositivo de áudio, ganho, gate: são da máquina, não do show. |
| `logo` | IndexedDB `doublek/kv` | `assets/`, `kind: "logo"`, `refId: "logo"` | No máximo um. Ausente = logo padrão do app. |
| `bg` | IndexedDB `doublek/kv` | `assets/`, `kind: "bg"`, `refId: "bg"` | No máximo um. |
| `video:<id>` | IndexedDB `doublek/kv` | `assets/`, `kind: "video"`, `refId: <id>` | Um por vídeo da biblioteca. |
| `tracks/<id>.<ext>` | disco (`app_data`) | `assets/`, `kind: "track"`, `refId: "<id>.<ext>"` | Só com `includeTracks: true`. O `refId` é o id completo com extensão, como o Rust guarda. |

Formato de cada arquivo de estado: objeto `{ "<chave>": { "v": n, "data": … } }`. Exemplo de `visual.json`:

```json
{
  "doublek.visual": { "v": 1, "data": { "size": 55, "bgVideo": "k3j2h1g0", "…": "…" } },
  "doublek.trans":  { "v": 1, "data": 2 },
  "doublek.videos": { "v": 1, "data": [ { "id": "k3j2h1g0", "name": "loop floresta" } ] }
}
```

Referências cruzadas que o importador precisa checar (etapa 6 da seção 6): `visual.bgVideo`, `scene.look.bgVideo`, `cue.video` e `doublek.videos[].id` → asset `video`; `roteiro.track` → asset `track` quando `includeTracks`. Referência sem asset é erro de pacote, não silencioso.

## 6. Ordem de validação (importação)

Sempre nesta ordem; **o primeiro erro para tudo**, sem ter tocado no estado atual:

1. **Manifesto** — `manifest.json` existe, é JSON ≤ 2 MB, é objeto, campos obrigatórios com o tipo certo.
2. **Versão** — `schemaVersion` inteiro ≥ 1 e ≤ a conhecida. Futura → recusa (seção 7), antes de olhar qualquer asset.
3. **Caminhos** — cada `path` passa em `safeAssetPath`; sem repetidos.
4. **Tamanhos e limites** — `kind` conhecido; `bytes` inteiro > 0; `mime` real e permitido para o tipo; extensão e teto por tipo (`limits.ts`); `track` só com `includeTracks`; ≤ 50 assets; soma ≤ 2 GiB.
5. **Hashes** — `sha256` com 64 hex no manifesto; depois (DK-013) o hash **do conteúdo extraído** em staging bate com o declarado, e o tamanho real bate com `bytes`.
6. **Referências** — `refId` presente e válido; `logo`/`bg` com `refId` igual ao tipo e no máximo um de cada; `refId` único por tipo. Em seguida (DK-013): cada asset do manifesto existe no ZIP, cada arquivo de `assets/` está no manifesto, e as referências cruzadas da seção 5 resolvem.

As etapas 1–4, 5 (forma) e 6 (internas) são `validateManifest`. O restante está em `inspectShowPack` (`src/lib/showpack/import.ts`), também pura e testada em Node: lê o ZIP, confere tamanho e sha256 reais de cada asset, recusa arquivo em `assets/` fora do manifesto, migra e valida cada chave com `migrate` + os validadores do app (`validVisual`, `validScenes`, `validRoteiros`, `validVideos`, MIDI) e resolve as referências cruzadas. O resultado é um **plano** já validado, com os bytes dos assets; nada é gravado nessa fase.

Decodificar as imagens (`logo`, `bg`) para provar que são imagens de verdade é feito com `createImageBitmap` no navegador, antes de qualquer escrita. Em Node essa etapa é pulada, e SVG também (o Chromium não decodifica SVG em `createImageBitmap`; o `<img>` do app valida depois).

Avisos que não impedem a importação vão em `plan.warnings`: roteiro cuja música não veio (`includeTracks: false`) e vídeo do pacote que não está na lista.

Mensagens de erro são em **português**, curtas, com o índice e o caminho do asset quando houver (`asset 3 (loop.mp4): arquivo grande demais (650 MB; máximo 600 MB)`), prontas para a linha de status. Nunca expõem caminho de disco do usuário.

## 7. Versão futura do schema

`schemaVersion` maior que a conhecida: **recusar** com `pacote de uma versão mais nova do DoubleK (schema N; este app lê até M). Atualize o app.` Não ler os JSONs de estado, não extrair assets, não criar backup, não alterar nada. Dentro do mesmo `schemaVersion`, campos novos desconhecidos são ignorados. Mudança incompatível (campo renomeado, semântica diferente) exige subir `SCHEMA_VERSION` e escrever a migração `N → N+1` em `migrate.ts`, no mesmo molde de `store.ts`.

## 8. Modos de importação

Aplicação: `applyShowPack(plan, mode, deps)`. As escritas passam por `deps` (IndexedDB, localStorage, músicas), o que permite testar em Node. Ordem: checar imagens → **backup** → assets → chaves `doublek.*`. Cada escrita registra a operação inversa; se qualquer passo falhar, as inversas rodam do fim para o começo e o erro sai como `importação desfeita: <motivo>`. Falha no backup aborta antes de qualquer escrita.

O backup é um `.doublekshow` do estado atual (`collectShowPack`) entregue a `saveBackup(nome, bytes)`. O destino (`app_data/backups/` via Rust, mantendo os 5 mais recentes, ou download) é decidido na DK-014.

- **Substituir show atual (padrão).** Troca chaves `doublek.*` (exceto `doublek.settings`), `logo`, `bg` e a biblioteca de vídeos, mantendo os ids do pacote. `logo`/`bg` ausentes no pacote são removidos (volta a logo padrão). Vídeos do show antigo que o novo não usa são removidos do IndexedDB (estão no backup). Músicas antigas em `app_data/tracks/` **não** são apagadas (limpeza fica para DK-142).
- **Importar como novo.** Vídeos e músicas do pacote recebem **ids novos** e todas as referências são reescritas (`visual.bgVideo`, `scene.look.bgVideo`, `cue.video`, `roteiro.track`). Roteiros e cues ganham ids novos. A biblioteca de vídeos e a lista de roteiros são **somadas** às atuais. `logo`/`bg` só substituem os atuais se `plan.replaceLogoBg` (o DJ confirma). Visual, transição e as 8 cenas são posições únicas: as do pacote **substituem** as atuais, que ficam no backup.
- Em ambos: inspeção completa primeiro, aplicar por último; falha em qualquer etapa → nada muda (ADR 0001, item 2). `doublek.midi` só é aplicado se o pacote tiver `midi.json` **e** `plan.applyMidi` (o DJ marca "aplicar MIDI"). Pacote com música exige `deps.addTrack`; sem ele, a aplicação recusa antes de escrever.

## 9. Compatibilidade com os JSONs atuais

Preset JSON (visual + 8 cenas, sem mídia) e roteiro JSON continuam sendo importados pelos caminhos de hoje (`sanitizeLook`/`sanitizeRoteiro`). Não são Show Packs e não passam por este validador. Um preset legado pode ser convertido em pacote simplesmente exportando depois de carregá-lo.

## 10. Fora deste contrato (próximas tarefas)

DK-012: escrever o ZIP, calcular hashes (`crypto.subtle`), decidir se arquivo > N MB passa pelo Rust. DK-013: leitura do ZIP, staging, conferência de hash/tamanho real, dimensões de imagem, referências cruzadas, backup, rollback, migração de schema. DK-014: UI, mensagens e tutorial. DK-142: política final de música (DEC-09) e re-vinculação de ids.
