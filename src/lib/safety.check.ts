// npm run check — limite de flashes por segundo (DK-006).
import assert from 'node:assert/strict';
import { strobeEvery, strobeAllowed, strobeRate, MAX_FLASH_HZ, SAFE_LOOK } from './safety.ts';
import { lookOf, VISUAL } from './settings.ts';

assert.equal(strobeEvery(140, 1), 1);   // 2,33 Hz: passa inteiro
assert.equal(strobeEvery(180, 1), 1);   // 3,00 Hz: no limite, passa
assert.equal(strobeEvery(220, 1), 2);   // 3,67 Hz → 1 a cada 2 = 1,83 Hz
assert.equal(strobeEvery(148, 2), 2);   // 4,93 Hz → 2,47 Hz
assert.equal(strobeEvery(148, 4), 4);   // 9,87 Hz → 2,47 Hz
assert.equal(strobeEvery(220, 4), 5);   // 14,7 Hz → 2,93 Hz
assert.equal(strobeEvery(0, 4), 1);     // sem BPM: não divide por zero

// nunca passa do limiar, em toda a faixa de uso (80–220 BPM, 1/1 1/2 1/4)
for (let bpm = 80; bpm <= 220; bpm++) for (const div of [1, 2, 4]) assert.ok(strobeRate(bpm, div, true) <= MAX_FLASH_HZ + 1e-9, `${bpm} 1/${div}`);
assert.ok(strobeRate(220, 4, false) > 14); // sem o limite, é isso que o strobe faria

assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => strobeAllowed(n, 3)), [true, false, false, true, false, false]);
assert.equal(strobeAllowed(-3, 3), true); // beat negativo antes do 1º kick
assert.ok(Object.keys(SAFE_LOOK).every((k) => k in lookOf(VISUAL)), 'SAFE_LOOK só com chaves de cena');

console.log('safety: ok');
