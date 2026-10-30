// npm run check — dispatcher de comandos (DK-042 / ADR 0003): validação, fontes de rede recusadas, BLACKOUT/PÂNICO
// na frente, override manual, histórico, compatibilidade com o MIDI learn salvo e curvas das macros.
import assert from 'node:assert/strict';
import { VISUAL } from './settings.ts';
import { SAFE_FLASH_MAX, SAFE_STROBE_MAX } from './safety.ts';
import { createDispatcher, fromTarget, keyCommand, LEGACY_ACTIONS, MACROS, routePad, startMacro, validate, type Handlers, type ShowCommand, type Source } from './commands.ts';

let t = 1000;
const log: string[] = [];
const all = (tag = ''): Handlers => new Proxy({}, { get: (_, type: string) => (c: ShowCommand, s: Source) => log.push(`${tag}${type}@${s}`) }) as Handlers;
const fresh = (h: Handlers = all(), cooldownMs?: number) => { log.length = 0; return createDispatcher(h, { now: () => t, cooldownMs }); };
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? '' : (r as any).reason as string);

// --- validação ---
{
  const d = fresh();
  for (const c of [
    { type: 'TAP' }, { type: 'NUDGE', ms: -5 }, { type: 'BLACKOUT' }, { type: 'BLACKOUT', on: true }, { type: 'SCENE_RECALL', index: 7, fade: 4, now: true },
    { type: 'SCENE_SAVE', index: 0 }, { type: 'BANK_STEP', delta: -1 }, { type: 'BANK_SET', index: 3 }, { type: 'SET_PARAMETER', key: 'trail', value: 0.5 },
    { type: 'ROTEIRO_NUDGE', beats: 4 }, { type: 'MACRO', id: 'DROP' }, { type: 'AUTOMATION_MODE', mode: 'AUTO' },
  ] as ShowCommand[]) assert.equal(validate(c), null, JSON.stringify(c));
  const bad: [unknown, RegExp][] = [
    [null, /sem tipo/], [{ type: 'FOO' }, /desconhecido \(FOO\)/],
    [{ type: 'NUDGE', ms: 0 }, /NUDGE/], [{ type: 'NUDGE', ms: 500 }, /NUDGE/],
    [{ type: 'BLACKOUT', on: 'sim' }, /"on"/],
    [{ type: 'SCENE_RECALL', index: 8 }, /0 a 7/], [{ type: 'SCENE_RECALL', index: 1.5 }, /0 a 7/], [{ type: 'SCENE_RECALL', index: 0, fade: 99 }, /fade/],
    [{ type: 'SCENE_SAVE', index: -1 }, /0 a 7/],
    [{ type: 'BANK_STEP', delta: 0 }, /delta/], [{ type: 'BANK_SET', index: 4 }, /0 a 3/],
    [{ type: 'SET_PARAMETER', key: 'naoExiste', value: 1 }, /desconhecido ou não numérico \(naoExiste\)/],
    [{ type: 'SET_PARAMETER', key: 'color', value: 1 }, /não numérico \(color\)/],            // string no VISUAL
    [{ type: 'SET_PARAMETER', key: 'blackout', value: 1 }, /não numérico/],                   // boolean: só pelo BLACKOUT
    [{ type: 'SET_PARAMETER', key: 'toString', value: 1 }, /desconhecido/],                   // herdado, não é ajuste
    [{ type: 'SET_PARAMETER', key: 'trail', value: NaN }, /número/],
    [{ type: 'ROTEIRO_NUDGE', beats: 0.5 }, /beats/], [{ type: 'MACRO', id: 'FOO' }, /desconhecida/], [{ type: 'AUTOMATION_MODE', mode: 'x' }, /modo/],
  ];
  for (const [c, re] of bad) {
    assert.match(validate(c)!, re);
    assert.match(reason(d.dispatch(c as ShowCommand, 'ui')), re);
  }
  assert.equal(log.length, 0, 'nada inválido chega aos handlers');
}

// --- OSC e remoto: recusados com motivo, até BLACKOUT (não há servidor) ---
{
  const d = fresh();
  assert.match(reason(d.dispatch({ type: 'TAP' }, 'osc')), /OSC desligado/);
  assert.match(reason(d.dispatch({ type: 'BLACKOUT' }, 'remote')), /controle remoto desligado/);
  assert.equal(log.length, 0);
  assert.deepEqual(d.history().map((h) => [h.source, h.ok]), [['osc', false], ['remote', false]]);
}

// --- override manual: automação descartada por 8 s; roteiro passa; BLACKOUT/PÂNICO da automação passam ---
{
  t = 1000;
  const d = fresh();
  assert.ok(d.dispatch({ type: 'SCENE_RECALL', index: 1 }, 'automation').ok);   // ninguém mexeu ainda
  d.dispatch({ type: 'TAP' }, 'midi');                                           // DJ mexeu
  assert.equal(d.manualLeft(), 8000);
  t += 3000;
  assert.match(reason(d.dispatch({ type: 'SCENE_RECALL', index: 2 }, 'automation')), /override manual: automação pausada por mais 5 s/);
  assert.ok(d.dispatch({ type: 'SCENE_RECALL', index: 3 }, 'roteiro').ok);      // roteiro > automação
  assert.ok(d.dispatch({ type: 'BLACKOUT', on: true }, 'automation').ok);       // segurança passa
  assert.ok(d.dispatch({ type: 'PANIC' }, 'automation').ok);
  assert.equal(d.manualLeft(), 5000, 'roteiro e automação não renovam o override');
  t += 5000;
  assert.ok(d.dispatch({ type: 'SCENE_RECALL', index: 4 }, 'automation').ok);   // passou o cooldown
  assert.deepEqual(log, ['SCENE_RECALL@automation', 'TAP@midi', 'SCENE_RECALL@roteiro', 'BLACKOUT@automation', 'PANIC@automation', 'SCENE_RECALL@automation']);
  // cooldown configurável; teclado e botões também marcam
  const d2 = fresh(all(), 1000);
  d2.dispatch({ type: 'LOGO_ONLY' }, 'keyboard');
  assert.match(reason(d2.dispatch({ type: 'TAP' }, 'automation')), /1 s/);
  t += 1000;
  assert.ok(d2.dispatch({ type: 'TAP' }, 'automation').ok);
  d2.dispatch({ type: 'MACRO', id: 'CHAOS' }, 'ui');
  assert.ok(!d2.dispatch({ type: 'TAP' }, 'automation').ok);
}

// --- ordem: comando disparado de dentro de outro espera; BLACKOUT/PÂNICO passam na frente; PÂNICO limpa a fila ---
{
  let d!: ReturnType<typeof createDispatcher>;
  const h: Handlers = {
    MACRO: () => {
      log.push('MACRO');
      d.dispatch({ type: 'SET_PARAMETER', key: 'trail', value: 1 }, 'ui');
      d.dispatch({ type: 'BLACKOUT', on: true }, 'ui');
      d.dispatch({ type: 'SCENE_RECALL', index: 0 }, 'ui');
      log.push('fim MACRO');
    },
    SET_PARAMETER: () => log.push('SET_PARAMETER'),
    BLACKOUT: () => log.push('BLACKOUT'),
    SCENE_RECALL: () => log.push('SCENE_RECALL'),
    PANIC: () => log.push('PANIC'),
  };
  d = fresh(h);
  d.dispatch({ type: 'MACRO', id: 'BUILD_UP' }, 'ui');
  assert.deepEqual(log, ['MACRO', 'BLACKOUT', 'fim MACRO', 'SET_PARAMETER', 'SCENE_RECALL']);
  h.MACRO = () => {
    d.dispatch({ type: 'SET_PARAMETER', key: 'trail', value: 1 }, 'ui');
    d.dispatch({ type: 'PANIC' }, 'ui');
    d.dispatch({ type: 'SCENE_RECALL', index: 0 }, 'ui'); // depois do pânico: entra na fila de novo
  };
  log.length = 0;
  d.dispatch({ type: 'MACRO', id: 'DROP' }, 'ui');
  assert.deepEqual(log, ['PANIC', 'SCENE_RECALL'], 'o SET_PARAMETER enfileirado antes do pânico é descartado');
  // handler que lança vira recusa, não exceção; o dispatcher continua funcionando
  const d3 = fresh({ TAP: () => { throw new Error('motor parado'); }, BLACKOUT: () => log.push('B') });
  assert.match(reason(d3.dispatch({ type: 'TAP' }, 'keyboard')), /TAP: motor parado/);
  assert.ok(d3.dispatch({ type: 'BLACKOUT' }, 'keyboard').ok);
  // sem handler = sem efeito nesta versão (AUTOMATION_MODE)
  assert.match(reason(d3.dispatch({ type: 'AUTOMATION_MODE', mode: 'AUTO' }, 'ui')), /AUTOMATION_MODE: sem efeito nesta versão/);
}

// --- histórico: teto 50, mais antigo primeiro, SET_PARAMETER seguido do mesmo ajuste vira uma linha ---
{
  t = 0;
  const d = createDispatcher(all(), { now: () => t });
  for (let i = 0; i < 70; i++) { t = i; d.dispatch({ type: 'SCENE_RECALL', index: i % 8 }, 'midi'); }
  const h = d.history();
  assert.equal(h.length, 50);
  assert.deepEqual([h[0].t, h[49].t], [20, 69]);
  assert.deepEqual(Object.keys(h[0]).sort(), ['cmd', 'ok', 'source', 't']);
  for (let i = 0; i <= 100; i++) d.dispatch({ type: 'SET_PARAMETER', key: 'trail', value: i / 100 }, 'midi');
  d.dispatch({ type: 'SET_PARAMETER', key: 'glow', value: 0.3 }, 'midi');
  const tail = d.history().slice(-2);
  assert.deepEqual(tail.map((x) => [x.cmd.type, (x.cmd as any).key, (x.cmd as any).value]), [['SET_PARAMETER', 'trail', 1], ['SET_PARAMETER', 'glow', 0.3]]);
  assert.equal(d.history().length, 50);
  d.dispatch({ type: 'SET_PARAMETER', key: 'nada', value: 1 }, 'osc');
  assert.equal(d.history().at(-1)!.reason!.length > 0, true, 'recusa também fica no histórico, com motivo');
}

// --- compatibilidade: todo id que o app já gravou em doublek.midi vira um comando válido ---
{
  const ids = ['a:tap', 'a:half', 'a:double', 'a:nudge-', 'a:nudge+', 'a:blackout', 'a:logoOnly', 'a:panic', 'a:go', 'a:stop',
    'a:beat-', 'a:beat+', 'a:bar-', 'a:bar+', 'a:ab', 'a:bank-', 'a:bank+'];
  for (const id of ids) {
    const c = fromTarget({ id, label: id });
    assert.ok(c, id);
    assert.equal(validate(c), null, id);
  }
  assert.deepEqual(fromTarget({ id: 'a:nudge-' }), { type: 'NUDGE', ms: -5 });
  assert.deepEqual(fromTarget({ id: 'a:bar+' }), { type: 'ROTEIRO_NUDGE', beats: 4 });
  assert.deepEqual(fromTarget({ id: 'a:bank-' }), { type: 'BANK_STEP', delta: -1 });
  for (const m of MACROS) assert.deepEqual(fromTarget({ id: `a:macro:${m}` }), { type: 'MACRO', id: m });
  const novos = ['a:take', 'a:previewMode', 'a:previewClear']; // DK-043
  assert.equal(Object.keys(LEGACY_ACTIONS).length, ids.length + MACROS.length + novos.length);
  assert.deepEqual(novos.map((id) => fromTarget({ id })), [{ type: 'SCENE_TAKE' }, { type: 'PREVIEW_MODE' }, { type: 'PREVIEW_CLEAR' }]);
  // c:<i>
  for (let i = 0; i < 8; i++) assert.deepEqual(fromTarget({ id: `c:${i}` }), { type: 'SCENE_RECALL', index: i });
  assert.equal(fromTarget({ id: 'c:x' }), null);
  // v:<chave>: mesma conta de antes (min + val/127·(max−min), arredondado no step); todos os knobs que existem hoje
  assert.deepEqual(fromTarget({ id: 'v:chroma', min: 0, max: 40, step: 0.5 }, 64), { type: 'SET_PARAMETER', key: 'chroma', value: 20 });
  assert.deepEqual(fromTarget({ id: 'v:bgHue', min: -180, max: 180, step: 1 }, 0), { type: 'SET_PARAMETER', key: 'bgHue', value: -180 });
  assert.equal(fromTarget({ id: 'v:trail', label: 'Rastro' }, 64), null, 'knob sem faixa não vira comando');
  for (const k of ['amount', 'glow', 'fxFlash', 'fxRings', 'trail', 'strobe', 'chroma', 'bgPulse', 'fxShake', 'bgHue', 'white', 'wave', 'videoSpeed', 'trailZoom',
    'trailRot', 'size', 'renderScale', 'rel', 'offset', 'fxVig', 'fxScan', 'fxRadial', 'fxGrain', 'fxBars', 'dropFade', 'bgOpacity', 'bgFlash', 'bgDim', 'bgBlur', 'bgAngle'])
    assert.equal(validate(fromTarget({ id: 'v:' + k, min: 0, max: 1 }, 127)), null, k);
  assert.equal(fromTarget({ id: 'x:qualquer' }), null);
}

// --- macros ---
{
  const from = { ...(VISUAL as any), trail: 0.2, fxRings: 0.95, bgPulse: 0.05 };
  const up = startMacro('BUILD_UP', from, true);
  assert.deepEqual(up.update(0), { set: { trail: 0.2, fxRings: 0.95, bgPulse: 0.05 }, done: false });
  const mid = up.update(8).set;
  assert.ok(mid.trail > 0.2 && mid.trail < 0.8 && Math.abs(mid.trail - 0.5) < 1e-9);    // smoothstep na metade
  assert.equal(mid.fxRings, 0.95, 'nunca desce o que já estava acima do alvo');
  assert.deepEqual(up.update(16), { set: { trail: 0.8, fxRings: 0.95, bgPulse: 0.25 }, done: true });

  const prev = { ...(VISUAL as any), fxFlash: 0.35, strobe: 0.1, strobeDiv: 4, fxRings: 0.4 };
  const safe = startMacro('DROP', prev, true).update(1).set;
  assert.deepEqual(safe, { fxFlash: SAFE_FLASH_MAX, strobe: SAFE_STROBE_MAX, strobeDiv: 1, fxRings: 1 });
  assert.deepEqual(startMacro('DROP', prev, false).update(0).set, { fxFlash: 1, strobe: 1, strobeDiv: 1, fxRings: 1 });
  assert.deepEqual(startMacro('DROP', prev, true).update(2), { set: { fxFlash: 0.35, strobe: 0.1, strobeDiv: 4, fxRings: 0.4 }, done: true });

  let n = 0;
  const rng = () => [0, 1, 0.5, 0.25][n++ % 4];
  const ch = startMacro('CHAOS', { ...(VISUAL as any), chroma: 3, fxShake: 0, trailRot: 0.1 }, true, rng);
  const a = ch.update(0.1).set, a2 = ch.update(0.9).set, b = ch.update(1.2).set;
  assert.deepEqual(a, { chroma: 0, fxShake: 15, trailRot: 0 });
  assert.deepEqual(b, { chroma: 5, fxShake: 0, trailRot: 0.4 });
  assert.deepEqual(a2, a, 'mesmo beat, mesmo sorteio (não pisca a cada quadro)');
  assert.notDeepEqual(b, a);
  for (const s of [a, b]) assert.ok(s.chroma >= 0 && s.chroma <= 20 && s.fxShake >= 0 && s.fxShake <= 15 && Math.abs(s.trailRot) <= 0.4);
  assert.deepEqual(ch.update(4), { set: { chroma: 3, fxShake: 0, trailRot: 0.1 }, done: true });
}

// --- DK-043: preview/TAKE, modo preview nos pads, teclado ---
{
  for (const c of [{ type: 'SCENE_PREVIEW', index: 2 }, { type: 'SCENE_PREVIEW', bank: 3, index: 7 }, { type: 'SCENE_TAKE' }, { type: 'SCENE_TAKE', fade: 0 },
    { type: 'PREVIEW_CLEAR' }, { type: 'PREVIEW_MODE' }, { type: 'PREVIEW_MODE', on: false }] as ShowCommand[]) assert.equal(validate(c), null, JSON.stringify(c));
  assert.match(validate({ type: 'SCENE_PREVIEW', index: 8 })!, /0 a 7/);
  assert.match(validate({ type: 'SCENE_PREVIEW', bank: 4, index: 0 })!, /banco de 0 a 3/);
  assert.match(validate({ type: 'SCENE_TAKE', fade: -1 })!, /fade/);
  assert.match(validate({ type: 'PREVIEW_MODE', on: 1 })!, /"on"/);

  // c:<i> do MIDI e o toque no pad obedecem ao modo preview; o resto passa igual
  const pad = fromTarget({ id: 'c:4' })!;
  assert.deepEqual(routePad(pad, false), { type: 'SCENE_RECALL', index: 4 });
  assert.deepEqual(routePad(pad, true), { type: 'SCENE_PREVIEW', index: 4 });
  assert.deepEqual(routePad({ type: 'BLACKOUT' }, true), { type: 'BLACKOUT' });
  assert.deepEqual(routePad({ type: 'SCENE_RECALL', index: 1, fade: 0, now: true }, false), { type: 'SCENE_RECALL', index: 1, fade: 0, now: true });

  const k = (code: string, shiftKey = false, key = '') => keyCommand({ code, key, shiftKey });
  assert.deepEqual(k('Digit3'), { type: 'SCENE_RECALL', index: 2 });
  assert.deepEqual(k('Digit3', true, '#'), { type: 'SCENE_PREVIEW', index: 2 });   // Shift+3 não chama a cena
  assert.deepEqual(k('Digit1', true, '!'), { type: 'SCENE_PREVIEW', index: 0 });
  assert.equal(k('Digit9'), null);
  assert.deepEqual(k('KeyT', false, 't'), { type: 'SCENE_TAKE' });
  assert.deepEqual(k('KeyT', true, 'T'), { type: 'PREVIEW_CLEAR' });
  // o que já existia continua igual
  assert.deepEqual([k('Space'), k('KeyB'), k('KeyL'), k('KeyP'), k('KeyG'), k('KeyG', true), k('KeyR')].map((c) => c!.type),
    ['TAP', 'BLACKOUT', 'LOGO_ONLY', 'PANIC', 'ROTEIRO_GO', 'ROTEIRO_STOP', 'ROTEIRO_AB']);
  assert.deepEqual([k('ArrowLeft'), k('Comma'), k('Quote')], [{ type: 'NUDGE', ms: -5 }, { type: 'ROTEIRO_NUDGE', beats: -1 }, { type: 'ROTEIRO_NUDGE', beats: 4 }]);
  assert.deepEqual(k('BracketRight', false, '['), { type: 'BANK_STEP', delta: -1 });  // ABNT2: tecla "[" na posição BracketRight
  assert.deepEqual(k('Backslash', false, ']'), { type: 'BANK_STEP', delta: 1 });
  assert.deepEqual(k('BracketLeft', false, 'Dead'), { type: 'BANK_STEP', delta: -1 });
  assert.equal(k('KeyF'), null, 'F (projetar) não é comando de show');
}

// --- DK-143: efeitos do roteiro como comandos; roteiro > automação; knobs da tela marcam override ---
{
  for (const c of [{ type: 'FX_BURST', fx: 'strobe', beats: 4, div: 2 }, { type: 'FX_BURST', fx: 'blackout', beats: 1 }, { type: 'VIDEO_SET', id: '' },
    { type: 'VIDEO_SET', id: 'k3j2h1g0' }, { type: 'PARAM_RAMP', key: 'trail', to: 0.8, beats: 8 }, { type: 'PARAM_RAMP', key: 'glow', to: 1, beats: 0 },
    { type: 'SCENE_RECALL', index: 2, bank: 3, now: true }] as ShowCommand[]) assert.equal(validate(c), null, JSON.stringify(c));
  const bad: [unknown, RegExp][] = [
    [{ type: 'FX_BURST', fx: 'laser', beats: 4 }, /efeito desconhecido \(laser\)/], [{ type: 'FX_BURST', fx: 'strobe', beats: 0 }, /beats/],
    [{ type: 'FX_BURST', fx: 'strobe', beats: 4, div: 3 }, /div/], [{ type: 'VIDEO_SET', id: '../x' }, /id de vídeo/], [{ type: 'VIDEO_SET' }, /id de vídeo/],
    [{ type: 'PARAM_RAMP', key: 'color', to: 1, beats: 4 }, /não numérico \(color\)/], [{ type: 'PARAM_RAMP', key: 'trail', to: NaN, beats: 4 }, /alvo/],
    [{ type: 'PARAM_RAMP', key: 'trail', to: 1, beats: 99 }, /beats de 0 a 64/], [{ type: 'SCENE_RECALL', index: 0, bank: 4 }, /banco de 0 a 3/],
  ];
  for (const [c, re] of bad) assert.match(validate(c)!, re);

  // roteiro tocando: a automação não troca cena/banco/vídeo (mesmo sem override manual); ajustes passam; o roteiro passa
  t = 100000;
  let running = true;
  log.length = 0;
  const d = createDispatcher(all(), { now: () => t, roteiroRunning: () => running });
  for (const c of [{ type: 'SCENE_RECALL', index: 1 }, { type: 'SCENE_TAKE' }, { type: 'BANK_STEP', delta: 1 }, { type: 'BANK_SET', index: 0 }, { type: 'VIDEO_SET', id: 'v1' }] as ShowCommand[])
    assert.match(reason(d.dispatch(c, 'automation')), /roteiro em andamento/, c.type);
  assert.ok(d.dispatch({ type: 'SET_PARAMETER', key: 'trail', value: 0.5 }, 'automation').ok, 'ajuste passa');
  assert.ok(d.dispatch({ type: 'PARAM_RAMP', key: 'glow', to: 1, beats: 4 }, 'automation').ok);
  assert.ok(d.dispatch({ type: 'BLACKOUT', on: true }, 'automation').ok, 'segurança passa');
  assert.ok(d.dispatch({ type: 'SCENE_RECALL', index: 1 }, 'roteiro').ok, 'o próprio roteiro passa');
  assert.ok(d.dispatch({ type: 'VIDEO_SET', id: 'v2' }, 'roteiro').ok);
  running = false;
  assert.ok(d.dispatch({ type: 'SCENE_RECALL', index: 1 }, 'automation').ok, 'roteiro parado: automação volta a trocar cena');
  assert.deepEqual(log, ['SET_PARAMETER@automation', 'PARAM_RAMP@automation', 'BLACKOUT@automation', 'SCENE_RECALL@roteiro', 'VIDEO_SET@roteiro', 'SCENE_RECALL@automation']);
  // o histórico mostra o que o roteiro fez
  assert.deepEqual(d.history().filter((h) => h.source === 'roteiro').map((h) => h.cmd.type), ['SCENE_RECALL', 'VIDEO_SET']);

  // knob/slider da tela: markManual renova o override sem passar comando
  assert.equal(d.manualLeft(), 0);
  d.markManual();
  assert.equal(d.manualLeft(), 8000);
  assert.match(reason(d.dispatch({ type: 'SET_PARAMETER', key: 'trail', value: 0.1 }, 'automation')), /override manual/);
  t += 8000;
  assert.ok(d.dispatch({ type: 'SET_PARAMETER', key: 'trail', value: 0.1 }, 'automation').ok);
}

console.log('commands: ok');
