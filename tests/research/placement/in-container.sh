#!/bin/bash
# Runs INSIDE a dev container as user dev: installs SnapTile and the probe, starts the session.
set -u
REPO=/workspace
EXT_DIR=$HOME/.local/share/gnome-shell/extensions
export XDG_RUNTIME_DIR=/tmp/xdg-research
export XDG_CURRENT_DESKTOP=GNOME # the desktop portal picks its GNOME backend from this
rm -rf "$XDG_RUNTIME_DIR" "$EXT_DIR"
mkdir -p -m 700 "$XDG_RUNTIME_DIR" "$EXT_DIR"
cp -r "$REPO/src" "$EXT_DIR/snaptile@muse83"
glib-compile-schemas "$EXT_DIR/snaptile@muse83/schemas"
cp -r "$REPO/tests/research/placement/placement-probe@snaptile.test" "$EXT_DIR/"
# Portal backend for the file chooser: PORTAL_CHOOSER=gtk|gnome (default gnome, the real GNOME choice).
mkdir -p "$HOME/.config/xdg-desktop-portal"
if [ "${PORTAL_CHOOSER:-gnome}" = gtk ]; then
    printf '[preferred]\ndefault=gnome;gtk;\norg.freedesktop.impl.portal.FileChooser=gtk;\n' >"$HOME/.config/xdg-desktop-portal/gnome-portals.conf"
else
    rm -f "$HOME/.config/xdg-desktop-portal/gnome-portals.conf"
fi
exec dbus-run-session -- bash "$REPO/tests/research/placement/session.sh" "$@" 2>/tmp/research-session.log
