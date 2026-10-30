# Camadas — benchmark de 4 layers (DK-053)

> **GPU swiftshader (Edge headless, CPU emulando a GPU), NÃO VERIFICADO em GPU real.**
> Serve para comparar configurações entre si e provar que nada aloca à toa, não para prever o telão.

**Como foi medido (2026-10-30):** build de teste com o mock do Tauri, telão 960×540, relógio real, qualidade Média,
ajuste automático desligado. Para cada configuração: 3 s de aquecimento e 10 s lendo o evento `telemetry`
(p95 e fps do telão, 1×/s) e `psy-costs` (`renderer.costs()`, média de ~1 s por passe; o swiftshader expõe
`EXT_disjoint_timer_query_webgl2`, então são tempos de GPU emulada). Valores = mediana dos segundos medidos.
Script: `bench.mjs` no scratchpad da sessão (fora do repositório).

| Configuração | fps | p95 do quadro | Alvos (FBO) alocados |
|---|---|---|---|
| Padrão (Psy Engine em 0) | 26 | 51,6 ms | 3 |
| 4 camadas em Normal 100% (orgânico, túnel, mandala, caleidoscópio) | 9 | 127,1 ms | 7 |
| As mesmas 4 com modo ≠ Normal a 80% (tela, somar, somar, multiplicar) | 8 | 143,7 ms | 9 |

**Custo por passe (ms, GPU swiftshader):**

| Passe | Padrão | 4 em Normal | 4 misturadas |
|---|---|---|---|
| cena (fixo) | 28,7 | 28,4 | 28,5 |
| orgânico | — | 23,9 | 29,2 |
| túnel | — | 10,5 | 16,1 |
| mandala | — | 18,2 | 23,5 |
| caleidoscópio | — | 17,1 | 22,4 |
| pós (fixo) | 6,9 | 6,9 | 6,9 |

**Leitura:**

- Camada em Normal a 100% não paga nada além do próprio módulo. Misturar (modo ≠ Normal ou opacidade < 1) soma
  1 passe por camada; aqui deu +5 a +6 ms por camada, quase o custo do pós, que também lê 1 textura por pixel.
- Alvos: 1 da cena + 2 do rastro sempre; +1 por módulo no 1º quadro em que ele desenha; +2 do compositor na 1ª
  camada misturada. Ligar, desligar, reordenar e trocar o modo não alocam mais nada (100 ciclos medidos no DK-052).
- O swiftshader é CPU: a proporção entre passes vale como pista, os milissegundos não. Medir de novo no notebook
  do show (1080p), com o mesmo roteiro, antes de recomendar quantas camadas misturadas usar ao vivo.
