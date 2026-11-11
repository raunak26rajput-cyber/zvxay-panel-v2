#!/usr/bin/env bash
# ZVXAY Panel + Telegram bot, side by side in one container.
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
  # A real directory shipped in the image/repo: move its contents aside
  # into the persistent location once, then replace it with the symlink.
  cp -a "$BOT_DB_LINK/." "$BOT_DB_TARGET/" 2>/dev/null || true
  mv "$BOT_DB_LINK" "bot/database.image-backup"
fi
ln -sfn "$BOT_DB_TARGET" "$BOT_DB_LINK"

PANEL_PID=""
BOT_PID=""
cleanup() {
  [ -n "$BOT_PID" ] && kill "$BOT_PID" 2>/dev/null
  [ -n "$PANEL_PID" ] && kill "$PANEL_PID" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup SIGTERM SIGINT

# Panel (listens on $PORT for Render).
PORT="${PORT:-8080}" DATA_DIR="$DATA_DIR" node server.js &
PANEL_PID=$!

# Bot (must not inherit PORT — it would try to bind the same port).
(cd bot && env -u PORT DATA_DIR="$DATA_DIR/bot-runtime" node index.js) &
BOT_PID=$!

# Exit when either process exits, so the platform restarts the service.
wait -n "$PANEL_PID" "$BOT_PID"
cleanup
