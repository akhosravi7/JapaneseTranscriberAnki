#!/bin/sh
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
electron_app="$root/node_modules/electron/dist/Electron.app"
renderer_url="${ELECTRON_RENDERER_URL:-}"
token="kotoba-dev-$$-$(date +%s)"

entry="${1:-.}"
if [ "$#" -gt 0 ]; then
  shift
fi
if [ -d "$entry" ]; then
  entry="$(cd "$entry" && pwd)"
fi

app_pid=""
cleanup() {
  if [ -n "$app_pid" ]; then
    kill "$app_pid" 2>/dev/null || true
  fi
}
trap cleanup INT TERM HUP

open -n "$electron_app" --args "$entry" \
  "--kotoba-renderer-url=$renderer_url" \
  "--kotoba-dev-instance=$token" \
  "$@"

attempt=0
while [ "$attempt" -lt 100 ]; do
  app_pid="$(pgrep -f "kotoba-dev-instance=$token" | head -n 1 || true)"
  if [ -n "$app_pid" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

if [ -z "$app_pid" ]; then
  echo "Failed to launch Electron through LaunchServices." >&2
  exit 1
fi

while kill -0 "$app_pid" 2>/dev/null; do
  sleep 0.5
done
