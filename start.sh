#!/usr/bin/env bash
# ZVXAY Panel + Telegram bot, side by side in one container.
# The panel is the main process; the bot runs in a supervised loop so a
# bot crash can never take the website down with it.
set -u
cd "$(dirname "$0")"

# Persistent data: prefer /data (Render persistent disk mount) when present.
if [ -z "${DATA_DIR:-}" ]; then
  if [ -d /data ]; then
    export DATA_DIR=/data
  else
    export DATA_DIR="$(pwd)/data"
  fi
fi
mkdir -p "$DATA_DIR"

# The bot keeps its own database in bot/database (relative to its cwd).
# Point it at the persistent disk via a symlink so bot data survives
# deploys together with the panel data.
BOT_DB_LINK="bot/database"
BOT_DB_TARGET="$DATA_DIR/bot-database"
mkdir -p "$BOT_DB_TARGET"
if [ -L "$BOT_DB_LINK" ]; then
  : # already a symlink
elif [ -d "$BOT_DB_LINK" ]; then
  # A real directory shipped in the image/repo: copy its contents into the
  # persistent location once, then replace it with the symlink.
  cp -a "$BOT_DB_LINK/." "$BOT_DB_TARGET/" 2>/dev/null || true
  mv "$BOT_DB_LINK" "bot/database.image-backup"
fi
ln -sfn "$BOT_DB_TARGET" "$BOT_DB_LINK"

# Bot in a supervised loop (must not inherit PORT — it would try to bind
# the same port as the panel). If the bot exits, restart it after 5s.
(
  cd bot
  while true; do
    echo "[start.sh] starting bot..."
    env -u PORT node index.js
    echo "[start.sh] bot exited, restarting in 5s"
    sleep 5
  done
) &

# Panel is the main process: the container lives and dies with it.
echo "[start.sh] starting panel on port ${PORT:-8080} (data: $DATA_DIR)"
exec env PORT="${PORT:-8080}" DATA_DIR="$DATA_DIR" node server.js
