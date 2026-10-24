#!/bin/bash
# Smoke test, runs INSIDE a dev container (gnome50 or gnome51) as user dev.
# Starts a headless GNOME Shell, loads SnapTile and checks it. Use ./run.sh from the host.
set -u

REPO=/workspace
EXT_DIR=$HOME/.local/share/gnome-shell/extensions
export XDG_RUNTIME_DIR=/tmp/xdg-smoke
rm -rf "$XDG_RUNTIME_DIR" "$EXT_DIR"
mkdir -p -m 700 "$XDG_RUNTIME_DIR" "$EXT_DIR"
cp -r "$REPO/src" "$EXT_DIR/snaptile@muse83"
glib-compile-schemas "$EXT_DIR/snaptile@muse83/schemas" # gnome-extensions does this when it installs the extension
cp -r "$REPO/tests/smoke/helper@snaptile.test" "$EXT_DIR/"

# Bus and portal noise goes to a log file so the terminal shows only the checks.
exec dbus-run-session -- bash "$REPO/tests/smoke/session.sh" 2>/tmp/smoke-session.log
