// Segurança visual (DK-006). Referência: WCAG 2.3.1 trata mais de 3 flashes por segundo como limiar de
// risco para epilepsia fotossensível. É referência de engenharia, não certificação clínica.

export const MAX_FLASH_HZ = 3;

/** Com `safeFlash`, o strobe acende só 1 em cada `every` pulsos para ficar ≤ MAX_FLASH_HZ. 1 = todos. */
export const strobeEvery = (bpm: number, div: number) => (bpm > 0 ? Math.max(1, Math.ceil(((bpm / 60) * div) / MAX_FLASH_HZ)) : 1);

/** O pulso de índice `n` (subdivisões contadas desde o 1º beat) pode acender? */
export const strobeAllowed = (n: number, every: number) => ((n % every) + every) % every === 0;

/** Taxa efetiva de flashes (Hz) depois da redução. */
export const strobeRate = (bpm: number, div: number, safe: boolean) => ((bpm / 60) * div) / (safe ? strobeEvery(bpm, div) : 1);

export const SAFE_FLASH_MAX = 0.5;  // teto do flash de tela com safeFlash
export const SAFE_STROBE_MAX = 0.7; // teto da intensidade do strobe com safeFlash

/** PÂNICO: o que volta ao neutro na hora (só chaves de cena; blackout/logoOnly/react são tratados à parte). */
export const SAFE_LOOK = { strobe: 0, fxFlash: 0.2, fxShake: 0, chroma: 0, trail: 0, fxGrain: 0, fxScan: 0, bgFlash: 0.1 } as const;
