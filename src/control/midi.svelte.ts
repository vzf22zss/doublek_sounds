// MIDI learn: liga o modo, clica num controle da tela (fica "armado") e mexe no knob/pad do controlador.
// Mapeamento: "cc:canal:número" ou "note:canal:número" → alvo. Alvos: v:<ajuste visual>, a:<ação>, c:<cena>.

export type Target = { id: string; label: string; min?: number; max?: number; step?: number };
export type MidiMsg = { kind: 'cc' | 'note'; ch: number; num: number; val: number };

const KEY = 'doublek.midi';

function load(): Record<string, Target> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

export const midi = $state({
  learning: false,
  armed: null as Target | null,
  map: load(),
  devices: [] as string[],
  activity: 0,
});

const save = () => { try { localStorage.setItem(KEY, JSON.stringify(midi.map)); } catch {} };

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
