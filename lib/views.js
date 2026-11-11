'use strict';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>";
const FONT_LINKS = `
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">`;

function brand() {
  return `<a class="brand" href="/">
      <div class="brand-icon">⚡</div>
      <div class="brand-name">ZVXAY <span>PANEL</span></div>
      <div class="brand-badge">PANEL</div>
    </a>`;
}

function layout({ panelName, user, title, body }) {
  const nav = user
    ? `<nav class="nav">
         <a href="/" class="nav-link">🏠 Home</a>
         <span class="nav-user mono">${esc(user.username)}</span>
         <form method="POST" action="/logout" class="nav-logout"><button class="btn btn-ghost btn-sm" type="submit">Logout</button></form>
       </nav>`
    : `<nav class="nav">
         <a href="/login" class="btn btn-primary btn-sm">Login</a>
       </nav>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${esc(panelName)}</title>
${FONT_LINKS}
</head>
<body>
<header class="site-header">
  <div class="container header-inner">
    ${brand()}
    ${nav}
  </div>
</header>
<main class="container page-content">
${body}
</main>
<footer class="site-footer">
  <div class="container">
    <span>© 2026 <span class="fx">ZVXAY PANEL</span> · Bot Hosting</span>
  </div>
</footer>
</body>
</html>`;
}

function loginPage({ panelName, error }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Login · ${esc(panelName)}</title>
${FONT_LINKS}
</head>
<body>
<header class="site-header">
  <div class="container header-inner">
    ${brand()}
  </div>
</header>
<main class="container page-content">
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">
        <div class="logo-icon">⚡</div>
        <h1>ZVXAY <span>PANEL</span></h1>
        <p>Enter your credentials to access the panel</p>
      </div>
      ${error ? `<div class="flash error">✗ <span>${esc(error)}</span></div>` : ''}
      <form method="POST" action="/login" class="form-grid">
        <div>
          <span class="form-label">Username</span>
          <input type="text" name="username" autocomplete="username" placeholder="your username" required autofocus>
        </div>
        <div>
          <span class="form-label">Password</span>
          <input type="password" name="password" autocomplete="current-password" placeholder="••••••••" required>
        </div>
        <button class="btn btn-primary w-full" type="submit">Login →</button>
      </form>
      <div class="auth-footer">Accounts are created by the Telegram bot.</div>
    </div>
  </div>
</main>
<footer class="site-footer">
  <div class="container">
    <span>© 2026 <span class="fx">ZVXAY PANEL</span> · Bot Hosting</span>
  </div>
</footer>
</body>
</html>`;
}

function statusPill(server) {
  return server.status === 'running'
    ? '<span class="badge badge-running">Running</span>'
    : '<span class="badge badge-offline">Offline</span>';
}

function eggBadge(server) {
  return server.egg === 'python'
    ? '<span class="badge badge-egg">🐍 Python</span>'
    : '<span class="badge badge-egg">🟢 Node.js</span>';
}

function dashboardPage({ panelName, user, servers }) {
  const runningCount = servers.filter((s) => s.status === 'running').length;
  const stoppedCount = servers.length - runningCount;

  const cards = servers.length
    ? servers.map((s) => `
    <div class="card bot-card">
      <div class="bot-card-head">
        <div class="stack-sm">
          <div class="bot-name">${esc(s.name)}</div>
          <div><span class="uid-chip">${esc(s.identifier)}</span></div>
        </div>
        ${statusPill(s)}
      </div>
      <div class="bot-badges">${eggBadge(s)}</div>
      <div class="bot-card-info">
        <div class="bot-info-item">
          <span class="bot-info-label">Type</span>
          <span class="bot-info-value">${s.egg === 'python' ? 'Python' : 'Node.js'}</span>
        </div>
        <div class="bot-info-item">
          <span class="bot-info-label">Status</span>
          <span class="bot-info-value">${s.status === 'running' ? 'Running' : 'Offline'}</span>
        </div>
        <div class="bot-info-item">
          <span class="bot-info-label">Created</span>
          <span class="bot-info-value">${esc(new Date(s.created_at).toLocaleDateString())}</span>
        </div>
        ${user.is_admin && s.owner_name ? `<div class="bot-info-item">
          <span class="bot-info-label">Owner</span>
          <span class="bot-info-value">${esc(s.owner_name)}</span>
        </div>` : ''}
      </div>
      <div class="bot-card-actions">
        ${s.status === 'running'
          ? `<button class="btn btn-danger" data-power="stop" data-id="${esc(s.identifier)}">⬛ Stop</button>`
          : `<button class="btn btn-success" data-power="start" data-id="${esc(s.identifier)}">▶ Start</button>`}
        <a class="btn btn-primary" href="/server/${esc(s.identifier)}">Open →</a>
      </div>
    </div>`).join('')
    : `<div class="card"><div class="empty-state">
         <span class="icon">🤖</span>
         <h3>No bots yet</h3>
         <p>Bots are created for you by the Telegram bot.</p>
       </div></div>`;

  const body = `
  <div class="page-head">
    <div>
      <h1 class="page-title">Dashboard</h1>
      <p class="page-subtitle">Hello, <strong>${esc(user.username)}</strong> · ${servers.length} bot${servers.length === 1 ? '' : 's'}${user.is_admin ? ' · <span class="text-cyan">Owner</span>' : ''}</p>
    </div>
  </div>

  <div class="stats-bar">
    <div class="stat-card stat-cyan">
      <div class="stat-value">${servers.length}</div>
      <div class="stat-label">Total Bots</div>
    </div>
    <div class="stat-card stat-green">
      <div class="stat-value">${runningCount}</div>
      <div class="stat-label">Running</div>
    </div>
    <div class="stat-card">
      <div class="stat-value" style="color:var(--text-muted)">${stoppedCount}</div>
      <div class="stat-label">Stopped</div>
    </div>
  </div>

  <div class="section-label">🤖 ${user.is_admin ? 'All Bots' : 'Your Bots'}</div>
  <div class="bot-grid">${cards}</div>

<script>
document.querySelectorAll('[data-power]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var id = btn.getAttribute('data-id');
    var action = btn.getAttribute('data-power');
    btn.disabled = true;
    btn.textContent = 'Working…';
    fetch('/api/client/server/' + id + '/power', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { alert(data.error); btn.disabled = false; return; }
      setTimeout(function () { location.reload(); }, 500);
    }).catch(function () { location.reload(); });
  });
});
</script>`;
  return layout({ panelName, user, title: 'Dashboard', body });
}

function serverPage({ panelName, user, server, message, error }) {
  const env = server.environment || {};
  const envKeys = Object.keys(env);
  const envFields = envKeys.map((k) => `
    <div class="form-field">
      <label>${esc(k)}</label>
      <input type="text" name="env_${esc(k)}" value="${esc(env[k])}">
    </div>`).join('');

  const body = `
  <div class="page-head">
    <div>
      <h1 class="page-title">${esc(server.name)}</h1>
      <p class="page-subtitle"><span class="uid-chip">${esc(server.identifier)}</span> ${eggBadge(server)} ${statusPill(server)}</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="/">← All servers</a>
  </div>
  ${message ? `<div class="flash success">✓ <span>${esc(message)}</span></div>` : ''}
  ${error ? `<div class="flash error">✗ <span>${esc(error)}</span></div>` : ''}

  <div class="tabs">
    <button class="tab-btn active" data-tab="console">Console</button>
    <button class="tab-btn" data-tab="files">Files</button>
    <button class="tab-btn" data-tab="startup">Startup</button>
    <button class="tab-btn" data-tab="settings">Settings</button>
  </div>

  <section id="tab-console" class="tab-page">
    <div class="power-bar">
      <button class="btn btn-success" onclick="power('start')">▶ Start</button>
      <button class="btn btn-warn" onclick="power('restart')">↻ Restart</button>
      <button class="btn btn-danger" onclick="power('stop')">■ Stop</button>
      <span id="power-msg" class="power-msg"></span>
      <span class="console-status">Status: <strong id="console-status">${esc(server.status)}</strong></span>
    </div>
    <div class="card console-card">
      <div class="console-head">
        <span class="mono dim text-xs">stdout / stderr</span>
        <span class="console-dot"></span>
      </div>
      <pre id="console" class="console">Loading console…</pre>
    </div>
  </section>

  <section id="tab-files" class="tab-page hidden">
    <div class="files-bar">
      <input type="file" id="upload-input">
      <button class="btn btn-primary" onclick="uploadFile()">⬆ Upload</button>
      <span id="files-msg" class="power-msg"></span>
    </div>
    <div id="file-list" class="file-list">Loading files…</div>
    <div id="editor" class="editor hidden">
      <div class="editor-head">
        <span id="editor-name" class="mono"></span>
        <span>
          <button class="btn btn-small btn-primary" onclick="saveFile()">Save</button>
          <button class="btn btn-small btn-ghost" onclick="closeEditor()">Close</button>
        </span>
      </div>
      <textarea id="editor-text" spellcheck="false"></textarea>
    </div>
  </section>

  <section id="tab-startup" class="tab-page hidden">
    <div class="card">
      <h3 class="section-title">Startup command</h3>
      <pre class="startup-raw">${esc(server.startup_raw || '')}</pre>
      <h3 class="section-title">Variables</h3>
      <form method="POST" action="/server/${esc(server.identifier)}/startup">
        ${envFields}
        <button class="btn btn-primary" type="submit">Save variables</button>
      </form>
    </div>
  </section>

  <section id="tab-settings" class="tab-page hidden">
    <div class="card">
      <h3 class="section-title">Rename server</h3>
      <form method="POST" action="/server/${esc(server.identifier)}/rename">
        <div class="form-field"><label>Server name</label><input type="text" name="name" value="${esc(server.name)}" required></div>
        <button class="btn btn-primary" type="submit">Rename</button>
      </form>
    </div>
    <div class="card">
      <h3 class="section-title">Change your account password</h3>
      <form method="POST" action="/account/password">
        <div class="form-field"><label>Current password</label><input type="password" name="current_password" required></div>
        <div class="form-field"><label>New password</label><input type="password" name="new_password" required minlength="6"></div>
        <button class="btn btn-primary" type="submit">Change password</button>
      </form>
    </div>
  </section>

<script>
var SERVER_ID = ${JSON.stringify(server.identifier)};

document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-page').forEach(function (p) { p.classList.add('hidden'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'files') loadFiles();
  });
});

function apiUrl(action) { return '/api/client/server/' + SERVER_ID + '/' + action; }

function refreshConsole() {
  fetch(apiUrl('console')).then(function (r) { return r.json(); }).then(function (data) {
    var el = document.getElementById('console');
    var nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    el.textContent = (data.lines || []).join('\\n');
    document.getElementById('console-status').textContent = data.starting ? 'starting…' : data.status;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }).catch(function () {});
}
setInterval(refreshConsole, 2000);
refreshConsole();

function power(action) {
  var msg = document.getElementById('power-msg');
  msg.textContent = 'Working…';
  fetch(apiUrl('power'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action })
  }).then(function (r) { return r.json(); }).then(function (data) {
    msg.textContent = data.message || data.error || 'Done';
    refreshConsole();
  }).catch(function () { msg.textContent = 'Request failed'; });
}

function loadFiles() {
  fetch(apiUrl('files')).then(function (r) { return r.json(); }).then(function (data) {
    var el = document.getElementById('file-list');
    if (!data.files || !data.files.length) { el.innerHTML = '<div class="empty">No files yet. Upload your bot file to get started.</div>'; return; }
    el.innerHTML = data.files.map(function (f) {
      var safe = f.name.replace(/'/g, "\\'");
      return '<div class="file-row"><span class="file-name">' + (f.is_dir ? '📁 ' : '📄 ') + f.name + '</span>' +
        '<span class="file-size">' + f.size + ' B</span>' +
        (f.is_dir ? '' : '<span><button class="btn btn-small btn-ghost" onclick="editFile(\\'' + safe + '\\')">Edit</button>' +
        ' <button class="btn btn-small btn-danger" onclick="deleteFile(\\'' + safe + '\\')">Delete</button></span>') + '</div>';
    }).join('');
  }).catch(function () {});
}

function uploadFile() {
  var input = document.getElementById('upload-input');
  var msg = document.getElementById('files-msg');
  if (!input.files.length) { msg.textContent = 'Choose a file first'; return; }
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function () {
    var base64 = String(reader.result).split(',')[1];
    msg.textContent = 'Uploading ' + file.name + '…';
    fetch(apiUrl('files/upload'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, content_base64: base64 })
    }).then(function (r) { return r.json(); }).then(function (data) {
      msg.textContent = data.message || data.error || 'Uploaded';
      loadFiles();
    }).catch(function () { msg.textContent = 'Upload failed'; });
  };
  reader.readAsDataURL(file);
}

var editingName = null;
function editFile(name) {
  fetch(apiUrl('files/content') + '?name=' + encodeURIComponent(name)).then(function (r) { return r.json(); }).then(function (data) {
    if (data.error) { alert(data.error); return; }
    editingName = name;
    document.getElementById('editor-name').textContent = name;
    document.getElementById('editor-text').value = data.content;
    document.getElementById('editor').classList.remove('hidden');
  });
}
function saveFile() {
  if (!editingName) return;
  fetch(apiUrl('files/save'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: editingName, content: document.getElementById('editor-text').value })
  }).then(function (r) { return r.json(); }).then(function (data) {
    alert(data.message || data.error || 'Saved');
    loadFiles();
  });
}
function closeEditor() { document.getElementById('editor').classList.add('hidden'); editingName = null; }
function deleteFile(name) {
  if (!confirm('Delete ' + name + '?')) return;
  fetch(apiUrl('files/delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  }).then(function (r) { return r.json(); }).then(function () { loadFiles(); });
}
</script>`;

  return layout({ panelName, user, title: server.name, body });
}

function messagePage({ panelName, user, title, heading, text }) {
  const body = `<div class="page-head"><div><h1 class="page-title">${esc(heading)}</h1></div></div>
  <div class="card"><p>${esc(text)}</p><p style="margin-top:12px"><a class="btn btn-ghost btn-sm" href="/">← Back to servers</a></p></div>`;
  return layout({ panelName, user, title, body });
}

module.exports = { esc, layout, loginPage, dashboardPage, serverPage, messagePage };
