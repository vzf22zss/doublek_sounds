// Lógica musical do renderer, em TS puro (sem WebGL, sem DOM): envelopes, fase do beat, matriz de modulação,
// "só no drop", strobe com limite de flashes e blackout. Fórmulas e constantes copiadas do renderer da v0.3.1.
// O estado é mutado no lugar e devolvido junto (evita alocar 60 vezes por segundo).
import type { Frame } from '../lib/types.ts';
import type { DropTarget, ModTarget, Source, Visual } from '../lib/settings.ts';
import { SAFE_STROBE_MAX, strobeAllowed, strobeEvery } from '../lib/safety.ts';

export type Ring = { t: number; s: number };

export type MusicState = {
  frame: Frame | null;
  rxAt: number; lastT: number; lastKickRx: number; strength: number; // lastKickRx: último kick com grave (ver KICK_REAL)
  kickEnv: number; waveEnv: number; presence: number; black: number; dropEnv: number;
  prevPh: number; lastTrig: number; absBeat: number;
  paused: boolean; // sem kick há PAUSE_BEATS (fora do modo 'beat'): nada de disparo previsto
  sil: number;     // 0–1: silêncio (pausa + nível abaixo de pauseThr), já suavizado
  kickLvl: number; // volume do último kick: pico do sub (`levels`) logo depois do disparo
  kickPk: number;  // pico do sub desde o último disparo
  detAt: number;   // último kick detectado (com ou sem grave)
  hits: number[];  // índices dos beats em que veio kick (os últimos 32)
  rings: Ring[];
  spec: Float32Array;
};

export type MusicUniforms = {
  now: number;           // ms (relógio do quadro)
  kick: number;          // presence × kickEnv
  wave: number;          // envelope da onda (sem kick)
  presence: number;      // 1 = há kick/andamento previsto, 0 = só onda
  p: number;             // pulso final da logo (o que `render()` devolve)
  drop: number;          // dropEnv: 1 = grave tocando, 0 = breakdown
  beatPhase: number;     // fase do beat 0–1, já com o offset
  bar: number;           // fase do compasso 0–1
  absBeat: number;
  bands: readonly number[]; // sub, bass, mid, click, air (zeros sem som ou em "só roteiro")
  spec: Float32Array;    // 64 bandas suavizadas
  S: Record<Source, number>; // valor de cada fonte de modulação
  fx: number;            // 0 = só a logo (L)
  live: boolean;         // false = "só roteiro"
  stale: boolean;        // sem frame há mais de 3 s
  strobe: number;        // intensidade final do strobe, já com o limite de flashes
  black: number;         // blackout 0–1
  rings: Ring[];         // anéis vivos (< 900 ms)
  sil?: number;          // 0–1: silêncio (pausa + nível baixo), suavizado
};

export const musicState = (): MusicState => ({
  frame: null, rxAt: 0, lastT: 0, lastKickRx: -1e9, strength: 0.8,
  kickEnv: 0, waveEnv: 0, presence: 0, black: 0, dropEnv: 1,
  prevPh: 0, lastTrig: -1e9, absBeat: 0, paused: false, sil: 0, kickLvl: 0.8, kickPk: 0, detAt: -1e9, hits: [], rings: [], spec: new Float32Array(64),
});

/** Pausa (Onda 10): nenhum kick há este tanto de beats. 2,5 e não 1,6 para um kick que faltou (2 beats) não cortar o pulso. */
export const PAUSE_BEATS = 2.5;

/** Com o andamento travado, o pulso sai da fase prevista (adiantada pelo offset), não do kick detectado. Na pausa, não:
 *  a grade fixa da música tocada pelo app nunca solta (`holding`) e o pulso seguia o silêncio inteiro. */
export function predicting(st: MusicState, v: Visual) {
  const f = st.frame;
  return !!f && v.predict && f.locked && !f.holding && f.bpm > 0 && !st.paused;
}

/** Janela depois do disparo em que o pulso sobe até o volume do kick que chegou (o previsto sai antes do kick). */
export const KICK_MS = 120;
/** Kick "de verdade" para a pausa e o `presence`: o sub chega a isto (÷ pico do último minuto) na janela. Os "kicks" que
 *  o detector aceita no ruído de um breakdown ficam em ~0,02 (chapati.mp3); os do drop, 0,45–0,8. */
export const KICK_REAL = 0.1;

function trigger(st: MusicState, now: number, s: number) {
  st.kickPk = 0;
  st.kickEnv = Math.max(st.kickEnv, s);
  st.lastTrig = now;
  st.rings.push({ t: now, s });
  if (st.rings.length > 16) st.rings.shift();
}

/** Chegou um frame do motor de áudio. */
export function musicFrame(st: MusicState, f: Frame, v: Visual, now: number) {
  st.frame = f;
  st.rxAt = now;
  if (f.kick > 0) {
    const back = st.paused; // o kick voltou: dispara na hora, sem esperar o próximo beat previsto
    st.paused = false;
    st.detAt = now;
    if (!f.levels) st.lastKickRx = now; // frame antigo: todo kick vale; com `levels`, só o que traz grave (em music())
    st.strength = f.levels ? st.kickLvl : f.kick; // frame sem `levels`: a força da detecção, como antes
    if (f.bpm > 0) {
      const i = f.beat + Math.round(f.beatPhase);
      if (st.hits.at(-1) !== i) st.hits.push(i);
      if (st.hits.length > 32) st.hits.shift();
    }
    // previsto: só dispara aqui o kick que não ganhou pulso no beat (contratempo, tercina, tempo fora do padrão)
    const alone = now - st.lastTrig > (f.bpm ? 60000 / f.bpm : 420) * GAP;
    if ((back || !predicting(st, v) || alone) && v.react !== false) trigger(st, now, st.strength);
  }
}

/** Fração do beat sem pulso a partir da qual um kick detectado dispara mesmo com o andamento previsto. */
const GAP = 0.35;

/** O beat previsto `n` pulsa se veio kick nesse tempo em algum dos 4 compassos anteriores: kick a cada 2 tempos não
 *  vira pulso em todo tempo, e o detector (que pega ~60–75 % dos kicks numa faixa de psy) não abre buracos.
 *  'seguir o beat' pulsa sempre (o comportamento de antes). */
export const expected = (st: MusicState, v: Visual, n: number) => v.pause === 'beat' || [4, 8, 12, 16].some((k) => st.hits.includes(n - k));

/** Fonte de modulação do alvo `k` (sem sinal: o pulso que respira). Com régua [mín, máx]: 0 abaixo do mínimo,
 *  sobe proporcional e chega a 1 no máximo (acima, fica em 1). */
export function mod(u: MusicUniforms, v: Visual, k: ModTarget) {
  if (u.stale) return u.p;
  const x = u.S[v.mod[k]] ?? u.p, r = v.range?.[k];
  const y = r ? Math.min(1, Math.max(0, (x - r[0]) / (r[1] - r[0]))) : x;
  return y + (x - y) * (u.sil ?? 0); // no silêncio a régua não vale (como sem sinal): respirar não vira parar nem pulso cheio
}

/** "Só no drop": multiplica pelo envelope do grave se o efeito estiver marcado. */
export const gate = (u: MusicUniforms, v: Visual, k: DropTarget) => (v.drop?.[k] ? u.drop : 1);

// ---------- rajadas do glitch (DK-023) ----------
// Teto coerente com o limite de flashes: no máximo BURST_HZ rajadas por segundo, cada uma de BURST_MS.
// Sem safeFlash, o operador pode liberar até o dobro da taxa (a duração não muda).
export const BURST_HZ = 3, BURST_MS = 120;
export type Burst = { start: number; prev: number; n: number };
export const burstState = (): Burst => ({ start: -1e9, prev: 0, n: 0 });

/** Dispara quando a fonte cruza 0,5 subindo e já passou o intervalo mínimo. Devolve 1 → 0 durante a rajada. */
export function burst(b: Burst, now: number, src: number, safe: boolean) {
  const rise = src >= 0.5 && b.prev < 0.5;
  b.prev = src;
  if (rise && now - b.start >= 1000 / (BURST_HZ * (safe ? 1 : 2))) { b.start = now; b.n++; }
  const t = now - b.start;
  return t >= 0 && t < BURST_MS ? 1 - t / BURST_MS : 0;
}

/** Um quadro: avança envelopes e fase e devolve os valores que os efeitos usam. */
export function music(st: MusicState, v: Visual, now: number): MusicUniforms {
  const dt = Math.min(0.1, (now - st.lastT) / 1000);
  st.lastT = now;
  const f = st.frame;
  const stale = !f || now - st.rxAt > 3000;
  const period = f?.bpm ? 60000 / f.bpm : 420;
  // com o grave tocando (`low`) não é pausa: é o detector que perdeu kicks (~1 em 4 numa faixa de psy). A memória do
  // padrão (`expected`) para o pulso sozinha se o kick sumir mesmo
  st.paused = v.pause !== 'beat' && now - st.lastKickRx > period * PAUSE_BEATS && !(f && !stale && (f.low ?? 0) > 0.5);

  const live = v.react !== false; // "só roteiro": ignora o som (o relógio do beat continua)
  // fase do beat extrapolada, já com o offset visual (negativo = adiantado)
  let ph = 0, bar = (now / 2000) % 1;
  if (f?.bpm) {
    const x = f.beatPhase + ((now - st.rxAt - v.offset) / 1000) * (f.bpm / 60);
    ph = x - Math.floor(x);
    st.absBeat = f.beat + Math.floor(x);
    bar = ((((st.absBeat % 4) + 4) % 4) + ph) / 4;
    if (live && predicting(st, v) && ph < st.prevPh - 0.5 && now - st.lastTrig > period * GAP && expected(st, v, st.absBeat)) trigger(st, now, st.strength);
  }
  st.prevPh = ph;

  // envelopes (independem da taxa de quadros)
  st.kickEnv *= Math.exp(-dt / Math.max(0.01, v.rel));
  const b = !stale && f && live ? f.bands : [0, 0, 0, 0, 0];
  // fontes e onda na régua de ~1 min (`levels`): na de 4 s (`bands`) o chiado de uma pausa vira ~100 %. Frame antigo: bands
  const lv = !stale && f && live ? f.levels ?? b : b;
  // o pulso do kick tem a altura do volume dele (sub ÷ pico do último minuto): kick fraco, pulso pequeno. A régua
  // do Kick passa a falar de volume, não da certeza da detecção. Sem piso: um "kick" sem grave (ruído do pad num
  // breakdown, que o detector às vezes aceita) não vira pulso
  if (f?.levels && live && !stale && now - st.lastTrig < KICK_MS) {
    st.kickPk = Math.max(st.kickPk, lv[0]);
    st.kickEnv = Math.max(st.kickEnv, lv[0]);
    st.kickLvl = st.strength = st.kickPk;
    if (lv[0] >= KICK_REAL && now - st.detAt < KICK_MS) st.lastKickRx = now; // kick detectado e com grave
  }
  const w = Math.max(lv[0], lv[1]) * 0.6 + lv[2] * 0.4;
  st.waveEnv += (w - st.waveEnv) * (1 - Math.exp(-dt / (w > st.waveEnv ? 0.012 : Math.max(0.02, v.rel * 0.8))));
  const target = predicting(st, v) || now - st.lastKickRx < period * 1.6 ? 1 : 0;
  st.presence += (target - st.presence) * (1 - Math.exp(-dt / (target > st.presence ? 0.04 : 0.3)));
  const kick = st.presence * st.kickEnv;
  let p = live ? kick + (1 - st.presence) * st.waveEnv * v.wave : 0;
  const breathe = 0.12 * (0.5 + 0.5 * Math.sin(now / 1000 * 1.6)); // devagar e baixo
  // silêncio = pausa + nível abaixo de pauseThr. Breakdown com pad não é silêncio: segue a onda pelos levels
  const quiet = live && st.paused && Math.max(...lv) < v.pauseThr;
  st.sil += ((quiet ? 1 : 0) - st.sil) * (1 - Math.exp(-dt / (quiet ? 0.3 : 0.04)));
  p += ((v.pause === 'breathe' ? breathe : 0) - p) * st.sil;
  if (stale) p = breathe; // sem sinal

  // matriz de modulação: cada efeito escolhe a fonte do movimento
  const S: Record<Source, number> = {
    auto: p, kick, sub: lv[0], bass: lv[1], mid: lv[2], hats: lv[3],
    beat: f?.bpm ? (1 - ph) ** 2 * (1 - st.sil) : 0, bar: f?.bpm ? (1 - bar) * (1 - st.sil) : 0,
    lfo: 0.5 + 0.5 * Math.sin(2 * Math.PI * bar),
  };
  const fx = v.logoOnly ? 0 : 1; // L = só a logo, sem efeitos
  // "só no drop": some no breakdown sem grave e entra quando o grave volta, em dropFade beats
  const lowT = !live ? 1 : f && !stale ? f.low ?? 1 : 0;
  st.dropEnv += (lowT - st.dropEnv) * (1 - Math.exp(-dt / Math.max(0.02, (v.dropFade * period) / 3000)));
  st.black += ((v.blackout ? 1 : 0) - st.black) * (1 - Math.exp(-dt / 0.08));
  if (f && !stale) for (let i = 0; i < 64; i++) {
    const s = live ? f.spectrum[i] ?? 0 : 0;
    st.spec[i] += (s - st.spec[i]) * (s > st.spec[i] ? 0.6 : 0.15);
  }
  st.rings = st.rings.filter((r) => now - r.t < 900);

  const u: MusicUniforms = {
    now, kick, wave: st.waveEnv, presence: st.presence, p, drop: st.dropEnv, beatPhase: ph, bar, absBeat: st.absBeat,
    bands: b, spec: st.spec, S, fx, live, stale, strobe: 0, black: st.black, rings: st.rings, sil: st.sil,
  };

  if (v.strobe > 0 && fx) {
    const sub = (ph * v.strobeDiv) % 1;
    // safeFlash: acende 1 em cada `every` pulsos para não passar de 3 flashes/s (ex.: 1/4 a 148 BPM = 9,9 Hz → 2,5 Hz)
    const every = v.safeFlash ? strobeEvery(f?.bpm ?? 0, v.strobeDiv) : 1;
    const allowed = strobeAllowed(Math.floor((st.absBeat + ph) * v.strobeDiv), every);
    // na pausa com som (build-up sem kick), o strobe segue o relógio do beat; só o silêncio o apaga
    const clocked = predicting(st, v) || (st.paused && st.sil < 0.5 && v.predict && !!f?.locked && f.bpm > 0);
    let strobe = clocked ? (allowed && sub < 0.15 ? 1 - sub / 0.15 : 0) : st.kickEnv;
    strobe *= (v.safeFlash ? Math.min(v.strobe, SAFE_STROBE_MAX) : v.strobe) * gate(u, v, 'strobe');
    u.strobe = strobe;
  }
  return u;
}
