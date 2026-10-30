// npm run check — crossfade de cenas e saneamento de presets.
import assert from 'node:assert/strict';
import { blend, lookOf, sanitizeLook, VISUAL, type Visual } from './settings.ts';

const from: Visual = { ...VISUAL, amount: 0, color: '#000000', bgGrad: false, strobeDiv: 1, blackout: true };
const to = { ...lookOf(VISUAL), amount: 1, color: '#ffffff', bgGrad: true, strobeDiv: 4, mod: { ...VISUAL.mod, glow: 'bass' as const } };

const mid = blend(from, to, 0.5);
assert.equal(mid.amount, 0.5);
assert.equal(mid.color, '#808080');
assert.equal(mid.bgGrad, true); // troca no meio
assert.equal(mid.strobeDiv, 4); // discreto: não interpola
assert.ok(!('blackout' in mid), 'crossfade não pode mexer no blackout');
assert.equal(blend(from, to, 0.2).bgGrad, false);
assert.equal(blend(from, to, 1).mod.glow, 'bass');

const s = sanitizeLook({ amount: 0.7, glow: 'x', size: Infinity, blackout: true, evil: 1, mod: { glow: 'kick', fxFlash: 'nope', bogus: 'kick' } });
assert.deepEqual(Object.keys(s).sort(), ['amount', 'mod']);
assert.equal(s.mod!.glow, 'kick');
assert.equal(s.mod!.fxFlash, VISUAL.mod.fxFlash);
assert.ok(!('bogus' in s.mod!));
assert.deepEqual(sanitizeLook(null), {});

console.log('settings: ok');
