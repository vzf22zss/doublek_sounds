// Espelho de `Frame` / `Msg` em src-tauri/src/analysis.rs e audio.rs
export type Frame = {
  peak: number;
  rms: number;
  bands: [number, number, number, number, number]; // sub, bass, mid, click, air
  kick: number;
  bpm: number;
  locked: boolean;
  holding: boolean;
  beatPhase: number;
  beat: number;
  flux: number;
  thr: number;
  spectrum: number[];
  low: number; // 1 = grave tocando (drop), 0 = breakdown sem grave
  pos: number; // posição na faixa tocada pelo app (s); -1 = entrada ao vivo
  // indicadores de energia musical (DK-031); opcionais até todo consumidor atualizar
  energy?: number; // (rms + médio + agudo)/3 absoluto, suavizado em ~1 compasso
  contrast?: number; // energia dos últimos 4 compassos ÷ 4 anteriores (1 = estável; > 1 subindo)
  stability?: number; // 0..1: confiança no relógio do beat (jitter × tempo desde a trava)
  kickRate?: number; // kicks por compasso nos últimos 8 beats (0 no breakdown, ~4 no groove)
  clock?: 'audio' | 'midi'; // quem manda no relógio do beat (DK-112); opcional até todo consumidor atualizar
};

export type Msg = { t: 'frame'; v: Frame } | { t: 'status'; v: string };
