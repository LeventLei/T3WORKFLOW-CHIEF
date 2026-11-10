#!/bin/bash
# Build "Chief 工作流.app" (macOS) that starts the panel and opens it in the browser.
# Usage: bash app/build-mac-app.sh [destination-dir]   (default: ~/Applications)
# The app points at this checkout and at the node found now; rebuild after
# moving the repo or switching node installs.
set -euo pipefail

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ $(uname -s) == Darwin ]] || die 'macOS only'
command -v osacompile >/dev/null || die 'missing command: osacompile'

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEST_DIR="${1:-$HOME/Applications}"
APP="$DEST_DIR/Chief 工作流.app"

# GUI apps do not inherit the shell PATH, so pin node's absolute path now.
NODE_PATH="$(command -v node || true)"
[[ -n $NODE_PATH ]] || NODE_PATH="$(/bin/zsh -lic 'command -v node' 2>/dev/null | tail -n 1 || true)"
[[ -x $NODE_PATH ]] || die 'node not found; install Node 22.5+ first'
NODE_MAJOR="$("$NODE_PATH" -p 'process.versions.node.split(".")[0]')"
[[ $NODE_MAJOR -ge 18 ]] || die "node $NODE_MAJOR is too old (need 18+, 22.5+ to read T3 projects)"

[[ $REPO_DIR$NODE_PATH != *"&"* ]] || die 'paths containing "&" are not supported'
as_string() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }
work="$(mktemp -d -t chief-panel)"
trap 'rm -rf "$work"' EXIT
src="$work/ChiefPanel.applescript"
REPO_ESC="$(as_string "$REPO_DIR")" NODE_ESC="$(as_string "$NODE_PATH")" \
  awk '{ gsub(/__REPO_DIR__/, ENVIRON["REPO_ESC"]); gsub(/__NODE_PATH__/, ENVIRON["NODE_ESC"]); print }' \
  "$REPO_DIR/app/ChiefPanel.applescript" > "$src"

mkdir -p -- "$DEST_DIR"
if [[ -e $APP ]]; then
  osascript -e 'if application "Chief 工作流" is running then tell application "Chief 工作流" to quit' >/dev/null 2>&1 || true
  rm -rf -- "$APP"
fi
osacompile -s -o "$APP" "$src"
# Name shown in the menu bar / Dock.
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Chief 工作流' "$APP/Contents/Info.plist" 2>/dev/null || true

printf 'Built: %s\n  repo: %s\n  node: %s\n' "$APP" "$REPO_DIR" "$NODE_PATH"
