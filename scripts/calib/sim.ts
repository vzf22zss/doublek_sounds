// Simula o renderer (music.ts) a 60 fps sobre os quadros do calib e grava <pasta>/sim.jsonl: [t, pulso da logo, kick, sil]
//   node scripts/calib/sim.ts <pasta> ['{"mod":{"amount":"sub"}}']   (Visual parcial; o padrão é o do app)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mod, music, musicFrame, musicState } from '../../src/render/music.ts';
import { VISUAL } from '../../src/lib/settings.ts';

const [dir, vjson = '{}'] = process.argv.slice(2);
const F = readFileSync(join(dir, 'frames.jsonl'), 'utf8').trim().split('\n').map((l) => ({ spectrum: [], ...JSON.parse(l) }));
const o = JSON.parse(vjson);
const v = { ...structuredClone(VISUAL), ...o, mod: { ...VISUAL.mod, ...o.mod } };
const st = musicState();
const out: string[] = [];
let fi = 0;
for (let now = 0; now < F.at(-1).pos * 1000; now += 1000 / 60) {
  while (fi < F.length && F[fi].pos * 1000 <= now) musicFrame(st, F[fi++], v, now);
  const u = music(st, v, now);
  out.push(JSON.stringify([+(now / 1000).toFixed(4), +mod(u, v, 'amount').toFixed(3), +u.kick.toFixed(3), +(u.sil ?? 0).toFixed(3)]));
}
writeFileSync(join(dir, 'sim.jsonl'), out.join('\n'));
console.log(join(dir, 'sim.jsonl'), out.length, 'quadros');
