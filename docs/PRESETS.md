# Presets do DoubleK (`.doublekpreset`)

Um preset é um **visual sem mídia**: cores, efeitos, rastro, fundo, fontes de modulação e a régua de cada fonte. Serve para trocar looks com outros DJs. No app: **Catálogo → Exportar preset** salva o visual atual; **Importar preset** traz o arquivo de alguém para a seção **Importados** do Catálogo, de onde ele é aplicado ou gravado num pad como qualquer preset de fábrica.

## Formato

Arquivo JSON, no máximo **64 KB**, extensão `.doublekpreset`:

```json
{
  "format": "doublek-preset",
  "v": 1,
  "name": "Meu túnel",
  "author": "DJ Fulano",
  "style": "dark",
  "look": { "color": "#ff2a55", "trail": 0.75, "chroma": 6, "mod": { "chroma": "hats" }, "range": { "chroma": [0.2, 0.8] } }
}
```

| Campo | Regra |
|---|---|
| `format` | sempre `"doublek-preset"`; outro valor é recusado |
| `v` | versão do formato: hoje `1`. Maior que a do app = "preset de uma versão mais nova", recusado |
| `name` | obrigatório; até 60 caracteres (o resto é cortado) |
| `author` | opcional, até 60 caracteres |
| `style` | opcional: `psy`, `dark`, `forest`, `hitech`, `ambient`, `breakdown` ou `drop` (outro valor é ignorado) |
| `look` | obrigatório; os mesmos campos de uma cena. Chave desconhecida é descartada, valor do tipo errado volta ao padrão, e o que faltar vem do padrão do app |
| `look.range` | opcional (desde a 0.3.11): régua por fonte, `{ "<efeito>": [mín, máx] }` com `0 ≤ mín < máx ≤ 1`, só para efeitos que têm fonte (os de `mod`). Entrada inválida é descartada (o efeito volta à faixa inteira). Preset sem `range` (os antigos) carrega sem régua |

## O que não vai no arquivo

Logo, foto de fundo e vídeos (são arquivos, não parâmetros) e os ajustes de operação (BLACKOUT, desempenho, limite de flashes, recorte da logo, sincronia e o **Na pausa**). Se o visual exportado usa vídeo de fundo, o arquivo sai sem ele e o app avisa. Para levar mídia junto, use o **Show Pack** (`docs/SHOWPACK.md`).

## Limites

Até 100 presets importados por máquina (guardados em `doublek.presets`). Apagar um importado pede confirmação e não muda os pads que já usam aquele look.
