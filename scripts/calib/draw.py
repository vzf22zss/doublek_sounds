"""Desenha um trecho da calibração: python scripts/calib/draw.py <pasta> <t0> <t1> [saida.png] [px/s]
Espectrograma + faixas: verdade (kick/baixo/chimbal), grade, kicks do detector, drop, levels e a logo (sim.jsonl, se houver)."""
import json, sys, os
from PIL import Image, ImageDraw

d, t0, t1 = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
out = sys.argv[4] if len(sys.argv) > 4 else os.path.join(d, f'trecho_{t0:.0f}_{t1:.0f}.png')
T = json.load(open(os.path.join(d, 'truth.json')))
F = [json.loads(l) for l in open(os.path.join(d, 'frames.jsonl')) if t0 - 1 <= float(l[l.index('"pos":') + 6:].split(',')[0]) <= t1 + 1]
S = [json.loads(l) for l in open(os.path.join(d, 'sim.jsonl'))] if os.path.exists(os.path.join(d, 'sim.jsonl')) else []
S = [s for s in S if t0 <= s[0] <= t1]
PX = float(sys.argv[5]) if len(sys.argv) > 5 else 200  # px por segundo
W, L = int((t1 - t0) * PX), 120
x = lambda t: int((t - t0) * PX) + L
lanes = ['grade', 'kick verdade', 'baixo', 'chimbal', 'kick detector', 'subida/limiar', 'drop (low)', 'lv sub', 'lv bass', 'lv mid', 'lv hats', 'logo']
SH, LH = 48 * 3, 26
im = Image.new('RGB', (W + L, SH + LH * len(lanes) + 4), (12, 12, 16))
g = ImageDraw.Draw(im)
dt = T['specDt']
for c in range(int(t0 / dt), min(len(T['spec']), int(t1 / dt))):
    for j, v in enumerate(T['spec'][c]):
        col = (int(v * 0.9), int(v * 0.5), int(min(255, v * 1.2)))
        g.rectangle([x(c * dt), SH - (j + 1) * 3, x((c + 1) * dt), SH - j * 3], fill=col)
for i, n in enumerate(lanes):
    y = SH + 4 + i * LH
    g.text((4, y + 7), n, fill=(170, 170, 180))
    g.line([L, y + LH - 1, W + L, y + LH - 1], fill=(35, 35, 45))
Y = lambda n: SH + 4 + lanes.index(n) * LH
# grade: beats do mapa (frames: troca de f.beat)
lb = None
for f in F:
    if f['beat'] != lb and t0 <= f['pos'] <= t1:
        bt = f['pos'] - f['beatPhase'] * 60 / f['bpm']
        g.line([x(bt), Y('grade'), x(bt), Y('grade') + LH - 4], fill=(200, 200, 200) if f['beat'] % 4 == 0 else (90, 90, 100))
        g.line([x(bt), 0, x(bt), SH], fill=(60, 60, 70))
    lb = f['beat']
for t, r, c in T['kicks']:
    if t0 <= t <= t1:
        h = int(min(1, r) * (LH - 4))
        g.rectangle([x(t) - 1, Y('kick verdade') + LH - 2 - h, x(t) + 1, Y('kick verdade') + LH - 2], fill=(255, 80, 140) if c > 0.25 else (110, 80, 100))
for t, r in T['bass']:
    if t0 <= t <= t1:
        h = int(min(1, r) * (LH - 4)); g.rectangle([x(t) - 1, Y('baixo') + LH - 2 - h, x(t), Y('baixo') + LH - 2], fill=(90, 170, 255))
for t, r in T['hats']:
    if t0 <= t <= t1:
        h = int(min(1, r) * (LH - 4)); g.rectangle([x(t), Y('chimbal') + LH - 2 - h, x(t), Y('chimbal') + LH - 2], fill=(240, 220, 90))
def curve(lane, pts, col):
    y0 = Y(lane) + LH - 2
    g.line([(x(t), y0 - v * (LH - 4)) for t, v in pts], fill=col, width=1)
for f in F:
    if f['kick'] > 0 and t0 <= f['pos'] <= t1:
        g.rectangle([x(f['pos']) - 1, Y('kick detector') + 3, x(f['pos']) + 1, Y('kick detector') + LH - 3], fill=(255, 80, 140))
mx = max([f['flux'] for f in F if t0 <= f['pos'] <= t1] + [1e-9])
curve('subida/limiar', [(f['pos'], f['flux'] / mx) for f in F], (255, 140, 60))
curve('subida/limiar', [(f['pos'], min(1, f['thr'] / mx)) for f in F], (200, 200, 200))
curve('drop (low)', [(f['pos'], f['low']) for f in F], (120, 255, 120))
for i, n in enumerate(['lv sub', 'lv bass', 'lv mid', 'lv hats']):
    curve(n, [(f['pos'], f['levels'][[0, 1, 2, 3][i]]) for f in F], (180, 140, 255))
if S:
    curve('logo', [(s[0], min(1, s[1])) for s in S], (255, 255, 255))
step = 1 if PX >= 50 else 10
for s in range(int(t0), int(t1) + 1, step):
    g.text((x(s) + 2, 2), f'{s}s', fill=(255, 255, 255))
im.save(out)
print(out)
