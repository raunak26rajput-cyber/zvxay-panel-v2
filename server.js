'use strict';

/**
 * ZVXAY Panel — Pterodactyl-style bot-hosting panel.
 *
 * One process serves:
 *   - the web panel (login, dashboard, server console/files/startup/settings)
 *   - the Pterodactyl-compatible Application API used by the Telegram bot
 *   - the hosting engine (user bots run as child processes)
 */

const path = require('path');
const { Store } = require('./lib/store');
const { Engine } = require('./lib/engine');
const { createAppApi } = require('./lib/appapi');
const { createWeb } = require('./lib/web');
const lifecycle = require('./lib/lifecycle');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const PORT = Number(process.env.PORT) || 8080;

const store = new Store(DATA_DIR).init();
const engine = new Engine(store);

// Any server still marked "running" from a previous life is not actually
// running anymore (processes do not survive a panel restart).
let dirty = false;
for (const server of store.db.servers) {
  if (server.status !== 'offline') { server.status = 'offline'; dirty = true; }
}
if (dirty) store.save();

// Expire accounts that ran out while the panel was down, then sweep hourly.
lifecycle.sweepExpired(store, engine);
setInterval(() => lifecycle.sweepExpired(store, engine), 60 * 60 * 1000).unref();

const app = createWeb(store, engine);
app.use('/api/application', createAppApi(store, engine));

app.listen(PORT, () => {
  console.log(`[${store.db.settings.panel_name}] listening on port ${PORT} (data: ${DATA_DIR})`);
});
