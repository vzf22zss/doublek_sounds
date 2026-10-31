# Efeitos da comunidade (`.doublekfx`)

Um efeito é um **shader de pós-processamento**: recebe a imagem do DoubleK e devolve a imagem modificada, reagindo à música. Nesta versão os efeitos existem **só no editor** (aba **Efeitos → Efeitos da comunidade (FX)**), com pré-visualização própria; ligá-los ao telão como camada é a próxima etapa (DK-123).

> ⚠ **Shader de terceiros pode travar a placa de vídeo.** O app valida o código e compila num contexto separado, mas isso não é uma sandbox. Use só efeitos de quem você confia.

## Pacote

Um `.doublekfx` é um ZIP (sem compressão, o mesmo formato do Show Pack) com dois arquivos, até **64 KB** no total:

```
meu-efeito.doublekfx
├── manifest.json
└── effect.frag
```

### `manifest.json`

```json
{
 "format": "doublek-fx",
 "v": 1,
 "id": "rgb-split-kick",
 "name": "RGB split no kick",
 "author": "Fulano",
 "version": "1.0.0",
 "entry": "effect.frag",
 "params": [
  { "key": "amount", "label": "Força", "min": 0, "max": 1, "default": 0.6, "step": 0.01, "mod": "kick" }
 ]
}
```

| Campo | Regra |
|---|---|
| `format` / `v` | `"doublek-fx"` e `1`. Versão maior = "efeito de uma versão mais nova", recusado |
| `id` | 3–40 caracteres: minúsculas, números, hífen. Identifica o efeito instalado |
| `name` | obrigatório, até 60; `author` opcional, até 60; `version` texto curto (`1.0.0`) |
| `entry` | sempre `"effect.frag"` |
| `params` | até **8**. Cada um: `key` (letra + letras/números, única), `label`, `min < max`, `default` dentro da faixa, `step` > 0 (padrão: faixa/100), `mod` opcional (`kick`, `sub`, `bass`, `mid`, `hats`, `beat`, `bar`, `lfo`, `auto`) — informativo nesta versão |

O parâmetro *n* chega no shader como `uP[n]` (na ordem da lista).

### `effect.frag` — o contrato

Você escreve **só o corpo**. O app põe isto na frente (não repita):

```glsl
#version 300 es
precision highp float;
uniform sampler2D uInput;      // a imagem de entrada
uniform vec2 uRes;             // tamanho em pixels
uniform float uTime, uBeat, uPhase, uKick, uLow;
uniform float uBands[5];       // sub, bass, mid, click, air (0..1)
uniform float uP[8];           // seus parâmetros
in vec2 vUv;                   // coordenada 0..1
out vec4 o;                    // a cor de saída
```

| Uniform | O que é |
|---|---|
| `uTime` | segundos |
| `uBeat` | beats desde o início (contínuo), `uPhase` 0..1 dentro do beat |
| `uKick` | 1 na batida, decai em ~150 ms |
| `uLow` | 1 com grave tocando (drop), 0 no breakdown |
| `uBands[5]` | energia por banda: 0 sub, 1 bass, 2 mid, 3 click, 4 air |

Exemplo mínimo:

```glsl
void main() {
  vec4 c = texture(uInput, vUv);
  o = vec4(mix(c.rgb, 1.0 - c.rgb, uP[0] * uKick), c.a);
}
```

### Regras (validação antes de compilar)

- Até **32 KB**, **só ASCII** (inclusive comentários).
- Proibido: `#version` (o app já põe), `#extension`, `#include`, qualquer `uniform` (todos já vêm declarados).
- Laços: só `for` com **limite constante ≤ 256** (`for (int i = 0; i < 64; i++)`); `while` e `do` são recusados.
- Precisa de `void main()` escrevendo em `o`.

As regras são verificações simples de texto: pegam o óbvio, não provam que o shader é seguro.

## Editor

Na aba **Efeitos**, seção **Efeitos da comunidade (FX)** (recolhível):

- **Novo** (a partir de um modelo), **Importar** `.doublekfx`, **Exportar**, **Apagar**.
- Pré-visualização num canvas com contexto WebGL2 **próprio** (não o do telão), sobre a sua logo (ou um gradiente), com os uniforms vindos do áudio que está tocando.
- Compila **500 ms depois de você parar de digitar**, no máximo **2 vezes por segundo**. Erros aparecem com a **linha do seu código**. **Reverter para o último válido** volta ao último código que compilou.
- Sliders para os parâmetros do manifesto; valores e efeitos ficam salvos (`doublek.fx`; o código fica no armazenamento local do app, junto com a mídia).
- **Segurança:** se o contexto WebGL cair ou a primeira renderização passar de **2 s**, o efeito fica **suspeito** e não recompila sozinho (botão *Tentar de novo*). **3 falhas** → **desabilitado** até você clicar em *Reativar*.

## Exemplos

`docs/examples/fx/rgb-split-kick` e `docs/examples/fx/ondas-grave` (com laço de 8 amostras). Para gerar o `.doublekfx`, importe no editor pelo botão **Novo** + colar, ou compacte os dois arquivos num ZIP *sem compressão* com a extensão `.doublekfx`.
