// Mapa do MIDI learn (`doublek.midi`): "cc|note:canal:número" → alvo. Puro (roda no Node): o controle e o importador
// de Show Pack usam o mesmo validador. `device` (D-23) = de qual controlador veio o controle aprendido; é só
// informação (o pré-show usa): ao vivo o app responde ao controle venha de onde vier. Mapas antigos não têm o campo.
import { isObj } from './store.ts';

export type MidiTarget = { id: string; label: string; min?: number; max?: number; step?: number; device?: string };

/** Mapa salvo → só entradas "cc|note:canal:número" → alvo com id e label; min/max/step se forem números; device se for texto. */
export function validMidiMap(raw: unknown): Record<string, MidiTarget> {
  if (!isObj(raw)) throw new Error('midi: precisa ser objeto');
  const out: Record<string, MidiTarget> = {};
  for (const [k, t] of Object.entries(raw)) {
    if (!/^(cc|note):\d+:\d+$/.test(k) || !isObj(t) || typeof t.id !== 'string' || typeof t.label !== 'string') continue;
    const o: MidiTarget = { id: t.id, label: t.label };
    for (const f of ['min', 'max', 'step'] as const) if (typeof t[f] === 'number' && Number.isFinite(t[f])) o[f] = t[f] as number;
    if (typeof t.device === 'string' && t.device && t.device.length <= 200) o.device = t.device;
    out[k] = o;
  }
  return out;
}

/** Controles mapeados por controlador (D-23). Os aprendidos antes da D-23 (sem `device`) ficam de fora. */
export function mappedByDevice(map: Record<string, MidiTarget>): Record<string, number> {
  const by: Record<string, number> = {};
  for (const t of Object.values(map)) if (t.device) by[t.device] = (by[t.device] ?? 0) + 1;
  return by;
}
