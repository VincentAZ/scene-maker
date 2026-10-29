#!/usr/bin/env bash
# Starts Scene Maker's local service if it is not already running, then opens the studio
# in its own app window. This is what the app-menu, dock and desktop icons run.
#   ./start.sh          start (or just open) the studio
#   ./start.sh --stop   stop the service this script started
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

PORT="${PORT:-4311}"
URL="http://127.0.0.1:$PORT"
DATA="${SCENE_MAKER_DATA:-.data}"
LOG="$DATA/service.log"
PIDFILE="$DATA/service.pid"
NODE="$(command -v node || echo "$HOME/.local/bin/node")"
PROFILE="${XDG_DATA_HOME:-$HOME/.local/share}/scene-maker/browser"

running() { curl -fs -o /dev/null "$URL/api/health"; }

if [ "${1:-}" = --stop ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" && echo "Scene Maker service stopped."
  else
    echo "No service started by this script is running."
  fi
  rm -f "$PIDFILE"
  exit 0
fi

if ! running; then
  mkdir -p "$DATA"
  # The service serves the production build; make one the first time.
  if [ ! -f dist/index.html ]; then
    echo "Building Scene Maker (first start)…"
    npm run build >>"$LOG" 2>&1
  fi
  echo "Starting Scene Maker service at $URL (log: $LOG)"
  PORT="$PORT" nohup "$NODE" node_modules/tsx/dist/cli.mjs server/index.ts >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    running && break
    kill -0 "$(cat "$PIDFILE")" 2>/dev/null || { echo "The service stopped unexpectedly. See $LOG" >&2; exit 1; }
    sleep 1
  done
  running || { echo "The service did not answer within a minute. See $LOG" >&2; exit 1; }
fi

# Open the studio as its own window with a Chromium-family browser, using a profile that belongs only to
# Scene Maker. On GNOME's Wayland session the window goes through XWayland so it gets the desktop's normal
# title bar and so the dock can match it to the launcher by window class.
open_app() {
  local bin=""
  for c in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge; do
    command -v "$c" >/dev/null 2>&1 && { bin="$(command -v "$c")"; break; }
  done
  if [ -z "$bin" ]; then
    xdg-open "$URL" >/dev/null 2>&1 || true
    return 0
  fi
  local platform=()
  if [ "${XDG_SESSION_TYPE:-}" = wayland ] && [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] && [ -n "${DISPLAY:-}" ]; then
    platform=(--ozone-platform=x11)
  fi
  mkdir -p "$PROFILE"
  "$bin" --app="$URL" --user-data-dir="$PROFILE" --class=scene-maker --no-first-run \
    --no-default-browser-check --disable-sync --disable-component-update "${platform[@]}" >/dev/null 2>&1 &
  disown
}
open_app
echo "Scene Maker is running at $URL"
