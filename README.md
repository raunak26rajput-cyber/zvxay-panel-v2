# ZVXAY Panel

Bot-hosting website (Flask + SQLAlchemy) with the Telegram bot in `bot/`
running alongside it in the same container.

## Website

- Login with username/password. There is **no self-registration** and **no
  admin panel** — accounts are created by the Telegram bot.
- Pages: Dashboard, Upload (.py / .zip), My Files, Logs, bot Setup
  (main-file picker + requirements install), Start / Stop / Restart.
- Each account can hold at most **2 bots**.
- Bot-issued accounts are valid for **10 days**; after that, login fails with
  the same generic "Invalid username or password." message as wrong
  credentials, and the account's bots are stopped automatically.

## Telegram bot integration

The bot (unchanged) talks to a Pterodactyl-compatible Application API
implemented in `botapi.py`:

- `GET /api/application/locations`, `GET /api/application/nests`,
  `GET /api/application/nests/:id/eggs` (eggs named exactly **NODE JS** and
  **Python Engine**)
- `POST /api/application/users`, `GET /api/application/users/:id`,
  `DELETE /api/application/users/:id`
- `POST /api/application/servers`, `GET /api/application/servers`

Auth: `Authorization: Bearer <APP_API_KEY>`. API-created users get
`expiry = today + 10 days`. The bot hands users a `{panel}/server/{identifier}`
link; that route redirects into the dashboard (or login).

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (set by the host) |
| `DATA_DIR` | SQLite DB + uploads + logs directory |
| `OWNER_USERNAME` / `OWNER_PASSWORD` | Owner account (falls back to `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `start.sh`) |
| `APP_API_KEY` | Fixed application API key for the bot (also the session-secret fallback) |
| `SECRET_KEY` | Optional session secret |

The bot additionally needs `BOT_TOKEN`, `PTERODACTYL_URL` (this panel's public
URL) and `PTERODACTYL_API_KEY` (same value as `APP_API_KEY`).

## Running

On the host: the Docker service builds from this repo; `start.sh` runs
gunicorn for the site (main process, `$PORT`) and supervises the bot beside
it, and symlinks `bot/database` onto `DATA_DIR` so both stores persist
together on the disk.
