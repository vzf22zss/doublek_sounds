# Stress de comandos (DK-044)

Dispara ~20 comandos/s aleatórios por 5 min no app rodando sob o mock do Tauri (Edge headless) e mede histórico, fila, alvos GL, p95 do telão, heap e a taxa real de flashes do strobe. Resultados de referência: `docs/quality/DK-044-stress.md`.

1. Tenha uma pasta com o mock (`inject.js`) e `npm i puppeteer-core` dentro dela; aponte `DOUBLEK_MOCK` para ela.
2. Suba o app em modo de desenvolvimento (o gancho `window.__dispatch` só existe nele): `npx vite --port 4183`.
3. Rode: `node scripts/stress/stress.mjs 300` (ou `node scripts/stress/stress.mjs 70 semB` para 70 s sem a parte do strobe).
4. Opcional: `EDGE` = caminho do msedge.exe; `PORT` = porta do vite.
5. Sai `stress-result.json` na pasta atual (por minuto: p95, heap, alvos GL, comandos, recusas; strobe por subdivisão). Não versionar.
