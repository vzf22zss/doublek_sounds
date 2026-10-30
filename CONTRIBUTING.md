# Contribuir com o DoubleK Visuals

Obrigado por querer ajudar. Este guia diz como rodar o app, o que conferir antes de mandar uma mudança e como o trabalho é organizado. Em caso de dúvida, o documento que manda é o [roadmap](docs/DOUBLEK_VISUALS_PLANO_AGENTICO_ROADMAP.md), em especial a seção 0 (contrato de execução).

> **Licença:** o repositório ainda **não tem licença definida** (decisão DEC-01 do mantenedor, pendente). Repositório público não quer dizer código aberto. Até a decisão sair, combine com o mantenedor antes de reutilizar o código ou de contribuir algo que dependa de uma licença específica.

## Rodar

Requer **Node 20+**, **Rust** (via rustup) e **Visual Studio Build Tools** com a carga de trabalho C++. O alvo é Windows 10/11 64 bits.

```
npm install
npm run tauri dev
```

Abre a janela de controle; **F** abre o telão. Detalhes de uso estão no [tutorial](docs/TUTORIAL.md).

## Checagens

Rode as três antes de qualquer commit. São as mesmas que a CI roda em push e PR (`.github/workflows/ci.yml`).

```
npm run typecheck            # svelte-check sobre tudo
npm run check                # testes de settings, store, telemetry, limits e safety
cd src-tauri && cargo test --release
```

Para afinar a detecção com faixas reais:

```
cd src-tauri
cargo run --release --example analyze -- faixa.mp3 135 150
```

## Fluxo de trabalho

O trabalho segue o roadmap, uma tarefa de cada vez, na ordem de prioridade e dependência.

- **Uma branch por tarefa**, com o ID dela: `feat/dk-010-show-pack`, `fix/dk-003-telemetria`, `docs/dk-004-governanca`.
- **Commits pequenos, em português**, começando pelo ID quando a tarefa tiver um: `DK-006: limite de flashes, blackout por CSS e PÂNICO`.
- **Sem push, merge, publicação ou release sem autorização do mantenedor.** A branch `prod` é o que está publicado: cada push nela gera uma Release.
- **Revalide no código antes de implementar.** O roadmap descreve a baseline analisada; o código pode ter andado. Se a funcionalidade já existe, teste e registre a evidência em vez de duplicar.
- **Atualize o roadmap só com evidência.** Uma checkbox só vira marcada com comando, resultado e commit. Teste de hardware que não pôde ser feito fica como **NÃO VERIFICADO**, nunca como aprovado.
- **Não escolha sozinho** licença, modelo comercial ou arquitetura nativa irreversível. Registre a decisão pendente para o mantenedor (seção 8.4 do roadmap).
- **Documente junto com o código:** README, tutorial, mensagens de interface, migração e diagnóstico.

Ao terminar, produza o relatório da seção 11 do roadmap: tarefa, status, branch/commits, arquivos, testes, teste manual, riscos, pendências e próximo passo.

## Definição de pronto

Copiada da seção 0.4 do roadmap. Uma tarefa só fica **DONE** se satisfizer todos os critérios relevantes:

- [ ] Código compilando e alterações localizadas/legíveis.
- [ ] `npm run typecheck` e `npm run check` executados, sem regressão causada pela tarefa.
- [ ] Testes Rust relevantes executados (`cargo test`, preferencialmente também `cargo test --release`).
- [ ] Testes automatizados novos cobrindo regras novas, limites e erros esperados.
- [ ] Teste manual documentado quando for interação com áudio, controlador MIDI, saída externa ou GPU.
- [ ] Fluxo de abertura/fechamento de telão e **BLACKOUT** preservado.
- [ ] Impacto de CPU/GPU, memória e latência medido quando aplicável.
- [ ] Presets anteriores carregando ou migrados corretamente; falha recuperável se forem inválidos.
- [ ] README/tutorial e mensagens de interface atualizados quando aplicável.
- [ ] Linha correspondente do roadmap, data, commit/PR e evidência atualizados.

## O que não fazer

- **Não apague `legacy/logo-pulsante-2.0.html` nem a tag git `html-original`.** É o plano B do DJ para o dia do show.
- **Não adicione dependências, SDKs ou assets sem revisar licença, tamanho e superfície de ataque.** O inventário atual está em [BASELINE.md, seção 9](docs/quality/BASELINE.md). Nada de GPL/AGPL; prefira o que já está instalado.
- **Não use mídia de terceiros** (música, logos, vídeos, fotos) sem autorização, nem em testes, nem na documentação.
- **Não remova nem migre de forma destrutiva** configurações, presets, cenas e assets salvos. Toda mudança de formato tem migração e fallback.
- **Não quebre o show:** falha em efeito, asset, vídeo ou rede não pode parar o motor de áudio nem bloquear o BLACKOUT.
- **Não abra porta de rede nem envie dados** sem decisão explícita do mantenedor. O app funciona offline; o único acesso externo é a consulta de atualização às Releases do GitHub.

## Relatar problemas

Use os modelos de issue em `.github/ISSUE_TEMPLATE/`. Para falhas de segurança, veja [SECURITY.md](SECURITY.md).
