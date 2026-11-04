// npm run check — gravação no telão (record.ts): começo, "Parar" e o que vai para o disco, com Tauri e MediaRecorder falsos.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// @tauri-apps/api → falsos em globalThis.__fake; imports sem extensão do Vite ('../lib/recorder') → .ts
const fake = (src: string) => 'data:text/javascript,' + encodeURIComponent(src);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@tauri-apps/api/core') return { url: fake('export const invoke = (...a) => globalThis.__fake.invoke(...a);'), shortCircuit: true };
    if (spec === '@tauri-apps/api/event')
      return { url: fake('export const listen = (...a) => globalThis.__fake.listen(...a); export const emitTo = (...a) => globalThis.__fake.emitTo(...a);'), shortCircuit: true };
    if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(spec + '.ts', ctx);
    return next(spec, ctx);
  },
});

type Ev = { payload?: unknown };
let on = new Map<string, (e: Ev) => unknown>(), calls: string[] = [], emitted: [string, unknown][] = [], startDelay = 0;
(globalThis as any).__fake = {
  listen: async (n: string, f: (e: Ev) => unknown) => { on.set(n, f); return () => {}; },
  emitTo: async (_w: string, n: string, p?: unknown) => { emitted.push([n, p]); },
  invoke: async (cmd: string) => {
    calls.push(cmd);
    if (cmd === 'rec_start') await new Promise((r) => setTimeout(r, startDelay));
    if (cmd === 'rec_chunk') return { total: 10 * calls.filter((c) => c === 'rec_chunk').length, stop: null };
    if (cmd === 'rec_stop') return { path: 'C:/rec/x.mp4', bytes: 20 };
  },
};
// MediaRecorder do Chromium: stop() entrega o último pedaço (o que gravou desde o começo) e depois o onstop
let mr: any;
(globalThis as any).MediaRecorder = class {
  state = 'inactive'; ondataavailable: any; onstop: any; onerror: any; stream = { getTracks: () => [] };
  constructor() { mr = this; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable?.({ data: new Blob(['ultimo']) }); this.onstop?.(); }); }
};
(globalThis as any).addEventListener = () => {};
const { initRecording } = await import('./record.ts');
const settle = () => new Promise((r) => setTimeout(r, 30));
const canvas = { captureStream: () => ({ getTracks: () => [] }) } as unknown as HTMLCanvasElement;
const fresh = async () => {
  on = new Map(); calls = []; emitted = []; startDelay = 0;
  initRecording(canvas, () => {});
  await settle();
};
const START = { payload: { id: '20261103T000000.mp4', mime: 'video/mp4;codecs=avc1.640028', fps: 30, bitrate: 1 } };
const done = () => emitted.find(([n]) => n === 'rec-done')?.[1] as { path: string } | undefined;
const finish = async () => { for (let i = 0; i < 30 && !done(); i++) await settle(); };

// gravação normal: pedaços em ordem, Parar fecha o arquivo com o último pedaço
await fresh();
on.get('rec-start')!(START); await settle();
mr.ondataavailable({ data: new Blob(['1o segundo']) }); await settle();
on.get('rec-stop')!({}); await finish();
assert.deepEqual(calls, ['rec_start', 'rec_chunk', 'rec_chunk', 'rec_stop']);
assert.equal(done()?.path, 'C:/rec/x.mp4');

// Parar enquanto o telão ainda começa (revisão 0.3.10): nada vai para o disco, o arquivo é apagado
await fresh();
startDelay = 50;
on.get('rec-start')!(START); on.get('rec-stop')!({}); await finish();
assert.deepEqual(calls, ['rec_start', 'rec_abort'], 'parar no começo: ' + calls);
assert.equal(done()?.path, '');

// D-29: o gravador já começou (rec-started) mas Parar chega antes do 1º pedaço (~1 s): é cancelar também, e não
// salvar os poucos quadros do stop() — senão "Gravar → Parar em 100 ms" deixava arquivo conforme quem ganhava a corrida
await fresh();
on.get('rec-start')!(START); await settle();
assert.ok(emitted.some(([n]) => n === 'rec-started'), 'gravador começou');
on.get('rec-stop')!({}); await finish();
assert.deepEqual(calls, ['rec_start', 'rec_abort'], 'parar antes do 1º pedaço: ' + calls);
assert.equal(done()?.path, '', 'controle: "cancelada antes do primeiro pedaço"');
console.log('record: ok');
