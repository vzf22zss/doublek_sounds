// npm run check — percentis, resumo por segundo e diário sem eco (DK-003).
import assert from 'node:assert/strict';
import { FrameStats, percentile, log, logEntries, clearLog } from './telemetry.ts';

assert.equal(percentile([], 0.5), 0);
assert.equal(percentile([7], 0.99), 7);
assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
assert.equal(percentile([1, 2, 3, 4, 5], 0), 1);
assert.equal(percentile([1, 2, 3, 4, 5], 1), 5);

// 60 quadros de 16,7 ms em 1 s, com dois engasgos
const fs = new FrameStats();
for (let i = 0; i < 58; i++) fs.push(16.7);
fs.push(40); fs.push(90);
fs.push(8000); // aba escondida: ignorado
const t = fs.flush(1000);
assert.equal(t.fps, 60);
assert.equal(t.p50, 16.7);
assert.equal(t.p99, 90);
assert.equal(t.drops, 2);
assert.equal(t.lost, false);
assert.deepEqual(fs.flush(1000), { fps: 0, p50: 0, p95: 0, p99: 0, drops: 0, lost: false }); // zerou
assert.equal(fs.flush(0, true).lost, true);

clearLog();
log('info', 'a'); log('info', 'a'); log('warn', 'a'); log('error', 'b');
assert.deepEqual(logEntries().map((e) => e.level + ':' + e.msg), ['info:a', 'warn:a', 'error:b']);
for (let i = 0; i < 300; i++) log('info', 'x' + i);
assert.equal(logEntries().length, 200);
assert.equal(logEntries()[0].msg, 'x100');

console.log('telemetry: ok');
