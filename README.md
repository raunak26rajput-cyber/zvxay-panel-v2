# ZVXAY Panel

A Pterodactyl-style bot-hosting panel (Node.js + Express, JSON-file store)
with a **Pterodactyl-compatible Application API**, so the existing Telegram
bot in `bot/` works against it with **zero code changes** — it only needs a
new `PTERODACTYL_URL` and `PTERODACTYL_API_KEY`.

## What it does

- Web panel: username/password login (scrypt-hashed), dashboard, and a
  server page at `/server/<identifier>` with **Console** (live logs +
  Start/Stop/Restart), **Files** (upload / edit / delete), **Startup**
  (egg variables) and **Settings** (rename, change password) tabs.
- Admin area at `/admin`: stats, user management (extend validity, ban /
  unban, delete, create), panel settings, all servers.
- Hosting engine: user bots run as plain child processes — Python
  (`pip install` from requirements, then `python3 <file>`) and Node.js
  (`npm install`, then the configured run command). Logs are captured to
  `server.log` in each server directory and streamed to the console.
- Accounts are valid for **20 days** by default (admin-editable). Expired
  accounts cannot log in and their servers are stopped automatically
  (hourly sweeper + checks on login and on every power action).

## Application API (for the bot)

Base URL: `<panel-url>/api/application`, header `Authorization: Bearer <key>`.

Implemented: `GET /locations`, `POST /users`, `GET /users/:id`,
`DELETE /users/:id` (also deletes the user's servers), `GET /nests`,
`GET /nests/:id/eggs` (eggs named exactly **NODE JS** and **Python Engine**),
`POST /servers`. Responses and errors use Pterodactyl's shapes
(`attributes` on single objects, `data` + `meta.pagination` on lists,
`{ errors: [{ code, status, detail }] }` on failures).

## Environment variables

| Variable         | Purpose                                              | Default        |
| ---------------- | ---------------------------------------------------- | -------------- |
| `PORT`           | Port the panel listens on (set by Render)            | `8080`         |
| `DATA_DIR`       | Where `db.json` and server files live                | `./data` (or `/data` if it exists) |
| `ADMIN_USERNAME` | Seeds the admin account on first boot                | —              |
| `ADMIN_PASSWORD` | Password for the seeded admin account                | —              |

The bot additionally needs its usual env: `BOT_TOKEN`, `PTERODACTYL_URL`
(this panel's public URL), `PTERODACTYL_API_KEY` (see below), `OWNER_ID`.

## The application API key

On first boot the panel generates an application API key (prefixed
`ptla_`), stores it in `db.json`, and prints it **once** in the log:

```
APP_API_KEY=ptla_...
```

It is also visible any time in **Admin → Panel settings**. Give this value
to the bot as `PTERODACTYL_API_KEY`.

## Running

Locally:

```bash
npm install
ADMIN_USERNAME=admin ADMIN_PASSWORD=changeme PORT=8080 node server.js
```

On Render: deploy the Docker service from this repo. `start.sh` runs the
panel (on `$PORT`) and the bot side by side, keeps both data stores on
`DATA_DIR`, and symlinks `bot/database` to `$DATA_DIR/bot-database` so the
bot's own database persists on the same disk.
