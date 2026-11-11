'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ------------------------------------------------------------------ *
 * Static panel catalogue: locations, nests and eggs.
 * The bot discovers eggs by NAME (case-insensitive) when no egg-id
 * env var is configured, so these names must stay exactly as below.
 * ------------------------------------------------------------------ */
const LOCATIONS = [
  { id: 1, short: 'main', long: 'Main Location' },
];

const NODEJS_ENV_DEFAULTS = {
  CMD_RUN: 'npm start',
  NODE_PACKAGES: '',
  UNNODE_PACKAGES: '',
  AUTO_UPDATE: '0',
  GIT_ADDRESS: '',
  BRANCH: '',
  USER_UPLOAD: '0',
  USERNAME: '',
  ACCESS_TOKEN: '',
};

const PYTHON_ENV_DEFAULTS = {
  PY_FILE: 'app.py',
  PY_PACKAGES: '',
  GIT_ADDRESS: '',
  BRANCH: '',
  USER_UPLOAD: '0',
  AUTO_UPDATE: '0',
  USERNAME: '',
  ACCESS_TOKEN: '',
  REQUIREMENTS_FILE: 'requirements.txt',
};

const EGGS = [
  {
    id: 1,
    nest: 1,
    name: 'NODE JS',
    key: 'nodejs',
    description: 'Node.js bot server',
    docker_image: 'ghcr.io/parkervcp/yolks:nodejs_22',
    startup:
      'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; ' +
      'if [[ ! -z ${NODE_PACKAGES} ]]; then npm install ${NODE_PACKAGES}; fi; ' +
      'if [ -f package.json ]; then npm install; fi; ${CMD_RUN}',
    env_defaults: NODEJS_ENV_DEFAULTS,
  },
  {
    id: 2,
    nest: 1,
    name: 'Python Engine',
    key: 'python',
    description: 'Python bot server',
    docker_image: 'ghcr.io/parkervcp/yolks:python_3.12',
    startup:
      'if [[ -d .git ]] && [[ "{{AUTO_UPDATE}}" == "1" ]]; then git pull; fi; ' +
      'if [[ ! -z "{{PY_PACKAGES}}" ]]; then pip install -U --prefix .local {{PY_PACKAGES}}; fi; ' +
      'if [[ -f ${REQUIREMENTS_FILE} ]]; then pip install -U --prefix .local -r ${REQUIREMENTS_FILE}; fi; ' +
      'python3 {{PY_FILE}}',
    env_defaults: PYTHON_ENV_DEFAULTS,
  },
];

const NESTS = [{ id: 1, name: 'ZVXAY Bots', author: 'zvxay', description: 'Bot hosting eggs' }];

/* ------------------------------------------------------------------ *
 * Password hashing (scrypt from node:crypto)
 * ------------------------------------------------------------------ */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * JSON-file store with atomic writes (tmp + rename)
 * ------------------------------------------------------------------ */
class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, 'db.json');
    this.db = null;
  }

  init() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(path.join(this.dataDir, 'servers'), { recursive: true });
    let firstBoot = false;
    if (fs.existsSync(this.dbPath)) {
      try {
        this.db = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      } catch (e) {
        throw new Error(`db.json is corrupted (${e.message}); refusing to start with an empty database`);
      }
    } else {
      firstBoot = true;
      this.db = {
        settings: {
          validity_days: 20,
          panel_name: 'ZVXAY Panel',
          app_api_key: null,
          session_secret: null,
        },
        users: [],
        servers: [],
        apiKeys: [],
        seq: { user: 1, server: 1 },
      };
    }
    // First-boot secrets
    // An operator-provided key (env APP_API_KEY) always wins: it keeps the
    // bot's PTERODACTYL_API_KEY valid across restarts even before a
    // persistent disk is attached.
    const envKey = (process.env.APP_API_KEY || '').trim();
    if (envKey && this.db.settings.app_api_key !== envKey) {
      this.db.settings.app_api_key = envKey;
      const rec = this.db.apiKeys.find(k => k.id === 1);
      if (rec) rec.key = envKey;
      else this.db.apiKeys.push({ id: 1, key: envKey, memo: 'Primary application API key', created_at: new Date().toISOString() });
      this.save();
      console.log('APP_API_KEY set from environment');
    }
    if (!this.db.settings.app_api_key) {
      const key = 'ptla_' + crypto.randomBytes(24).toString('hex');
      this.db.settings.app_api_key = key;
      this.db.apiKeys.push({ id: 1, key, memo: 'Primary application API key', created_at: new Date().toISOString() });
      // The deployer needs this value to configure the bot (PTERODACTYL_API_KEY).
      console.log(`APP_API_KEY=${key}`);
    }
    if (!this.db.settings.session_secret) {
      this.db.settings.session_secret = crypto.randomBytes(32).toString('hex');
    }
    if (firstBoot) this.save();
    this.seedAdmin();
    return this;
  }

  seedAdmin() {
    const username = (process.env.ADMIN_USERNAME || '').trim();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!username || !password) return;
    const existing = this.findUserByUsername(username);
    if (existing) {
      if (!existing.is_admin) { existing.is_admin = true; this.save(); }
      return;
    }
    const now = new Date().toISOString();
    this.db.users.push({
      id: this.db.seq.user++,
      username,
      email: 'admin@localhost',
      first_name: 'Admin',
      last_name: '',
      password_hash: hashPassword(password),
      is_admin: true,
      status: 'active',
      created_at: now,
      expires_at: null, // admin never expires
    });
    this.save();
    console.log(`[panel] Seeded admin account "${username}" from environment.`);
  }

  save() {
    const tmp = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.dbPath);
  }

  /* ------------------------------ users ------------------------------ */
  findUserByUsername(username) {
    const u = String(username || '').toLowerCase();
    return this.db.users.find((x) => x.username.toLowerCase() === u) || null;
  }

  findUserByEmail(email) {
    const e = String(email || '').toLowerCase();
    return this.db.users.find((x) => x.email.toLowerCase() === e) || null;
  }

  findUserById(id) {
    return this.db.users.find((x) => x.id === Number(id)) || null;
  }

  createUser({ username, email, first_name, last_name, password, is_admin = false }) {
    const now = new Date();
    const validityDays = Number(this.db.settings.validity_days) || 20;
    const user = {
      id: this.db.seq.user++,
      username: String(username),
      email: String(email),
      first_name: first_name || String(username),
      last_name: last_name || '',
      password_hash: hashPassword(password),
      is_admin: !!is_admin,
      status: 'active',
      created_at: now.toISOString(),
      expires_at: is_admin ? null : new Date(now.getTime() + validityDays * 86400_000).toISOString(),
    };
    this.db.users.push(user);
    this.save();
    return user;
  }

  deleteUser(id) {
    this.db.users = this.db.users.filter((x) => x.id !== Number(id));
    this.save();
  }

  /* ----------------------------- servers ----------------------------- */
  serverDir(identifier) {
    return path.join(this.dataDir, 'servers', identifier);
  }

  findServerByIdentifier(identifier) {
    return this.db.servers.find((x) => x.identifier === String(identifier)) || null;
  }

  findServerById(id) {
    return this.db.servers.find((x) => x.id === Number(id)) || null;
  }

  serversOfUser(userId) {
    return this.db.servers.filter((x) => x.user_id === Number(userId));
  }

  createServer(fields) {
    const server = { id: this.db.seq.server++, ...fields };
    this.db.servers.push(server);
    fs.mkdirSync(this.serverDir(server.identifier), { recursive: true });
    this.save();
    return server;
  }

  deleteServerRecord(identifier) {
    this.db.servers = this.db.servers.filter((x) => x.identifier !== String(identifier));
    this.save();
  }

  /* --------------------------- api keys ------------------------------ */
  isValidAppKey(key) {
    if (!key) return false;
    if (key === this.db.settings.app_api_key) return true;
    return this.db.apiKeys.some((k) => k.key === key);
  }
}

module.exports = { Store, LOCATIONS, NESTS, EGGS, hashPassword, verifyPassword };
