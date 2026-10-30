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
};

export type Msg = { t: 'frame'; v: Frame } | { t: 'status'; v: string };
