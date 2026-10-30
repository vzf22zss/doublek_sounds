# ADR 0002 — Renderer: WebGL2 em 3 passes, evoluindo para módulos e compositor

**Status:** aceita · **Data:** 2026-10-30 · **Tarefa:** DK-001

## Contexto

`src/render/renderer.ts` (409 linhas) é uma classe única com 3 shaders fixos: cena (fundo + anéis + espectros + logo), feedback (rastro) e pós (vinheta, grão, strobe, blackout). O mesmo código roda no telão (60 fps) e no preview (30 fps, meia resolução). Vídeo de fundo e "só no drop" foram adicionados dentro dessa classe. Funciona e é previsível, mas cada efeito novo cresce o monólito e o shader de cena.

Alternativas consideradas: (a) trocar para three.js/pixi (dependência grande, pouco ganho para shaders custom); (b) renderer nativo em Rust/wgpu (reescrita total, perde o preview no WebView, Spout continuaria não trivial); (c) manter WebGL2 puro e **modularizar**.

## Decisão

Opção (c), em etapas:

1. **DK-021:** extrair helpers GL (`src/render/gl/`: programa, FBO, textura, quad) e uma interface de efeito (`init/resize/render/dispose/parameters`, uniformes musicais padronizados: `uKick`, `uBands[5]`, `uBeatPhase`, `uBar`, `uLow`, `uTime`). O renderer atual vira o primeiro "módulo legado".
2. **DK-022/023:** cada efeito novo (caleidoscópio, túnel, mandala, partículas, orgânico, glitch) é um módulo com seu shader e seus presets. Shader que não compila **desliga só o módulo**, com log.
3. **DK-050:** compositor de camadas (ordem, opacidade, blend) por cima dos módulos. Só depois disso o vídeo deixa de ser "textura do fundo" e vira camada.
4. Orçamento: no máximo 1 passe extra por módulo ativo; `renderScale` continua sendo a válvula de escape em notebook fraco.

## Consequências

- Nada muda para o usuário até DK-021; o renderer atual continua sendo o fallback.
- Preview e telão continuam com o **mesmo** código (regra: nunca divergir).
- Perda de contexto WebGL precisa de tratamento explícito (DK-003) antes de multiplicar módulos.
- Spout/gravação (DK-070/100) dependem de spike próprio; esta ADR não promete interoperabilidade GPU.
