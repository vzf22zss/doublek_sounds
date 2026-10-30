// MIDI learn: liga o modo, clica num controle da tela (fica "armado") e mexe no knob/pad do controlador.
// Mapeamento: "cc:canal:número" ou "note:canal:número" → alvo. Alvos: v:<ajuste visual>, a:<ação>, c:<cena>.

import { isObj, load, save as storeSave } from '../lib/store';

export type Target = { id: string; label: string; min?: number; max?: number; step?: number };
export type MidiMsg = { kind: 'cc' | 'note'; ch: number; num: number; val: number };

/** Mapa salvo → só entradas "cc|note:canal:número" → alvo com id e label; min/max/step se forem números. */
export function validMidiMap(raw: unknown): Record<string, Target> {
  if (!isObj(raw)) throw new Error('midi: precisa ser objeto');
  const out: Record<string, Target> = {};
  for (const [k, t] of Object.entries(raw)) {
    if (!/^(cc|note):\d+:\d+$/.test(k) || !isObj(t) || typeof t.id !== 'string' || typeof t.label !== 'string') continue;
    const o: Target = { id: t.id, label: t.label };
    for (const f of ['min', 'max', 'step'] as const) if (typeof t[f] === 'number' && Number.isFinite(t[f])) o[f] = t[f] as number;
    out[k] = o;
  }
  return out;
}

export const midi = $state({
  learning: false,
  armed: null as Target | null,
  map: load<Record<string, Target>>('doublek.midi', validMidiMap, () => ({})),
  devices: [] as string[],
  activity: 0,
});

const save = () => storeSave('doublek.midi', midi.map);

export const keyOf = (m: MidiMsg) => `${m.kind}:${m.ch}:${m.num}`;

export function keyLabel(key: string) {
  const [k, ch, n] = key.split(':');
  return (k === 'cc' ? 'CC' : 'N') + n + (ch !== '0' ? ` ch${+ch + 1}` : '');
}

export const mappedKey = (id: string) => Object.keys(midi.map).find((k) => midi.map[k].id === id);

/** Liga o controle armado à mensagem recebida (um alvo tem só um controle físico). */
export function bindArmed(key: string) {
  const t = midi.armed;
  if (!t) return;
  for (const k of Object.keys(midi.map)) if (midi.map[k].id === t.id) delete midi.map[k];
  midi.map[key] = t;
  midi.armed = null;
  save();
  return t;
}

export function clearArmed() {
  const t = midi.armed;
  if (!t) return;
  for (const k of Object.keys(midi.map)) if (midi.map[k].id === t.id) delete midi.map[k];
  midi.armed = null;
  save();
}

/** Ação Svelte: em modo learn, clicar no elemento arma-o; fora dele, não interfere. */
export function learnable(node: HTMLElement, t: Target | null) {
  let target = t;
  const grab = (e: Event) => {
    if (!midi.learning || !target) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') midi.armed = target;
  };
  const evs = ['pointerdown', 'mousedown', 'click', 'dblclick'];
  evs.forEach((ev) => node.addEventListener(ev, grab, true));
  $effect(() => {
    const on = midi.learning && !!target;
    node.classList.toggle('learn', on);
    node.classList.toggle('armed', on && midi.armed?.id === target!.id);
    const k = target && mappedKey(target.id);
    if (k) node.dataset.midi = keyLabel(k);
    else delete node.dataset.midi;
  });
  return {
    update(n: Target | null) { target = n; },
    destroy() { evs.forEach((ev) => node.removeEventListener(ev, grab, true)); },
  };
}
