// Sellos Nyméla HOME — aplicación del navegador (es-419)
// El PIN nunca llega a este archivo: solo se envía al servidor para desbloquear.

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  token: sessionStorage.getItem('nymela_token') || null,
  myCode: localStorage.getItem('nymela_code') || null,
  currentClient: null,
  scanStream: null,
  scanTimer: null,
};

function showView(id) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
  window.scrollTo(0, 0);
  if (id !== 'view-scan') stopScan();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

function showErr(sel, msg) {
  const el = $(sel);
  if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { 'X-Owner-Token': state.token } : {}), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Algo salió mal');
  return data;
}

// ---------- navegación ----------
$$('[data-go]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    const go = el.dataset.go;
    if (go === 'home') showView('view-home');
    else if (go === 'client-start') showView('view-client-start');
    else if (go === 'client-lookup') showView('view-client-lookup');
    else if (go === 'owner-pin') { resetPin(); showView('view-owner-pin'); }
    else if (go === 'owner') loadOwner().then(() => showView('view-owner'));
    else if (go === 'scan') { showView('view-scan'); startScan(); }
    else if (go === 'walkin') { showErr('#walkin-error'); showErr('#walkin-ok'); $('#walkin-matches').classList.add('hidden'); showView('view-walkin'); }
  });
});

// ---------- tarjeta de clienta ----------
function renderStamps(container, stamps, total = 8) {
  container.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('span');
    d.className = 'dot' + (i < stamps ? ' full' : '') + (i === total - 1 ? ' gift' : '');
    d.textContent = i < stamps ? '♥' : (i === total - 1 ? '🎁' : '');
    container.appendChild(d);
  }
}

function drawQR(code) {
  const box = $('#card-qr');
  box.innerHTML = '';
  try {
    const qr = qrcode(0, 'M');
    qr.addData(code);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch {
    box.textContent = code;
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d + '/' + m + '/' + y;
}

function historyHtml(history) {
  if (!history || !history.length) return '<li>Todavía no tengo sellos. Mi primer sello llega con mi primera compra.</li>';
  return history.map((h) => {
    const date = new Date(h.created_at.replace(' ', 'T') + 'Z');
    const when = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
    const label = h.type === 'gift' ? '🎁 ' + h.label : h.type === 'birthday_gift' ? '🎂 ' + h.label : '♥ ' + h.label;
    return '<li>' + label + '<small>' + when + ' · Tarjeta ' + h.card_number + '</small></li>';
  }).join('');
}

function showClientCard(client, history) {
  state.myCode = client.code;
  localStorage.setItem('nymela_code', client.code);
  $('#card-name').textContent = client.name;
  $('#card-code').textContent = client.code + (client.card_number > 1 ? ' · Tarjeta ' + client.card_number : '');
  drawQR(client.code);
  renderStamps($('#card-stamps'), client.stamps);
  const left = 8 - client.stamps;
  $('#card-count').textContent = client.stamps === 0
    ? 'Ya tengo mi tarjeta. Me faltan 8 sellos para mi regalo.'
    : 'Ya tengo ' + client.stamps + ' de 8 sellos. Me faltan ' + left + ' para mi regalo.';
  const gift = $('#card-gift');
  if (client.card_number > 1) {
    gift.textContent = '¡Ya completé una tarjeta y Nyméla HOME me regaló una vela! Esta es mi tarjeta ' + client.card_number + '.';
    gift.classList.remove('hidden');
  } else gift.classList.add('hidden');
  const bday = $('#card-birthday');
  if (client.birthday) {
    const today = new Date();
    const md = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    if (client.birthday.slice(5) === md) {
      bday.textContent = '¡Hoy es mi cumpleaños! Nyméla HOME me tiene un regalo especial.';
      bday.classList.remove('hidden');
    } else {
      bday.textContent = 'Mi cumpleaños: ' + fmtDate(client.birthday) + '. Ese día Nyméla HOME me tiene un regalo especial.';
      bday.classList.remove('hidden');
    }
  } else bday.classList.add('hidden');
  $('#card-history').innerHTML = historyHtml(history);
  showView('view-client-card');
}

// Registro
$('#form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('#reg-error');
  const name = $('#reg-name').value.trim();
  const birthday = $('#reg-birthday').value || undefined;
  if (!name) { showErr('#reg-error', 'Escribe tu nombre'); return; }
  try {
    const data = await api('/api/clients', { method: 'POST', body: JSON.stringify({ name, birthday }) });
    toast('¡Listo! Nyméla HOME creó tu tarjeta.');
    showClientCard(data.client, data.history);
  } catch (err) { showErr('#reg-error', err.message); }
});

// Ver por código
$('#form-lookup').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('#lookup-error');
  const code = $('#lookup-code').value.trim().toUpperCase();
  try {
    const data = await api('/api/clients/' + encodeURIComponent(code));
    showClientCard(data.client, data.history);
  } catch (err) { showErr('#lookup-error', err.message); }
});

// ---------- PIN de dueña ----------
let pin = '';
function resetPin() {
  pin = '';
  renderPin();
  showErr('#pin-error');
}
function renderPin() {
  $$('#pin-dots span').forEach((s, i) => s.classList.toggle('on', i < pin.length));
}
$('#pinpad').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.digit !== undefined) {
    if (pin.length < 4) { pin += btn.dataset.digit; renderPin(); }
    if (pin.length === 4) {
      try {
        const data = await api('/api/owner/unlock', { method: 'POST', body: JSON.stringify({ pin }) });
        state.token = data.token;
        sessionStorage.setItem('nymela_token', data.token);
        await loadOwner();
        showView('view-owner');
      } catch (err) {
        showErr('#pin-error', err.message);
        pin = '';
        renderPin();
      }
    }
  } else if (btn.dataset.action === 'clear') { pin = ''; renderPin(); }
  else if (btn.dataset.action === 'back') { pin = pin.slice(0, -1); renderPin(); }
});

$('#btn-logout').addEventListener('click', () => {
  state.token = null;
  sessionStorage.removeItem('nymela_token');
  showView('view-home');
});

// ---------- Panel de dueña ----------
async function loadOwner() {
  try {
    const q = $('#owner-search').value.trim();
    const data = await api('/api/owner/clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
    renderClients(data.clients);
    const b = await api('/api/owner/birthdays');
    renderBirthdays(b);
  } catch (err) {
    if (err.message.includes('Acceso')) { state.token = null; sessionStorage.removeItem('nymela_token'); showView('view-owner-pin'); }
    else toast(err.message);
  }
}

function renderClients(clients) {
  const ul = $('#owner-clients');
  ul.innerHTML = '';
  $('#owner-empty').classList.toggle('hidden', clients.length > 0);
  clients.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML =
      '<div class="c-name">' + escapeHtml(c.name) +
      (c.birthday_today ? '<span class="badge">🎂 Hoy cumple años</span>' : '') + '</div>' +
      '<div class="c-meta">' + c.code + ' · Tarjeta ' + c.card_number + ' · ' + c.stamps + ' de 8 sellos</div>' +
      '<div class="c-dots">' + Array.from({ length: 8 }, (_, i) => '<span class="' + (i < c.stamps ? 'full' : '') + '"></span>').join('') + '</div>' +
      '<div class="row">' +
      '<button class="btn" data-act="stamp">+ Sello</button>' +
      '<button class="btn ghost" data-act="detail">Ver</button>' +
      '</div>';
    li.querySelector('[data-act="stamp"]').addEventListener('click', async () => {
      try {
        const out = await api('/api/owner/stamp', { method: 'POST', body: JSON.stringify({ code: c.code }) });
        toast(out.gift ? '¡Tarjeta completa! Nyméla HOME le regala una vela a ' + c.name + '.' : 'Nyméla HOME le puso un sello a ' + c.name + '.');
        loadOwner();
      } catch (err) { toast(err.message); }
    });
    li.querySelector('[data-act="detail"]').addEventListener('click', () => openDetail(c.code));
    ul.appendChild(li);
  });
}

function renderBirthdays(b) {
  const today = $('#birthdays-today');
  const up = $('#birthdays-upcoming');
  today.innerHTML = '';
  up.innerHTML = '';
  if (b.today.length) {
    b.today.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'bday';
      div.innerHTML = '<span class="today">🎂 Hoy: ' + escapeHtml(c.name) + ' (' + c.code + ')</span>';
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = c.birthday_gift_given ? 'Regalo entregado ✓' : 'Entregar regalo';
      btn.disabled = c.birthday_gift_given;
      btn.addEventListener('click', async () => {
        try {
          await api('/api/owner/birthday-gift', { method: 'POST', body: JSON.stringify({ code: c.code }) });
          toast('Nyméla HOME le entregó su regalo de cumpleaños a ' + c.name + '.');
          loadOwner();
        } catch (err) { toast(err.message); }
      });
      div.appendChild(btn);
      today.appendChild(div);
    });
  } else {
    today.innerHTML = '<div class="bday"><span>Nadie cumple años hoy.</span></div>';
  }
  if (b.upcoming.length) {
    up.innerHTML = '<h3>Próximos cumpleaños</h3>' + b.upcoming.map((c) =>
      '<div class="bday"><span>' + escapeHtml(c.name) + ' · ' + fmtDate(c.date) + '</span><span>en ' + c.days + ' días</span></div>'
    ).join('');
  }
}

$('#owner-search').addEventListener('input', () => loadOwner());

// Detalle de clienta
async function openDetail(code) {
  try {
    const data = await api('/api/owner/clients/' + encodeURIComponent(code) + '/history');
    state.currentClient = data.client;
    $('#detail-name').textContent = data.client.name;
    $('#detail-code').textContent = data.client.code + ' · Tarjeta ' + data.client.card_number;
    renderStamps($('#detail-stamps'), data.client.stamps);
    $('#detail-count').textContent = data.client.stamps + ' de 8 sellos';
    $('#detail-history').innerHTML = historyHtml(data.history);
    showErr('#detail-error'); showErr('#detail-ok');
    $('#btn-delete').textContent = 'Eliminar clienta';
    $('#btn-delete').dataset.armed = '';
    showView('view-owner-detail');
  } catch (err) { toast(err.message); }
}

$('#btn-stamp').addEventListener('click', async () => {
  const c = state.currentClient; if (!c) return;
  try {
    const out = await api('/api/owner/stamp', { method: 'POST', body: JSON.stringify({ code: c.code }) });
    showErr('#detail-ok', out.gift ? '¡Tarjeta completa! Nyméla HOME le regala una vela.' : 'Nyméla HOME le puso un sello.');
    openDetail(c.code);
  } catch (err) { showErr('#detail-error', err.message); }
});

$('#btn-unstamp').addEventListener('click', async () => {
  const c = state.currentClient; if (!c) return;
  try {
    await api('/api/owner/unstamp', { method: 'POST', body: JSON.stringify({ code: c.code }) });
    showErr('#detail-ok', 'Se quitó el último sello y su entrada del historial.');
    openDetail(c.code);
  } catch (err) { showErr('#detail-error', err.message); }
});

$('#btn-delete').addEventListener('click', async () => {
  const c = state.currentClient; if (!c) return;
  const btn = $('#btn-delete');
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = '¿Seguro? Toca otra vez para eliminar';
    return;
  }
  try {
    await api('/api/owner/clients/' + encodeURIComponent(c.code), { method: 'DELETE' });
    toast('Se eliminó a ' + c.name + ' con su historial.');
    await loadOwner();
    showView('view-owner');
  } catch (err) { showErr('#detail-error', err.message); }
});

// ---------- Escanear QR ----------
function stopScan() {
  if (state.scanTimer) { clearInterval(state.scanTimer); state.scanTimer = null; }
  if (state.scanStream) { state.scanStream.getTracks().forEach((t) => t.stop()); state.scanStream = null; }
}

async function startScan() {
  stopScan();
  showErr('#scan-error');
  $('#scan-status').textContent = 'Encendiendo la cámara...';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    state.scanStream = stream;
    const video = $('#scan-video');
    video.srcObject = stream;
    await video.play();
    $('#scan-status').textContent = 'Apunta al QR de la clienta.';
    const canvas = $('#scan-canvas');
    const ctx = canvas.getContext('2d');
    state.scanTimer = setInterval(() => {
      if (!video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(img.data, canvas.width, canvas.height);
      if (found && found.data) onCodeFound(found.data.trim());
    }, 400);
  } catch {
    $('#scan-status').textContent = 'No se pudo abrir la cámara. Elige una foto del QR o escribe el código.';
  }
}

async function onCodeFound(code) {
  stopScan();
  const clean = code.trim().toUpperCase();
  try {
    await api('/api/clients/' + encodeURIComponent(clean));
    openDetail(clean);
  } catch (err) { showErr('#scan-error', err.message); }
}

$('#scan-photo').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    const canvas = $('#scan-canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(data.data, canvas.width, canvas.height);
    if (found && found.data) onCodeFound(found.data.trim());
    else showErr('#scan-error', 'No se ve ningún QR en esa foto. Intenta con otra.');
  };
  img.src = URL.createObjectURL(file);
});

$('#form-scan-code').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('#scan-error');
  const code = $('#scan-code').value.trim().toUpperCase();
  if (!code) return;
  try {
    await api('/api/clients/' + encodeURIComponent(code));
    openDetail(code);
  } catch (err) { showErr('#scan-error', err.message); }
});

// ---------- Poner el sello de quien ya compró ----------
$('#form-walkin').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('#walkin-error'); showErr('#walkin-ok');
  $('#walkin-matches').classList.add('hidden');
  const name = $('#walkin-name').value.trim();
  const code = $('#walkin-code').value.trim().toUpperCase();
  try {
    const out = await api('/api/owner/walkin', { method: 'POST', body: JSON.stringify({ name, code }) });
    if (out.matches) {
      $('#walkin-matches').classList.remove('hidden');
      const ul = $('#walkin-list');
      ul.innerHTML = '';
      out.matches.forEach((m) => {
        const li = document.createElement('li');
        li.innerHTML = '<div class="c-name">' + escapeHtml(m.name) + '</div><div class="c-meta">' + m.code + ' · ' + m.stamps + ' de 8 sellos</div>';
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.textContent = 'Poner sello a ' + m.name;
        btn.addEventListener('click', async () => {
          try {
            const r = await api('/api/owner/stamp', { method: 'POST', body: JSON.stringify({ code: m.code }) });
            showErr('#walkin-ok', r.gift ? '¡Tarjeta completa! Nyméla HOME le regala una vela.' : 'Nyméla HOME le puso un sello a ' + m.name + '.');
            $('#walkin-matches').classList.add('hidden');
          } catch (err) { showErr('#walkin-error', err.message); }
        });
        li.appendChild(btn);
        ul.appendChild(li);
      });
      return;
    }
    showErr('#walkin-ok', out.created
      ? 'Nyméla HOME creó la tarjeta de ' + out.client.name + ' (' + out.client.code + ') y le puso su primer sello.'
      : (out.gift ? '¡Tarjeta completa! Nyméla HOME le regala una vela a ' + out.client.name + '.' : 'Nyméla HOME le puso un sello a ' + out.client.name + '.'));
  } catch (err) { showErr('#walkin-error', err.message); }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Inicio: si ya hay sesión de dueña, ir al panel; si hay tarjeta guardada, no forzar nada.
if (state.token) { loadOwner().then(() => showView('view-owner')).catch(() => showView('view-home')); }
showView('view-home');
