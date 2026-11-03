// Verificação pré-show (DK-145): o checklist do dia do show (TUTORIAL §19) vira "Testar tudo" na aba Saída.
// Aqui só a regra: entradas já coletadas → verde/amarelo/vermelho com a correção em 1 frase. Quem coleta é PreShow.svelte.
import { normDevice } from './midimap.ts';

export type Color = 'verde' | 'amarelo' | 'vermelho';
export type Item = { id: string; label: string; color: Color; msg: string };

export type PreshowInput = {
  rms: number[];               // uma amostra a cada 100 ms por 10 s; 0 quando não chegou quadro novo
  gate: number;
  lockedAtS: number | null;    // segundos até o BPM travar (0 = já estava travado); null = não travou
  output: { open: boolean; fullscreen: boolean | null; monitorOk: boolean | null; p95: number[]; lost: boolean };
  midi: { devices: string[]; mapped: number; mappedBy?: Record<string, number> }; // mappedBy: controles por controlador (D-23)
  diskFree: number | null;     // bytes livres no disco do app; null = não deu para ler
  recording: boolean;
  safeFlash: boolean;
  fx: { safe: boolean; suspect: string[]; disabled?: { name: string; fails: number }[] }; // disabled: desligado depois de falhas
  update: string | null;       // versão nova que o atualizador já conhece
  net: { osc: boolean; oscLan: boolean; remote: boolean; remoteLan: boolean; spout: boolean };
};

/** Monitor em coordenadas físicas (availableMonitors). */
export type Mon = { name: string | null; x: number; y: number; w: number; h: number };

/**
 * A janela do telão (posição e tamanho físicos) está no monitor escolhido? Vale o monitor que contém o CENTRO da
 * janela, comparado com o escolhido por nome + posição física (± tol px). Comparar o canto da janela com o canto do
 * monitor dava falso "monitor errado" com DPI misto: em tela cheia num monitor a 150% o Windows devolve o canto
 * alguns pixels fora (bordas invisíveis). null = sem o monitor escolhido na lista.
 */
export function onChosenMonitor(win: { x: number; y: number; w: number; h: number }, mons: Mon[], chosen: number, tol = 2): boolean | null {
  const want = mons[chosen];
  if (!want) return null;
  const cx = win.x + win.w / 2, cy = win.y + win.h / 2;
  const has = mons.find((m) => cx >= m.x && cx < m.x + m.w && cy >= m.y && cy < m.y + m.h);
  return !!has && has.name === want.name && Math.abs(has.x - want.x) <= tol && Math.abs(has.y - want.y) <= tol;
}

const GB = 1e9;
const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const it = (id: string, label: string, color: Color, msg: string): Item => ({ id, label, color, msg });

export function evaluate(i: PreshowInput): Item[] {
  const out: Item[] = [];

  const above = i.rms.filter((r) => r > i.gate).length;
  out.push(i.rms.length && above / i.rms.length >= 0.5
    ? it('audio', 'Áudio', 'verde', `Som entrando (${Math.round((above / i.rms.length) * 100)}% do tempo acima do corte).`)
    : it('audio', 'Áudio', 'vermelho', 'Pouco som entrando: aumente o ganho ou confira o cabo do REC/BOOTH.'));

  out.push(i.lockedAtS !== null && i.lockedAtS <= 10
    ? it('bpm', 'BPM', 'verde', i.lockedAtS ? `Travou em ${i.lockedAtS.toFixed(1)} s.` : 'Já estava travado.')
    : it('bpm', 'BPM', 'amarelo', 'Não travou em 10 s: toque um trecho com kick ou use TAP.'));

  const o = i.output, p95 = +median(o.p95).toFixed(1);
  if (!o.open) out.push(it('output', 'Telão', 'vermelho', 'Telão fechado: escolha o monitor e clique em Projetar.'));
  else if (o.lost) out.push(it('output', 'Telão', 'vermelho', 'O telão perdeu a placa de vídeo: feche e projete de novo.'));
  else if (o.monitorOk === false) out.push(it('output', 'Telão', 'vermelho', 'Telão no monitor errado: confira o monitor escolhido e clique em Projetar.'));
  else if (o.fullscreen === false) out.push(it('output', 'Telão', 'vermelho', 'Telão fora da tela cheia: clique em Projetar de novo.'));
  else if (!o.p95.length || p95 >= 40) out.push(it('output', 'Telão', 'vermelho', `${o.p95.length ? `p95 ${p95} ms` : 'Sem medida do telão'}: abaixe a resolução de render ou feche outros programas.`));
  else if (p95 >= 25) out.push(it('output', 'Telão', 'amarelo', `p95 ${p95} ms (alvo < 25): abaixe a resolução de render se cair de 60 fps.`));
  else out.push(it('output', 'Telão', o.fullscreen === null || o.monitorOk === null ? 'amarelo' : 'verde',
    o.fullscreen === null || o.monitorOk === null ? `p95 ${p95} ms, mas não consegui conferir monitor e tela cheia: olhe o telão.` : `Tela cheia no monitor escolhido, p95 ${p95} ms.`));

  // D-23: o mapa sabe de qual controlador veio cada controle → diz exatamente qual está ocupado/sumiu e quantos controles
  // perde. Controles aprendidos antes da D-23 (sem origem) caem na regra aproximada. Todas as frases no mesmo molde:
  // "O controlador X está ocupado…" / "N controladores, M controles mapeados."
  // nomes normalizados dos dois lados ("2- nanoKONTROL2" = "nanoKONTROL2"), inclusive mapas antigos com o nome cru
  const busy = i.midi.devices.filter((d) => d.endsWith('(ocupado)')).map(normDevice), free = i.midi.devices.length - busy.length;
  const here = i.midi.devices.filter((d) => !d.endsWith('(ocupado)')).map(normDevice);
  const by: Record<string, number> = {}, mapped = i.midi.mapped;
  for (const [d, n] of Object.entries(i.midi.mappedBy ?? {})) by[normDevice(d)] = (by[normDevice(d)] ?? 0) + n;
  const known = Object.values(by).reduce((s, n) => s + n, 0);
  const ctl = (k: number) => `${k} controle${k === 1 ? '' : 's'} mapeado${k === 1 ? '' : 's'}`;
  const ctrls = (k: number) => `${k} controlador${k === 1 ? '' : 'es'}`;
  const isBusy = (ds: string[]) => ds.map((d) => `O controlador ${d} está ocupado`).join('; ');
  const close = 'feche o outro programa que usa o controlador.';
  const busyMapped = busy.filter((d) => by[d]);
  const missing = Object.keys(by).filter((d) => by[d] && !here.includes(d) && !busy.includes(d));
  // controlador mapeado que não está aqui (Show Pack de outra máquina, outro nome de porta): só é vermelho se nenhum
  // controlador conectado tiver controles mapeados; senão o show anda com o que está aqui → amarelo
  const hereMapped = here.some((d) => by[d]) || (mapped > known && here.length > 0);
  if (busyMapped.length) out.push(it('midi', 'MIDI', 'vermelho', `${busyMapped.map((d) => `O controlador ${d} está ocupado e tem ${ctl(by[d])}`).join('; ')}: ${close}`));
  else if (missing.length && hereMapped) out.push(it('midi', 'MIDI', 'amarelo', `Mapeado num controlador que não está aqui: ${missing.map((d) => `${d} (${ctl(by[d])})`).join(', ')}. Os outros controles estão em controladores conectados.`));
  else if (missing.length) out.push(it('midi', 'MIDI', 'vermelho', `${missing.map((d) => `O controlador ${d} não está conectado e tem ${ctl(by[d])}`).join('; ')}: conecte o cabo USB.`));
  else if (mapped && known === mapped) out.push(it('midi', 'MIDI', busy.length ? 'amarelo' : 'verde', busy.length
    ? `${isBusy(busy)}, mas sem controles mapeados nele; ${known === 1 ? 'o controle mapeado está' : `os ${ctl(known)} estão`} em controladores livres.`
    : `${ctrls(free)}, ${ctl(known)}.`));
  // ponytail: controles sem origem (aprendidos antes da D-23): "(ocupado)" sem outro livre = vermelho; reaprender resolve
  else if (!mapped) out.push(it('midi', 'MIDI', busy.length ? 'amarelo' : 'verde', busy.length ? `${isBusy(busy)}, sem controles mapeados: se for usá-lo, ${close}` : free ? `${ctrls(free)}, nada mapeado.` : 'Sem controlador e nada mapeado.'));
  else if (!free) out.push(it('midi', 'MIDI', 'vermelho', busy.length ? `${isBusy(busy)} e há ${ctl(mapped)}: ${close}` : `${ctl(mapped)} e nenhum controlador conectado: conecte o cabo USB.`));
  else if (busy.length) out.push(it('midi', 'MIDI', 'amarelo', `${isBusy(busy)}: se for o dos controles mapeados, ${close}`));
  else out.push(it('midi', 'MIDI', 'verde', `${ctrls(free)}, ${ctl(mapped)}.`));

  const d = i.diskFree, gb = d === null ? '' : (d / GB).toFixed(1) + ' GB livres';
  out.push(d === null ? it('disk', 'Disco', 'amarelo', 'Não consegui ler o espaço livre: confira no Explorer (≥ 2 GB).')
    : d < 2 * GB ? it('disk', 'Disco', 'vermelho', `${gb}: libere espaço (mínimo 2 GB).`)
    : i.recording && d < 5 * GB ? it('disk', 'Disco', 'amarelo', `${gb} gravando: libere espaço ou a gravação para no meio.`)
    : it('disk', 'Disco', 'verde', gb + '.'));

  out.push(i.safeFlash ? it('flash', 'Flashes', 'verde', 'Limite de 3 flashes/s ligado.')
    : it('flash', 'Flashes', 'amarelo', 'Limite de flashes desligado: ligue em Segurança visual (aba Saída).'));

  const off = i.fx.disabled ?? [];
  const fxBad = [
    ...(i.fx.suspect.length ? [`Suspeito: ${i.fx.suspect.join(', ')}. Teste no editor ou remova.`] : []),
    ...off.map((x) => `Efeito ${x.name} desligado depois de ${x.fails} falha${x.fails === 1 ? '' : 's'}: reative no editor ou remova.`),
  ];
  out.push(i.fx.safe ? it('fx', 'Efeitos da comunidade', 'amarelo', 'Modo seguro ligado: desligue no editor de efeitos se for usá-los.')
    : fxBad.length ? it('fx', 'Efeitos da comunidade', 'amarelo', fxBad.join(' '))
    : it('fx', 'Efeitos da comunidade', 'verde', 'Nenhum efeito suspeito ou desligado.'));

  out.push(i.update ? it('version', 'Versão', 'amarelo', `Versão ${i.update} disponível: atualize antes do show (com o telão fechado).`)
    : it('version', 'Versão', 'verde', 'Nenhuma versão nova conhecida.'));

  const n = i.net, on = (b: boolean, lan: boolean) => (b ? (lan ? 'rede local' : 'ligado') : 'desligado');
  const lan = (n.osc && n.oscLan) || (n.remote && n.remoteLan);
  out.push(it('net', 'OSC / celular / Spout', lan ? 'amarelo' : 'verde',
    `OSC ${on(n.osc, n.oscLan)} · celular ${on(n.remote, n.remoteLan)} · Spout ${n.spout ? 'ligado' : 'desligado'}${lan ? ': rede local aberta, use só rede confiável.' : '.'}`));

  return out;
}

/** Pior cor da lista (resumo do botão). */
export const worst = (items: Item[]): Color =>
  items.some((x) => x.color === 'vermelho') ? 'vermelho' : items.some((x) => x.color === 'amarelo') ? 'amarelo' : 'verde';
