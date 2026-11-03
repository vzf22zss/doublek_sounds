// npm run check — "Testar tudo" (DK-145): entradas simuladas → cores e mensagens.
import assert from 'node:assert/strict';
import { evaluate, onChosenMonitor, worst, type Mon, type PreshowInput } from './preshow.ts';
import { mappedByDevice, normDevice } from './midimap.ts';

const OK: PreshowInput = {
  peak: Array(100).fill(0.2), gate: 0.003, lockedAtS: 3.2,
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
assert.equal(color({ peak: [...Array(50).fill(0.2), ...Array(50).fill(0)] }, 'audio'), 'verde');
assert.equal(color({ peak: [...Array(49).fill(0.2), ...Array(51).fill(0)] }, 'audio'), 'vermelho');
assert.equal(color({ peak: [] }, 'audio'), 'vermelho');
assert.match(run({ peak: Array(100).fill(0.002) }).audio.msg, /ganho.*cabo/);

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

// 3b. monitor do telão com DPI misto: notebook 1920×1080 a 100% + projetor 4K a 150% à direita (coordenadas físicas)
{
  const mons: Mon[] = [{ name: 'Notebook', x: 0, y: 0, w: 1920, h: 1080 }, { name: 'EPSON 4K', x: 1920, y: 0, w: 3840, h: 2160 }];
  // tela cheia no 4K a 150%: o Windows devolve o canto 7 px fora e o tamanho com as bordas invisíveis
  const fs150 = { x: 1913, y: -7, w: 3854, h: 2174 };
  assert.equal(onChosenMonitor(fs150, mons, 1), true, 'canto fora por bordas não é monitor errado');
  assert.equal(fs150.x === mons[1].x, false, 'a regra antiga (canto = canto) dava falso "monitor errado" aqui');
  assert.equal(onChosenMonitor(fs150, mons, 0), false, 'escolheu o notebook, telão está no 4K');
  assert.equal(onChosenMonitor({ x: 0, y: 0, w: 1920, h: 1080 }, mons, 0), true);
  assert.equal(onChosenMonitor({ x: 0, y: 0, w: 1920, h: 1080 }, mons, 1), false);
  // monitor à esquerda do principal (x negativo) a 150%
  const left: Mon[] = [{ name: 'Notebook', x: 0, y: 0, w: 1920, h: 1080 }, { name: 'Projetor', x: -2880, y: -200, w: 2880, h: 1620 }];
  assert.equal(onChosenMonitor({ x: -2887, y: -207, w: 2894, h: 1634 }, left, 1), true);
  // mesmo nome em dois monitores iguais: a posição desempata (± 2 px)
  const twins: Mon[] = [{ name: 'Generic PnP', x: 0, y: 0, w: 1920, h: 1080 }, { name: 'Generic PnP', x: 1920, y: 0, w: 1920, h: 1080 }];
  assert.equal(onChosenMonitor({ x: 1920, y: 0, w: 1920, h: 1080 }, twins, 0), false);
  assert.equal(onChosenMonitor({ x: 1920, y: 0, w: 1920, h: 1080 }, twins, 1), true);
  // janela fora de qualquer monitor ou monitor escolhido sumiu
  assert.equal(onChosenMonitor({ x: 9000, y: 9000, w: 100, h: 100 }, mons, 1), false);
  assert.equal(onChosenMonitor(fs150, mons, 5), null);
}

// 4. MIDI
const md = (devices: string[], mapped = 5) => ({ midi: { devices, mapped } });
assert.equal(color(md([], 0), 'midi'), 'verde');
assert.equal(color(md([]), 'midi'), 'vermelho');
assert.equal(color(md(['nanoKONTROL2 (ocupado)']), 'midi'), 'vermelho');
assert.equal(run(md(['nanoKONTROL2 (ocupado)'])).midi.msg, 'O controlador nanoKONTROL2 está ocupado e há 5 controles mapeados: feche o outro programa que usa o controlador.');
assert.equal(run(md([])).midi.msg, '5 controles mapeados e nenhum controlador conectado: conecte o cabo USB.');
assert.equal(color(md(['nanoKONTROL2 (ocupado)', 'APC40']), 'midi'), 'amarelo');
assert.equal(color(md(['nanoKONTROL2 (ocupado)'], 0), 'midi'), 'amarelo');
assert.equal(run(md(['nanoKONTROL2 (ocupado)'], 0)).midi.msg, 'O controlador nanoKONTROL2 está ocupado, sem controles mapeados: se for usá-lo, feche o outro programa que usa o controlador.');
assert.equal(run(md(['nanoKONTROL2', 'APC40'], 0)).midi.msg, '2 controladores, nada mapeado.');
assert.equal(run(md(['nanoKONTROL2'], 1)).midi.msg, '1 controlador, 1 controle mapeado.');
// D-23: com a origem de cada controle, diz exatamente qual controlador e quantos controles
const mb = (devices: string[], mappedBy: Record<string, number>, extra = 0) =>
  ({ midi: { devices, mappedBy, mapped: Object.values(mappedBy).reduce((s, x) => s + x, 0) + extra } });
assert.equal(color(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { nanoKONTROL2: 3 }), 'midi'), 'vermelho', 'o ocupado é o mapeado (antes: amarelo, "se for o mapeado")');
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { nanoKONTROL2: 3 })).midi.msg, /^O controlador nanoKONTROL2 está ocupado e tem 3 controles mapeados: feche/);
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40 (ocupado)'], { nanoKONTROL2: 1, APC40: 2 })).midi.msg, /nanoKONTROL2 está ocupado e tem 1 controle mapeado; O controlador APC40 está ocupado e tem 2 controles mapeados/);
assert.equal(color(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 4 }), 'midi'), 'amarelo', 'ocupado, mas nada mapeado nele');
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 4 })).midi.msg, /^O controlador nanoKONTROL2 está ocupado, mas sem controles mapeados nele; os 4 controles mapeados estão em controladores livres\.$/);
assert.equal(color(mb(['APC40'], { nanoKONTROL2: 1 }), 'midi'), 'vermelho');
assert.match(run(mb(['APC40'], { nanoKONTROL2: 1 })).midi.msg, /O controlador nanoKONTROL2 não está conectado e tem 1 controle mapeado: conecte o cabo USB/);
assert.equal(color(mb(['APC40'], { APC40: 2 }), 'midi'), 'verde');
assert.equal(run(mb(['APC40'], { APC40: 2 })).midi.msg, '1 controlador, 2 controles mapeados.');
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 1 })).midi.msg, /; o controle mapeado está em controladores livres\.$/, 'singular');
// mapa misto (3 controles aprendidos antes da D-23, sem origem): volta para a regra aproximada
assert.equal(color(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 2 }, 3), 'midi'), 'amarelo');
assert.match(run(mb(['nanoKONTROL2 (ocupado)', 'APC40'], { APC40: 2 }, 3)).midi.msg, /^O controlador nanoKONTROL2 está ocupado: se for o dos controles mapeados, feche o outro programa que usa o controlador\.$/);
// todas as frases do item no mesmo molde: nada de "(ocupado)" cru nem "controlador(es)"
for (const m of [md(['nanoKONTROL2 (ocupado)']), md(['a (ocupado)', 'b']), md(['a (ocupado)'], 0), md(['a', 'b']), mb(['a (ocupado)', 'b'], { b: 2 }), mb(['a (ocupado)', 'b'], { a: 2 })])
  assert.ok(!/\(ocupado\)|\(es\)/.test(run(m).midi.msg), run(m).midi.msg);
// revisão 0.3.10: nome da porta normalizado dos dois lados (WinMM numera portas repetidas: "2- nanoKONTROL2")
assert.equal(normDevice('2- nanoKONTROL2'), 'nanoKONTROL2');
assert.equal(normDevice('10-  nano  KONTROL2  (ocupado)'), 'nano KONTROL2');
assert.equal(normDevice('MIDI 2- X'), 'MIDI 2- X', 'só o prefixo do começo');
assert.deepEqual(mappedByDevice({ 'cc:0:1': { id: 'a', label: 'A', device: '2- nanoKONTROL2' }, 'cc:0:2': { id: 'b', label: 'B', device: 'nanoKONTROL2' } }), { nanoKONTROL2: 2 }, 'mapa antigo com o nome cru');
assert.equal(run(mb(['2- nanoKONTROL2'], { nanoKONTROL2: 3 })).midi.msg, '1 controlador, 3 controles mapeados.', 'porta numerada × nome guardado');
assert.equal(color(mb(['nanoKONTROL2'], { '2- nanoKONTROL2': 3 }), 'midi'), 'verde', 'nome guardado cru × porta sem número');
assert.match(run(mb(['2- nanoKONTROL2 (ocupado)', 'APC40'], { nanoKONTROL2: 3 })).midi.msg, /^O controlador nanoKONTROL2 está ocupado e tem 3 controles mapeados/);
// controlador mapeado que não está aqui: amarelo se outro conectado tem controles mapeados; vermelho se nenhum tem
assert.equal(color(mb(['APC40'], { APC40: 4, 'nanoKONTROL2 do Zé': 2 }), 'midi'), 'amarelo');
assert.equal(run(mb(['APC40'], { APC40: 4, 'nanoKONTROL2 do Zé': 2 })).midi.msg, 'Mapeado num controlador que não está aqui: nanoKONTROL2 do Zé (2 controles mapeados). Os outros controles estão em controladores conectados.');
assert.equal(color(mb(['APC40'], { 'nanoKONTROL2 do Zé': 2 }), 'midi'), 'vermelho', 'nenhum conectado com controles mapeados');
assert.equal(color(mb([], { APC40: 4 }), 'midi'), 'vermelho', 'nada conectado');
assert.equal(color(mb(['APC40'], { 'nanoKONTROL2 do Zé': 2 }, 3), 'midi'), 'amarelo', 'controles sem origem podem estar no APC40');

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
// desligado depois de falhas também pinta amarelo (D-23)
assert.equal(color({ fx: { safe: false, suspect: [], disabled: [{ name: 'Vórtex', fails: 3 }] } }, 'fx'), 'amarelo');
assert.equal(run({ fx: { safe: false, suspect: [], disabled: [{ name: 'Vórtex', fails: 3 }] } }).fx.msg, 'Efeito Vórtex desligado depois de 3 falhas: reative no editor ou remova.');
assert.equal(run({ fx: { safe: false, suspect: ['Túnel'], disabled: [{ name: 'Vórtex', fails: 1 }] } }).fx.msg, 'Suspeito: Túnel. Teste no editor ou remova. Efeito Vórtex desligado depois de 1 falha: reative no editor ou remova.');
assert.equal(run({}).fx.msg, 'Nenhum efeito suspeito ou desligado.');
assert.equal(color({ fx: { safe: true, suspect: [], disabled: [{ name: 'Vórtex', fails: 3 }] } }, 'fx'), 'amarelo', 'modo seguro manda na frase');
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

// calibração do corte de ruído: ruído baixo vira corte; som tocando é recusado (o corte ia a 0,2 e zerava os níveis)
{
  const { noiseGate, GATE_HIGH } = await import('./preshow.ts');
  assert.deepEqual(noiseGate(0.002), { gate: 0.0026 });
  const r = noiseGate(0.18);
  assert.ok('error' in r && /Tinha som/.test(r.error), JSON.stringify(r));
  assert.ok('gate' in noiseGate(GATE_HIGH / 1.3 - 1e-4) && 'error' in noiseGate(GATE_HIGH / 1.3 + 1e-3));
}
