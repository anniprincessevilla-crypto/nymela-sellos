// Sellos para clientes — Nyméla HOME (standalone, fuera de Muse)
// Servidor Node.js. Base de datos: SQLite local (node:sqlite) o Turso (SQLite
// en la nube, @libsql/client) cuando están las variables TURSO_DATABASE_URL y
// TURSO_AUTH_TOKEN. Sin esas variables, sigue con el archivo local como antes.
// El PIN de la zona de dueña se lee SOLO de la variable de entorno OWNER_PIN.
// Nunca se escribe en código, archivos, respuestas ni registros.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'sellos.db');
const OWNER_PIN = process.env.OWNER_PIN || '';

if (!OWNER_PIN || OWNER_PIN.length < 4) {
  console.error('Falta OWNER_PIN: define la variable de entorno OWNER_PIN con el PIN de 4 dígitos y vuelve a iniciar.');
  process.exit(1);
}

// ---------- base de datos ----------
// Misma API en los dos modos, siempre con await (el modo local es síncrono
// por dentro, pero await sobre un valor no-promesa funciona igual):
//   dbGet(sql, ...args)  -> una fila (objeto) o undefined
//   dbAll(sql, ...args)  -> lista de filas (objetos)
//   dbRun(sql, ...args)  -> ejecuta INSERT/UPDATE/DELETE
//   dbExec(sql)          -> ejecuta varias sentencias (esquema)
const USE_TURSO = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
let dbGet;
let dbAll;
let dbRun;
let dbExec;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  birthday TEXT,
  card_number INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stamps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  card_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  stamp_id INTEGER,
  card_number INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS owner_sessions (
  token TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stamps_client ON stamps(client_id, card_number);
CREATE INDEX IF NOT EXISTS idx_history_client ON history(client_id);
`;

if (USE_TURSO) {
  const { createClient } = await import('@libsql/client');
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  // Turso devuelve cada fila como objeto con acceso por índice y por nombre;
  // se normaliza a objetos planos con los nombres de columna, igual que
  // node:sqlite, para que el resto del código no note la diferencia.
  const toObjects = (result) => result.rows.map((row) => {
    const obj = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
  dbGet = async (sql, ...args) => toObjects(await turso.execute({ sql, args }))[0];
  dbAll = async (sql, ...args) => toObjects(await turso.execute({ sql, args }));
  dbRun = async (sql, ...args) => { await turso.execute({ sql, args }); };
  dbExec = async (sql) => { await turso.executeMultiple(sql); };
} else {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const local = new DatabaseSync(DB_PATH);
  local.exec('PRAGMA journal_mode = WAL;');
  local.exec('PRAGMA foreign_keys = ON;');
  dbGet = (sql, ...args) => local.prepare(sql).get(...args);
  dbAll = (sql, ...args) => local.prepare(sql).all(...args);
  dbRun = (sql, ...args) => { local.prepare(sql).run(...args); };
  dbExec = (sql) => { local.exec(sql); };
}

await dbExec(SCHEMA_SQL);

// ---------- utilidades ----------
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para no confundir
async function newCode() {
  for (let i = 0; i < 50; i++) {
    let code = 'NH-';
    for (let j = 0; j < 6; j++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const row = await dbGet('SELECT id FROM clients WHERE code = ?', code);
    if (!row) return code;
  }
  throw new Error('No se pudo generar un código único');
}

function pinMatches(input) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(OWNER_PIN);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// Límite de intentos del PIN: 5 fallos por IP cada 15 minutos.
const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (now - rec.windowStart > 15 * 60 * 1000) { attempts.delete(ip); return false; }
  return rec.count >= 5;
}
function recordFailedAttempt(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.windowStart > 15 * 60 * 1000) attempts.set(ip, { count: 1, windowStart: now });
  else rec.count += 1;
}

async function newToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await dbRun('INSERT INTO owner_sessions (token, expires_at) VALUES (?, ?)', token, expires);
  return token;
}
async function validToken(token) {
  if (!token) return false;
  await dbRun("DELETE FROM owner_sessions WHERE expires_at <= datetime('now')");
  const row = await dbGet('SELECT token FROM owner_sessions WHERE token = ?', token);
  return !!row;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

async function clientPublic(row) {
  const stamps = (await dbGet('SELECT COUNT(*) AS n FROM stamps WHERE client_id = ? AND card_number = ?', row.id, row.card_number)).n;
  return {
    code: row.code,
    name: row.name,
    birthday: row.birthday || null,
    card_number: row.card_number,
    stamps,
    stamps_total: 8,
  };
}

async function clientHistory(clientId) {
  return dbAll("SELECT type, label, card_number, created_at FROM history WHERE client_id = ? ORDER BY id DESC LIMIT 50", clientId);
}

async function addStamp(client) {
  const count = (await dbGet('SELECT COUNT(*) AS n FROM stamps WHERE client_id = ? AND card_number = ?', client.id, client.card_number)).n;
  if (count >= 8) return { error: 'La tarjeta ya está completa' };
  const stamp = await dbGet('INSERT INTO stamps (client_id, card_number) VALUES (?, ?) RETURNING id', client.id, client.card_number);
  await dbRun("INSERT INTO history (client_id, type, label, stamp_id, card_number) VALUES (?, 'stamp', 'Sello por compra', ?, ?)", client.id, stamp.id, client.card_number);
  const newCount = count + 1;
  let gift = false;
  if (newCount === 8) {
    gift = true;
    await dbRun("INSERT INTO history (client_id, type, label, stamp_id, card_number) VALUES (?, 'gift', 'Regalo: una vela gratis por completar los 8 sellos', NULL, ?)", client.id, client.card_number);
    await dbRun('UPDATE clients SET card_number = card_number + 1 WHERE id = ?', client.id);
  }
  const updated = await dbGet('SELECT * FROM clients WHERE id = ?', client.id);
  return { client: await clientPublic(updated), gift };
}

async function removeLastStamp(client) {
  const stamp = await dbGet('SELECT * FROM stamps WHERE client_id = ? ORDER BY id DESC LIMIT 1', client.id);
  if (!stamp) return { error: 'No hay sellos para quitar' };
  // Si ese sello fue el octavo, también se quita el regalo y se vuelve a la tarjeta anterior.
  const wasGift = stamp.card_number < client.card_number;
  await dbRun('DELETE FROM stamps WHERE id = ?', stamp.id);
  await dbRun('DELETE FROM history WHERE stamp_id = ?', stamp.id);
  if (wasGift) {
    await dbRun("DELETE FROM history WHERE client_id = ? AND type = 'gift' AND card_number = ?", client.id, stamp.card_number);
    await dbRun('UPDATE clients SET card_number = ? WHERE id = ?', stamp.card_number, client.id);
  }
  const updated = await dbGet('SELECT * FROM clients WHERE id = ?', client.id);
  return { client: await clientPublic(updated) };
}

async function findClientByCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return (await dbGet('SELECT * FROM clients WHERE code = ?', clean)) || null;
}

// ---------- archivos estáticos ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  if (rel.includes('..')) { res.writeHead(400); return res.end(); }
  const file = path.join(__dirname, 'public', rel);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- servidor ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const ip = req.socket.remoteAddress || 'unknown';

    // Salud
    if (p === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true });

    // --- Registro de clienta ---
    if (p === '/api/clients' && req.method === 'POST') {
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'Escribe tu nombre' });
      let birthday = null;
      if (body.birthday) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.birthday))) return sendJson(res, 400, { error: 'Cumpleaños inválido' });
        birthday = String(body.birthday);
      }
      const code = await newCode();
      const row = await dbGet('INSERT INTO clients (code, name, birthday) VALUES (?, ?, ?) RETURNING *', code, name, birthday);
      return sendJson(res, 201, { client: await clientPublic(row), history: [] });
    }

    // --- Ver mi tarjeta por código ---
    if (p.startsWith('/api/clients/') && req.method === 'GET') {
      const code = decodeURIComponent(p.slice('/api/clients/'.length)).split('/')[0];
      const client = await findClientByCode(code);
      if (!client) return sendJson(res, 404, { error: 'Ese código no existe. Revisa el código o regístrate.' });
      return sendJson(res, 200, { client: await clientPublic(client), history: await clientHistory(client.id) });
    }

    // --- Zona de dueña: entrar con PIN ---
    if (p === '/api/owner/unlock' && req.method === 'POST') {
      if (tooManyAttempts(ip)) return sendJson(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      const body = await readJson(req);
      if (!pinMatches(body.pin)) {
        recordFailedAttempt(ip);
        return sendJson(res, 401, { error: 'PIN incorrecto' });
      }
      attempts.delete(ip);
      return sendJson(res, 200, { token: await newToken() });
    }

    // --- Rutas de dueña (con token) ---
    if (p.startsWith('/api/owner/')) {
      const token = req.headers['x-owner-token'];
      if (!(await validToken(token))) return sendJson(res, 401, { error: 'Acceso de dueña requerido' });

      // Lista de clientas
      if (p === '/api/owner/clients' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        let rows = await dbAll('SELECT * FROM clients ORDER BY name COLLATE NOCASE');
        if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
        const today = new Date();
        const md = String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        return sendJson(res, 200, {
          clients: await Promise.all(rows.map(async (r) => ({ ...(await clientPublic(r)), birthday_today: !!r.birthday && r.birthday.slice(5) === md }))),
        });
      }

      // Cumpleaños
      if (p === '/api/owner/birthdays' && req.method === 'GET') {
        const rows = await dbAll('SELECT * FROM clients WHERE birthday IS NOT NULL ORDER BY name COLLATE NOCASE');
        const now = new Date();
        const todayMD = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        const upcoming = [];
        const todayList = [];
        for (const r of rows) {
          const md = r.birthday.slice(5);
          if (md === todayMD) {
            const given = await dbGet("SELECT id FROM history WHERE client_id = ? AND type = 'birthday_gift' AND substr(created_at, 1, 4) = ?", r.id, String(year));
            todayList.push({ ...(await clientPublic(r)), birthday_gift_given: !!given });
            continue;
          }
          const [m, d] = md.split('-').map(Number);
          let next = new Date(year, m - 1, d);
          if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next = new Date(year + 1, m - 1, d);
          const days = Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
          if (days <= 30) upcoming.push({ ...(await clientPublic(r)), days, date: next.toISOString().slice(0, 10) });
        }
        upcoming.sort((a, b) => a.days - b.days);
        return sendJson(res, 200, { today: todayList, upcoming });
      }

      // Poner sello
      if (p === '/api/owner/stamp' && req.method === 'POST') {
        const body = await readJson(req);
        const client = await findClientByCode(body.code);
        if (!client) return sendJson(res, 404, { error: 'Ese código no existe' });
        const out = await addStamp(client);
        if (out.error) return sendJson(res, 400, { error: out.error });
        return sendJson(res, 200, out);
      }

      // Quitar sello (borra también su entrada del historial)
      if (p === '/api/owner/unstamp' && req.method === 'POST') {
        const body = await readJson(req);
        const client = await findClientByCode(body.code);
        if (!client) return sendJson(res, 404, { error: 'Ese código no existe' });
        const out = await removeLastStamp(client);
        if (out.error) return sendJson(res, 400, { error: out.error });
        return sendJson(res, 200, out);
      }

      // Poner el sello de quien ya compró (sin tarjeta en este celular)
      if (p === '/api/owner/walkin' && req.method === 'POST') {
        const body = await readJson(req);
        const name = String(body.name || '').trim();
        const code = String(body.code || '').trim().toUpperCase();
        if (code) {
          const client = await findClientByCode(code);
          if (!client) return sendJson(res, 404, { error: 'Ese código no existe. Revisa el código.' });
          const out = await addStamp(client);
          if (out.error) return sendJson(res, 400, { error: out.error });
          return sendJson(res, 200, { ...out, matched: 'code' });
        }
        if (!name) return sendJson(res, 400, { error: 'Escribe el nombre de la clienta o su código' });
        const matches = await dbAll('SELECT * FROM clients WHERE LOWER(name) LIKE ? ORDER BY name COLLATE NOCASE', '%' + name.toLowerCase() + '%');
        if (matches.length === 1) {
          const out = await addStamp(matches[0]);
          if (out.error) return sendJson(res, 400, { error: out.error });
          return sendJson(res, 200, { ...out, matched: 'name' });
        }
        if (matches.length > 1) {
          return sendJson(res, 200, { matches: await Promise.all(matches.map(clientPublic)) });
        }
        // Nueva clienta: se crea su tarjeta y se le pone su primer sello.
        const newClient = await dbGet('INSERT INTO clients (code, name) VALUES (?, ?) RETURNING *', await newCode(), name);
        const out = await addStamp(newClient);
        return sendJson(res, 201, { ...out, matched: 'new', created: true });
      }

      // Regalo de cumpleaños
      if (p === '/api/owner/birthday-gift' && req.method === 'POST') {
        const body = await readJson(req);
        const client = await findClientByCode(body.code);
        if (!client) return sendJson(res, 404, { error: 'Ese código no existe' });
        const year = String(new Date().getFullYear());
        const given = await dbGet("SELECT id FROM history WHERE client_id = ? AND type = 'birthday_gift' AND substr(created_at, 1, 4) = ?", client.id, year);
        if (given) return sendJson(res, 400, { error: 'Su regalo de cumpleaños ya se entregó este año' });
        await dbRun("INSERT INTO history (client_id, type, label, stamp_id, card_number) VALUES (?, 'birthday_gift', 'Regalo especial de cumpleaños', NULL, ?)", client.id, client.card_number);
        return sendJson(res, 200, { ok: true });
      }

      // Historial de una clienta (dueña)
      if (p.startsWith('/api/owner/clients/') && p.endsWith('/history') && req.method === 'GET') {
        const code = decodeURIComponent(p.slice('/api/owner/clients/'.length, -'/history'.length));
        const client = await findClientByCode(code);
        if (!client) return sendJson(res, 404, { error: 'Ese código no existe' });
        return sendJson(res, 200, { client: await clientPublic(client), history: await clientHistory(client.id) });
      }

      // Eliminar clienta (con su historial)
      if (p.startsWith('/api/owner/clients/') && req.method === 'DELETE') {
        const code = decodeURIComponent(p.slice('/api/owner/clients/'.length)).split('/')[0];
        const client = await findClientByCode(code);
        if (!client) return sendJson(res, 404, { error: 'Ese código no existe' });
        await dbRun('DELETE FROM history WHERE client_id = ?', client.id);
        await dbRun('DELETE FROM stamps WHERE client_id = ?', client.id);
        await dbRun('DELETE FROM clients WHERE id = ?', client.id);
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'No encontrado' });
    }

    // --- Páginas ---
    if (req.method === 'GET') return serveStatic(req, res, p);
    res.writeHead(405);
    res.end();
  } catch (err) {
    console.error('Error:', err.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Error del servidor' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Sellos Nyméla HOME listo en el puerto ' + PORT);
  console.log('Base de datos: ' + (USE_TURSO ? 'Turso (nube)' : 'SQLite local'));
  console.log('PIN de dueña configurado: sí (nunca se muestra ni se registra)');
});
