// Saúde dos efeitos da comunidade vinda do telão (DK-123). O telão só avisa ('fx-health'); quem grava a lista
// `doublek.fx` é o controle, aqui, mesmo com a aba Efeitos fechada (o editor só existe com ela aberta).
// Gravar dispara o `storage` no telão, que descarrega o efeito suspeito; o editor, se aberto, relê a lista.
import { listen } from '@tauri-apps/api/event';
import { load, save } from '../lib/store';
import { nextHealth, validFxList, type FxEntry } from '../lib/shaders/manifest';
import type { FxHealthMsg } from '../output/fx';

export const FX_LIST_EVENT = 'doublek:fx-list'; // evento de janela: "a lista mudou por fora, releia"

export function watchFxHealth(onstatus: (msg: string) => void) {
  return listen<FxHealthMsg>('fx-health', (e) => {
    const { id, event, msg } = e.payload;
    const list = load('doublek.fx', validFxList, () => [] as FxEntry[]);
    const cur = list.find((x) => x.manifest.id === id);
    if (!cur) return;
    cur.health = nextHealth(cur.health, event);
    save('doublek.fx', list);
    dispatchEvent(new CustomEvent(FX_LIST_EVENT));
    onstatus(cur.health.status === 'desabilitado'
      ? `Efeito "${cur.manifest.name}" desabilitado depois de ${cur.health.fails} falhas no telão (${msg}). Reative no editor se confiar nele.`
      : `Efeito "${cur.manifest.name}" saiu do telão e ficou suspeito: ${msg}. Tente de novo pelo editor.`);
  });
}
