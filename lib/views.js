'use strict';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function layout({ panelName, user, title, body }) {
  const adminLink = user && user.is_admin ? '<a href="/admin" class="nav-item">🛠 Admin</a>' : '';
  const userBlock = user
    ? `<div class="sidebar-user">
         <div class="sidebar-username">${esc(user.username)}</div>
         <form method="POST" action="/logout"><button class="btn btn-small btn-ghost" type="submit">Logout</button></form>
       </div>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(panelName)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="logo">ZVXAY <span>PANEL</span></div>
    <nav>
      <a href="/" class="nav-item">🖥 Servers</a>
      ${adminLink}
    </nav>
    ${userBlock}
  </aside>
  <main class="main">
    ${body}
  </main>
</div>
</body>
</html>`;
}

function loginPage({ panelName, error }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login · ${esc(panelName)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body class="login-body">
  <div class="login-card">
    <div class="logo logo-center">ZVXAY <span>PANEL</span></div>
    <p class="login-sub">Sign in to ${esc(panelName)}</p>
    ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
    <form method="POST" action="/login">
      <label>Username</label>
      <input type="text" name="username" autocomplete="username" required autofocus>
      <label>Password</label>
      <input type="password" name="password" autocomplete="current-password" required>
      <button class="btn btn-primary btn-block" type="submit">Login</button>
    </form>
    <p class="login-hint">Accounts are created by the Telegram bot after you complete your referrals.</p>
  </div>
</body>
</html>`;
}

function statusDot(server) {
  return server.status === 'running'
    ? '<span class="dot dot-on"></span> Running'
    : '<span class="dot dot-off"></span> Offline';
}

function dashboardPage({ panelName, user, servers }) {
  let banner = '';
  if (!user.is_admin && user.expires_at) {
    const ms = new Date(user.expires_at).getTime() - Date.now();
    const days = Math.max(0, Math.ceil(ms / 86400_000));
    banner = `<div class="alert ${days <= 3 ? 'alert-error' : 'alert-info'}">
      ⏳ Your account is valid for <strong>${days} day${days === 1 ? '' : 's'}</strong> (until ${esc(new Date(user.expires_at).toLocaleString())}).
      When it expires you will be logged out and your servers will stop.
    </div>`;
  }
  const rows = servers.length
    ? servers.map((s) => `
      <a class="server-card" href="/server/${esc(s.identifier)}">
        <div class="server-card-main">
          <div class="server-name">${esc(s.name)}</div>
          <div class="server-meta">${s.egg === 'python' ? '🐍 Python' : '🟢 Node.js'} · ${esc(s.identifier)} · created ${esc(new Date(s.created_at).toLocaleDateString())}</div>
        </div>
        <div class="server-status">${statusDot(s)}</div>
      </a>`).join('')
    : '<div class="empty">You have no servers yet. Servers are created for you by the Telegram bot.</div>';

  const body = `
    <h1 class="page-title">Your Servers</h1>
    ${banner}
    <div class="server-list">${rows}</div>`;
  return layout({ panelName, user, title: 'Servers', body });
}

function serverPage({ panelName, user, server, message, error }) {
  const env = server.environment || {};
  const envKeys = Object.keys(env);
  const envFields = envKeys.map((k) => `
    <div class="form-row">
      <label>${esc(k)}</label>
      <input type="text" name="env_${esc(k)}" value="${esc(env[k])}">
    </div>`).join('');

  const body = `
  <div class="server-head">
    <div>
      <h1 class="page-title">${esc(server.name)}</h1>
      <div class="server-meta">${server.egg === 'python' ? '🐍 Python' : '🟢 Node.js'} · ${esc(server.identifier)} · ${statusDot(server)}</div>
    </div>
    <a class="btn btn-ghost" href="/">← All servers</a>
  </div>
  ${message ? `<div class="alert alert-info">${esc(message)}</div>` : ''}
  ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}

  <div class="tabs">
    <button class="tab-btn active" data-tab="console">Console</button>
    <button class="tab-btn" data-tab="files">Files</button>
    <button class="tab-btn" data-tab="startup">Startup</button>
    <button class="tab-btn" data-tab="settings">Settings</button>
  </div>

  <section id="tab-console" class="tab-page">
    <div class="power-bar">
      <button class="btn btn-success" onclick="power('start')">▶ Start</button>
      <button class="btn btn-warning" onclick="power('restart')">↻ Restart</button>
      <button class="btn btn-danger" onclick="power('stop')">■ Stop</button>
      <span id="power-msg" class="power-msg"></span>
      <span class="console-status">Status: <strong id="console-status">${esc(server.status)}</strong></span>
    </div>
    <pre id="console" class="console">Loading console…</pre>
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
        <span id="editor-name"></span>
        <span>
          <button class="btn btn-small btn-primary" onclick="saveFile()">Save</button>
          <button class="btn btn-small btn-ghost" onclick="closeEditor()">Close</button>
        </span>
      </div>
      <textarea id="editor-text" spellcheck="false"></textarea>
    </div>
  </section>

  <section id="tab-startup" class="tab-page hidden">
    <h3>Startup command</h3>
    <pre class="startup-raw">${esc(server.startup_raw || '')}</pre>
    <h3>Variables</h3>
    <form method="POST" action="/server/${esc(server.identifier)}/startup">
      ${envFields}
      <button class="btn btn-primary" type="submit">Save variables</button>
    </form>
  </section>

  <section id="tab-settings" class="tab-page hidden">
    <h3>Rename server</h3>
    <form method="POST" action="/server/${esc(server.identifier)}/rename">
      <div class="form-row"><label>Server name</label><input type="text" name="name" value="${esc(server.name)}" required></div>
      <button class="btn btn-primary" type="submit">Rename</button>
    </form>
    <h3>Change your account password</h3>
    <form method="POST" action="/account/password">
      <div class="form-row"><label>Current password</label><input type="password" name="current_password" required></div>
      <div class="form-row"><label>New password</label><input type="password" name="new_password" required minlength="6"></div>
      <button class="btn btn-primary" type="submit">Change password</button>
    </form>
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

function adminPage({ panelName, user, stats, users, servers, settings, message, error }) {
  const userRows = users.map((u) => {
    const srvCount = servers.filter((s) => s.user_id === u.id).length;
    const expiry = u.is_admin ? 'never' : (u.expires_at ? new Date(u.expires_at).toLocaleString() : '—');
    return `<tr>
      <td>${esc(u.username)}${u.is_admin ? ' 👑' : ''}</td>
      <td>${esc(u.email)}</td>
      <td>${esc(u.status)}</td>
      <td>${esc(expiry)}</td>
      <td>${srvCount}</td>
      <td class="actions">
        <form method="POST" action="/admin/users/${u.id}/extend" class="inline-form">
          <input type="number" name="days" value="20" min="1" max="3650" class="days-input">
          <button class="btn btn-small btn-primary" type="submit">+ days</button>
        </form>
        ${u.status === 'banned'
          ? `<form method="POST" action="/admin/users/${u.id}/unban" class="inline-form"><button class="btn btn-small btn-success" type="submit">Unban</button></form>`
          : (u.is_admin ? '' : `<form method="POST" action="/admin/users/${u.id}/ban" class="inline-form"><button class="btn btn-small btn-warning" type="submit">Ban</button></form>`)}
        ${u.is_admin ? '' : `<form method="POST" action="/admin/users/${u.id}/delete" class="inline-form" onsubmit="return confirm('Delete this user and all their servers?')"><button class="btn btn-small btn-danger" type="submit">Delete</button></form>`}
      </td>
    </tr>`;
  }).join('');

  const serverRows = servers.map((s) => {
    const owner = users.find((u) => u.id === s.user_id);
    return `<tr>
      <td>${esc(s.name)}</td>
      <td>${esc(owner ? owner.username : '?')}</td>
      <td>${s.egg === 'python' ? '🐍 Python' : '🟢 Node.js'}</td>
      <td>${statusDot(s)}</td>
      <td class="actions">
        ${s.status === 'running' ? `<form method="POST" action="/admin/servers/${esc(s.identifier)}/stop" class="inline-form"><button class="btn btn-small btn-warning" type="submit">Stop</button></form>` : ''}
        <form method="POST" action="/admin/servers/${esc(s.identifier)}/delete" class="inline-form" onsubmit="return confirm('Delete this server and its files?')"><button class="btn btn-small btn-danger" type="submit">Delete</button></form>
      </td>
    </tr>`;
  }).join('');

  const body = `
  <h1 class="page-title">🛠 Admin</h1>
  ${message ? `<div class="alert alert-info">${esc(message)}</div>` : ''}
  ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-num">${stats.users}</div><div class="stat-label">Users</div></div>
    <div class="stat-card"><div class="stat-num">${stats.servers}</div><div class="stat-label">Servers</div></div>
    <div class="stat-card"><div class="stat-num">${stats.running}</div><div class="stat-label">Running</div></div>
  </div>

  <h3>Panel settings</h3>
  <form method="POST" action="/admin/settings" class="card">
    <div class="form-row"><label>Panel name</label><input type="text" name="panel_name" value="${esc(settings.panel_name)}"></div>
    <div class="form-row"><label>Account validity (days)</label><input type="number" name="validity_days" value="${esc(settings.validity_days)}" min="1" max="3650"></div>
    <div class="form-row"><label>Application API key (for the bot)</label><input type="text" value="${esc(settings.app_api_key)}" readonly></div>
    <button class="btn btn-primary" type="submit">Save settings</button>
  </form>

  <h3>Add user</h3>
  <form method="POST" action="/admin/users/create" class="card">
    <div class="form-row"><label>Username</label><input type="text" name="username" required></div>
    <div class="form-row"><label>Email</label><input type="email" name="email" required></div>
    <div class="form-row"><label>Password</label><input type="text" name="password" required minlength="6"></div>
    <button class="btn btn-primary" type="submit">Create user</button>
  </form>

  <h3>Users</h3>
  <div class="table-wrap"><table>
    <tr><th>Username</th><th>Email</th><th>Status</th><th>Expires</th><th>Servers</th><th>Actions</th></tr>
    ${userRows || '<tr><td colspan="6">No users yet.</td></tr>'}
  </table></div>

  <h3>All servers</h3>
  <div class="table-wrap"><table>
    <tr><th>Name</th><th>Owner</th><th>Type</th><th>Status</th><th>Actions</th></tr>
    ${serverRows || '<tr><td colspan="5">No servers yet.</td></tr>'}
  </table></div>`;

  return layout({ panelName, user, title: 'Admin', body });
}

function messagePage({ panelName, user, title, heading, text }) {
  const body = `<h1 class="page-title">${esc(heading)}</h1><div class="card"><p>${esc(text)}</p><p><a href="/">← Back to servers</a></p></div>`;
  return layout({ panelName, user, title, body });
}

module.exports = { esc, layout, loginPage, dashboardPage, serverPage, adminPage, messagePage };
