"""Pulso da logo (sim.jsonl) por trecho: python scripts/calib/pulse.py <pasta> t0-t1 [t0-t1 ...]
Por trecho: pico mediano por beat, p90 e fração do tempo acima de 0,2."""
import json, sys, os
d = sys.argv[1]
S = [json.loads(l) for l in open(os.path.join(d, 'sim.jsonl'))]
for sp in sys.argv[2:]:
    a, b = map(float, sp.split('-'))
    v = [s[1] for s in S if a <= s[0] < b]
    w = sorted(v)
    peaks = sorted(max(v[i:i + 25]) for i in range(0, len(v) - 25, 25))  # ~1 beat a 145
    print(f"{sp:>10}: pico por beat mediano {peaks[len(peaks) // 2]:.2f} · p90 {w[int(len(w) * 0.9)]:.2f} · >0,2 {100 * sum(x > 0.2 for x in v) / len(v):.0f}%")
