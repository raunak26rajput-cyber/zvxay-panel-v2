/*
 * ============================================================
 * CRITTIX PTERODACTYL  index.js
 * Telegram Referral Panel Bot
 * Created by: 𝗟𝗼𝗿𝗱 𝙳𝙴𝚅𝙸𝙽𝙴
 * ============================================================
 */
require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const fs          = require('fs');
const path        = require('path');
const axios       = require('axios');
const chalk       = require('chalk');

const BOT_TOKEN       = (process.env.BOT_TOKEN || '').trim();
const PTERO_URL       = (() => {
  let u = (process.env.PTERODACTYL_URL || '').trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;   // .env had no https://
  return u;
})();
const PTERO_KEY       = (process.env.PTERODACTYL_API_KEY || '').trim();
const PTERO_LOCATION  = (process.env.PTERODACTYL_LOCATION_ID || '').trim();
const OWNER_ID        = (process.env.OWNER_ID || '8033024853').trim();
const ADMIN_IDS       = (process.env.ADMIN_IDS || OWNER_ID).split(',').map(s => s.trim()).filter(Boolean);
if (!ADMIN_IDS.includes(OWNER_ID)) ADMIN_IDS.push(OWNER_ID);
const isAdmin         = (id) => ADMIN_IDS.includes(String(id));
const PTERO_NODEJS_EGG_ID = (process.env.PTERODACTYL_NODEJS_EGG_ID || '').trim();
const PTERO_PYTHON_EGG_ID = (process.env.PTERODACTYL_PYTHON_EGG_ID || '').trim();

// ---- Startup configuration validation (fail fast, never log secret values) ----
const _missingCfg = [];
if (!BOT_TOKEN)  _missingCfg.push('BOT_TOKEN');
if (!PTERO_URL)  _missingCfg.push('PTERODACTYL_URL');
if (!PTERO_KEY)  _missingCfg.push('PTERODACTYL_API_KEY');
if (_missingCfg.length) {
  console.error('===================================================');
  console.error('CONFIG ERROR: missing required environment variables:');
  for (const v of _missingCfg) console.error(`  - ${v}`);
  console.error('Copy .env.example to .env and fill in the values,');
  console.error('or set them as startup variables on your Pterodactyl server.');
  console.error('===================================================');
  process.exit(1);
}
const DEFAULT_BOT_PIC = 'https://files.catbox.moe/ynx7u9.jpg';
const DEVELOPER_LINK  = 'https://t.me/ZVXAY_PAPA';
// Referral economy defaults live in database/settings.json (Admin Panel can
// change them at runtime) - see getSettings() below. Defaults: 5 and 5.

const REQUIRED_CHANNELS = [
  { name: 'ZVXAY ERA',  link: 'https://t.me/ZVXAY_ERA', username: 'ZVXAY_ERA'},
];

const NODEJS_EGG = {
  name: 'NODE JS',
  dockerImage: 'ghcr.io/parkervcp/yolks:nodejs_22',
  startup: `if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z \${NODE_PACKAGES} ]]; then /usr/local/bin/npm install \${NODE_PACKAGES}; fi; if [[ ! -z \${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall \${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/\${CMD_RUN};`,
  environment: {
    CMD_RUN: 'npm start',
    NODE_PACKAGES: '',
    UNNODE_PACKAGES: '',
    AUTO_UPDATE: '0',
    GIT_ADDRESS: '',
    BRANCH: '',
    USER_UPLOAD: '0',
    USERNAME: '',
    ACCESS_TOKEN: '',
  },
};

const PYTHON_EGG = {
  name: 'Python Engine',
  dockerImage: 'ghcr.io/parkervcp/yolks:python_3.12',
  startup: `if [[ -d .git ]] && [[ "{{AUTO_UPDATE}}" == "1" ]]; then git pull; fi; if [[ ! -z "{{PY_PACKAGES}}" ]]; then pip install -U --prefix .local {{PY_PACKAGES}}; fi; if [[ -f /home/container/\${REQUIREMENTS_FILE} ]]; then pip install -U --prefix .local -r \${REQUIREMENTS_FILE}; fi; /usr/local/bin/python /home/container/{{PY_FILE}}`,
  environment: {
    PY_FILE: 'app.py',
    PY_PACKAGES: '',
    GIT_ADDRESS: '',
    BRANCH: '',
    USER_UPLOAD: '0',
    AUTO_UPDATE: '0',
    USERNAME: '',
    ACCESS_TOKEN: '',
    REQUIREMENTS_FILE: 'requirements.txt',
  },
};

const EMOJI = {
  heart:      { fallback: '💜', id: '6271768127613178904' },
  heartBlack: { fallback: '🖤', id: '5463319913726755421' },
  shield:     { fallback: '🛡️', id: '6122834518807157701' },
  bolt:       { fallback: '⚡',  id: '6165913289894140111' },
  scroll:     { fallback: '📜', id: '6323096332579899122' },
  book:       { fallback: '📖', id: '5974560986344983722' },
  tools:      { fallback: '🛠️', id: '6323218545874306931' },
  back:       { fallback: '🔙', id: '5253997076169115797' },
  check:      { fallback: '✅', id: '6122664859009031604' },
  cross:      { fallback: '❌', id: '6122712498786276439' },
  user:       { fallback: '👤', id: '5350778980158956492' },
  users:      { fallback: '👥', id: '5244933196230972438' },
  robot:      { fallback: '🤖', id: '6300683629861280494' },
  clock:      { fallback: '⏰', id: '5319272710688226013' },
  chart:      { fallback: '📊', id: '5028746137645876535' },
  banned:     { fallback: '🚫', id: '5776064103483184336' },
  stop:       { fallback: '⛔', id: '5852487725051023314' },
  warning:    { fallback: '⚠️', id: '6136702555889084621' },
  pencil:     { fallback: '📝', id: '5253451288905006321' },
  hourglass:  { fallback: '⏳', id: '6113844439292054570' },
  hash:       { fallback: '🔢', id: '5226929552319594190' },
  point:      { fallback: '☝️', id: '5193084595846795612' },
  mobile:     { fallback: '📱', id: '5334998226636390258' },
  wave:       { fallback: '👋', id: '5440431182602842059' },
  refresh:    { fallback: '🔄', id: '5452002073606384268' },
  online:     { fallback: '🟢', id: '5832572966721818453' },
  offline:    { fallback: '🔴', id: '5372930759319379174' },
  lock:       { fallback: '🔒', id: '5296369303661067030' },
  siren:      { fallback: '🚨', id: '5427347926240221093' },
  step1:      { fallback: '1️⃣', id: '6123022479460932232' },
  step2:      { fallback: '2️⃣', id: '6122912996449591253' },
  step3:      { fallback: '3️⃣', id: '6122763385558801623' },
  step4:      { fallback: '4️⃣', id: '5188675391010645868' },
  step5:      { fallback: '5️⃣', id: '5776027703635349399' },
  panel:      { fallback: '🖥️', id: '5888877522661150311' },
  python:     { fallback: '💻', id: '5260480440971570446' },
  nodejs:     { fallback: '🔰', id: '5766954623877256630' },
  link:       { fallback: '🔗', id: '6028171274939797252' },
  server:     { fallback: '📋', id: '6323602795123443087' },
  gift:       { fallback: '🎁', id: '5449800250032143374' },
  party:      { fallback: '🎉', id: '5854804842727346200' },
  broadcast:  { fallback: '📢', id: '5213391561999526028' },
  settings:   { fallback: '⚙️', id: '6208565922915949253' },
  key:        { fallback: '🔑', id: '5420094143089111506' },
  email:      { fallback: '📧', id: '5303416490295304868' },
  crown:      { fallback: '👑', id: '5992236713798274417' },
};

function px(key) {
  const e = EMOJI[key];
  if (!e) return '';
  if (!e.id) return e.fallback;
  return `<tg-emoji emoji-id="${e.id}">${e.fallback}</tg-emoji>`;
}

const USE_CUSTOM_BUTTON_ICONS = true;
function btn(key, label, extra, style) {
  const e = EMOJI[key];
  const b = { text: toSC(label), ...extra };
  if (e) {
    if (USE_CUSTOM_BUTTON_ICONS && e.id) b.icon_custom_emoji_id = e.id;
    else b.text = `${e.fallback} ${b.text}`;
  }
  if (style) b.style = style;
  return b;
}

const DB_DIR       = path.join(__dirname, 'database');
const USERS_FILE   = path.join(DB_DIR, 'users.json');
const SERVERS_FILE = path.join(DB_DIR, 'servers.json');
const CODES_FILE   = path.join(DB_DIR, 'codes.json');

if (!fs.existsSync(DB_DIR))       fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE))   fs.writeFileSync(USERS_FILE,   '{}');
if (!fs.existsSync(SERVERS_FILE)) fs.writeFileSync(SERVERS_FILE, '{}');
if (!fs.existsSync(CODES_FILE))   fs.writeFileSync(CODES_FILE,   '{}');

const readJSON = (file) => {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch { return {}; }                       // file missing -> empty db
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('database root is not an object');
    return data;
  } catch (e) {
    // NEVER silently wipe a corrupted database: keep a timestamped backup copy, then start empty.
    const bak = `${file}.corrupt-${Date.now()}.bak`;
    try { fs.copyFileSync(file, bak); } catch {}
    console.error(`[DB] Corrupted JSON in ${path.basename(file)} (${e.message}). Backup saved to ${path.basename(bak)} - starting with an empty file. Restore the backup manually if the records are needed.`);
    return {};
  }
};
const writeJSON = (file, data) => {
  // Atomic write: write to a temp file, then rename over the target (crash-safe).
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
};

const db = {
  getUser(id) {
    return readJSON(USERS_FILE)[String(id)] || null;
  },
  saveUser(id, data) {
    const users = readJSON(USERS_FILE);
    users[String(id)] = { ...users[String(id)], ...data };
    writeJSON(USERS_FILE, users);
  },
  getAllUsers() { return readJSON(USERS_FILE); },
  getServers(id) { return readJSON(SERVERS_FILE)[String(id)] || []; },
  addServer(id, serverData) {
    const servers = readJSON(SERVERS_FILE);
    if (!servers[String(id)]) servers[String(id)] = [];
    servers[String(id)].push(serverData);
    writeJSON(SERVERS_FILE, servers);
  },
  getAllServers() { return readJSON(SERVERS_FILE); },
};

const SETTINGS_FILE = path.join(DB_DIR, 'settings.json');
function getSettings() {
  const defaults = { refsNeeded: 5, refsPerServer: 5, pointsPerReferral: 1, botPic: DEFAULT_BOT_PIC, forceChannels: null };
  return { ...defaults, ...readJSON(SETTINGS_FILE) };
}
function saveSettings(patchSet) { writeJSON(SETTINGS_FILE, { ...getSettings(), ...patchSet }); }

// Force-join channels are managed from the Admin Panel (settings.forceChannels =
// array of channel usernames). null = built-in defaults; [] = force-join disabled.
function getForceChannels() {
  const saved = getSettings().forceChannels;
  const list = Array.isArray(saved) ? saved : REQUIRED_CHANNELS.map(c => c.username);
  return list.map(u => ({ username: u, name: u, link: 'https://t.me/' + u }));
}

// Redeem codes: { CODE: { points, createdBy, createdAt, usedBy, usedAt } }
const getCodes  = () => readJSON(CODES_FILE);
const saveCodes = (c) => writeJSON(CODES_FILE, c);
function genRedeemCode(existing) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    let s = '';
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    code = 'CRX-' + s;
  } while (existing[code]);
  return code;
}
function isBannedUser(id) { const u = db.getUser(id); return !!(u && u.banned); }

const toSC = (text) => {
  const m = {
    'a':'ᴀ','b':'ʙ','c':'ᴄ','d':'ᴅ','e':'ᴇ','f':'ғ','g':'ɢ','h':'ʜ','i':'ɪ','j':'ᴊ',
    'k':'ᴋ','l':'ʟ','m':'ᴍ','n':'ɴ','o':'ᴏ','p':'ᴘ','q':'Q','r':'ʀ','s':'ꜱ','t':'ᴛ',
    'u':'ᴜ','v':'ᴠ','w':'ᴡ','x':'x','y':'ʏ','z':'ᴢ',
    'A':'ᴀ','B':'ʙ','C':'ᴄ','D':'ᴅ','E':'ᴇ','F':'ғ','G':'ɢ','H':'ʜ','I':'ɪ','J':'ᴊ',
    'K':'ᴋ','L':'ʟ','M':'ᴍ','N':'ɴ','O':'ᴏ','P':'ᴘ','Q':'Q','R':'ʀ','S':'ꜱ','T':'ᴛ',
    'U':'ᴜ','V':'ᴠ','W':'ᴡ','X':'x','Y':'ʏ','Z':'ᴢ',
  };
  return text.split('').map(c => m[c] || c).join('');
};

const escHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const genEmail = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for (let i = 0; i < 10; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return `${r}@crittix.dev`;
};


const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const PREMIUM_FALLBACK = Object.fromEntries(Object.values(EMOJI).filter(e => e.id).map(e => [e.id, e.fallback]));
function stripPremium(v) {
  if (typeof v === 'string') return v.replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/g, '$1');
  if (Array.isArray(v)) return v.map(stripPremium);
  if (v && Object.getPrototypeOf(v) === Object.prototype) {
    const o = {};
    for (const [k, val] of Object.entries(v)) if (k !== 'icon_custom_emoji_id') o[k] = stripPremium(val);
    if (v.icon_custom_emoji_id && typeof o.text === 'string') o.text = `${PREMIUM_FALLBACK[v.icon_custom_emoji_id] || ''} ${o.text}`.trim();
    return o;
  }
  return v;
}

for (const name of ['sendMessage', 'sendPhoto', 'sendAnimation', 'sendVideo', 'editMessageText', 'editMessageCaption']) {
  const orig = bot[name].bind(bot);
  bot[name] = async (...args) => {
    try { return await orig(...args); }
    catch (err) {
      if (!/DOCUMENT_INVALID/.test(err.message || '')) throw err;
      console.error(chalk.yellow(`[premium emoji] invalid emoji ID in ${name} – retrying with normal emoji`));
      return orig(...stripPremium(args));
    }
  };
}

bot.on('polling_error', (e) => console.error(chalk.red('Polling error:'), e.message));

console.log(chalk.red('「𖦠」'.repeat(20)));
console.log(chalk.white('       「𖦠」 zvxay ᴘᴛᴇʀᴏᴅᴀᴄᴛʏʟ ʙᴏᴛ 「𖦠」'));
console.log(chalk.red('       ᴄʀᴇᴀᴛᴇᴅ ʙʏ: 𝐋𝐎𝐑𝐃 ♰ Zvxay  |  Telegram: @Zvxay_papa'));
console.log(chalk.red('「𖦠」'.repeat(20)));

const msgSlots = new Map();
const slot = (chatId) => {
  const k = String(chatId);
  if (!msgSlots.has(k)) msgSlots.set(k, { temp: null, menu: null });
  return msgSlots.get(k);
};
const deleteMsg = (chatId, id) => id ? bot.deleteMessage(chatId, id).catch(() => {}) : Promise.resolve();
const clearTemp = async (chatId) => {
  const s = slot(chatId);
  if (!s.temp) return;
  const id = s.temp; s.temp = null;
  await deleteMsg(chatId, id);
};

async function tsend(chatId, text, options) {
  await clearTemp(chatId);
  const sent = await bot.sendMessage(chatId, text, options);
  slot(chatId).temp = sent.message_id;
  return sent;
}

async function sendMenuMedia(chatId, caption, keyboard) {
  const opts = { caption, parse_mode: 'HTML', reply_markup: keyboard };
  const pic     = getSettings().botPic || DEFAULT_BOT_PIC;
  const isImage = /\.(jpe?g|png|webp)(\?.*)?$/i.test(pic);
  const isGif   = /\.gif(\?.*)?$/i.test(pic);
  try {
    if (isImage) return await bot.sendPhoto(chatId, pic, opts);
    if (isGif)   return await bot.sendAnimation(chatId, pic, opts);
    return await bot.sendVideo(chatId, pic, opts);
  } catch (err) {
    console.error(chalk.red('sendMenuMedia photo failed:'), err.message);
    return await bot.sendMessage(chatId, caption, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch((e) => { console.error(chalk.red('sendMenuMedia text failed:'), e.message); return null; });
  }
}

async function editMenu(chatId, msgId, caption, keyboard) {
  try {
    await bot.editMessageCaption(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: keyboard });
  } catch {
    await bot.editMessageText(caption, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', reply_markup: keyboard })
      .catch((e) => { if (!/not modified/i.test(e.message)) console.error(chalk.red('editMenu failed:'), e.message); });
  }
}

async function checkChannels(userId) {
  if (isAdmin(userId)) return { verified: true, missing: [] };
  const missing = [];
  for (const ch of getForceChannels()) {
    try {
      const member = await bot.getChatMember('@' + ch.username, userId);
      if (!member || ['left', 'kicked'].includes(member.status)) missing.push(ch);
    } catch {
      missing.push(ch);
    }
  }
  return { verified: missing.length === 0, missing };
}

function joinKeyboard(missing) {
  return {
    inline_keyboard: [
      ...missing.map(ch => [{ text: `「𖦠」 ${ch.name}`, url: ch.link, style: 'primary' }]),
      [btn('check', 'Verify Joined', { callback_data: 'verify_channels' }, 'success')],
    ],
  };
}


function getUserRef(userId) {
  let user = db.getUser(userId);
  if (!user) {
    user = { id: String(userId), refs: [], giftedSlots: 0 };
    db.saveUser(userId, user);
  }
  return db.getUser(userId);
}

function getReferralLink(userId, botUsername) {
  return `https://t.me/${botUsername}?start=ref_${userId}`;
}

function getUnlockedSlots(user) {
  const refSlots    = Math.floor((user.refs || []).length / getSettings().refsPerServer);
  const giftedSlots = user.giftedSlots || 0;
  return refSlots + giftedSlots;
}

function getUsedSlots(userId) {
  return db.getServers(userId).length;
}

function buildMainCaption(firstName, userId) {
  const isOwner = isAdmin(userId);
  const user    = getUserRef(userId);
  const refs    = (user.refs || []).length;
  const slots   = getUnlockedSlots(user);
  const used    = getUsedSlots(userId);
  const _s      = getSettings();
  const need    = slots === 0
    ? _s.refsNeeded - refs
    : _s.refsPerServer - (refs % _s.refsPerServer || _s.refsPerServer);

  return (
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    `╠✤│ ${px('crown')} ${toSC('Crittix Pterodactyl')}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('user')} ${toSC('User')} : ${escHtml(firstName)}\n` +
    `╠✤│ ${px('shield')} ${toSC('Status')} : ${isOwner ? toSC('Commander') : toSC('Active')}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('users')} ${toSC('Referrals')} : ${refs}\n` +
    `╠✤│ ${px('server')} ${toSC('Panel Slots')} : ${used}/${isOwner ? '∞' : slots}\n` +
    `╠✤│ ${px('bolt')} ${toSC('Next slot in')} : ${isOwner ? toSC('N/A') : `${need} ${toSC('more refs')}`}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('link')} ${toSC('Refer')} ${_s.refsNeeded} ${toSC('people to get your first panel')}\n` +
    `╠✤│ ${px('refresh')} ${toSC('Every')} ${_s.refsPerServer} ${toSC('more refs adds another server')}\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣</blockquote>`
  );
}

function buildMainKeyboard(userId) {
  const isOwner = isAdmin(userId);
  const rows = [
    [
      btn('panel', 'Create Panel', { callback_data: 'create_panel' }, 'success'),
      btn('users', 'My Referrals', { callback_data: 'my_referrals' }, 'primary'),
    ],
    [
      btn('link', 'Referral Link', { callback_data: 'referral_link' }, 'primary'),
      btn('server', 'My Servers', { callback_data: 'my_servers' }, 'primary'),
    ],
    [
      btn('key', 'Redeem Code', { callback_data: 'redeem_code' }, 'success'),
    ],
  ];
  if (isOwner) rows.push([btn('settings', 'Admin Panel', { callback_data: 'lord_settings' }, 'danger')]);
  rows.push([{ text: `𝗧𝗛𝗘 𝗟𝗢𝗥𝗗`, url: DEVELOPER_LINK, style: 'primary' }]);
  return { inline_keyboard: rows };
}

async function sendMainMenu(chatId, firstName, userId) {
  const s = slot(chatId);
  await clearTemp(chatId);
  if (s.menu) { const old = s.menu; s.menu = null; await deleteMsg(chatId, old); }
  const sent = await sendMenuMedia(chatId, buildMainCaption(firstName, userId), buildMainKeyboard(userId));
  if (sent) s.menu = sent.message_id;
}

const pteroApi = axios.create({
  baseURL: `${PTERO_URL}/api/application`,
  timeout: 120000,
  headers: {
    Authorization: `Bearer ${PTERO_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

// One-time startup check of the panel connection + API key. Never blocks the
// Telegram side of the bot; it only makes panel problems obvious in the log.
async function pteroSelfCheck() {
  if (PTERO_KEY.startsWith('ptlc_')) {
    console.error(chalk.red('[PTERO] WARNING: PTERODACTYL_API_KEY starts with "ptlc_" - that is a CLIENT API key.'));
    console.error(chalk.red('[PTERO] Panel/user creation needs an APPLICATION API key ("ptla_...") from Panel -> Admin -> Application API.'));
  }
  try {
    const res = await pteroApi.get('/locations', { params: { per_page: 1 } });
    const total = res.data?.meta?.pagination?.total ?? (res.data?.data || []).length;
    console.log(chalk.green(`[PTERO] Panel connected: ${PTERO_URL} (${total} location(s) visible)`));
  } catch (e) {
    const detail = e.response?.data?.errors?.[0]?.detail || e.message;
    console.error(chalk.red(`[PTERO] Panel check FAILED (${e.response?.status || 'no response'}): ${detail}`));
    console.error(chalk.red('[PTERO] Server creation will not work until the panel URL + Application API key are correct.'));
  }
}

async function pteroCreateUser(email, username, password) {
  const res = await pteroApi.post('/users', {
    email,
    username,
    first_name: username,
    last_name: 'crittix',
    password,
  });
  return res.data.attributes;
}

// Fetch ALL pages of a Pterodactyl application API list endpoint.
async function pteroGetAll(url) {
  const items = [];
  let page = 1;
  while (true) {
    const res = await pteroApi.get(url, { params: { page, per_page: 100 } });
    items.push(...(res.data?.data || []));
    const totalPages = res.data?.meta?.pagination?.total_pages || 1;
    if (page >= totalPages) break;
    page++;
  }
  return items;
}

async function pteroCreateServer(username, userId, eggType, password) {
  const email  = genEmail();
  const ptUser = await pteroCreateUser(email, username, password);

  // From here on, any failure must clean up ONLY the panel user created above,
  // so failed attempts never leave orphan accounts on the panel.
  try {
    const egg = eggType === 'nodejs' ? NODEJS_EGG : PYTHON_EGG;

    // Locate the egg on the panel: by configured Egg ID if set, otherwise by
    // verified egg name (case-insensitive). Nothing is assumed or hardcoded.
    const wantedEggId = eggType === 'nodejs' ? PTERO_NODEJS_EGG_ID : PTERO_PYTHON_EGG_ID;
    let eggId = null, nestId = null;
    const nests = await pteroGetAll('/nests');
    for (const nest of nests) {
      const eggs = await pteroGetAll(`/nests/${nest.attributes.id}/eggs`);
      for (const e of eggs) {
        const match = wantedEggId
          ? String(e.attributes.id) === String(wantedEggId)
          : String(e.attributes.name).trim().toLowerCase() === egg.name.trim().toLowerCase();
        if (match) { eggId = e.attributes.id; nestId = nest.attributes.id; break; }
      }
      if (eggId) break;
    }
    if (!eggId) throw new Error(wantedEggId
      ? `Egg ID ${wantedEggId} not found on panel`
      : `${toSC('Egg not found on panel:')} ${egg.name}`);

    // auto-discover location (configured ID/short code wins, otherwise first)
    const locs = (await pteroGetAll('/locations')).map(l => l.attributes);
    let loc = null;
    if (PTERO_LOCATION) {
      loc = locs.find(l => String(l.id) === PTERO_LOCATION || String(l.short).toLowerCase() === PTERO_LOCATION.toLowerCase());
      if (!loc) console.error(chalk.yellow(`PTERODACTYL_LOCATION_ID "${PTERO_LOCATION}" not found – using first location. Available: ${locs.map(l => `${l.id}=${l.short}`).join(', ')}`));
    }
    loc = loc || locs[0];
    const locationId = loc?.id;
    if (!locationId) throw new Error(toSC('No location found on panel'));

    const serverRes = await pteroApi.post('/servers', {
      name:         `${username}-${eggType}`,
      user:         ptUser.id,
      egg:          eggId,
      docker_image: egg.dockerImage,
      startup:      egg.startup,
      environment:  egg.environment,
      limits:       { memory: 0, swap: 0, disk: 0, io: 500, cpu: 0 },   // 0 = unlimited (swap 0 = off, io must be 10-1000)
      feature_limits: { databases: 1, allocations: 1, backups: 1 },
      // NOTE: no "allocation" field here - the deploy block below makes the
      // panel pick a free allocation in the chosen location automatically.
      deploy:       { locations: [locationId], dedicated_ip: false, port_range: [] },
    });

    return {
      server:   serverRes.data.attributes,
      ptUser,
      email,
      panelUrl: `${PTERO_URL}/server/${serverRes.data.attributes.identifier}`,
      loginUrl: PTERO_URL,
    };
  } catch (err) {
    try {
      await pteroApi.delete(`/users/${ptUser.id}`);
      console.error(chalk.yellow(`Cleaned up unused panel user ${ptUser.id} after failed server creation`));
    } catch (delErr) {
      console.error(chalk.red('Could not clean up unused panel user:'), delErr.message);
    }
    throw err;
  }
}

const userState = new Map();
const creatingNow = new Set();   // telegram ids with a panel creation already in progress
const setState  = (userId, state) => userState.set(String(userId), state);
const getState  = (userId)        => userState.get(String(userId)) || null;
const clearState = (userId)       => userState.delete(String(userId));

const cancelKeyboard = {
  inline_keyboard: [[btn('cross', 'Cancel', { callback_data: 'cancel_flow' }, 'danger')]],
};

bot.onText(/\/start(.*)/, async (msg, match) => {
  if (msg.chat.type !== 'private') return;
  const chatId    = msg.chat.id;
  const userId    = msg.from.id;
  const firstName = msg.from.first_name || 'Raider';
  const username  = msg.from.username   || 'unknown';
  const param     = (match[1] || '').trim();

  if (isBannedUser(userId) && !isAdmin(userId)) {
    return tsend(chatId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('banned')} ${toSC('You are banned from using this bot')}\n` +
      `╠✤│ ${px('book')} ${toSC('Contact the admin if this is a mistake')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { parse_mode: 'HTML' }
    );
  }

  if (param.startsWith('ref_')) {
    const referrerId = param.replace('ref_', '');
    if (referrerId !== String(userId) && String(referrerId) !== OWNER_ID) {
      const referrer      = getUserRef(referrerId);
      const alreadyCounted = (referrer.refs || []).includes(String(userId));
      if (!alreadyCounted) {
        const existing = db.getUser(userId) || {};
        db.saveUser(userId, { ...existing, pendingReferrer: referrerId });
      }
    }
  }

  const existing = db.getUser(userId) || {};
  db.saveUser(userId, { ...existing, id: String(userId), username, firstName });

  const ver = await checkChannels(userId);
  if (!ver.verified) {
    const list = ver.missing.map(ch => `╠✤│ ${px('lock')} <a href="${ch.link}">${ch.name}</a>`).join('\n');
    return tsend(chatId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('siren')} ${toSC('Join Required Channels')}\n` +
      `╠✤│\n${list}\n╠✤│\n` +
      `╠✤│ ${px('check')} ${toSC('Join all then tap Verify')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { parse_mode: 'HTML', reply_markup: joinKeyboard(ver.missing) }
    );
  }

  await processPendingReferral(userId);
  await sendMainMenu(chatId, firstName, userId);
});

async function processPendingReferral(userId) {
  const user = db.getUser(userId);
  if (!user || !user.pendingReferrer) return;
  const referrerId = user.pendingReferrer;

  const referrer       = getUserRef(referrerId);
  const alreadyCounted = (referrer.refs || []).includes(String(userId));

  if (!alreadyCounted) {
    const perRef = Math.max(1, getSettings().pointsPerReferral || 1);
    const updatedRefs = [...(referrer.refs || []), String(userId)];
    for (let i = 1; i < perRef; i++) updatedRefs.push(`refbonus_${Date.now()}_${i}`);
    db.saveUser(referrerId, { ...referrer, refs: updatedRefs });

    const newTotal  = updatedRefs.length;
    const newSlots  = Math.floor(newTotal / getSettings().refsPerServer);
    const prevSlots = Math.floor((newTotal - 1) / getSettings().refsPerServer);

    if (newTotal % getSettings().refsPerServer === 0 && newSlots > prevSlots) {
      bot.sendMessage(referrerId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('party')} ${toSC('New Server Slot Unlocked')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('server')} ${toSC('You now have')} ${newSlots} ${toSC('slot(s)')}\n` +
        `╠✤│ ${px('panel')} ${toSC('Use Create Panel to deploy')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } else if (newTotal === getSettings().refsNeeded && newSlots === 1 && prevSlots === 0) {
      bot.sendMessage(referrerId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('party')} ${toSC('You Can Now Create Your Panel')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('check')} ${toSC('Referrals complete')}\n` +
        `╠✤│ ${px('panel')} ${toSC('Tap Create Panel to begin')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } else {
      const need = getSettings().refsPerServer - (newTotal % getSettings().refsPerServer);
      bot.sendMessage(referrerId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('users')} ${toSC('New Referral')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('chart')} ${toSC('Total refs')}: ${newTotal}\n` +
        `╠✤│ ${px('bolt')} ${toSC('Need')} ${need} ${toSC('more for next slot')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  }

  db.saveUser(userId, { ...db.getUser(userId), pendingReferrer: null });
}

bot.on('callback_query', async (cq) => {
  const data      = cq.data;
  const chatId    = cq.message.chat.id;
  const msgId     = cq.message.message_id;
  const userId    = cq.from.id;
  const firstName = cq.from.first_name || 'Raider';
  const isOwner   = String(userId) === OWNER_ID;
  const isAdminUser = isAdmin(userId);
  if (!isAdminUser && isBannedUser(userId)) return;

  await bot.answerCallbackQuery(cq.id).catch(() => {});

  if (data === 'verify_channels') {
    const ver = await checkChannels(userId);
    if (!ver.verified) {
      const list = ver.missing.map(ch => `╠✤│ ${px('lock')} <a href="${ch.link}">${ch.name}</a>`).join('\n');
      return tsend(chatId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('cross')} ${toSC('Still Missing')}\n` +
        `╠✤│\n${list}\n╠✤│\n` +
        `╠✤│ ${toSC('Join all then tap Verify again')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML', reply_markup: joinKeyboard(ver.missing) }
      );
    }
    await processPendingReferral(userId);
    await deleteMsg(chatId, msgId);
    return sendMainMenu(chatId, firstName, userId);
  }

  if (data === 'cancel_flow') {
    clearState(userId);
    await clearTemp(chatId);
    return sendMainMenu(chatId, firstName, userId);
  }

  if (data === 'menu_back') {
    clearState(userId);
    const s = slot(chatId);
    return editMenu(chatId, s.menu || msgId, buildMainCaption(firstName, userId), buildMainKeyboard(userId));
  }

  if (data === 'referral_link') {
    const me   = await bot.getMe();
    const link = getReferralLink(userId, me.username);
    const user = getUserRef(userId);
    return editMenu(chatId, msgId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('link')} ${toSC('Your Referral Link')}\n` +
      `╠✤│\n` +
      `╠✤│ <code>${escHtml(link)}</code>\n` +
      `╠✤│\n` +
      `╠✤│ ${px('users')} ${toSC('Refs')}: ${(user.refs || []).length}\n` +
      `╠✤│ ${px('server')} ${toSC('Slots unlocked')}: ${getUnlockedSlots(user)}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('bolt')} ${toSC('Share link to earn slots')}\n` +
      `╠✤│ ${px('check')} ${toSC('Each ref must join all channels')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { inline_keyboard: [[btn('link', 'Copy Link', { copy_text: { text: link } }, 'success')], [btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')]] }
    );
  }

  if (data === 'my_referrals') {
    const user  = getUserRef(userId);
    const refs  = user.refs || [];
    const slots = getUnlockedSlots(user);
    const _st   = getSettings();
    const need  = slots === 0
      ? _st.refsNeeded - refs.length
      : _st.refsPerServer - (refs.length % _st.refsPerServer || _st.refsPerServer);
    return editMenu(chatId, msgId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('users')} ${toSC('My Referrals')}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('chart')} ${toSC('Total refs')}: ${refs.length}\n` +
      `╠✤│ ${px('server')} ${toSC('Slots unlocked')}: ${slots}\n` +
      `╠✤│ ${px('panel')} ${toSC('Slots used')}: ${getUsedSlots(userId)}\n` +
      `╠✤│ ${px('gift')} ${toSC('Gifted slots')}: ${user.giftedSlots || 0}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('bolt')} ${toSC('Next slot in')}: ${refs.length === 0 ? _st.refsNeeded : need} ${toSC('more refs')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { inline_keyboard: [[btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')]] }
    );
  }

  if (data === 'my_servers') {
    const servers = db.getServers(userId);
    if (!servers.length) {
      return editMenu(chatId, msgId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('server')} ${toSC('My Servers')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('cross')} ${toSC('No servers yet')}\n` +
        `╠✤│ ${px('panel')} ${toSC('Create a panel to get started')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
      { inline_keyboard: [[btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')]] }
      );
    }
    const shown  = servers.slice(-6);
    const hidden = servers.length - shown.length;
    const lines  = shown.map((s, i) =>
      `╠✤│ ${hidden + i + 1}. ${escHtml(s.name)} (${s.type})\n╠✤│    ${px('link')} <a href="${escHtml(s.panelUrl)}">${toSC('Open Panel')}</a>`
    ).join('\n╠✤│\n') + (hidden > 0 ? `\n╠✤│\n╠✤│ +${hidden} ${toSC('older servers')}` : '');
    return editMenu(chatId, msgId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('server')} ${toSC('My Servers')}\n` +
      `╠✤│\n${lines}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { inline_keyboard: [[btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')]] }
    );
  }

  if (data === 'redeem_code') {
    setState(userId, { step: 'redeem_code' });
    return tsend(chatId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('key')} ${toSC('Redeem Code')}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('pencil')} ${toSC('Send your redeem code to get free points')}\n` +
      `╠✤│ ${px('book')} ${toSC('Example')}: CRX-AB12CD34\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { parse_mode: 'HTML', reply_markup: cancelKeyboard }
    );
  }

  if (data === 'create_panel') {
    const user  = getUserRef(userId);
    const slots = isAdminUser ? 999 : getUnlockedSlots(user);
    const used  = getUsedSlots(userId);

    if (slots === 0) {
      const refs = (user.refs || []).length;
      return tsend(chatId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('lock')} ${toSC('No Panel Slot Available')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('users')} ${toSC('You need')} ${getSettings().refsNeeded} ${toSC('referrals to unlock your first panel')}\n` +
        `╠✤│ ${px('chart')} ${toSC('Current refs')}: ${refs}\n` +
        `╠✤│ ${px('bolt')} ${toSC('Need')}: ${getSettings().refsNeeded - refs} ${toSC('more')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('link')} ${toSC('Get your referral link from the menu')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')]] } }
      );
    }

    if (!isAdminUser && used >= slots) {
      return tsend(chatId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('lock')} ${toSC('All Slots Used')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('server')} ${toSC('Slots used')}: ${used}/${slots}\n` +
        `╠✤│ ${px('users')} ${toSC('Refer')} ${getSettings().refsPerServer} ${toSC('more people to get another slot')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')]] } }
      );
    }

    setState(userId, { step: 'ask_username' });
    return tsend(chatId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('panel')} ${toSC('Create Panel')} (1/3)\n` +
      `╠✤│\n` +
      `╠✤│ ${px('pencil')} ${toSC('Enter your desired username for the pterodactyl panel')}\n` +
      `╠✤│ ${px('book')} ${toSC('Letters, numbers and underscore only')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { parse_mode: 'HTML', reply_markup: cancelKeyboard }
    );
  }

  if (data === 'egg_nodejs' || data === 'egg_python') {
    const state = getState(userId);
    if (!state || state.step !== 'ask_egg') return;
    if (creatingNow.has(String(userId))) return;   // double-tap guard: creation already running
    state.eggType = data === 'egg_nodejs' ? 'nodejs' : 'python';
    setState(userId, state);
    return handlePanelCreation(chatId, userId);
  }

  if (data === 'admin_broadcast') {
    if (!isAdminUser) return;
    return tsend(chatId,
      `<blockquote>╠✤│ ${px('book')} ${toSC('Usage')}: /broadcast &lt;message&gt;</blockquote>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')]] } }
    );
  }

  if (data && data.startsWith('admin_')) {
    if (!isAdminUser) return;
    return handleAdminCallback(cq, data, chatId, msgId, userId);
  }

  if (data === 'lord_settings') {
    if (!isAdminUser) return bot.answerCallbackQuery(cq.id, { text: toSC('Owner only!'), show_alert: true }).catch(() => {});
    return sendLordSettings(chatId, msgId);
  }
});

bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private') return;
  if (msg.text && msg.text.startsWith('/')) return;

  const chatId    = msg.chat.id;
  const userId    = msg.from.id;
  const text      = (msg.text || '').trim();
  const state     = getState(userId);

  if (isBannedUser(userId) && !isAdmin(userId)) return;
  if (state && state.step && state.step.startsWith('admin_')) {
    if (!isAdmin(userId)) { clearState(userId); return; }
    return handleAdminState(msg, state, text);
  }

  if (!state) return;

  if (state.step === 'redeem_code') {
    clearState(userId);
    const code = text.toUpperCase().replace(/\s+/g, '');
    const codes = getCodes();
    const entry = codes[code];
    const box = (inner) =>
      `<blockquote>╔════════════════▣\n┊✺┌────     ──⊷\n${inner}\n┊✺└────••••────⊷\n╚════════════════▣</blockquote>`;
    if (!entry) {
      return tsend(chatId, box(`╠✤│ ${px('cross')} ${toSC('Invalid code. Check the code and try again')}`),
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[btn('back', 'Back to Menu', { callback_data: 'menu_back' }, 'primary')]] } });
    }
    if (entry.usedBy) {
      return tsend(chatId, box(`╠✤│ ${px('cross')} ${toSC('This code has already been used')}`),
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[btn('back', 'Back to Menu', { callback_data: 'menu_back' }, 'primary')]] } });
    }
    entry.usedBy = String(userId);
    entry.usedAt = Date.now();
    saveCodes(codes);
    const u = getUserRef(userId);
    const refs = [...(u.refs || [])];
    for (let i = 0; i < entry.points; i++) refs.push(`code_${code}_${Date.now()}_${i}`);
    db.saveUser(userId, { ...u, refs });
    return tsend(chatId, box(
      `╠✤│ ${px('check')} ${toSC('Code Redeemed')}\n╠✤│\n` +
      `╠✤│ ${px('hash')} ${toSC('Points added')}: +${entry.points}\n` +
      `╠✤│ ${px('chart')} ${toSC('Your total points')}: ${refs.length}`),
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[btn('back', 'Back to Menu', { callback_data: 'menu_back' }, 'primary')]] } });
  }

  if (state.step === 'ask_username') {
    if (!text || !/^[a-zA-Z0-9_]{3,16}$/.test(text)) {
      return tsend(chatId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('cross')} ${toSC('Invalid Username')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('book')} ${toSC('3 to 16 characters, letters numbers and underscore only')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML', reply_markup: cancelKeyboard }
      );
    }
    state.username = text.toLowerCase();
    state.step     = 'ask_password';
    setState(userId, state);
    return tsend(chatId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('panel')} ${toSC('Create Panel')} (2/3)\n` +
      `╠✤│\n` +
      `╠✤│ ${px('key')} ${toSC('Enter a password for your panel account')}\n` +
      `╠✤│ ${px('book')} ${toSC('Minimum 8 characters')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { parse_mode: 'HTML', reply_markup: cancelKeyboard }
    );
  }

  if (state.step === 'ask_password') {
    if (!text || text.length < 8) {
      return tsend(chatId,
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('cross')} ${toSC('Password Too Short')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('book')} ${toSC('Minimum 8 characters required')}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`,
        { parse_mode: 'HTML', reply_markup: cancelKeyboard }
      );
    }
    state.password = text;
    state.step     = 'ask_egg';
    setState(userId, state);
    bot.deleteMessage(chatId, msg.message_id).catch(() => {});   // remove the password from chat history where Telegram allows it
    return tsend(chatId,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('panel')} ${toSC('Create Panel')} (3/3)\n` +
      `╠✤│\n` +
      `╠✤│ ${px('tools')} ${toSC('Choose your server type')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              btn('nodejs', 'Node.js', { callback_data: 'egg_nodejs' }, 'success'),
              btn('python', 'Python', { callback_data: 'egg_python' }, 'primary'),
            ],
            [btn('cross', 'Cancel', { callback_data: 'cancel_flow' }, 'danger')],
          ],
        },
      }
    );
  }
});

async function handlePanelCreation(chatId, userId) {
  const state = getState(userId);
  if (!state) return;
  if (creatingNow.has(String(userId))) return;   // one creation at a time per user
  creatingNow.add(String(userId));

  const creating = await tsend(chatId,
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    `╠✤│ ${px('hourglass')} ${toSC('Creating Your Panel')}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('user')} ${toSC('Username')}: ${escHtml(state.username)}\n` +
    `╠✤│ ${px('tools')} ${toSC('Type')}: ${state.eggType}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('refresh')} ${toSC('Please wait this may take a moment')}\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣</blockquote>`,
    { parse_mode: 'HTML' }
  );

  try {
    const result = await pteroCreateServer(state.username, userId, state.eggType, state.password);
    clearState(userId);
    creatingNow.delete(String(userId));

    db.addServer(userId, {
      name:      result.server.name,
      type:      state.eggType,
      panelUrl:  result.panelUrl,
      serverId:  result.server.identifier,
      ptUserId:  result.ptUser.id,
      email:     result.email,
      createdAt: Date.now(),
    });

    // Notify all admins about the new panel, with the panel login details.
    {
      const creator = db.getUser(userId) || {};
      const adminText =
        `<blockquote>╔════════════════▣\n` +
        `┊✺┌────     ──⊷\n` +
        `╠✤│ ${px('panel')} ${toSC('New Panel Created')}\n` +
        `╠✤│\n` +
        `╠✤│ ${px('user')} ${toSC('User')}: ${escHtml(creator.firstName || '-')} ${creator.username ? '(@' + escHtml(creator.username) + ')' : ''}\n` +
        `╠✤│ ${px('hash')} ${toSC('Telegram ID')}: <code>${escHtml(userId)}</code>\n` +
        `╠✤│ ${px('user')} ${toSC('Panel Username')}: <code>${escHtml(state.username)}</code>\n` +
        `╠✤│ ${px('key')} ${toSC('Panel Password')}: <code>${escHtml(state.password)}</code>\n` +
        `╠✤│ ${px('email')} ${toSC('Email')}: <code>${escHtml(result.email)}</code>\n` +
        `╠✤│ ${px('tools')} ${toSC('Type')}: ${state.eggType}\n` +
        `╠✤│ ${px('server')} ${toSC('Server')}: ${escHtml(result.server.name)}\n` +
        `┊✺└────••••────⊷\n` +
        `╚════════════════▣</blockquote>`;
      for (const aid of ADMIN_IDS) {
        if (String(aid) === String(userId)) continue;
        bot.sendMessage(aid, adminText, { parse_mode: 'HTML' }).catch(() => {});
      }
    }

    bot.editMessageText(
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('check')} ${toSC('Panel Created Successfully')}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('user')} ${toSC('Username')}: <code>${escHtml(state.username)}</code>\n` +
      `╠✤│ ${px('key')} ${toSC('Password')}: <code>${escHtml(state.password)}</code>\n` +
      `╠✤│ ${px('email')} ${toSC('Email')}: <code>${escHtml(result.email)}</code>\n` +
      `╠✤│ ${px('tools')} ${toSC('Type')}: ${state.eggType}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('link')} ${toSC('Login')}: <a href="${escHtml(result.loginUrl)}">${toSC('Open Panel')}</a>\n` +
      `╠✤│ ${px('server')} ${toSC('Server')}: <a href="${escHtml(result.panelUrl)}">${toSC('Open Server')}</a>\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      {
        chat_id: chatId, message_id: creating.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[btn('back', 'Back to Menu', { callback_data: 'cancel_flow' }, 'primary')]] },
      }
    ).catch(() => {});

  } catch (err) {
    clearState(userId);
    creatingNow.delete(String(userId));
    let detail = err.response?.data?.errors?.[0]?.detail || err.message;
    if (err.response?.status === 403) detail += ' (Panel API key permission issue - an Application API key is required)';
    console.error(chalk.red('Panel creation error:'), detail, err.response?.data ? JSON.stringify(err.response.data) : '');
    bot.editMessageText(
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('stop')} ${toSC('Panel Creation Failed')}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('cross')} ${escHtml(detail)}\n` +
      `╠✤│\n` +
      `╠✤│ ${px('refresh')} ${toSC('Please try again later')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      {
        chat_id: chatId, message_id: creating.message_id, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[btn('back', 'Back to Menu', { callback_data: 'cancel_flow' }, 'primary')]] },
      }
    ).catch(() => {});
  }
}

function buildStatsLines() {
  const allUsers   = db.getAllUsers();
  const allServers = db.getAllServers();
  const serverList = Object.values(allServers).flat();
  return {
    totalUsers:   Object.keys(allUsers).length,
    totalRefs:    Object.values(allUsers).reduce((a, u) => a + (u.refs || []).length, 0),
    totalServers: serverList.length,
    nodeCount:    serverList.filter(s => s.type === 'nodejs').length,
    pyCount:      serverList.filter(s => s.type === 'python').length,
    bannedCount:  Object.values(allUsers).filter(u => u.banned).length,
  };
}

function adminPanelKeyboard() {
  return {
    inline_keyboard: [
      [btn('chart', 'Stats', { callback_data: 'admin_stats' }, 'primary'), btn('users', 'All Users', { callback_data: 'admin_users' }, 'primary')],
      [btn('user', 'User Lookup', { callback_data: 'admin_lookup' }, 'primary'), btn('crown', 'Top Referrers', { callback_data: 'admin_toprefs' }, 'primary')],
      [btn('gift', 'Gift Slot', { callback_data: 'admin_gift' }, 'success'), btn('gift', 'Gift All +1', { callback_data: 'admin_giftall' }, 'success')],
      [btn('hash', 'Add Points', { callback_data: 'admin_addrefs' }, 'success'), btn('hash', 'Remove Points', { callback_data: 'admin_removerefs' }, 'danger')],
      [btn('gift', 'Create Redeem Code', { callback_data: 'admin_code_create' }, 'success'), btn('scroll', 'Redeem Codes', { callback_data: 'admin_codes' }, 'primary')],
      [btn('banned', 'Ban User', { callback_data: 'admin_ban' }, 'danger'), btn('check', 'Unban User', { callback_data: 'admin_unban' }, 'success')],
      [btn('banned', 'Banned List', { callback_data: 'admin_banned' }, 'primary'), btn('server', 'All Servers', { callback_data: 'admin_servers' }, 'primary')],
      [btn('broadcast', 'Broadcast', { callback_data: 'admin_bcast' }, 'success'), btn('settings', 'Set Panel Price', { callback_data: 'admin_setrefs' }, 'primary')],
      [btn('settings', 'Set Referral Price', { callback_data: 'admin_setrefprice' }, 'primary'), btn('settings', 'Set First Panel Refs', { callback_data: 'admin_setfirst' }, 'primary')],
      [btn('mobile', 'Set Menu Photo', { callback_data: 'admin_setpic' }, 'primary'), btn('link', 'Force Channels', { callback_data: 'admin_channels' }, 'primary')],
      [btn('key', 'Admin List', { callback_data: 'admin_admins' }, 'primary'), btn('scroll', 'Backup Database', { callback_data: 'admin_backup' }, 'primary')],
      [btn('refresh', 'Restore Database', { callback_data: 'admin_restore' }, 'primary'), btn('book', 'Export Users CSV', { callback_data: 'admin_export' }, 'primary')],
      [btn('cross', 'Delete User', { callback_data: 'admin_deluser' }, 'danger'), btn('refresh', 'Restart Bot', { callback_data: 'admin_restart' }, 'danger')],
      [btn('back', 'Back', { callback_data: 'menu_back' }, 'primary')],
    ],
  };
}

const backToPanelKb = { inline_keyboard: [[btn('settings', 'Admin Panel', { callback_data: 'lord_settings' }, 'primary')]] };

async function sendLordSettings(chatId, msgId) {
  const s = buildStatsLines();
  const st = getSettings();
  const caption =
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    `╠✤│ ${px('settings')} ${toSC('Admin Panel')}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('users')} ${toSC('Users')}: ${s.totalUsers}  ${px('server')} ${toSC('Servers')}: ${s.totalServers}\n` +
    `╠✤│ ${px('link')} ${toSC('Refs')}: ${s.totalRefs}  ${px('banned')} ${toSC('Banned')}: ${s.bannedCount}\n` +
    `╠✤│ ${px('bolt')} ${toSC('Panel price')}: ${st.refsPerServer} ${toSC('pts')}  ${toSC('Per referral')}: ${st.pointsPerReferral} ${toSC('pts')}\n` +
    `╠✤│ ${px('bolt')} ${toSC('First panel')}: ${st.refsNeeded} ${toSC('pts')}\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣</blockquote>`;

  if (msgId) {
    await editMenu(chatId, msgId, caption, adminPanelKeyboard());
  } else {
    await tsend(chatId, caption, { parse_mode: 'HTML', reply_markup: adminPanelKeyboard() });
  }
}

function adminPage(chatId, msgId, title, lines) {
  const caption =
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    `╠✤│ ${title}\n` +
    `╠✤│\n` +
    lines + `\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣</blockquote>`;
  return editMenu(chatId, msgId, caption, backToPanelKb);
}

function adminPrompt(chatId, userId, step, text) {
  setState(userId, { step });
  return tsend(chatId,
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    text + `\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣</blockquote>`,
    { parse_mode: 'HTML', reply_markup: cancelKeyboard }
  );
}

async function handleAdminCallback(cq, data, chatId, msgId, userId) {
  // ----- view pages -----
  if (data === 'admin_stats') {
    const s = buildStatsLines();
    return adminPage(chatId, msgId, `${px('chart')} ${toSC('Statistics')}`,
      `╠✤│ ${px('users')} ${toSC('Total Users')}: ${s.totalUsers}\n` +
      `╠✤│ ${px('link')} ${toSC('Total Referrals')}: ${s.totalRefs}\n` +
      `╠✤│ ${px('server')} ${toSC('Total Servers')}: ${s.totalServers}\n` +
      `╠✤│ ${px('nodejs')} ${toSC('Node.js Servers')}: ${s.nodeCount}\n` +
      `╠✤│ ${px('python')} ${toSC('Python Servers')}: ${s.pyCount}\n` +
      `╠✤│ ${px('banned')} ${toSC('Banned Users')}: ${s.bannedCount}`);
  }

  if (data === 'admin_users') {
    const all = Object.values(db.getAllUsers());
    const shown = all.slice(-15);
    const lines = shown.map(u =>
      `╠✤│ <code>${escHtml(u.id)}</code> ${escHtml(u.firstName || '')} ${u.username ? '@' + escHtml(u.username) : ''} — ${(u.refs || []).length} ${toSC('refs')}${u.banned ? ' 🚫' : ''}`
    ).join('\n') || `╠✤│ ${toSC('No users yet')}`;
    return adminPage(chatId, msgId, `${px('users')} ${toSC('All Users')} (${all.length})`, lines);
  }

  if (data === 'admin_toprefs') {
    const top = Object.values(db.getAllUsers())
      .sort((a, b) => (b.refs || []).length - (a.refs || []).length).slice(0, 10);
    const lines = top.map((u, i) =>
      `╠✤│ ${i + 1}. ${escHtml(u.firstName || '')} ${u.username ? '@' + escHtml(u.username) : ''} — ${(u.refs || []).length} ${toSC('refs')}`
    ).join('\n') || `╠✤│ ${toSC('No users yet')}`;
    return adminPage(chatId, msgId, `${px('crown')} ${toSC('Top Referrers')}`, lines);
  }

  if (data === 'admin_servers') {
    const entries = Object.entries(db.getAllServers());
    const flat = entries.flatMap(([uid, list]) => list.map(s => ({ uid, ...s })));
    const shown = flat.slice(-15);
    const lines = shown.map(s =>
      `╠✤│ ${escHtml(s.name)} (${s.type}) — ${toSC('owner')} <code>${escHtml(s.uid)}</code>`
    ).join('\n') || `╠✤│ ${toSC('No servers yet')}`;
    return adminPage(chatId, msgId, `${px('server')} ${toSC('All Servers')} (${flat.length})`, lines);
  }

  if (data === 'admin_banned') {
    const banned = Object.values(db.getAllUsers()).filter(u => u.banned);
    const lines = banned.map(u =>
      `╠✤│ <code>${escHtml(u.id)}</code> ${escHtml(u.firstName || '')} ${u.username ? '@' + escHtml(u.username) : ''}`
    ).join('\n') || `╠✤│ ${toSC('No banned users')}`;
    return adminPage(chatId, msgId, `${px('banned')} ${toSC('Banned Users')} (${banned.length})`, lines);
  }

  if (data === 'admin_channels') {
    const chans = getForceChannels();
    const lines = chans.length
      ? chans.map(ch => `╠✤│ ${px('link')} <a href="${ch.link}">@${escHtml(ch.username)}</a>`).join('\n')
      : `╠✤│ ${toSC('No channels - force join is OFF')}`;
    const caption =
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('link')} ${toSC('Force Join Channels')} (${chans.length})\n` +
      `╠✤│\n` + lines + `\n` +
      `╠✤│\n` +
      `╠✤│ ${px('book')} ${toSC('The bot must be an admin in each channel, or the join check will fail for everyone')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`;
    return editMenu(chatId, msgId, caption, { inline_keyboard: [
      [btn('check', 'Add Channel', { callback_data: 'admin_ch_add' }, 'success'), btn('cross', 'Remove Channel', { callback_data: 'admin_ch_remove' }, 'danger')],
      [btn('settings', 'Admin Panel', { callback_data: 'lord_settings' }, 'primary')],
    ] });
  }

  if (data === 'admin_codes') {
    const codes = getCodes();
    const entries = Object.entries(codes).slice(-15).reverse();
    const unused = Object.values(codes).filter(c => !c.usedBy).length;
    const lines = entries.length
      ? entries.map(([code, c]) =>
          `╠✤│ <code>${escHtml(code)}</code> — ${c.points} ${toSC('pts')} ${c.usedBy ? '✅ ' + toSC('used by') + ' <code>' + escHtml(c.usedBy) + '</code>' : '🟢 ' + toSC('unused')}`
        ).join('\n')
      : `╠✤│ ${toSC('No redeem codes yet')}`;
    const caption =
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('scroll')} ${toSC('Redeem Codes')} (${Object.keys(codes).length} ${toSC('total')}, ${unused} ${toSC('unused')})\n` +
      `╠✤│\n` + lines + `\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`;
    return editMenu(chatId, msgId, caption, { inline_keyboard: [
      [btn('gift', 'Create Code', { callback_data: 'admin_code_create' }, 'success'), btn('cross', 'Delete Code', { callback_data: 'admin_code_delete' }, 'danger')],
      [btn('settings', 'Admin Panel', { callback_data: 'lord_settings' }, 'primary')],
    ] });
  }

  if (data === 'admin_admins') {
    const lines = ADMIN_IDS.map(id =>
      `╠✤│ ${px('crown')} <code>${id}</code>${String(id) === OWNER_ID ? ' ' + toSC('(Owner)') : ''}`
    ).join('\n');
    return adminPage(chatId, msgId, `${px('key')} ${toSC('Admin List')}`, lines);
  }

  // ----- file actions -----
  if (data === 'admin_backup') {
    await bot.sendDocument(chatId, USERS_FILE).catch(() => {});
    await bot.sendDocument(chatId, SERVERS_FILE).catch(() => {});
    if (fs.existsSync(SETTINGS_FILE)) await bot.sendDocument(chatId, SETTINGS_FILE).catch(() => {});
    if (fs.existsSync(CODES_FILE)) await bot.sendDocument(chatId, CODES_FILE).catch(() => {});
    return;
  }

  if (data === 'admin_export') {
    const all = Object.values(db.getAllUsers());
    const csv = 'id,username,first_name,refs,servers,gifted_slots,banned\n' + all.map(u => {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      return [u.id, esc(u.username), esc(u.firstName), (u.refs || []).length, db.getServers(u.id).length, u.giftedSlots || 0, u.banned ? 1 : 0].join(',');
    }).join('\n');
    return bot.sendDocument(chatId, Buffer.from(csv, 'utf8'), {}, { filename: 'users.csv', contentType: 'text/csv' }).catch(() => {});
  }

  // ----- confirm actions -----
  if (data === 'admin_giftall') {
    return editMenu(chatId, msgId,
      `<blockquote>╠✤│ ${px('gift')} ${toSC('Gift +1 slot to ALL users?')}</blockquote>`,
      { inline_keyboard: [
        [btn('check', 'Yes, Gift All', { callback_data: 'admin_giftall_yes' }, 'success')],
        [btn('back', 'Back', { callback_data: 'lord_settings' }, 'primary')],
      ] });
  }
  if (data === 'admin_giftall_yes') {
    const all = db.getAllUsers();
    for (const uid of Object.keys(all)) {
      const u = all[uid];
      db.saveUser(uid, { ...u, giftedSlots: (u.giftedSlots || 0) + 1 });
    }
    return adminPage(chatId, msgId, `${px('gift')} ${toSC('Done')}`,
      `╠✤│ ${toSC('Gifted +1 slot to')} ${Object.keys(all).length} ${toSC('users')}`);
  }

  if (data === 'admin_restart') {
    return editMenu(chatId, msgId,
      `<blockquote>╠✤│ ${px('refresh')} ${toSC('Restart the bot now?')}</blockquote>`,
      { inline_keyboard: [
        [btn('check', 'Yes, Restart', { callback_data: 'admin_restart_yes' }, 'danger')],
        [btn('back', 'Back', { callback_data: 'lord_settings' }, 'primary')],
      ] });
  }
  if (data === 'admin_restart_yes') {
    await bot.sendMessage(chatId, '♻️ Restarting...', {}).catch(() => {});
    setTimeout(() => process.exit(0), 800);
    return;
  }

  if (data === 'admin_deluser_yes') {
    const st = getState(userId);
    if (!st || !st.target) return;
    const target = st.target;
    clearState(userId);
    const users = readJSON(USERS_FILE); delete users[String(target)]; writeJSON(USERS_FILE, users);
    const servers = readJSON(SERVERS_FILE); delete servers[String(target)]; writeJSON(SERVERS_FILE, servers);
    return tsend(chatId,
      `<blockquote>╠✤│ ${px('check')} ${toSC('User deleted')}: <code>${escHtml(target)}</code></blockquote>`,
      { parse_mode: 'HTML', reply_markup: backToPanelKb });
  }
  if (data === 'admin_deluser_no') {
    clearState(userId);
    return sendLordSettings(chatId, msgId);
  }

  // ----- input prompts -----
  if (data === 'admin_lookup')  return adminPrompt(chatId, userId, 'admin_lookup',  `╠✤│ ${px('user')} ${toSC('Send a Telegram user ID or @username')}`);
  if (data === 'admin_gift')    return adminPrompt(chatId, userId, 'admin_gift',    `╠✤│ ${px('gift')} ${toSC('Send the Telegram ID to gift +1 slot')}`);
  if (data === 'admin_addrefs') return adminPrompt(chatId, userId, 'admin_addrefs', `╠✤│ ${px('hash')} ${toSC('Add Points - Send')}: ${toSC('USER_ID AMOUNT')}\n╠✤│ ${px('book')} ${toSC('Example')}: 123456789 5`);
  if (data === 'admin_removerefs') return adminPrompt(chatId, userId, 'admin_removerefs', `╠✤│ ${px('hash')} ${toSC('Remove Points - Send')}: ${toSC('USER_ID AMOUNT')}\n╠✤│ ${px('book')} ${toSC('Example')}: 123456789 5`);
  if (data === 'admin_ban')     return adminPrompt(chatId, userId, 'admin_ban',     `╠✤│ ${px('banned')} ${toSC('Send the Telegram ID to ban')}`);
  if (data === 'admin_unban')   return adminPrompt(chatId, userId, 'admin_unban',   `╠✤│ ${px('check')} ${toSC('Send the Telegram ID to unban')}`);
  if (data === 'admin_bcast')   return adminPrompt(chatId, userId, 'admin_bcast',   `╠✤│ ${px('broadcast')} ${toSC('Send the broadcast message')}`);
  if (data === 'admin_setrefs') return adminPrompt(chatId, userId, 'admin_setrefs', `╠✤│ ${px('settings')} ${toSC('Set Panel Price - send points cost per panel (current')}: ${getSettings().refsPerServer})`);
  if (data === 'admin_setrefprice') return adminPrompt(chatId, userId, 'admin_setrefprice', `╠✤│ ${px('settings')} ${toSC('Set Referral Price - send points earned per referral (current')}: ${getSettings().pointsPerReferral})`);
  if (data === 'admin_setfirst') return adminPrompt(chatId, userId, 'admin_setfirst', `╠✤│ ${px('settings')} ${toSC('Set First Panel Refs - send points needed for first panel (current')}: ${getSettings().refsNeeded})`);
  if (data === 'admin_setpic')  return adminPrompt(chatId, userId, 'admin_setpic',  `╠✤│ ${px('mobile')} ${toSC('Send a new menu photo URL, or send DEFAULT')}`);
  if (data === 'admin_code_create') return adminPrompt(chatId, userId, 'admin_code_points', `╠✤│ ${px('gift')} ${toSC('Create Redeem Code - send the points value (1-1000)')}\n╠✤│ ${px('book')} ${toSC('Example')}: 10`);
  if (data === 'admin_code_delete') return adminPrompt(chatId, userId, 'admin_code_delete', `╠✤│ ${px('cross')} ${toSC('Send the redeem code to delete')}\n╠✤│ ${px('book')} ${toSC('Example')}: CRX-AB12CD34`);
  if (data === 'admin_ch_add')    return adminPrompt(chatId, userId, 'admin_ch_add',    `╠✤│ ${px('link')} ${toSC('Send the channel username to ADD to force join')}\n╠✤│ ${px('book')} ${toSC('Example')}: @mychannel\n╠✤│ ${px('warning')} ${toSC('Bot must be admin in that channel')}`);
  if (data === 'admin_ch_remove') return adminPrompt(chatId, userId, 'admin_ch_remove', `╠✤│ ${px('link')} ${toSC('Send the channel username to REMOVE from force join')}\n╠✤│ ${px('book')} ${toSC('Example')}: @mychannel`);
  if (data === 'admin_restore')   return adminPrompt(chatId, userId, 'admin_restore',   `╠✤│ ${px('refresh')} ${toSC('Restore Database - now send the backup file (users.json, servers.json, settings.json or codes.json)')}\n╠✤│ ${px('warning')} ${toSC('It will REPLACE the current file with the same name')}`);
  if (data === 'admin_deluser') return adminPrompt(chatId, userId, 'admin_deluser', `╠✤│ ${px('cross')} ${toSC('Send the Telegram ID to delete from the bot database')}`);
}

async function handleAdminState(msg, state, text) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const done = (body) => tsend(chatId,
    `<blockquote>╔════════════════▣\n┊✺┌────     ──⊷\n${body}\n┊✺└────••••────⊷\n╚════════════════▣</blockquote>`,
    { parse_mode: 'HTML', reply_markup: backToPanelKb });
  const targetId = (text || '').replace(/\D/g, '');

  if (state.step === 'admin_lookup') {
    clearState(userId);
    let found = null;
    if (targetId) found = db.getUser(targetId);
    if (!found && text) {
      const uname = text.replace('@', '').toLowerCase();
      found = Object.values(db.getAllUsers()).find(u => (u.username || '').toLowerCase() === uname) || null;
    }
    if (!found) return done(`╠✤│ ${px('cross')} ${toSC('User not found')}`);
    const servers = db.getServers(found.id);
    return done(
      `╠✤│ ${px('user')} ${toSC('User Lookup')}\n╠✤│\n` +
      `╠✤│ ${toSC('ID')}: <code>${escHtml(found.id)}</code>\n` +
      `╠✤│ ${toSC('Name')}: ${escHtml(found.firstName || '-')}\n` +
      `╠✤│ ${toSC('Username')}: ${found.username ? '@' + escHtml(found.username) : '-'}\n` +
      `╠✤│ ${toSC('Refs')}: ${(found.refs || []).length}\n` +
      `╠✤│ ${toSC('Slots unlocked')}: ${getUnlockedSlots(found)} (${toSC('used')} ${servers.length})\n` +
      `╠✤│ ${toSC('Gifted slots')}: ${found.giftedSlots || 0}\n` +
      `╠✤│ ${toSC('Banned')}: ${found.banned ? toSC('Yes') : toSC('No')}`);
  }

  if (state.step === 'admin_gift') {
    if (!targetId) { clearState(userId); return done(`╠✤│ ${px('cross')} ${toSC('Invalid ID')}`); }
    clearState(userId);
    const u = getUserRef(targetId);
    const n = (u.giftedSlots || 0) + 1;
    db.saveUser(targetId, { ...u, giftedSlots: n });
    bot.sendMessage(targetId,
      `<blockquote>╠✤│ ${px('gift')} ${toSC('You Have Been Gifted a Panel Slot')}</blockquote>`,
      { parse_mode: 'HTML' }).catch(() => {});
    return done(`╠✤│ ${px('gift')} ${toSC('Slot gifted to')} <code>${escHtml(targetId)}</code> — ${toSC('total gifted')}: ${n}`);
  }

  if (state.step === 'admin_addrefs' || state.step === 'admin_removerefs') {
    const parts = (text || '').split(/\s+/);
    const id = (parts[0] || '').replace(/\D/g, '');
    const amount = parseInt(parts[1], 10);
    clearState(userId);
    if (!id || !amount || amount < 1 || amount > 10000) return done(`╠✤│ ${px('cross')} ${toSC('Invalid input. Send: USER_ID AMOUNT')}`);
    const u = getUserRef(id);
    let refs = [...(u.refs || [])];
    if (state.step === 'admin_addrefs') {
      for (let i = 0; i < amount; i++) refs.push(`bonus_${Date.now()}_${i}`);
    } else {
      refs = refs.slice(0, Math.max(0, refs.length - amount));
    }
    db.saveUser(id, { ...u, refs });
    return done(`╠✤│ ${px('hash')} ${toSC('Points updated for')} <code>${escHtml(id)}</code> — ${toSC('total points')}: ${refs.length}`);
  }

  if (state.step === 'admin_ban' || state.step === 'admin_unban') {
    clearState(userId);
    if (!targetId) return done(`╠✤│ ${px('cross')} ${toSC('Invalid ID')}`);
    if (isAdmin(targetId)) return done(`╠✤│ ${px('cross')} ${toSC('Cannot ban an admin')}`);
    const u = getUserRef(targetId);
    const banned = state.step === 'admin_ban';
    db.saveUser(targetId, { ...u, banned });
    if (banned) bot.sendMessage(targetId,
      `<blockquote>╠✤│ ${px('banned')} ${toSC('You have been banned from this bot by the admin')}</blockquote>`,
      { parse_mode: 'HTML' }).catch(() => {});
    return done(`╠✤│ ${banned ? px('banned') : px('check')} ${toSC(banned ? 'User banned' : 'User unbanned')}: <code>${escHtml(targetId)}</code>`);
  }

  if (state.step === 'admin_bcast') {
    clearState(userId);
    if (!text) return done(`╠✤│ ${px('cross')} ${toSC('Empty message')}`);
    const ids = Object.keys(db.getAllUsers());
    const broadText =
      `<blockquote>╔════════════════▣\n┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('broadcast')} ${toSC('Crittix Pterodactyl Announcement')}\n╠✤│\n` +
      `╠✤│ ${escHtml(text)}\n┊✺└────••••────⊷\n╚════════════════▣</blockquote>`;
    let sent = 0, failed = 0;
    for (const uid of ids) {
      if (isAdmin(uid)) continue;
      try { await bot.sendMessage(uid, broadText, { parse_mode: 'HTML' }); sent++; }
      catch { failed++; }
      await new Promise(r => setTimeout(r, 50));
    }
    return done(`╠✤│ ${px('check')} ${toSC('Broadcast done')} — ${toSC('Sent')}: ${sent}, ${toSC('Failed')}: ${failed}`);
  }

  if (state.step === 'admin_setrefs' || state.step === 'admin_setfirst') {
    const n = parseInt(text, 10);
    clearState(userId);
    if (!n || n < 1 || n > 1000) return done(`╠✤│ ${px('cross')} ${toSC('Send a number between 1 and 1000')}`);
    if (state.step === 'admin_setrefs') saveSettings({ refsPerServer: n });
    else saveSettings({ refsNeeded: n });
    return done(`╠✤│ ${px('check')} ${toSC('Setting updated to')} ${n}`);
  }

  if (state.step === 'admin_setrefprice') {
    const n = parseInt(text, 10);
    clearState(userId);
    if (!n || n < 1 || n > 100) return done(`╠✤│ ${px('cross')} ${toSC('Send a number between 1 and 100')}`);
    saveSettings({ pointsPerReferral: n });
    return done(`╠✤│ ${px('check')} ${toSC('Referral price set to')} ${n} ${toSC('points per referral')}`);
  }

  if (state.step === 'admin_setpic') {
    clearState(userId);
    if (/^default$/i.test(text || '')) {
      saveSettings({ botPic: DEFAULT_BOT_PIC });
      return done(`╠✤│ ${px('check')} ${toSC('Menu photo reset to default')}`);
    }
    if (!/^https?:\/\//i.test(text || '')) return done(`╠✤│ ${px('cross')} ${toSC('Send a valid http(s) image URL or DEFAULT')}`);
    saveSettings({ botPic: text });
    return done(`╠✤│ ${px('check')} ${toSC('Menu photo updated')}`);
  }

  if (state.step === 'admin_restore') {
    clearState(userId);
    const doc = msg.document;
    if (!doc) return done(`╠✤│ ${px('cross')} ${toSC('No file received. Send the backup JSON file')}`);
    const targets = { 'users.json': USERS_FILE, 'servers.json': SERVERS_FILE, 'settings.json': SETTINGS_FILE, 'codes.json': CODES_FILE };
    const target = targets[(doc.file_name || '').toLowerCase()];
    if (!target) return done(`╠✤│ ${px('cross')} ${toSC('File name must be users.json, servers.json, settings.json or codes.json')}`);
    try {
      const link = await bot.getFileLink(doc.file_id);
      const resp = await axios.get(link, { responseType: 'arraybuffer', timeout: 60000 });
      const parsed = JSON.parse(Buffer.from(resp.data).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('file is not a database object');
      writeJSON(target, parsed);
      return done(`╠✤│ ${px('check')} ${toSC('Restored')} ${escHtml(doc.file_name)} — ${Object.keys(parsed).length} ${toSC('entries loaded')}`);
    } catch (e) {
      return done(`╠✤│ ${px('cross')} ${toSC('Restore failed')}: ${escHtml(e.message)}`);
    }
  }

  if (state.step === 'admin_code_points') {
    const n = parseInt(text, 10);
    clearState(userId);
    if (!n || n < 1 || n > 1000) return done(`╠✤│ ${px('cross')} ${toSC('Send a number between 1 and 1000')}`);
    const codes = getCodes();
    const code = genRedeemCode(codes);
    codes[code] = { points: n, createdBy: String(userId), createdAt: Date.now(), usedBy: null, usedAt: null };
    saveCodes(codes);
    return done(`╠✤│ ${px('gift')} ${toSC('Redeem code created')}\n╠✤│\n╠✤│ <code>${code}</code>\n╠✤│ ${px('hash')} ${toSC('Value')}: ${n} ${toSC('points (single use)')}`);
  }

  if (state.step === 'admin_code_delete') {
    clearState(userId);
    const code = (text || '').toUpperCase().replace(/\s+/g, '');
    const codes = getCodes();
    if (!codes[code]) return done(`╠✤│ ${px('cross')} ${toSC('Code not found')}`);
    delete codes[code];
    saveCodes(codes);
    return done(`╠✤│ ${px('check')} ${toSC('Code deleted')}: <code>${escHtml(code)}</code>`);
  }

  if (state.step === 'admin_ch_add' || state.step === 'admin_ch_remove') {
    clearState(userId);
    const uname = (text || '').trim().replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
    if (!/^[A-Za-z0-9_]{5,}$/.test(uname)) return done(`╠✤│ ${px('cross')} ${toSC('Invalid channel username')}`);
    let list = getForceChannels().map(c => c.username);
    if (state.step === 'admin_ch_add') {
      if (list.some(x => x.toLowerCase() === uname.toLowerCase())) return done(`╠✤│ ${px('cross')} ${toSC('Channel already in the list')}`);
      list.push(uname);
    } else {
      const before = list.length;
      list = list.filter(x => x.toLowerCase() !== uname.toLowerCase());
      if (list.length === before) return done(`╠✤│ ${px('cross')} ${toSC('Channel not in the list')}`);
    }
    saveSettings({ forceChannels: list });
    return done(`╠✤│ ${px('check')} ${toSC('Force join updated')} — ${toSC('channels now')}: ${list.length}${list.length ? '\n╠✤│ @' + list.join(', @') : ''}`);
  }

  if (state.step === 'admin_deluser') {
    if (!targetId) { clearState(userId); return done(`╠✤│ ${px('cross')} ${toSC('Invalid ID')}`); }
    if (isAdmin(targetId)) { clearState(userId); return done(`╠✤│ ${px('cross')} ${toSC('Cannot delete an admin')}`); }
    setState(userId, { step: 'admin_deluser_confirm', target: targetId });
    return tsend(chatId,
      `<blockquote>╠✤│ ${px('warning')} ${toSC('Delete user')} <code>${escHtml(targetId)}</code> ${toSC('and all their server records? This cannot be undone.')}</blockquote>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [btn('check', 'Yes, Delete', { callback_data: 'admin_deluser_yes' }, 'danger')],
        [btn('cross', 'Cancel', { callback_data: 'admin_deluser_no' }, 'primary')],
      ] } });
  }

  clearState(userId);
}

bot.onText(/\/stats/, async (msg) => {
  if (msg.chat.type !== 'private') return;
  if (!isAdmin(msg.chat.id)) return;
  await sendLordSettings(msg.chat.id, null);
});

bot.onText(/\/gift(.*)/, async (msg, match) => {
  if (msg.chat.type !== 'private') return;
  if (!isAdmin(msg.chat.id)) return;

  const targetId = match[1].trim().replace(/\D/g, '');
  if (!targetId) {
    return tsend(msg.chat.id,
      `<blockquote>╔════════════════▣\n` +
      `┊✺┌────     ──⊷\n` +
      `╠✤│ ${px('book')} ${toSC('Usage')}: /gift &lt;telegram_id&gt;\n` +
      `╠✤│ ${px('pencil')} ${toSC('Example')}: /gift 123456789\n` +
      `╠✤│ ${px('gift')} ${toSC('Gives user 1 extra panel slot')}\n` +
      `┊✺└────••••────⊷\n` +
      `╚════════════════▣</blockquote>`,
      { parse_mode: 'HTML' }
    );
  }

  const user = getUserRef(targetId);
  const newGifted = (user.giftedSlots || 0) + 1;
  db.saveUser(targetId, { ...user, giftedSlots: newGifted });

  tsend(msg.chat.id,
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    `╠✤│ ${px('gift')} ${toSC('Slot Gifted Successfully')}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('user')} ${toSC('User ID')}: ${targetId}\n` +
    `╠✤│ ${px('server')} ${toSC('Total gifted slots')}: ${newGifted}\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣</blockquote>`,
    { parse_mode: 'HTML' }
  );

  bot.sendMessage(targetId,
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    `╠✤│ ${px('gift')} ${toSC('You Have Been Gifted a Panel Slot')}\n` +
    `╠✤│\n` +
    `╠✤│ ${px('crown')} ${toSC('Gifted by Lord Devine')}\n` +
    `╠✤│ ${px('panel')} ${toSC('Tap Create Panel to deploy your server')}\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣</blockquote>`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
});

bot.onText(/\/broadcast(.*)/, async (msg, match) => {
  if (msg.chat.type !== 'private') return;
  if (!isAdmin(msg.chat.id)) return;

  const text = match[1].trim();
  if (!text) {
    return tsend(msg.chat.id,
      `<blockquote>╠✤│ ${px('book')} ${toSC('Usage')}: /broadcast &lt;message&gt;</blockquote>`,
      { parse_mode: 'HTML' }
    );
  }

  const allUsers = db.getAllUsers();
  const ids      = Object.keys(allUsers);
  const prog     = await tsend(msg.chat.id,
    `<blockquote>╠✤│ ${px('hourglass')} ${toSC('Broadcasting to')} ${ids.length} ${toSC('users')}</blockquote>`,
    { parse_mode: 'HTML' }
  );

  let sent = 0, failed = 0;
  const broadText =
    `<blockquote>╔════════════════▣\n` +
    `┊✺┌────     ──⊷\n` +
    `╠✤│ ${px('broadcast')} ${toSC('Crittix Pterodactyl Announcement')}\n` +
    `╠✤│\n` +
    `╠✤│ ${escHtml(text)}\n` +
    `┊✺└────••••────⊷\n` +
    `╚════════════════▣\n` +
    `${px('crown')} ♰ 𝐋𝐎𝐑𝐃 Zvxay</blockquote>`;

  for (const uid of ids) {
    if (uid === OWNER_ID) { sent++; continue; }
    try { await bot.sendMessage(uid, broadText, { parse_mode: 'HTML' }); sent++; }
    catch { failed++; }
    await new Promise(r => setTimeout(r, 50));
  }

  if (prog) {
    bot.editMessageText(
      `<blockquote>╔════════════════▣\n` +
      `╠✤│ ${px('check')} ${toSC('Broadcast Done')}\n` +
      `╠✤│ ${px('users')} ${toSC('Sent')}: ${sent} ${px('cross')} ${toSC('Failed')}: ${failed}\n` +
      `╚════════════════▣</blockquote>`,
      { chat_id: msg.chat.id, message_id: prog.message_id, parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

// Render / PaaS hosts assign a PORT and expect an open HTTP port. When PORT is
// set, serve a tiny health endpoint. Locally (no PORT set) nothing changes.
if (process.env.PORT) {
  require('http').createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Crittix bot is running (v2)'); })
    .listen(process.env.PORT, () => console.log(`Health server listening on port ${process.env.PORT}`));
}

bot.getMe().then(me => {
  console.log(chalk.green(`✅ Bot online: @${me.username}`));
  pteroSelfCheck();
  console.log(chalk.red('「𖦠」 Zvxay ᴘᴛᴇʀᴏ ʙᴏᴛ ɪꜱ ʀᴇᴀᴅʏ 「𖦠」'));
}).catch(e => console.error(chalk.red('getMe failed:'), e.message));

process.on('unhandledRejection', r => console.error(chalk.red('[ERROR]'), r?.message || r));
process.on('uncaughtException',  e => console.error(chalk.red('[CRASH]'), e.message));