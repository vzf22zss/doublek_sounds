"""Acerto do detector de kick contra a grade nos trechos 4/4: python scripts/calib/kicks.py <pasta> [t0-t1,...] [live]
`live`: os kicks vêm de live.jsonl (sem mapa, como ao vivo); a grade (verdade) continua a do mapa.
Verdade: kick em todo beat da grade nos trechos dados (conferir com draw.py antes de usar outra faixa)."""
import json, sys, os
d = sys.argv[1]
spans = [tuple(map(float, s.split('-'))) for s in (sys.argv[2] if len(sys.argv) > 2 else '60-180,270-370').split(',')]
F = [json.loads(l) for l in open(os.path.join(d, 'frames.jsonl'))]
beats, lb = [], None
for f in F:
    if f['beat'] != lb:
        beats.append(f['pos'] - f['beatPhase'] * 60 / f['bpm']); lb = f['beat']
src = F if 'live' not in sys.argv[3:] else [json.loads(l) for l in open(os.path.join(d, 'live.jsonl'))]
ks = [f['pos'] for f in src if f['kick'] > 0]
inside = lambda t: any(a <= t < b for a, b in spans)
B = [b for b in beats if inside(b)]
import bisect
def near(t, xs, lo, hi):
    i = bisect.bisect_left(xs, t + lo); return i < len(xs) and xs[i] <= t + hi
hit = sum(near(b, ks, -0.06, 0.06) for b in B)
K = [k for k in ks if inside(k)]
false = sum(not near(k, beats, -0.06, 0.06) for k in K)
lat = sorted(min((k - b for k in ks[bisect.bisect_left(ks, b - 0.06):bisect.bisect_left(ks, b + 0.06)]), default=None) or 0 for b in B if near(b, ks, -0.06, 0.06))
print(f"recall {hit}/{len(B)} = {hit / len(B):.3f} · falsos {false}/{len(K)} · atraso mediano {1000 * lat[len(lat) // 2]:.0f} ms · kicks no total {len(ks)}")
