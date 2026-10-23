#!/bin/bash
# Runs inside the D-Bus session started by in-container.sh.
set -u

SHELL_LOG=/tmp/smoke-shell.log
FAILS=0

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILS=$((FAILS + 1)); }

# ev <js expression>: runs it in the shell via the test helper, prints the JSON result.
ev() {
    local out
    out=$(gdbus call --session --dest org.snaptile.Test --object-path /org/snaptile/Test \
        --method org.snaptile.Test.Eval "$1") || { echo "EVAL-ERROR"; return 1; }
    # out looks like: (true, '"text"')
    out=${out#\(true, \'}
    echo "${out%\'\)}"
}

check() { # check <description> <expected> <js expression>
    local got
    got=$(ev "$3")
    if [ "$got" = "$2" ]; then pass "$1"; else fail "$1 (expected $2, got $got)"; fi
}

gsettings set org.gnome.shell enabled-extensions "['helper@snaptile.test']"
gsettings set org.gnome.shell disable-user-extensions false

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x720 >"$SHELL_LOG" 2>&1 &
SHELL_PID=$!

for _ in $(seq 40); do
    ev 1 >/dev/null 2>&1 && break
    sleep 0.5
done

echo "GNOME Shell $(gnome-shell --version | sed 's/GNOME Shell //')"

UUID=snaptile@muse83
SOURCES='Main.messageTray.getSources().filter(s => s.title === "SnapTile").length'
NOTE='Main.messageTray.getSources().filter(s => s.title === "SnapTile").flatMap(s => s.notifications.map(n => n.title)).join("|")'
STATE="Main.extensionManager.lookup('$UUID').state"
ENABLE="(Main.extensionManager.enableExtension('$UUID'), 1)"
DISABLE="(Main.extensionManager.disableExtension('$UUID'), 1)"
ACTIVE=1 # ExtensionState.ACTIVE
INACTIVE=2 # ExtensionState.INACTIVE

echo "Edge tiling ON:"
gsettings set org.gnome.mutter edge-tiling true
ev "$ENABLE" >/dev/null
check "extension is active" $ACTIVE "$STATE"
check "one hint source appears" 1 "$SOURCES"
check "hint names the setting" '"Switch off GNOME edge tiling"' "$NOTE"
check "hint text names Active Screen Edges" true \
    'Main.messageTray.getSources().some(s => s.notifications.some(n => n.body.includes("Active Screen Edges") && n.body.includes("edge-tiling false")))'
ev "$DISABLE" >/dev/null
check "extension is inactive after disable" $INACTIVE "$STATE"
check "hint source is gone after disable" 0 "$SOURCES"
ev "$ENABLE" >/dev/null
check "hint appears again on the next enable" 1 "$SOURCES"
ev "$DISABLE" >/dev/null
check "GNOME setting still on (SnapTile did not touch it)" true "$(gsettings get org.gnome.mutter edge-tiling)"

echo "Edge tiling OFF:"
gsettings set org.gnome.mutter edge-tiling false
ev "$ENABLE" >/dev/null
check "extension is active" $ACTIVE "$STATE"
check "no hint source" 0 "$SOURCES"
ev "$DISABLE" >/dev/null
check "GNOME setting still off" false "$(gsettings get org.gnome.mutter edge-tiling)"

echo "Drag and screenshot in the headless shell (what later tickets build on):"
WAYLAND_DISPLAY=wayland-0 python3 "$(dirname "$0")/probe-window.py" >/tmp/smoke-window.log 2>&1 &
WINDOW_PID=$!
sleep 4
RECT='JSON.stringify(global.get_window_actors().map(a => a.meta_window).filter(w => w.title === "probe-window").map(w => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; })[0])'
check "client window appears at its default place" '"[440,226,400,300]"' "$RECT"

# Virtual pointer inside the shell: real input events, handled by Mutter like a mouse.
ev 'globalThis.__dev = global.stage.context.get_backend().get_default_seat().create_virtual_device(imports.gi.Clutter.InputDeviceType.POINTER_DEVICE), globalThis.__ops = [], global.display.connect("grab-op-begin", (d, w, op) => globalThis.__ops.push(["begin", op])), global.display.connect("grab-op-end", (d, w, op) => globalThis.__ops.push(["end", op])), 1' >/dev/null
move() { # the pointer position only settles after the second motion event to a point
    for _ in 1 2; do
        ev "globalThis.__dev.notify_absolute_motion(imports.gi.GLib.get_monotonic_time(), $1, $2), 1" >/dev/null
        sleep 0.2
    done
}
button() { # button PRESSED|RELEASED
    ev "globalThis.__dev.notify_button(imports.gi.GLib.get_monotonic_time(), 1, imports.gi.Clutter.ButtonState.$1), 1" >/dev/null
    sleep 0.3
}
move 32 14; button PRESSED; button RELEASED # the first click after start is needed before clients get input
sleep 1
move 640 240; button PRESSED
for step in "620 220" "500 180" "300 120" "100 60" "20 20"; do move $step; done
check "dragging the title bar starts a window move" '"begin:1"' 'globalThis.__ops.map(o => o.join(":")).join(",")'
button RELEASED
sleep 1
check "window followed the pointer (y held below the top bar)" '"[-180,32,400,300]"' "$RECT"
check "release ends the move" '"begin:1,end:1"' 'globalThis.__ops.map(o => o.join(":")).join(",")'

SHOT=/tmp/smoke-shot.png
rm -f $SHOT
ev "globalThis.__shot = 'pending', (() => { const {Shell, Gio} = imports.gi; const sh = new Shell.Screenshot(); const st = Gio.File.new_for_path('$SHOT').replace(null, false, Gio.FileCreateFlags.NONE, null); sh.screenshot(false, st, (o, res) => { try { sh.screenshot_finish(res); st.close(null); globalThis.__shot = 'done'; } catch (e) { globalThis.__shot = 'error ' + e; } }); })(), 1" >/dev/null
sleep 2
check "screenshot written to a PNG file" '"done"' 'globalThis.__shot'
PIXELS=$(python3 "$(dirname "$0")/pixels.py" $SHOT 100 100 600 500 | tr '\n' '|')
# (100,100) is inside the moved window, (600,500) is bare desktop.
if [ "$PIXELS" != "" ] && [ "${PIXELS%%|*}" != "$(echo "$PIXELS" | cut -d'|' -f2)" ]; then
    pass "pixel read tells window ($(echo "$PIXELS" | cut -d'|' -f1)) from desktop ($(echo "$PIXELS" | cut -d'|' -f2))"
else
    fail "pixel read tells window from desktop (got: $PIXELS)"
fi
kill $WINDOW_PID 2>/dev/null

echo "Shell log:"
if grep -iE "snaptile|JS ERROR" "$SHELL_LOG"; then
    fail "errors mentioning SnapTile or JS ERROR in the shell log"
else
    pass "no SnapTile or JS errors in the shell log"
fi

kill $SHELL_PID 2>/dev/null
wait $SHELL_PID 2>/dev/null
if [ "$FAILS" -eq 0 ]; then echo "RESULT: all checks passed"; else echo "RESULT: $FAILS check(s) FAILED"; fi
exit $((FAILS > 0))
