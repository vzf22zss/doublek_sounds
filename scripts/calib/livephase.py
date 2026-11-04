"""Fase da grade ao vivo (live.jsonl) no instante de cada kick real (beats do mapa), por trecho de 30 s:
python scripts/calib/livephase.py <pasta>. Grade certa = tudo na 1ª coluna (0) ou na última (logo antes)."""
import json, sys, os, bisect, collections
d = sys.argv[1]
F = [json.loads(l) for l in open(os.path.join(d, 'frames.jsonl'))]
Lv = [json.loads(l) for l in open(os.path.join(d, 'live.jsonl'))]
beats, lb = [], None
for f in F:
    if f['beat'] != lb:
        beats.append(f['pos'] - f['beatPhase'] * 60 / f['bpm']); lb = f['beat']
P = [f['pos'] for f in Lv]
for a in range(0, int(P[-1]), 30):
    ph, bpm = [], []
    for b in beats:
        if a <= b < a + 30:
            i = bisect.bisect_left(P, b)
            if i < len(Lv) and Lv[i]['locked']:
                ph.append(Lv[i]['beatPhase']); bpm.append(Lv[i]['bpm'])
    h = collections.Counter(int(p * 8) for p in ph)
    W = [f for f in Lv if a <= f['pos'] < a + 30]
    lk = sum(f['locked'] for f in W) / max(1, len(W))
    print(f"{a:3d}s travado {lk:4.0%} bpm {(sorted(bpm)[len(bpm) // 2] if bpm else 0):6.1f} fase (oitavos):", [h[k] for k in range(8)])
