'use strict';
// Celular do DoubleK (DK-082): pareia com o código mostrado no app e manda comandos /doublek/v1/... (os mesmos do
// OSC, ver docs/OSC.md) por POST /cmd; lê /state a 2 Hz. Sem framework. Nada vindo do app vira HTML: só textContent.

const $ = (id) => document.getElementById(id);
const P = '/doublek/v1/';
const KEY = 'doublek.token'; // sessionStorage: fechou a aba, esqueceu
let token = null;
try { token = sessionStorage.getItem(KEY); } catch {}
let state = {}, fails = 0, polling = false, blockedUntil = 0;

function saveToken(t) {
  token = t;
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch {}
}

/** fetch com tempo-limite de 2 s; status 0 = não chegou no app. */
async function api(method, path, body) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const headers = {};
    if (token) headers.authorization = 'Bearer ' + token;
    if (body) headers['content-type'] = 'application/json';
    const r = await fetch(path, { method, headers, body: body && JSON.stringify(body), signal: ctl.signal, cache: 'no-store' });
    let j = {};
    try { j = await r.json(); } catch {}
    return { status: r.status, j };
  } catch {
    return { status: 0, j: {} };
  } finally {
    clearTimeout(timer);
  }
}

function show(paired) {
  $('pair').hidden = paired;
  $('ctl').hidden = !paired;
  if (!paired) { $('code').value = ''; $('code').focus(); }
}

/** 401: o app desconectou (Desconectar todos, desligou ou reiniciou) → volta ao pareamento. */
function lost() {
  saveToken(null);
  show(false);
  $('pairErr').textContent = 'Desconectado pelo app: pareie de novo.';
}

// ---------- pareamento ----------
async function pair() {
  const code = $('code').value.replace(/\D/g, '');
  if (code.length !== 6) { $('pairErr').textContent = 'O código tem 6 dígitos.'; return; }
  $('pairBtn').disabled = true;
  const r = await api('POST', '/pair', { code });
  $('pairBtn').disabled = false;
  if (r.status === 200 && r.j.token) {
    saveToken(r.j.token);
    $('pairErr').textContent = '';
    fails = 0;
    show(true);
    poll();
    return;
  }
  if (r.status === 429) { blockedUntil = Date.now() + 60000; countdown(); return; }
  $('pairErr').textContent = r.status === 401 ? 'Código errado ou vencido: confira no app.' : r.status ? r.j.error || 'Erro ' + r.status : 'Sem conexão com o app.';
  $('code').select();
}

function countdown() {
  const left = Math.ceil((blockedUntil - Date.now()) / 1000);
  if (left <= 0) { $('pairErr').textContent = ''; return; }
  $('pairErr').textContent = `Muitas tentativas: espere ${left} s (ou mostre um código novo no app).`;
  setTimeout(countdown, 1000);
}

$('code').addEventListener('input', () => {
  const v = $('code').value.replace(/\D/g, '').slice(0, 6);
  $('code').value = v;
  if (v.length === 6) pair();
});
$('pairBtn').addEventListener('click', pair);

// ---------- estado (2 Hz) ----------
function offline(on) {
  $('offline').hidden = !on;
  document.body.classList.toggle('off', on);
  for (const el of document.querySelectorAll('#ctl button, #ctl input')) el.disabled = on;
}

async function poll() {
  if (polling || !token) return;
  polling = true;
  const r = await api('GET', '/state');
  polling = false;
  if (r.status === 401) return lost();
  if (r.status !== 200) { if (++fails >= 3) offline(true); return; }
  fails = 0;
  offline(false);
  render(r.j);
}

/** Garante `n` botões na caixa e preenche cada um. */
function buttons(box, n, fill) {
  while (box.children.length < n) box.append(document.createElement('button'));
  while (box.children.length > n) box.lastChild.remove();
  [...box.children].forEach(fill);
}

function render(s) {
  state = s || {};
  $('bpm').textContent = typeof s.bpm === 'number' ? s.bpm.toFixed(1) : '---.-';
  $('music').textContent = s.music || '';
  $('drop').classList.toggle('on', !!s.drop);
  $('status').textContent = s.state || '';
  $('blackout').classList.toggle('on', !!s.blackout);
  $('logo').classList.toggle('on', !!s.logoOnly);
  const names = Array.isArray(s.bankNames) && s.bankNames.length ? s.bankNames : null;
  buttons($('banks'), names ? names.length : 4, (b, i) => {
    b.textContent = names ? `${i + 1} · ${names[i]}` : `Banco ${i + 1}`;
    b.dataset.addr = `${P}bank/${i + 1}`;
    b.classList.toggle('on', s.bank === i + 1);
  });
  buttons($('pads'), 8, (b, i) => {
    b.textContent = (Array.isArray(s.sceneNames) && s.sceneNames[i]) || `Cena ${i + 1}`;
    b.dataset.addr = `${P}scene/${i + 1}`;
    b.classList.toggle('on', s.scene === i + 1);
  });
  // slider acompanha o app, menos enquanto o dedo está nele
  for (const el of document.querySelectorAll('[data-knob]')) {
    const v = s.knobs && s.knobs[el.dataset.knob];
    if (typeof v === 'number' && Date.now() - (+el.dataset.touched || 0) > 1500) el.value = v;
  }
}

// ---------- comandos ----------
function flash(el, ok) {
  if (!el) return;
  el.classList.add(ok ? 'sent' : 'fail');
  setTimeout(() => el.classList.remove('sent', 'fail'), 250);
}

async function send(addr, args, el) {
  const r = await api('POST', '/cmd', { addr, args });
  if (r.status === 401) return lost();
  flash(el, r.status === 200);
  $('msg').textContent = r.status === 200 ? '' : r.status === 429 ? 'Devagar: comandos demais por segundo.' : r.status ? r.j.error || 'Erro ' + r.status : 'Não chegou no app (sem conexão).';
  return r.status === 200;
}

const bool = (on) => ({ t: on ? 'T' : 'F', v: on });

$('ctl').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.id === 'blackout' || b.id === 'logo') {
    const key = b.id === 'blackout' ? 'blackout' : 'logoOnly', on = !state[key];
    if (await send(P + b.id, [bool(on)], b)) { state[key] = on; b.classList.toggle('on', on); } // o próximo /state confirma
    return;
  }
  if (b.dataset.addr) send(b.dataset.addr, b.dataset.arg ? [{ t: 'i', v: +b.dataset.arg }] : [], b);
});

// sliders: no máximo 10 envios por segundo (o servidor corta em 20); o último valor sempre vai
for (const el of document.querySelectorAll('[data-knob]')) {
  let last = 0, timer = 0;
  const go = () => {
    last = Date.now();
    timer = 0;
    send(P + 'parameter/' + el.dataset.knob, [{ t: 'f', v: +el.value }]);
  };
  el.addEventListener('input', () => {
    el.dataset.touched = Date.now();
    if (timer) return;
    const wait = 100 - (Date.now() - last);
    if (wait <= 0) go();
    else timer = setTimeout(go, wait);
  });
}

setInterval(poll, 500);
show(!!token);
if (token) poll();
