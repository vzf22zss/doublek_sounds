# ADR 0003 — Protocolo de comandos único (teclado, MIDI, roteiro, OSC, remoto)

**Status:** proposta · **Data:** 2026-10-30 · **Tarefa:** DK-001

## Contexto

Hoje há uma camada comum informal em `src/control/App.svelte`: o mapa `ACTIONS` (`tap`, `half`, `double`, `nudge-`, `nudge+`, `blackout`, `logoOnly`, `go`, `stop`, `beat-`, `beat+`, `bar-`, `bar+`, `ab`) é chamado pelo teclado (`onKey`) e pelo MIDI learn (alvos `a:<ação>`). Ajustes contínuos usam alvos `v:<chave do Visual>` e cenas `c:<índice>`. O roteiro dispara direto em `vs`/`perf.recall` a partir de `roteiro.svelte.ts`. Tudo passa pelo estado `$state` do Svelte; nada toca a thread de áudio.

Com OSC (DK-090), celular (DK-080), macros e automação (DK-030/040), ter 4 caminhos diferentes para "trocar de cena" vira fonte de divergência e de furo de segurança.

## Decisão (proposta para DK-042)

1. Criar `src/lib/commands.ts` com o tipo `ShowCommand` (união discriminada: `SCENE_RECALL`, `SCENE_PREVIEW`, `SCENE_TAKE`, `SET_PARAMETER`, `BLACKOUT`, `LOGO_ONLY`, `TAP`, `TEMPO_HALF/DOUBLE`, `NUDGE`, `ROTEIRO_GO/STOP/NUDGE/AB`, `MACRO`, `AUTOMATION_MODE`) e um `dispatch(cmd, source)` único.
2. **Fontes** (`keyboard`, `midi`, `roteiro`, `automation`, `osc`, `remote`) passam por **autorização** antes do dispatch: OSC/remoto só com servidor ligado e pareado; automação respeita roteiro e override manual (DK-143).
3. O mapa `ACTIONS` atual **vira a primeira implementação** do dispatcher (mesmos nomes, para o MIDI learn salvo continuar válido: `a:tap` → `{type:'TAP'}` etc.). Sem quebrar `doublek.midi`.
4. `dispatch` registra um histórico curto (para desfazer e para diagnóstico) e nunca bloqueia: tudo síncrono sobre `$state`, IPC para o Rust só em `TAP`/`NUDGE`/tempo.
5. BLACKOUT é tratado **antes** de qualquer fila ou cooldown.

## Consequências

- Refatoração contida em `App.svelte` + um arquivo novo; roteiro e MIDI passam a chamar `dispatch`.
- OSC e remoto nascem já no protocolo certo (um mapeamento de endereço → `ShowCommand`).
- Testes de regra (precedência, cooldown, override) ficam em TS puro, no `npm run check`.
