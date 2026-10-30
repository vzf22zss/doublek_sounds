// npm run check — crossfade de cenas e saneamento de presets.
import assert from 'node:assert/strict';
import { blend, lookOf, sanitizeLook, VISUAL, type Visual } from './settings.ts';
import { pickColors } from './assets.ts';

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

// "só no drop": entra nas cenas e é saneado como o mod
const dr = sanitizeLook({ drop: { fxRings: true, strobe: 'sim', bogus: true }, dropFade: 2 });
assert.equal(dr.drop!.fxRings, true);
assert.equal(dr.drop!.strobe, false);
assert.ok(!('bogus' in dr.drop!));
assert.equal(dr.dropFade, 2);
assert.equal(blend(from, { ...to, drop: { ...VISUAL.drop, trail: true } }, 1).drop.trail, true);
assert.deepEqual(sanitizeLook({ mod: 'x', drop: [1] }).drop, { ...VISUAL.drop }); // objeto inválido não passa

// cores da foto: muito azul escuro + um pouco de vermelho vivo → brilho vermelho, fundo azul escuro
const px = (rgb: number[], n: number) => Array.from({ length: n }, () => [...rgb, 255]).flat();
const c = pickColors([...px([10, 20, 60], 300), ...px([230, 20, 30], 60), ...px([128, 128, 128], 100)])!;
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const [r, g, b] = rgb(c.color);
assert.ok(r > 200 && g < 120 && b < 120, 'brilho deveria ser vermelho: ' + c.color);
const [r1, g1, b1] = rgb(c.bgc1);
assert.ok(b1 > r1 && b1 > g1 && b1 < 40, 'fundo deveria ser azul bem escuro: ' + c.bgc1);
// logo lima + roxo com contorno preto → brilho lima, segunda cor do fundo roxa
const l = pickColors([...px([215, 245, 20], 200), ...px([110, 40, 170], 150), ...px([5, 5, 5], 250)])!;
const [lr, lg, lb] = rgb(l.color), [pr, pg, pb] = rgb(l.bgc2);
assert.ok(lg > 200 && lr > 150 && lb < 120, 'brilho deveria ser lima: ' + l.color);
assert.ok(pb > pg && pr > pg, 'fundo deveria ser roxo: ' + l.bgc2);
assert.equal(pickColors(px([0, 0, 0], 10).map((v, i) => (i % 4 === 3 ? 0 : v))), null); // tudo transparente
assert.match(pickColors(px([200, 200, 200], 10))!.color, /^#([0-9a-f]{2})\1\1$/); // foto cinza → brilho cinza

console.log('settings: ok');
