'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LOG_MAX_BYTES = 1024 * 1024; // ~1 MB cap for server.log
const TAIL_LINES = 400;

/**
 * Hosting engine: runs user bots as plain child processes (no docker).
 * One runtime entry per server identifier, held in memory; the panel is
 * a single-instance app, so in-memory PID tracking is authoritative.
 * Processes are spawned detached so the whole process group can be
 * killed on stop (bots may spawn children of their own).
 */
class Engine {
  constructor(store) {
    this.store = store;
    this.running = new Map(); // identifier -> runtime
  }

  serverDir(server) {
    return this.store.serverDir(server.identifier);
  }

  isRunning(identifier) {
    const rt = this.running.get(identifier);
    return !!(rt && rt.child && !rt.child.killed && rt.child.exitCode === null);
  }

  /* ---------------------------- logging ---------------------------- */
  _openRuntime(server) {
    const dir = this.serverDir(server);
    fs.mkdirSync(dir, { recursive: true });
    const logPath = path.join(dir, 'server.log');
    let size = 0;
    try { size = fs.statSync(logPath).size; } catch { /* fresh log */ }
    const rt = {
      child: null,
      starting: false,
      tail: [],
      size,
      stream: fs.createWriteStream(logPath, { flags: 'a' }),
    };
    this.running.set(server.identifier, rt);
    return rt;
  }

  _runtime(server) {
    return this.running.get(server.identifier) || this._openRuntime(server);
  }

  _append(server, rt, chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    // Simple rotation: once the log passes the cap, start it over.
    if (rt.size + text.length > LOG_MAX_BYTES) {
      try {
        rt.stream.end();
        fs.truncateSync(path.join(this.serverDir(server), 'server.log'), 0);
        rt.stream = fs.createWriteStream(path.join(this.serverDir(server), 'server.log'), { flags: 'a' });
        rt.size = 0;
        const marker = '\n[panel] ---- server.log rotated ----\n';
        rt.stream.write(marker);
        rt.size += marker.length;
      } catch { /* logging must never crash the engine */ }
    }
    rt.stream.write(text);
    rt.size += text.length;
    const parts = (rt.partial || '') + text;
    const lines = parts.split('\n');
    rt.partial = lines.pop();
    for (const line of lines) {
      rt.tail.push(line);
      if (rt.tail.length > TAIL_LINES) rt.tail.shift();
    }
  }

  logLine(server, line) {
    const rt = this._runtime(server);
    this._append(server, rt, `${line}\n`);
  }

  /** Console view: in-memory tail if we have one, else the log file tail. */
  getConsole(identifier) {
    const server = this.store.findServerByIdentifier(identifier);
    if (!server) return null;
    const rt = this.running.get(identifier);
    if (rt) {
      const lines = [...rt.tail];
      if (rt.partial) lines.push(rt.partial);
      return { status: server.status, starting: !!rt.starting, lines };
    }
    let lines = [];
    try {
      const raw = fs.readFileSync(path.join(this.serverDir(server), 'server.log'), 'utf8');
      lines = raw.split('\n').slice(-TAIL_LINES);
    } catch { /* no log yet */ }
    return { status: server.status, starting: false, lines };
  }

  /* --------------------------- prep steps --------------------------- */
  _runPrep(server, rt, command, args, cwd, extraEnv) {
    return new Promise((resolve) => {
      this._append(server, rt, `\n[panel] $ ${command} ${args.join(' ')}\n`);
      let child;
      try {
        child = spawn(command, args, {
          cwd,
          env: { ...process.env, ...extraEnv },
          detached: false,
        });
      } catch (e) {
        this._append(server, rt, `[panel] failed to run ${command}: ${e.message}\n`);
        return resolve(false);
      }
      child.stdout.on('data', (d) => this._append(server, rt, d));
      child.stderr.on('data', (d) => this._append(server, rt, d));
      child.on('error', (e) => {
        this._append(server, rt, `[panel] ${command} error: ${e.message}\n`);
        resolve(false);
      });
      child.on('close', (code) => {
        this._append(server, rt, `[panel] ${command} exited with code ${code}\n`);
        resolve(code === 0);
      });
    });
  }

  _attach(server, rt, child) {
    rt.child = child;
    child.stdout.on('data', (d) => this._append(server, rt, d));
    child.stderr.on('data', (d) => this._append(server, rt, d));
    child.on('error', (e) => this._append(server, rt, `[panel] process error: ${e.message}\n`));
    child.on('close', (code, signal) => {
      this._append(server, rt, `\n[panel] process exited (code=${code}, signal=${signal || 'none'})\n`);
      rt.child = null;
      const fresh = this.store.findServerByIdentifier(server.identifier);
      if (fresh && fresh.status === 'running') {
        fresh.status = 'offline';
        this.store.save();
      }
    });
  }

  _markRunning(server) {
    server.status = 'running';
    this.store.save();
  }

  /* ----------------------------- python ----------------------------- */
  async _startPython(server, rt) {
    const dir = this.serverDir(server);
    const env = server.environment || {};
    const baseEnv = { PYTHONUNBUFFERED: '1' };
    const localDir = path.join(dir, '.local');

    const reqName = (env.REQUIREMENTS_FILE || 'requirements.txt').trim();
    if (reqName && fs.existsSync(path.join(dir, reqName))) {
      await this._runPrep(server, rt, 'python3', ['-m', 'pip', 'install', '-U', '--prefix', '.local', '-r', reqName], dir, baseEnv);
    }
    const pkgs = String(env.PY_PACKAGES || '').trim();
    if (pkgs) {
      await this._runPrep(server, rt, 'python3', ['-m', 'pip', 'install', '-U', '--prefix', '.local', ...pkgs.split(/\s+/)], dir, baseEnv);
    }

    // Work out .local paths so pip-installed packages are importable.
    const runEnv = { ...baseEnv };
    if (fs.existsSync(localDir)) {
      try {
        const libDir = path.join(localDir, 'lib');
        const pyDir = fs.readdirSync(libDir).find((d) => d.startsWith('python'));
        if (pyDir) {
          const sitePackages = path.join(libDir, pyDir, 'site-packages');
          if (fs.existsSync(sitePackages)) {
            runEnv.PYTHONPATH = sitePackages + (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : '');
          }
        }
      } catch { /* best effort */ }
      const localBin = path.join(localDir, 'bin');
      if (fs.existsSync(localBin)) runEnv.PATH = `${localBin}:${process.env.PATH || ''}`;
    }

    // Main file: configured PY_FILE, else auto-detect.
    let mainFile = (env.PY_FILE || 'app.py').trim();
    if (!fs.existsSync(path.join(dir, mainFile))) {
      const candidates = ['app.py', 'main.py', 'bot.py', 'index.py', 'run.py'];
      const found = candidates.find((f) => fs.existsSync(path.join(dir, f)));
      if (found) {
        this.logLine(server, `[panel] ${mainFile} not found, using ${found}`);
        mainFile = found;
      } else {
        this.logLine(server, `[panel] ERROR: no Python entry file found (looked for ${mainFile}, ${candidates.join(', ')}). Upload your bot file first.`);
        return false;
      }
    }

    const child = spawn('python3', ['-u', mainFile], {
      cwd: dir,
      env: { ...process.env, ...runEnv },
      detached: true,
    });
    this._attach(server, rt, child);
    this.logLine(server, `[panel] started: python3 ${mainFile} (pid ${child.pid})`);
    return true;
  }

  /* ------------------------------ node ------------------------------ */
  async _startNode(server, rt) {
    const dir = this.serverDir(server);
    const env = server.environment || {};

    if (fs.existsSync(path.join(dir, 'package.json'))) {
      await this._runPrep(server, rt, 'npm', ['install', '--no-audit', '--no-fund'], dir, {});
    }
    const pkgs = String(env.NODE_PACKAGES || '').trim();
    if (pkgs) {
      await this._runPrep(server, rt, 'npm', ['install', '--no-audit', '--no-fund', ...pkgs.split(/\s+/)], dir, {});
    }

    const cmd = String(env.CMD_RUN || 'npm start').trim() || 'npm start';
    const child = spawn('bash', ['-lc', cmd], {
      cwd: dir,
      env: { ...process.env },
      detached: true,
    });
    this._attach(server, rt, child);
    this.logLine(server, `[panel] started: ${cmd} (pid ${child.pid})`);
    return true;
  }

  /* --------------------------- public API --------------------------- */
  async startServer(identifier) {
    const server = this.store.findServerByIdentifier(identifier);
    if (!server) return { ok: false, error: 'Server not found' };
    if (this.isRunning(identifier)) return { ok: true, message: 'Already running' };
    const rt = this._runtime(server);
    if (rt.starting) return { ok: true, message: 'Already starting' };
    rt.starting = true;
    this.logLine(server, `\n[panel] ---- starting server "${server.name}" (${server.egg}) ----`);
    try {
      const ok = server.egg === 'python' ? await this._startPython(server, rt) : await this._startNode(server, rt);
      if (ok) this._markRunning(server);
      return { ok, message: ok ? 'Server started' : 'Failed to start (see console)' };
    } catch (e) {
      this.logLine(server, `[panel] start failed: ${e.message}`);
      return { ok: false, error: e.message };
    } finally {
      rt.starting = false;
    }
  }

  async stopServer(identifier, reason = 'stopped by user') {
    const server = this.store.findServerByIdentifier(identifier);
    if (!server) return { ok: false, error: 'Server not found' };
    const rt = this.running.get(identifier);
    if (server.status !== 'offline') {
      server.status = 'offline';
      this.store.save();
    }
    if (!rt || !rt.child) return { ok: true, message: 'Server is not running' };
    const child = rt.child;
    this.logLine(server, `[panel] stopping server (${reason})`);
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
        resolve();
      }, 3000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      if (child.exitCode !== null) { clearTimeout(timer); resolve(); }
    });
    rt.child = null;
    return { ok: true, message: 'Server stopped' };
  }

  async restartServer(identifier) {
    await this.stopServer(identifier, 'restart');
    return this.startServer(identifier);
  }

  /** Delete a server completely: stop it and remove its files. */
  async deleteServer(identifier) {
    const server = this.store.findServerByIdentifier(identifier);
    if (!server) return;
    await this.stopServer(identifier, 'server deleted');
    const rt = this.running.get(identifier);
    if (rt) {
      try { rt.stream.end(); } catch { /* ignore */ }
      this.running.delete(identifier);
    }
    fs.rmSync(this.serverDir(server), { recursive: true, force: true });
    this.store.deleteServerRecord(identifier);
  }
}

module.exports = { Engine };
