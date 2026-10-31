// Telão: efeitos da comunidade (DK-123). Carrega do `doublek.fx` + IndexedDB `fx:<id>` só os que estão como
// camada e saudáveis, entrega ao renderer, e devolve ao controle o que der errado ('fx-health'; quem grava a
// lista é o controle). Modo seguro (nenhum efeito externo): `?safe=1`, `fxSafe` no visual, ou o último telão
// caiu com efeito ligado (marca gravada antes de compilar, apagada depois de 10 s ou ao fechar normalmente).
import { emitTo, listen } from '@tauri-apps/api/event';
import { load } from '../lib/store';
import { getAsset } from '../lib/assets';
import { validFxList } from '../lib/shaders/manifest';
import type { Visual } from '../lib/settings';
import type { Renderer } from '../render/renderer';
import { isFxLayer, sanitizeLayers } from '../render/layers';

const GUARD = 'doublek.fxGuard'; // marca crua no localStorage (fora do store/SCHEMA): "telão compilando efeitos"
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} } };
type AssetKey = Parameters<typeof getAsset>[0];

export type FxHealthMsg = { id: string; event: 'lost' | 'slow'; msg: string };

export function fxTelao(o: { renderer: () => Renderer | null; visual: () => Visual; report: (level: 'warn' | 'error', msg: string) => void }) {
  const urlSafe = new URLSearchParams(location.search).has('safe');
  const crashed = !!store.get(GUARD);
  store.set(GUARD, null);
  if (crashed) o.report('warn', 'O último telão caiu com efeitos da comunidade ligados: abri em modo seguro, sem efeitos externos. Feche e abra o telão para tentar de novo.');
  const safe = () => urlSafe || crashed || !!o.visual().fxSafe;

  let key = '', sig = '', seq = 0, timer = 0;
  /** Lê a lista e o código e entrega ao renderer. `force` = o código pode ter mudado (editor salvou). */
  async function reload(force = false) {
    const r = o.renderer();
    if (!r) return;
    const v = o.visual();
    const ok = safe() ? [] : load('doublek.fx', validFxList, () => []).filter((e) => e.health.status === 'ok');
    const used = sanitizeLayers(v.layers, ok.map((e) => e.manifest.id)).filter((l) => l.type === 'fx').map((l) => l.id.slice(3));
    const want = ok.filter((e) => used.includes(e.manifest.id));
    const k = JSON.stringify(want.map((e) => [e.manifest.id, e.values]));
    if (!force && k === key) return;
    key = k;
    const my = ++seq;
    const items = (await Promise.all(want.map(async (e) => {
      const blob = await getAsset(`fx:${e.manifest.id}` as unknown as AssetKey).catch(() => undefined);
      return { id: e.manifest.id, code: blob ? await blob.text() : '', values: e.values };
    }))).filter((i) => i.code);
    if (my !== seq || o.renderer() !== r) return; // outra recarga chegou, ou o renderer foi recriado
    if (items.length) { // se o telão morrer compilando/desenhando nos próximos 10 s, a próxima abertura é segura
      store.set(GUARD, String(Date.now()));
      clearTimeout(timer);
      timer = window.setTimeout(() => store.set(GUARD, null), 10000);
    }
    r.setFx(items);
  }

  addEventListener('pagehide', () => store.set(GUARD, null)); // fechar o telão normalmente não é queda
  addEventListener('storage', (e) => { if (e.key === 'doublek.fx') reload(true); }); // o controle gravou a lista
  listen('fx-changed', () => reload(true)); // o editor salvou código novo (o IndexedDB não avisa sozinho)

  const health = (id: string, event: FxHealthMsg['event'], msg: string) => emitTo('control', 'fx-health', { id, event, msg } satisfies FxHealthMsg);
  return {
    reload,
    /** A cada evento 'visual': só recarrega se mudaram as camadas de efeito ou o modo seguro (os valores dos
     *  parâmetros chegam pelo `storage` do doublek.fx). */
    onVisual(v: Visual) {
      const s = `${!!v.fxSafe}|${(Array.isArray(v.layers) ? v.layers : []).filter((l) => isFxLayer(l?.id)).map((l) => l.id).join(',')}`;
      if (s !== sig) { sig = s; reload(); }
    },
    /** onEffectError do renderer: compilação/link que falhou ou lentidão → efeito suspeito no controle. */
    onError(id: string, err: Error) {
      if (!isFxLayer(id)) return;
      o.report('warn', `Efeito "${id.slice(3)}" desligado no telão: ${err.message}`);
      health(id.slice(3), 'slow', err.message);
    },
    /** Contexto WebGL perdido com efeito ligado: conta como falha de cada efeito que estava desenhando. */
    onLost(r: Renderer | null) {
      for (const id of r?.activeFx() ?? []) health(id, 'lost', 'a placa de vídeo perdeu o contexto');
    },
    safe,
  };
}
