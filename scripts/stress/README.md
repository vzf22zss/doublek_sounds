# Stress de comandos (DK-044)

Dispara ~20 comandos/s aleatórios por 5 min no app rodando sob o mock do Tauri (Edge headless) e mede histórico, fila, alvos GL, p95 do telão, heap e a taxa real de flashes do strobe. Resultados de referência: `docs/quality/DK-044-stress.md`.

1. Tenha uma pasta com o mock (`inject.js`) e `npm i puppeteer-core` dentro dela; aponte `DOUBLEK_MOCK` para ela.
2. Suba o app em modo de desenvolvimento (o gancho `window.__dispatch` só existe nele): `npx vite --port 4183`.
3. Rode: `node scripts/stress/stress.mjs 300` (ou `node scripts/stress/stress.mjs 70 semB` para 70 s sem a parte do strobe).
4. Opcional: `EDGE` = caminho do msedge.exe; `PORT` = porta do vite.
5. Sai `stress-result.json` na pasta atual (por minuto: p95, heap, alvos GL, comandos, recusas; strobe por subdivisão). Não versionar.

# Soak de sessão longa (regressão 0.3.8)

`node scripts/stress/soak.mjs [segundos=7200]` roda o app por 2 h em ritmo de show: telão em janela própria, áudio sintético com groove/breakdown/drop/pausa+faixa defasada, Intelligent Show em Automático, roteiro em 10 de cada 30 min, gravação em blocos de 5 min (16:9 e vertical, bytes descartados) e o editor de FX aberto 10 de cada 30 min. Mesmos pré-requisitos do stress (`DOUBLEK_MOCK`, vite em modo dev). Por minuto grava p95/fps do telão, heap das duas janelas (CDP depois de GC), alvos GL, histórico, fila e erros em `soak-result.json`, com os critérios no fim. Resultado de referência: `docs/quality/REGRESSAO-0.3.8.md` §3.
