// npm run check — "Testar tudo" (DK-145): entradas simuladas → cores e mensagens.
import assert from 'node:assert/strict';
import { evaluate, worst, type PreshowInput } from './preshow.ts';

const OK: PreshowInput = {
  rms: Array(100).fill(0.2), gate: 0.003, lockedAtS: 3.2,
  output: { open: true, fullscreen: true, monitorOk: true, p95: [17, 18, 30, 18, 17], lost: false },
  midi: { devices: ['nanoKONTROL2'], mapped: 5 },
  diskFree: 50e9, recording: false, safeFlash: true,
  fx: { safe: false, suspect: [] }, update: null,
  net: { osc: false, oscLan: false, remote: false, remoteLan: false, spout: false },
};
const run = (p: Partial<PreshowInput>) => Object.fromEntries(evaluate({ ...OK, ...p }).map((x) => [x.id, x]));
const color = (p: Partial<PreshowInput>, id: string) => run(p)[id].color;

// tudo certo: 9 itens verdes, cada um com frase
const all = evaluate(OK);
assert.deepEqual(all.map((x) => x.id), ['audio', 'bpm', 'output', 'midi', 'disk', 'flash', 'fx', 'version', 'net']);
assert.ok(all.every((x) => x.color === 'verde' && x.msg.length > 5));
assert.equal(worst(all), 'verde');
assert.match(run({}).output.msg, /p95 18 ms/); // mediana, um engasgo não pinta

// 1. áudio: ≥ 50% acima do corte
assert.equal(color({ rms: [...Array(50).fill(0.2), ...Array(50).fill(0)] }, 'audio'), 'verde');
assert.equal(color({ rms: [...Array(49).fill(0.2), ...Array(51).fill(0)] }, 'audio'), 'vermelho');
assert.equal(color({ rms: [] }, 'audio'), 'vermelho');
assert.match(run({ rms: Array(100).fill(0.002) }).audio.msg, /ganho.*cabo/);

// 2. BPM em ≤ 10 s
assert.equal(color({ lockedAtS: 0 }, 'bpm'), 'verde');
assert.equal(color({ lockedAtS: 10 }, 'bpm'), 'verde');
assert.equal(color({ lockedAtS: null }, 'bpm'), 'amarelo');
assert.match(run({ lockedAtS: null }).bpm.msg, /TAP/);

// 3. telão
const out = (o: Partial<PreshowInput['output']>) => ({ output: { ...OK.output, ...o } });
assert.equal(color(out({ open: false }), 'output'), 'vermelho');
assert.match(run(out({ open: false })).output.msg, /Projetar/);
assert.equal(color(out({ monitorOk: false }), 'output'), 'vermelho');
assert.equal(color(out({ fullscreen: false }), 'output'), 'vermelho');
assert.equal(color(out({ lost: true }), 'output'), 'vermelho');
assert.equal(color(out({ p95: [24.9] }), 'output'), 'verde');
assert.equal(color(out({ p95: [25] }), 'output'), 'amarelo');
assert.equal(color(out({ p95: [39.9] }), 'output'), 'amarelo');
assert.equal(color(out({ p95: [40] }), 'output'), 'vermelho');
assert.equal(color(out({ p95: [] }), 'output'), 'vermelho');
assert.equal(color(out({ fullscreen: null }), 'output'), 'amarelo'); // não deu para conferir

// 4. MIDI
const md = (devices: string[], mapped = 5) => ({ midi: { devices, mapped } });
assert.equal(color(md([], 0), 'midi'), 'verde');
assert.equal(color(md([]), 'midi'), 'vermelho');
assert.equal(color(md(['nanoKONTROL2 (ocupado)']), 'midi'), 'vermelho');
assert.match(run(md(['nanoKONTROL2 (ocupado)'])).midi.msg, /nanoKONTROL2 \(ocupado\): feche/);
assert.equal(color(md(['nanoKONTROL2 (ocupado)', 'APC40']), 'midi'), 'amarelo');
assert.equal(color(md(['nanoKONTROL2 (ocupado)'], 0), 'midi'), 'amarelo');
// D-23: com a origem de cada controle, diz exatamente qual controlador e quantos controles
const mb = (devices: string[], mappedBy: Record<string, number>, extra = 0) =>
  ({ midi: { devices, mappedBy, mapped: Object.values(mappedBy).reduce((s, x) => s + x, 0) + extra } });
assert.equal(color(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { nanoKONTROL2: 3 }), 'midi'), 'vermelho', 'o ocupado é o mapeado (antes: amarelo, "se for o mapeado")');
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { nanoKONTROL2: 3 })).midi.msg, /^O controlador nanoKONTROL2 está ocupado e tem 3 controles mapeados: feche/);
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40 (ocupado)'], { nanoKONTROL2: 1, APC40: 2 })).midi.msg, /nanoKONTROL2 está ocupado e tem 1 controle mapeado; O controlador APC40 está ocupado e tem 2 controles mapeados/);
assert.equal(color(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 4 }), 'midi'), 'amarelo', 'ocupado, mas nada mapeado nele');
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 4 })).midi.msg, /nanoKONTROL2 ocupado, mas sem controles mapeados nele; os 4 controles mapeados estão em controladores livres/);
assert.equal(color(mb(['APC40'], { nanoKONTROL2: 1 }), 'midi'), 'vermelho');
assert.match(run(mb(['APC40'], { nanoKONTROL2: 1 })).midi.msg, /O controlador nanoKONTROL2 não está conectado e tem 1 controle mapeado: conecte o cabo USB/);
assert.equal(color(mb(['APC40'], { APC40: 2 }), 'midi'), 'verde');
assert.equal(run(mb(['APC40'], { APC40: 2 })).midi.msg, '1 controlador(es), 2 controles mapeados.');
// mapa misto (3 controles aprendidos antes da D-23, sem origem): volta para a regra aproximada
assert.equal(color(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 2 }, 3), 'midi'), 'amarelo');
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 2 }, 3)).midi.msg, /se for o mapeado/);

// 5. disco
assert.equal(color({ diskFree: 1.9e9 }, 'disk'), 'vermelho');
assert.equal(color({ diskFree: 3e9 }, 'disk'), 'verde');
assert.equal(color({ diskFree: 3e9, recording: true }, 'disk'), 'amarelo');
assert.equal(color({ diskFree: 5e9, recording: true }, 'disk'), 'verde');
assert.equal(color({ diskFree: null }, 'disk'), 'amarelo');

// 6–8
assert.equal(color({ safeFlash: false }, 'flash'), 'amarelo');
assert.equal(color({ fx: { safe: true, suspect: [] } }, 'fx'), 'amarelo');
assert.match(run({ fx: { safe: false, suspect: ['Túnel'] } }).fx.msg, /Túnel/);
assert.equal(color({ update: '0.4.0' }, 'version'), 'amarelo');
assert.match(run({ update: '0.4.0' }).version.msg, /0\.4\.0.*antes do show/);

// 9. rede: só informa; LAN aberta = amarelo
const net = (n: Partial<PreshowInput['net']>) => ({ net: { ...OK.net, ...n } });
assert.equal(color(net({ osc: true, spout: true }), 'net'), 'verde');
assert.match(run(net({ osc: true, spout: true })).net.msg, /OSC ligado · celular desligado · Spout ligado/);
assert.equal(color(net({ remote: true, remoteLan: true }), 'net'), 'amarelo');
assert.equal(color(net({ oscLan: true }), 'net'), 'verde'); // marcado mas desligado: não está aberto

assert.equal(worst(evaluate({ ...OK, safeFlash: false })), 'amarelo');
assert.equal(worst(evaluate({ ...OK, safeFlash: false, diskFree: 1e9 })), 'vermelho');
console.log('preshow ok');
