/* ═══════════════════════════════════════════
   ZVXAY Panel v2 — main.js
═══════════════════════════════════════════ */

// ── Custom Modal (replaces browser confirm) ─────────────────
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle   = document.getElementById('modal-title');
const modalMsg     = document.getElementById('modal-msg');
const modalIcon    = document.getElementById('modal-icon');
const modalConfirm = document.getElementById('modal-confirm');
const modalCancel  = document.getElementById('modal-cancel');

let _modalResolve = null;

function showModal({ title = 'Confirm', msg = '', icon = '❓', confirmText = 'Confirm', confirmClass = 'btn-danger' } = {}) {
  return new Promise(resolve => {
    _modalResolve = resolve;
    modalTitle.textContent   = title;
    modalMsg.textContent     = msg;
    modalIcon.textContent    = icon;
    modalConfirm.textContent = confirmText;
    modalConfirm.className   = `btn ${confirmClass}`;
    modalOverlay.classList.add('open');
    modalOverlay.setAttribute('aria-hidden', 'false');
    modalConfirm.focus();
  });
}

function closeModal(result) {
  modalOverlay.classList.remove('open');
  modalOverlay.setAttribute('aria-hidden', 'true');
  if (_modalResolve) { _modalResolve(result); _modalResolve = null; }
}

modalConfirm?.addEventListener('click', () => closeModal(true));
modalCancel?.addEventListener('click',  () => closeModal(false));
modalOverlay?.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(false); });

// ── Hamburger menu ──────────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const mobileNav = document.getElementById('mobile-nav');

if (hamburger && mobileNav) {
  hamburger.addEventListener('click', () => {
    const open = mobileNav.classList.toggle('open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', String(open));
  });
  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('open');
      hamburger.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', e => {
    if (!hamburger.contains(e.target) && !mobileNav.contains(e.target)) {
      mobileNav.classList.remove('open');
      hamburger.classList.remove('open');
    }
  });
}

// ── Bot action buttons (Start / Stop / Restart / Delete) ────
document.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;

  const id     = btn.getAttribute('data-id');
  const action = btn.getAttribute('data-action');
  if (!id || !action) return;

  // Confirm dangerous actions via centered modal
  if (action === 'delete') {
    const ok = await showModal({
      icon: '🗑️', title: 'Delete Bot',
      msg: 'This will permanently delete the bot and all its files. Are you sure?',
      confirmText: 'Yes, Delete', confirmClass: 'btn-danger'
    });
    if (!ok) return;
  }
  if (action === 'restart') {
    const ok = await showModal({
      icon: '🔄', title: 'Restart Bot',
      msg: 'The bot will be stopped and started again. Continue?',
      confirmText: 'Restart', confirmClass: 'btn-warn'
    });
    if (!ok) return;
  }
  if (action === 'stop') {
    const ok = await showModal({
      icon: '⬛', title: 'Stop Bot',
      msg: 'Are you sure you want to stop this bot?',
      confirmText: 'Stop', confirmClass: 'btn-danger'
    });
    if (!ok) return;
  }

  setButtonLoading(btn, true);
  try {
    const res  = await fetch(`/${action}/${id}`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      showToast(data.msg || 'Action failed', 'error');
      setButtonLoading(btn, false);
    } else {
      const msgs = { start: '▶ Bot started!', stop: '⬛ Bot stopped', restart: '🔄 Bot restarted', delete: '🗑️ Bot deleted' };
      showToast(msgs[action] || 'Done ✓', 'success');
      setTimeout(() => location.reload(), 700);
    }
  } catch (err) {
    showToast('Network error — try again', 'error');
    setButtonLoading(btn, false);
  }
});

// ── Install requirements button ─────────────────────────────
document.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-install]');
  if (!btn) return;
  const id = btn.getAttribute('data-install');

  const ok = await showModal({
    icon: '📦', title: 'Install Requirements',
    msg: 'Install packages from requirements.txt? Check logs for output.',
    confirmText: 'Install', confirmClass: 'btn-success'
  });
  if (!ok) return;

  setButtonLoading(btn, true, 'Installing…');
  try {
    const res  = await fetch(`/install_req/${id}`, { method: 'POST' });
    const data = await res.json();
    showToast(data.msg || (data.ok ? '📦 Installed!' : '✗ Failed'), data.ok ? 'success' : 'error');
    if (data.ok) setTimeout(() => location.reload(), 900);
    else setButtonLoading(btn, false);
  } catch {
    showToast('Network error', 'error');
    setButtonLoading(btn, false);
  }
});

// ── Toast notifications ─────────────────────────────────────
function showToast(msg, type = 'info') {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    Object.assign(c.style, {
      position: 'fixed', bottom: '90px', right: '16px', zIndex: '9998',
      display: 'flex', flexDirection: 'column', gap: '8px',
      maxWidth: 'calc(100vw - 32px)', pointerEvents: 'none'
    });
    document.body.appendChild(c);
  }
  const clr = {
    success: { bg: 'rgba(0,255,157,.12)',  border: 'rgba(0,255,157,.35)', text: '#00ff9d' },
    error:   { bg: 'rgba(255,51,85,.12)',  border: 'rgba(255,51,85,.35)', text: '#ff3355' },
    info:    { bg: 'rgba(0,212,255,.12)',  border: 'rgba(0,212,255,.35)', text: '#00d4ff' },
  }[type] || {};

  const t = document.createElement('div');
  Object.assign(t.style, {
    background: clr.bg, border: `1px solid ${clr.border}`, color: clr.text,
    padding: '11px 16px', borderRadius: '10px', fontSize: '14px', fontWeight: '600',
    fontFamily: "'Outfit', sans-serif", backdropFilter: 'blur(8px)',
    animation: 'toastIn .2s ease'
  });
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── Button loading state ────────────────────────────────────
function setButtonLoading(btn, loading, txt) {
  if (loading) {
    btn._orig = btn.innerHTML;
    btn._dis  = btn.disabled;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${txt || 'Wait…'}`;
  } else {
    btn.disabled  = btn._dis || false;
    btn.innerHTML = btn._orig || btn.innerHTML;
  }
}

// ── File drop zone (upload page) ────────────────────────────
const dropzone  = document.querySelector('.upload-dropzone');
const fileInput = document.getElementById('file-input');
const idleView  = document.getElementById('dropzone-idle');
const preview   = document.getElementById('file-preview');
const prevIcon  = document.getElementById('preview-icon');
const prevName  = document.getElementById('preview-name');
const prevMeta  = document.getElementById('preview-meta');
const clearBtn  = document.getElementById('clear-file');
const uploadBtn = document.getElementById('upload-btn');
const form      = document.getElementById('upload-form');
const progWrap  = document.getElementById('upload-progress');
const progFill  = document.getElementById('progress-fill');
const progLbl   = document.getElementById('progress-label');

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function showFilePreview(file) {
  const isZip = file.name.toLowerCase().endsWith('.zip');
  prevIcon.textContent = isZip ? '📦' : '🐍';
  prevName.textContent = file.name;
  prevMeta.textContent = formatBytes(file.size) + (isZip ? ' · ZIP Archive' : ' · Python Script');
  idleView.style.display = 'none';
  preview.style.display  = 'flex';
  uploadBtn.disabled     = false;
  dropzone.classList.add('has-file');
}

function clearFileSel() {
  fileInput.value = '';
  idleView.style.display = '';
  preview.style.display  = 'none';
  if (uploadBtn) uploadBtn.disabled = true;
  dropzone?.classList.remove('has-file');
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) showFilePreview(fileInput.files[0]);
    else clearFileSel();
  });
}
clearBtn?.addEventListener('click', e => { e.stopPropagation(); clearFileSel(); });

if (dropzone) {
  ['dragover', 'dragenter'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(ev =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove('drag-over'))
  );
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f && (f.name.endsWith('.py') || f.name.endsWith('.zip'))) {
      const dt = new DataTransfer(); dt.items.add(f);
      fileInput.files = dt.files;
      showFilePreview(f);
    }
  });
}

// XHR upload with progress bar
if (form && fileInput) {
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!fileInput.files[0]) return;

    if (progWrap)  progWrap.style.display = '';
    if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.innerHTML = '<span class="spinner"></span> Uploading…'; }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', form.action);

    xhr.upload.addEventListener('progress', ev => {
      if (ev.lengthComputable && progFill && progLbl) {
        const pct = Math.round(ev.loaded / ev.total * 100);
        progFill.style.width = pct + '%';
        progLbl.textContent  = `Uploading… ${pct}%`;
      }
    });
    xhr.addEventListener('load', () => {
      if (progFill) progFill.style.width = '100%';
      if (progLbl)  progLbl.textContent  = 'Processing…';
      window.location.href = xhr.responseURL || '/dashboard';
    });
    xhr.addEventListener('error', () => {
      if (progWrap) progWrap.style.display = 'none';
      if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.innerHTML = '⬆ Upload & Continue'; }
      showToast('Upload failed — network error', 'error');
    });

    xhr.send(new FormData(form));
  });
}

// ── Live log refresh ────────────────────────────────────────
const logbox  = document.getElementById('logbox');
const botIdEl = document.getElementById('bot-id');
const autoEl  = document.getElementById('auto-refresh');

if (logbox && botIdEl) {
  let iv = null;
  function startRefresh() {
    iv = setInterval(async () => {
      try {
        const res  = await fetch(`/logs_raw/${botIdEl.value}`);
        const text = await res.text();
        if (text !== logbox.textContent) {
          logbox.textContent = text;
          logbox.scrollTop   = logbox.scrollHeight;
        }
      } catch { /* ignore */ }
    }, 3000);
  }
  if (autoEl) {
    autoEl.addEventListener('change', () => autoEl.checked ? startRefresh() : clearInterval(iv));
    if (autoEl.checked) startRefresh();
  }
  logbox.scrollTop = logbox.scrollHeight;
}

// ── Dashboard auto-reload (every 30s if bots are running) ──
if (document.querySelector('.badge-running') && !logbox) {
  setTimeout(() => location.reload(), 30_000);
}

// ── Inject animation keyframes ──────────────────────────────
const _st = document.createElement('style');
_st.textContent = `
  @keyframes toastIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin     { to { transform:rotate(360deg); } }
  .spinner {
    width:13px; height:13px; border-radius:50%;
    border:2px solid rgba(255,255,255,.15); border-top-color:currentColor;
    animation:spin .7s linear infinite; display:inline-block; vertical-align:middle;
  }
`;
document.head.appendChild(_st);
