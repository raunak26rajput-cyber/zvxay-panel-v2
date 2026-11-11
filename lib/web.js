'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const views = require('./views');
const { verifyPassword, hashPassword } = require('./store');
const lifecycle = require('./lifecycle');

const SESSION_COOKIE = 'zvxay_session';
const MAX_EDIT_BYTES = 512 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function createWeb(store, engine) {
  const app = express();
  const sessions = new Map(); // token -> userId

  app.disable('x-powered-by');
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const settings = () => store.db.settings;
  const panelName = () => settings().panel_name || 'ZVXAY Panel';

  /* ----------------------------- sessions ----------------------------- */
  function sign(token) {
    return crypto.createHmac('sha256', settings().session_secret).update(token).digest('base64url');
  }

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, userId);
    return `${token}.${sign(token)}`;
  }

  function readSession(req) {
    const raw = (req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (!raw) return null;
    const value = decodeURIComponent(raw.slice(SESSION_COOKIE.length + 1));
    const [token, sig] = value.split('.');
    if (!token || !sig) return null;
    const expected = sign(token);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const userId = sessions.get(token);
    if (!userId) return null;
    return { token, userId };
  }

  function attachUser(req, res, next) {
    const sess = readSession(req);
    req.session = sess;
    req.user = sess ? store.findUserById(sess.userId) : null;
    if (sess && !req.user) sessions.delete(sess.token);
    next();
  }

  function setSessionCookie(res, value) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`);
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  function requireAuth(req, res, next) {
    const isApi = req.path.startsWith('/api/client/');
    if (!req.user) {
      if (isApi) return res.status(401).json({ error: 'Not logged in' });
      return res.redirect('/login');
    }
    if (req.user.status === 'banned') {
      sessions.delete(req.session.token);
      clearSessionCookie(res);
      if (isApi) return res.status(403).json({ error: 'This account has been banned.' });
      return res.redirect('/login');
    }
    if (lifecycle.applyExpiry(store, engine, req.user)) {
      sessions.delete(req.session.token);
      clearSessionCookie(res);
      if (isApi) return res.status(403).json({ error: 'Access denied' });
      return res.redirect('/login');
    }
    next();
  }

  app.use(attachUser);

  /* ------------------------------- auth ------------------------------- */
  app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    res.send(views.loginPage({ panelName: panelName(), error: null }));
  });

  app.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = store.findUserByUsername(username || '');
    // One uniform error for bad credentials AND expired accounts: the
    // panel never reveals which one it was.
    const fail = () => res.send(views.loginPage({ panelName: panelName(), error: 'Invalid username or password' }));
    if (!user || !verifyPassword(password || '', user.password_hash)) {
      return fail();
    }
    if (user.status === 'banned') {
      return res.send(views.loginPage({ panelName: panelName(), error: 'This account has been banned. Please contact the admin.' }));
    }
    // Silent expiry check: flips the status and stops all of the user's
    // servers, then answers with the same generic error as bad credentials.
    lifecycle.applyExpiry(store, engine, user);
    if (user.status === 'expired') {
      return fail();
    }
    setSessionCookie(res, createSession(user.id));
    return res.redirect('/');
  });

  app.post('/logout', (req, res) => {
    if (req.session) sessions.delete(req.session.token);
    clearSessionCookie(res);
    res.redirect('/login');
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  /* ---------------------------- dashboard ----------------------------- */
  app.get('/', requireAuth, (req, res) => {
    // The admin account gets the owner view: every user's servers.
    let servers = req.user.is_admin ? store.db.servers : store.serversOfUser(req.user.id);
    if (req.user.is_admin) {
      servers = servers.map((s) => ({
        ...s,
        owner_name: (store.findUserById(s.user_id) || {}).username || '?',
      }));
    }
    res.send(views.dashboardPage({ panelName: panelName(), user: req.user, servers }));
  });

  /* --------------------------- server page ---------------------------- */
  function loadOwnedServer(req, res) {
    const server = store.findServerByIdentifier(req.params.identifier);
    if (!server) { res.status(404).send('Server not found'); return null; }
    if (!req.user.is_admin && server.user_id !== req.user.id) {
      res.status(403).send('Forbidden');
      return null;
    }
    return server;
  }

  app.get('/server/:identifier', requireAuth, (req, res) => {
    const server = loadOwnedServer(req, res);
    if (!server) return;
    res.send(views.serverPage({
      panelName: panelName(),
      user: req.user,
      server,
      message: req.query.msg || null,
      error: req.query.err || null,
    }));
  });

  app.post('/server/:identifier/rename', requireAuth, (req, res) => {
    const server = loadOwnedServer(req, res);
    if (!server) return;
    const name = String(req.body.name || '').trim();
    if (name) { server.name = name.slice(0, 60); store.save(); }
    res.redirect(`/server/${server.identifier}?msg=${encodeURIComponent('Server renamed.')}`);
  });

  app.post('/server/:identifier/startup', requireAuth, (req, res) => {
    const server = loadOwnedServer(req, res);
    if (!server) return;
    for (const key of Object.keys(server.environment || {})) {
      const field = `env_${key}`;
      if (req.body[field] !== undefined) server.environment[key] = String(req.body[field]);
    }
    store.save();
    res.redirect(`/server/${server.identifier}?msg=${encodeURIComponent('Startup variables saved. Restart the server to apply.')}`);
  });

  app.post('/account/password', requireAuth, (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (!verifyPassword(current_password || '', req.user.password_hash)) {
      return res.redirect(`/?msg=${encodeURIComponent('Current password was wrong.')}`);
    }
    if (!new_password || String(new_password).length < 6) {
      return res.redirect(`/?msg=${encodeURIComponent('New password must be at least 6 characters.')}`);
    }
    req.user.password_hash = hashPassword(String(new_password));
    store.save();
    res.redirect(`/?msg=${encodeURIComponent('Password changed.')}`);
  });

  /* ---------------------------- client API ---------------------------- */
  function clientServer(req, res) {
    const server = store.findServerByIdentifier(req.params.identifier);
    if (!server) { res.status(404).json({ error: 'Server not found' }); return null; }
    if (!req.user.is_admin && server.user_id !== req.user.id) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return server;
  }

  app.get('/api/client/server/:identifier/console', requireAuth, (req, res) => {
    const server = clientServer(req, res);
    if (!server) return;
    res.json(engine.getConsole(server.identifier));
  });

  app.post('/api/client/server/:identifier/power', requireAuth, async (req, res) => {
    const server = clientServer(req, res);
    if (!server) return;
    // Account validity is enforced on every server action.
    if (lifecycle.applyExpiry(store, engine, req.user)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.status === 'banned') return res.status(403).json({ error: 'Account banned.' });
    const action = (req.body || {}).action;
    // Per-user cap: at most 2 bots running at the same time (admins exempt).
    // Applies when the action would bring another server online.
    if (action === 'start' || (action === 'restart' && server.status !== 'running')) {
      const owner = store.findUserById(server.user_id);
      if (owner && !owner.is_admin) {
        const runningCount = store.serversOfUser(owner.id).filter((s) => s.status === 'running').length;
        if (runningCount >= 2) {
          return res.status(403).json({ error: 'You can run at most 2 bots at the same time.' });
        }
      }
    }
    try {
      if (action === 'start') return res.json(await engine.startServer(server.identifier));
      if (action === 'stop') return res.json(await engine.stopServer(server.identifier));
      if (action === 'restart') return res.json(await engine.restartServer(server.identifier));
      return res.status(400).json({ error: 'Unknown action' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  });

  function safeFilePath(server, name) {
    const dir = store.serverDir(server.identifier);
    const rel = String(name || '');
    if (!rel || rel.includes('\0') || path.isAbsolute(rel)) return null;
    const resolved = path.resolve(dir, rel);
    if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return null;
    return resolved;
  }

  app.get('/api/client/server/:identifier/files', requireAuth, (req, res) => {
    const server = clientServer(req, res);
    if (!server) return;
    const dir = store.serverDir(server.identifier);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
        let size = 0;
        try { size = fs.statSync(path.join(dir, e.name)).size; } catch { /* ignore */ }
        return { name: e.name, is_dir: e.isDirectory(), size };
      }).sort((a, b) => (a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1));
    } catch { /* empty dir */ }
    res.json({ files: entries });
  });

  app.post('/api/client/server/:identifier/files/upload', requireAuth, (req, res) => {
    const server = clientServer(req, res);
    if (!server) return;
    const { name, content_base64 } = req.body || {};
    const target = safeFilePath(server, path.basename(String(name || '')));
    if (!target || !content_base64) return res.status(400).json({ error: 'Invalid upload' });
    const data = Buffer.from(String(content_base64), 'base64');
    if (data.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File too large (max 10 MB)' });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    res.json({ ok: true, message: `Uploaded ${path.basename(target)} (${data.length} bytes)` });
  });

  app.get('/api/client/server/:identifier/files/content', requireAuth, (req, res) => {
    const server = clientServer(req, res);
    if (!server) return;
    const target = safeFilePath(server, req.query.name);
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const buf = fs.readFileSync(target);
    if (buf.length > MAX_EDIT_BYTES) return res.status(413).json({ error: 'File is too large to edit in the browser' });
    if (buf.includes(0)) return res.status(415).json({ error: 'Binary files cannot be edited' });
    res.json({ name: req.query.name, content: buf.toString('utf8') });
  });

  app.post('/api/client/server/:identifier/files/save', requireAuth, (req, res) => {
    const server = clientServer(req, res);
    if (!server) return;
    const { name, content } = req.body || {};
    const target = safeFilePath(server, name);
    if (!target) return res.status(400).json({ error: 'Invalid file name' });
    const data = Buffer.from(String(content ?? ''), 'utf8');
    if (data.length > MAX_UPLOAD_BYTES) return res.status(413).json({ error: 'File too large' });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    res.json({ ok: true, message: `Saved ${name}` });
  });

  app.post('/api/client/server/:identifier/files/delete', requireAuth, (req, res) => {
    const server = clientServer(req, res);
    if (!server) return;
    const target = safeFilePath(server, (req.body || {}).name);
    if (!target || target === store.serverDir(server.identifier)) {
      return res.status(400).json({ error: 'Invalid file name' });
    }
    fs.rmSync(target, { recursive: true, force: true });
    res.json({ ok: true, message: 'Deleted' });
  });

  return app;
}

module.exports = { createWeb };
