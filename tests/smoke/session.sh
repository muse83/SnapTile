#!/bin/bash
# Runs inside the D-Bus session started by in-container.sh.
set -u

SHELL_LOG=/tmp/smoke-shell.log
FAILS=0

# Maximum runtime of the whole run in seconds (see CLAUDE.md): 193 now, one more for every new
# check. The run fails when it takes longer. A single check has no limit of its own; each one
# prints how long it took since the check before it, so slow spots can be found and sped up.
MAX_RUNTIME=193
START=$(date +%s.%N)
LAST=$START
took() { local now; now=$(date +%s.%N); TOOK=$(awk -v a="$now" -v b="$LAST" 'BEGIN { printf "%.1f", a - b }'); LAST=$now; }
pass() { took; echo "  PASS  [${TOOK}s] $1"; }
fail() { took; echo "  FAIL  [${TOOK}s] $1"; FAILS=$((FAILS + 1)); }

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

await_settled() { # await_settled <title>: until the window is shown and its frame stayed the same for three reads (at most 8 s)
    local js previous="" same=0 now
    js="JSON.stringify(global.get_window_actors().filter(a => a.mapped && a.meta_window.title === '$1').map(a => { const r = a.meta_window.get_frame_rect(); return [r.x, r.y, r.width, r.height]; }))"
    for _ in $(seq 80); do
        now=$(ev "$js")
        if [ "$now" != '"[]"' ] && [ "$now" = "$previous" ]; then
            same=$((same + 1))
            [ $same -ge 2 ] && return
        else
            same=0
        fi
        previous=$now
        sleep 0.1
    done
}
await_state() { for _ in $(seq 25); do [ "$(ev "$STATE")" = "$1" ] && return; sleep 0.2; done; } # await_state <state>: at most 5 s
gsettings set org.gnome.shell enabled-extensions "['helper@snaptile.test']"
gsettings set org.gnome.shell disable-user-extensions false

start_shell() { # start_shell <log file> <virtual monitor size>...
    local log=$1; shift
    local args=()
    for size in "$@"; do args+=(--virtual-monitor "$size"); done
    gnome-shell --headless --wayland --no-x11 "${args[@]}" >"$log" 2>&1 &
    SHELL_PID=$!
    for _ in $(seq 100); do
        ev 1 >/dev/null 2>&1 && break
        sleep 0.2
    done
}

start_shell "$SHELL_LOG" 1280x720

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
await_state $ACTIVE
check "extension is active" $ACTIVE "$STATE"
check "one hint source appears" 1 "$SOURCES"
check "hint names the setting" '"Switch off GNOME edge tiling"' "$NOTE"
check "hint text names Active Screen Edges" true \
    'Main.messageTray.getSources().some(s => s.notifications.some(n => n.body.includes("Active Screen Edges") && n.body.includes("edge-tiling false")))'
# Urgency 1 is NORMAL; HIGH (2) and CRITICAL (3) would break through Do Not Disturb.
check "hint has normal urgency, so Do Not Disturb silences it" '"1"' \
    'Main.messageTray.getSources().filter(s => s.title === "SnapTile").flatMap(s => s.notifications.map(n => n.urgency)).join("|")'
gsettings set org.gnome.mutter edge-tiling false
check "hint goes away when the user switches GNOME edge tiling off" 0 "$SOURCES"
gsettings set org.gnome.mutter edge-tiling true
check "switching it back on while enabled shows no new hint" 0 "$SOURCES"
ev "$DISABLE" >/dev/null
check "extension is inactive after disable" $INACTIVE "$STATE"
check "hint source is gone after disable" 0 "$SOURCES"
ev "$ENABLE" >/dev/null
check "hint appears again on the next enable" 1 "$SOURCES"
ev "$DISABLE" >/dev/null
check "hint source is gone after the second disable" 0 "$SOURCES"
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
await_settled probe-window
RECT='JSON.stringify(global.get_window_actors().map(a => a.meta_window).filter(w => w.title === "probe-window").map(w => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; })[0])'
check "client window appears at its default place" '"[440,226,400,300]"' "$RECT"

# Virtual pointer inside the shell: real input events, handled by Mutter like a mouse.
move() { # the pointer position only settles after the second motion event to a point
    for _ in 1 2; do
        ev "globalThis.__dev.notify_absolute_motion(imports.gi.GLib.get_monotonic_time(), $1, $2), 1" >/dev/null
    done
}
button() { # button PRESSED|RELEASED
    ev "globalThis.__dev.notify_button(imports.gi.GLib.get_monotonic_time(), 1, imports.gi.Clutter.ButtonState.$1), 1" >/dev/null
    sleep 0.3
}
resize_window() { # resize_window X Y WIDTH HEIGHT: asks Mutter for a new frame, like an application would
    ev "global.get_window_actors().map(a => a.meta_window).filter(w => w.title === 'probe-window')[0].move_resize_frame(true, $1, $2, $3, $4), 1" >/dev/null
    sleep 0.3
}
press_escape() {
    for state in PRESSED RELEASED; do
        ev "globalThis.__kbd.notify_keyval(imports.gi.GLib.get_monotonic_time(), 0xff1b, imports.gi.Clutter.KeyState.$state), 1" >/dev/null
    done
}
setup_pointer() { # a virtual pointer for this shell, recording the window grabs it causes
    ev 'globalThis.__dev = global.stage.context.get_backend().get_default_seat().create_virtual_device(imports.gi.Clutter.InputDeviceType.POINTER_DEVICE), globalThis.__kbd = global.stage.context.get_backend().get_default_seat().create_virtual_device(imports.gi.Clutter.InputDeviceType.KEYBOARD_DEVICE), globalThis.__ops = [], global.display.connect("grab-op-begin", (d, w, op) => globalThis.__ops.push(["begin", op])), global.display.connect("grab-op-end", (d, w, op) => globalThis.__ops.push(["end", op])), 1' >/dev/null
    move 32 14; button PRESSED; button RELEASED # the first click after start is needed before clients get input
}
setup_pointer
move 640 240; button PRESSED
for step in "620 220" "500 180" "300 120" "100 60" "20 20"; do move $step; done
check "dragging the title bar starts a window move" '"begin:1"' 'globalThis.__ops.map(o => o.join(":")).join(",")'
button RELEASED
check "window followed the pointer (y held below the top bar)" '"[-180,32,400,300]"' "$RECT"
check "release ends the move" '"begin:1,end:1"' 'globalThis.__ops.map(o => o.join(":")).join(",")'

take_shot() { # take_shot FILE: the shell's screenshot, as a PNG file; prints "done" or the error
    rm -f "$1"
    ev "globalThis.__shot = 'pending', (() => { const {Shell, Gio} = imports.gi; const sh = new Shell.Screenshot(); const st = Gio.File.new_for_path('$1').replace(null, false, Gio.FileCreateFlags.NONE, null); sh.screenshot(false, st, (o, res) => { try { sh.screenshot_finish(res); st.close(null); globalThis.__shot = 'done'; } catch (e) { globalThis.__shot = 'error ' + e; } }); })(), 1" >/dev/null
    sleep 0.3
    ev 'globalThis.__shot'
}
SHOT=/tmp/smoke-shot.png
take_shot $SHOT >/dev/null
check "screenshot written to a PNG file" '"done"' 'globalThis.__shot'
PIXELS=$(python3 "$(dirname "$0")/pixels.py" $SHOT 100 100 600 500 | tr '\n' '|')
# (100,100) is inside the moved window, (600,500) is bare desktop.
if [ "$PIXELS" != "" ] && [ "${PIXELS%%|*}" != "$(echo "$PIXELS" | cut -d'|' -f2)" ]; then
    pass "pixel read tells window ($(echo "$PIXELS" | cut -d'|' -f1)) from desktop ($(echo "$PIXELS" | cut -d'|' -f2))"
else
    fail "pixel read tells window from desktop (got: $PIXELS)"
fi
kill $WINDOW_PID 2>/dev/null

echo "Drag to snap (SnapTile enabled, GNOME edge tiling off):"
gsettings set org.gnome.mutter edge-tiling false
ev "$ENABLE" >/dev/null
# The Window look: 0.83 mm of margin is 3 px at the 96 DPI fallback of the headless monitors, and the
# preview is drawn that far inside its Tile. PREVIEW reports the Tile the preview stands for
# (the drawn frame grown by the margin); PREVIEW_DRAWN reports the frame as drawn.
MARGIN=3
PREVIEW_BOXES='global.window_group.get_children().filter(c => c.style_class === "tile-preview" && c.visible && c.opacity === 255)'
PREVIEW_DRAWN="JSON.stringify($PREVIEW_BOXES.map(c => [Math.round(c.x), Math.round(c.y), Math.round(c.width), Math.round(c.height)]))"
PREVIEW="JSON.stringify($PREVIEW_BOXES.map(c => [Math.round(c.x) - $MARGIN, Math.round(c.y) - $MARGIN, Math.round(c.width) + 2 * $MARGIN, Math.round(c.height) + 2 * $MARGIN]))"
SIZE='JSON.stringify(global.get_window_actors().map(a => a.meta_window).filter(w => w.title === "probe-window").map(w => { const r = w.get_frame_rect(); return [r.width, r.height]; })[0])'

# What the shared TiledWindows says about the probe window: "<Tile> <width>x<height>" (size from
# before tiling), or null if it is not tiled.
TILED='(() => { const w = global.get_window_actors().map(a => a.meta_window).find(w => w.title === "probe-window"); const t = Main.extensionManager.lookup("'"$UUID"'").stateObj._tiledWindows.get(w.get_id()); return t && `${t.tile} ${t.sizeBefore.width}x${t.sizeBefore.height}`; })()'

start_probe() { # start_probe [WIDTHxHEIGHT]: a fresh probe window, with a minimum size if given
    kill $WINDOW_PID 2>/dev/null
    PROBE_MIN=${1:-} WAYLAND_DISPLAY=wayland-0 python3 "$(dirname "$0")/probe-window.py" >/tmp/smoke-window.log 2>&1 &
    WINDOW_PID=$!
    await_settled probe-window
}
grab_window() { # presses the pointer on the probe window's title bar
    IFS=, read -r fx fy fw fh <<<"$(ev "$RECT" | tr -d '"[]')"
    GX=$((fx + fw / 2)); GY=$((fy + 14))
    move $GX $GY; button PRESSED
}
drag_to() { # drag_to X Y: moves the held window to a pointer position in three steps
    move $((GX + 20)) $((GY + 20))
    move $((($1 + GX) / 2)) $((($2 + GY) / 2))
    move $1 $2
    sleep 0.3
}
snap() { # snap <description> <pointer x> <pointer y> <expected Tile rectangle x,y,w,h> [expected window x,y,w,h]
    grab_window
    drag_to "$2" "$3"
    local preview frame
    preview=$(ev "$PREVIEW")
    button RELEASED
    frame=$(ev "$RECT")
    local window=${5:-$4}
    if [ "$preview" = "\"[[$4]]\"" ] && [ "$frame" = "\"[$window]\"" ]; then
        pass "$1: preview at $4, window at $window"
    else
        fail "$1: expected preview [[$4]] and window [$window], got preview $preview and window $frame"
    fi
}

snap_merged() { # snap_merged <description> <pointer x of the first third> <of the next> <expected rect>
    grab_window
    drag_to "$2" 716
    move "$3" 716
    sleep 0.3
    local preview frame
    preview=$(ev "$PREVIEW")
    button RELEASED
    frame=$(ev "$RECT")
    if [ "$preview" = "\"[[$4]]\"" ] && [ "$frame" = "\"[$4]\"" ]; then
        pass "$1: preview at $4, window at $4"
    else
        fail "$1: expected preview [[$4]] and window [$4], got preview $preview and window $frame"
    fi
}

start_probe
# The headless monitor is 1280x720 with a 32 px top bar; it reports no millimetres, so the
# zones are 1 cm = 38 px deep at the 96 DPI fallback. Pointers sit well inside their zone.
snap "top-left quarter"     3    3 0,32,640,344
check "no preview left after release" '"[]"' "$PREVIEW"
snap "top-right quarter"    1276 3 640,32,640,344
snap "bottom-left quarter"  3    716 0,376,640,344
snap "bottom-right quarter" 1276 716 640,376,640,344
snap "left half"            3    360 0,32,640,688
snap "right half"           1276 360 640,32,640,688
snap "top half"             3    70 0,32,1280,344
snap "bottom half"          3    650 0,376,1280,344
snap "whole screen"         640  3 0,32,1280,688
snap "first third"          100  716 0,32,427,688
snap "middle third"         640  716 427,32,427,688
snap "last third"           1200 716 854,32,426,688

echo "Merged thirds without releasing:"
grab_window
drag_to 100 716
check "first third" '"[[0,32,427,688]]"' "$PREVIEW"
move 640 716
sleep 0.3
check "into the next third: left two-thirds" '"[[0,32,854,688]]"' "$PREVIEW"
move 1200 716
sleep 0.3
check "on into the last third: right two-thirds" '"[[427,32,853,688]]"' "$PREVIEW"
move 640 716
sleep 0.3
check "back to the middle third: only that third" '"[[427,32,427,688]]"' "$PREVIEW"
move 640 400
sleep 0.3
check "leaving the bottom strip hides the preview" '"[]"' "$PREVIEW"
BEFORE=$(ev "$RECT")
button RELEASED
check "releasing outside every zone leaves the window where it is" "$BEFORE" "$RECT"
snap_merged "release on the left two-thirds" 100 640 0,32,854,688
snap_merged "release on the right two-thirds, merged from the right" 1200 640 427,32,853,688

echo "Size before tiling:"
start_probe
snap "left half" 3 360 0,32,640,688
check "the shared record names the Tile and the size from before" '"left 400x300"' "$TILED"
snap "bottom-right quarter" 1276 716 640,376,640,344
check "tiled again: the record names the new Tile" '"bottom-right 400x300"' "$TILED"
snap "left half" 3 360 0,32,640,688
grab_window
drag_to 640 300
check "dragging a tiled window out restores its earlier size" '"[400,300]"' "$SIZE"
check "the shared record no longer has the window" 'null' "$TILED"
check "no preview in the middle of the screen" '"[]"' "$PREVIEW"
button RELEASED
snap "left half again" 3 360 0,32,640,688
ev "$DISABLE" >/dev/null
ev "$ENABLE" >/dev/null
check "after disabling and enabling, nothing is recorded" 'null' "$TILED"
grab_window
drag_to 640 300
check "a window with no remembered size keeps its own" '"[640,688]"' "$SIZE"
button RELEASED

echo "Cancelling a drag with Escape:"
start_probe
grab_window
drag_to 3 360
check "preview is shown before Escape" '"[[0,32,640,688]]"' "$PREVIEW"
press_escape
check "Escape hides the preview" '"[]"' "$PREVIEW"
button RELEASED
check "Escape leaves the window unsnapped" '"[440,226,400,300]"' "$RECT"
snap "left half" 3 360 0,32,640,688
grab_window
drag_to 3 360
check "dragging the tiled window back to a zone shows its preview" '"[[0,32,640,688]]"' "$PREVIEW"
press_escape
button RELEASED
check "Escape puts a tiled window back into its Tile" '"[0,32,640,688]"' "$RECT"
check "the shared record still names the Tile" '"left 400x300"' "$TILED"
grab_window
drag_to 640 300
check "it still remembers its earlier size" '"[400,300]"' "$SIZE"
button RELEASED

echo "Window that cannot get as small as the Tile (minimum 900x500):"
start_probe 900x500
snap "top-left quarter: window anchored at the Tile's top left" 3 3 0,32,640,344 0,32,900,500
snap "bottom-right quarter: window pulled back onto the screen" 1276 716 640,376,640,344 380,220,900,500

echo "A tiled window that grows beyond its Tile:"
start_probe
snap "top-left quarter" 3 3 0,32,640,344
resize_window 100 100 700 400
check "it is hung on the Tile's top left corner again" '"[0,32,700,400]"' "$RECT"
ev "$DISABLE" >/dev/null
resize_window 100 100 720 420
check "after disabling, SnapTile no longer touches it" '"[100,100,720,420]"' "$RECT"
ev "$ENABLE" >/dev/null
kill $WINDOW_PID 2>/dev/null

echo "Window look: rounded corners and margin (probe window at 440,226, 400x300, 8 px corners and 3 px margin at 96 DPI):"
# The shell starts in the overview, which shows windows smaller, and animations would move
# them during a screenshot. Both are switched off for the pixel checks.
gsettings set org.gnome.desktop.interface enable-animations false
ev 'Main.overview.hide(), 1' >/dev/null
red_at() { python3 "$(dirname "$0")/pixels.py" "$1" "$2" "$3" | cut -d' ' -f1; } # red channel at FILE X Y
look_of() { # look_of FILE X Y...: W for a window pixel (red 150 or more), D for the bare desktop (red below 100), ? otherwise
    local file=$1 value; shift
    while [ $# -gt 1 ]; do
        value=$(red_at "$file" "$1" "$2"); shift 2
        if [ "$value" -ge 150 ]; then echo -n W; elif [ "$value" -lt 100 ]; then echo -n D; else echo -n '?'; fi
    done
}
corner_checks() { # corner_checks <description> <screenshot> <round|square>: all four corners of the probe window
    # Round corners start inside the margin: the visible window is the frame pulled in by 3 px.
    local desc=$1 file=$2 want=$3 bad="" m=0
    [ "$want" = round ] && m=$MARGIN
    local corner name cx cy sx sy tip diag inner
    for corner in "top-left 440 226 1 1" "top-right 839 226 -1 1" "bottom-left 440 525 1 -1" "bottom-right 839 525 -1 -1"; do
        read -r name cx cy sx sy <<<"$corner"
        tip=$(red_at "$file" $((cx + m * sx)) $((cy + m * sy)))
        diag=$(red_at "$file" $((cx + (m + 1) * sx)) $((cy + (m + 1) * sy)))
        inner=$(red_at "$file" $((cx + (m + 3) * sx)) $((cy + (m + 3) * sy)))
        if [ "$want" = round ]; then
            { [ "$tip" -lt 100 ] && [ "$diag" -lt 100 ] && [ "$inner" -ge 150 ]; } || bad="$bad $name(tip $tip, diagonal $diag, inside $inner)"
        else
            { [ "$tip" -ge 150 ] && [ "$diag" -ge 150 ] && [ "$inner" -ge 150 ]; } || bad="$bad $name(tip $tip, diagonal $diag, inside $inner)"
        fi
    done
    if [ -z "$bad" ]; then pass "$desc"; else fail "$desc:$bad"; fi
}
PLAIN_ACTOR='global.get_window_actors().find(a => a.meta_window.title === "probe-window")'
EFFECTS="$PLAIN_ACTOR.get_effects().length"
PROBE_PLAIN=1 start_probe
ev "$DISABLE" >/dev/null
take_shot /tmp/look-off.png >/dev/null
corner_checks "without SnapTile the plain window has square corners (baseline)" /tmp/look-off.png square
ev "$ENABLE" >/dev/null
take_shot /tmp/look-on.png >/dev/null
corner_checks "with SnapTile all four corners are cut round" /tmp/look-on.png round
[ "$(red_at /tmp/look-on.png 640 376)" = 204 ] && pass "the middle of the window is untouched" || fail "the middle of the window is untouched"
# The frame is x 440..839, y 226..525. The margin clears 3 px inside it on every side, so the
# last full pixel of each straight edge is 3 px in and the 3 px outside that are the desktop.
edges=$(for xy in "640 229" "443 376" "836 376" "640 522"; do red_at /tmp/look-on.png $xy; done | tr '\n' ' ')
[ "$edges" = "204 204 204 204 " ] && pass "the straight edges stay full right up to the margin" || fail "the straight edges stay full right up to the margin (got $edges)"
margin=$(look_of /tmp/look-on.png 640 226 640 228 440 376 442 376 837 376 839 376 640 523 640 525)
[ "$margin" = DDDDDDDD ] && pass "the 3 px margin inside the frame shows the desktop on all four sides" || fail "the 3 px margin inside the frame shows the desktop on all four sides (got $margin, want DDDDDDDD)"
check "one effect on the window" 1 "$EFFECTS"
ev "$DISABLE" >/dev/null
check "disabling removes the effect from the window" 0 "$EFFECTS"
take_shot /tmp/look-off2.png >/dev/null
corner_checks "after disabling the corners are square again" /tmp/look-off2.png square
[ "$(red_at /tmp/look-off2.png 441 376)" = 204 ] && [ "$(red_at /tmp/look-off2.png 640 226)" = 204 ] && pass "after disabling the margin is gone: the window is full up to its frame" || fail "after disabling the margin is gone: the window is full up to its frame"
ev "$ENABLE" >/dev/null

echo "Window look: what it leaves alone"
FULLSCREEN_EFFECTS="($PLAIN_ACTOR.meta_window.make_fullscreen(), $EFFECTS)"
check "a full-screen window has no effect" 0 "$FULLSCREEN_EFFECTS"
check "leaving full screen brings it back" 1 "(($PLAIN_ACTOR.meta_window.unmake_fullscreen()), $EFFECTS)"
kill $WINDOW_PID 2>/dev/null
PROBE_POPOVER=1 start_probe
for _ in $(seq 30); do [ "$(ev 'global.get_window_actors().length')" = 2 ] && break; sleep 0.1; done # the probe opens its menu by itself
check "a menu is its own window next to the application window" 2 'global.get_window_actors().length'
check "only the application window has the effect, the menu has none" '"application:1,menu:0"' \
    'global.get_window_actors().map(a => `${a.meta_window.get_window_type() === 0 ? "application" : "menu"}:${a.get_effects().length}`).sort().join(",")'
kill $WINDOW_PID 2>/dev/null

echo "Window look: the application's own shadow stays"
start_probe
ev "$DISABLE" >/dev/null
take_shot /tmp/shadow-off.png >/dev/null
ev "$ENABLE" >/dev/null
take_shot /tmp/shadow-on.png >/dev/null
SHADOW_POINTS="438 224 436 222 440 224 438 230 436 300 441 222 840 224 842 226 842 530 440 527 436 524"
off=$(python3 "$(dirname "$0")/pixels.py" /tmp/shadow-off.png $SHADOW_POINTS | tr '\n' '|')
on=$(python3 "$(dirname "$0")/pixels.py" /tmp/shadow-on.png $SHADOW_POINTS | tr '\n' '|')
[ "$off" = "$on" ] && pass "pixels in the shadow around the corners are identical with and without SnapTile" || fail "shadow pixels changed: without $off with $on"
near=$(python3 "$(dirname "$0")/pixels.py" /tmp/shadow-off.png 436 300)
far=$(python3 "$(dirname "$0")/pixels.py" /tmp/shadow-off.png 380 300)
[ "$near" != "$far" ] && pass "there is a shadow to protect (beside the window $near, further away $far)" || fail "the probe window draws no shadow ($near = $far)"
kill $WINDOW_PID 2>/dev/null
gsettings set org.gnome.desktop.interface enable-animations true

echo "Window look: margin between and around tiled windows (two real drags, then pixels)"
# Window 1 is "probe-window", window 2 is "probe-second". Both have a title bar and are dragged
# into the two halves like a user would; the pixels are read from a screenshot afterwards.
FRAMES='JSON.stringify(global.get_window_actors().map(a => a.meta_window).filter(w => w.title.startsWith("probe")).map(w => { const r = w.get_frame_rect(); return [w.title === "probe-window" ? 1 : 2, r.x, r.y, r.width, r.height]; }).sort())'
start_probe
snap "left half (window 1)" 3 360 0,32,640,688
PROBE_TITLE=probe-second WAYLAND_DISPLAY=wayland-0 python3 "$(dirname "$0")/probe-window.py" >/tmp/smoke-window2.log 2>&1 &
SECOND_PID=$!
await_settled probe-second
FIRST_RECT=$RECT
RECT=${RECT//probe-window/probe-second} # the drag helpers now work on window 2
snap "right half (window 2)" 1276 360 640,32,640,688
RECT=$FIRST_RECT
check "the two windows touch: their frames are exactly the two halves" '"[[1,0,32,640,688],[2,640,32,640,688]]"' "$FRAMES"
take_shot /tmp/pair.png >/dev/null
across=$(for x in 2 3 636 637 642 643 1276 1277; do look_of /tmp/pair.png $x 500; done)
[ "$across" = DWWDDWWD ] \
    && pass "side by side: 3 px to the screen edge, 6 px between the windows, 3 px to the other edge" \
    || fail "side by side (columns 2,3,636,637,642,643,1276,1277: want DWWDDWWD, got $across)"
down=$(for y in 34 35 716 717; do look_of /tmp/pair.png 300 $y; done)
[ "$down" = DWWD ] \
    && pass "3 px below the top bar and 3 px above the bottom of the work area" \
    || fail "top and bottom (rows 34,35,716,717: want DWWD, got $down)"
# Floating: drag window 2 out of its Tile to a place that overlaps window 1. The look moves
# nothing and repels nothing: it sits exactly where the pointer put it.
RECT=${RECT//probe-window/probe-second}
grab_window
drag_to 700 300
button RELEASED
RECT=$FIRST_RECT
DROPPED='(() => { const frame = n => global.get_window_actors().map(a => a.meta_window).find(w => w.title === n).get_frame_rect(); const one = frame("probe-window"), two = frame("probe-second"); return JSON.stringify([[one.x, one.y, one.width, one.height], two.width, two.height, two.x < one.x + one.width, two.x <= 700 && 700 < two.x + two.width && two.y <= 300 && 300 < two.y + two.height]); })()'
check "a window dropped over another one: its earlier size, over the other window, under the pointer, nothing pushes it away" '"[[0,32,640,688],400,300,true,true]"' "$DROPPED"
kill $SECOND_PID 2>/dev/null
kill $WINDOW_PID 2>/dev/null

echo "Window look: the Tile preview matches the snapped window"
start_probe
take_shot /tmp/preview-before.png >/dev/null
grab_window
drag_to 1276 3
take_shot /tmp/preview-during.png >/dev/null
check "the preview is drawn 3 px inside its Tile, like the window it will become" '"[[643,35,634,338]]"' "$PREVIEW_DRAWN"
check "the preview has the window's corner radius" '"border-radius: 8px;"' \
    'global.window_group.get_children().filter(c => c.style_class === "tile-preview").map(c => c.style)[0]'
same_as_before() { # same_as_before X Y: the pixel is as on the bare desktop
    [ "$(python3 "$(dirname "$0")/pixels.py" /tmp/preview-during.png $1 $2)" = "$(python3 "$(dirname "$0")/pixels.py" /tmp/preview-before.png $1 $2)" ]
}
# The preview's top left corner is at 643,35; the dragged window covers the right of the Tile.
outside=""
for xy in "642 200" "700 34" "643 35" "644 36"; do same_as_before $xy || outside="$outside [$xy]"; done
[ -z "$outside" ] && pass "preview: desktop shows in the margin and in the rounded top left corner" || fail "preview: these pixels were painted but should show the desktop:$outside"
inside=""
for xy in "644 200" "700 36" "646 38" "660 50"; do same_as_before $xy && inside="$inside [$xy]"; done
[ -z "$inside" ] && pass "preview: tinted just inside the edge and inside the corner" || fail "preview: these pixels show the bare desktop but should be tinted:$inside"
button RELEASED
check "the snapped window's frame is the Tile the preview marked" '"[640,32,640,344]"' "$RECT"
kill $WINDOW_PID 2>/dev/null

echo "Disabling SnapTile during and right after a drag:"
# Records the timers SnapTile starts and still has pending (not removed, not finished).
ev '(() => { const GLib = imports.gi.GLib; const add = GLib.timeout_add, remove = GLib.source_remove; globalThis.__timers = new Set(); GLib.timeout_add = function (priority, ms, fn) { const ours = new Error().stack.includes("dragSnap.js") || new Error().stack.includes("windowMemory.js"); const id = add.call(GLib, priority, ms, ours ? () => { const again = fn(); if (!again) globalThis.__timers.delete(id); return again; } : fn); if (ours) globalThis.__timers.add(id); return id; }; GLib.source_remove = function (id) { globalThis.__timers.delete(id); return remove.call(GLib, id); }; return 1; })()' >/dev/null
TIMERS='globalThis.__timers.size'
start_probe
grab_window
drag_to 3 3
check "preview is shown before disabling" '"[[0,32,640,344]]"' "$PREVIEW"
check "the drag has a timer running" 1 "$TIMERS"
ev "$DISABLE" >/dev/null
check "no timer is left when disabled during the drag" 0 "$TIMERS"
check "preview is gone when disabled during the drag" '"[]"' "$PREVIEW"
move 1276 3
check "no preview comes back while the drag goes on" '"[]"' "$PREVIEW"
button RELEASED
check "the window is not snapped after disabling" '"[400,300]"' "$SIZE"
ev "$ENABLE" >/dev/null
grab_window
drag_to 3 3
button RELEASED
check "a drop starts no timer" 0 "$TIMERS"
ev "$DISABLE" >/dev/null
check "no timer is left after a drop and after disabling" 0 "$TIMERS"
check "extension is inactive after disabling right after a drop" $INACTIVE "$STATE"
check "no preview left after disabling right after a drop" '"[]"' "$PREVIEW"
kill $WINDOW_PID 2>/dev/null
SHELL_LOGS=("$SHELL_LOG")

echo "Window memory (free windows):"
# Probe windows are told apart by application id (PROBE_APP_ID) and title. The memory keys by
# application, so the same id on a second start is "the same application". The extension keeps a
# copy of the stored places, so a test that changes them behind its back reloads the extension.
gsettings set org.gnome.desktop.interface enable-animations false
# On GNOME 51 an enable right after a disable can be undone by the shell, which acts on the
# earlier change of its list of enabled extensions late. So each step waits for its result.
reload_extension() { # the shell may undo an enable a moment after it was seen, so look again and retry
    for _ in 1 2 3; do
        ev "$DISABLE" >/dev/null; await_state $INACTIVE; ev "$ENABLE" >/dev/null; await_state $ACTIVE
        sleep 0.3
        [ "$(ev "$STATE")" = "$ACTIVE" ] && return
    done
}
reload_extension
MEM='Main.extensionManager.lookup("'"$UUID"'").stateObj.getSettings()'
PLACES="Object.entries(JSON.parse($MEM.get_string('places'))).map(([key, entry]) => key + '=' + Object.values(entry.frame)).join(';')"
store_places() { ev "$MEM.set_string('places', JSON.stringify($1)), 1" >/dev/null; } # store_places <js object>
set_places() { store_places "$1"; reload_extension; }
reset_places() { ev "$MEM.reset('places'), 1" >/dev/null; reload_extension; }
titled() { echo "global.get_window_actors().map(a => a.meta_window).filter(w => w.title === '$1')"; } # titled <title>: JS for the windows with that title
frame_of() { # frame_of <title>: JS for the frame rectangle of that window, or null
    echo "JSON.stringify($(titled "$1").map(w => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; })[0] ?? null)"
}
MEM_PIDS=()
await_true() { for _ in $(seq 80); do [ "$(ev "$1")" = true ] && return; sleep 0.1; done; } # await_true <js expression>: at most 8 s
MEM_TITLES=()
start_app() { # start_app <title> <ENV=value>...: a probe window, ready once its frame has settled
    local title=$1; shift
    env PROBE_TITLE="$title" "$@" WAYLAND_DISPLAY=wayland-0 python3 "$(dirname "$0")/probe-window.py" >"/tmp/smoke-memory-$title.log" 2>&1 &
    MEM_PIDS+=($!)
    MEM_TITLES+=("$title")
    await_settled "$title"
    # Probes that do something on their own a moment after they appeared: wait for what they do.
    case " $* " in *" PROBE_SECOND="*) await_settled "$title-2" ;; esac
    case " $* " in *" PROBE_DIALOG="*) await_settled probe-dialog ;; esac
    case " $* " in *" PROBE_LATER="*) await_settled "$title-$(( $(sed -n 's/.*PROBE_LATER=\([0-9]*\).*/\1/p' <<<" $* ") + 1 ))" ;; esac
    case " $* " in *" PROBE_FULLSCREEN="*) await_true "$(titled "$title").some(w => w.is_fullscreen())" ;; esac
}
close_window() { # close_window <title>: asks the window to close, like its close button, and waits until it is gone
    ev "$(titled "$1").forEach(w => w.delete(global.get_current_time())), 1" >/dev/null
    for _ in $(seq 15); do [ "$(ev "$(titled "$1").length")" = 0 ] && break; sleep 0.2; done
}
place_window() { # place_window <title> x y w h: moves the window like the user would (through Mutter)
    ev "$(titled "$1")[0].move_resize_frame(true, $2, $3, $4, $5), 1" >/dev/null
}
stop_apps() { # kills the probes and waits until their windows (also dialogs and second windows) are gone
    kill "${MEM_PIDS[@]}" 2>/dev/null
    MEM_PIDS=()
    local ours="global.get_window_actors().filter(a => /^(${MEM_TITLES[*]// /|})(-[0-9]+)?\$|^probe-dialog\$/.test(a.meta_window.title)).length"
    MEM_TITLES=()
    for _ in $(seq 15); do [ "$(ev "$ours")" = 0 ] && break; sleep 0.2; done
}
MEM_A='{"org.snaptile.MemA": {frame: {x: 120, y: 90, width: 520, height: 360}}}'

reset_places
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "an application with nothing remembered keeps its own size and place" '"[440,226,400,300]"' "$(frame_of mem-a)"
place_window mem-a 120 90 520 360
close_window mem-a
check "closing a window remembers its size and position, per application" '"org.snaptile.MemA=120,90,520,360"' "$PLACES"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "the application's next window opens with the same size and position" '"[120,90,520,360]"' "$(frame_of mem-a)"
start_app mem-b PROBE_APP_ID=org.snaptile.MemB
check "a second application is not affected" '"[440,226,400,300]"' "$(frame_of mem-b)"
stop_apps

echo "  Window memory: windows that count, and windows that do not"
set_places "$MEM_A"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_SECOND=1
check "two windows opened together: exactly one is put at the remembered place" 1 "[$(frame_of mem-a), $(frame_of mem-a-2)].filter(f => f === '[120,90,520,360]').length"
stop_apps
reset_places
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_FULLSCREEN=1
close_window mem-a
check "a window that went full screen is not remembered" '""' "$PLACES"
stop_apps

echo "  Window memory: dialogs are left alone"
# The dialog has no application id, so a memory that did not skip it would key it by its window
# class "python3". Such an entry is put in place as bait: the dialog must neither go there nor
# be stored.
reset_places
set_places '{"python3": {frame: {x: 700, y: 400, width: 333, height: 222}}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_DIALOG=1
DIALOG_UNTOUCHED='(() => { const frame = n => global.get_window_actors().map(a => a.meta_window).find(w => w.title === n).get_frame_rect(); const main = frame("mem-a"), dialog = frame("probe-dialog"); return [dialog.width, dialog.height, dialog.x === main.x + Math.round((main.width - dialog.width) / 2)].join(); })()'
check "a dialog keeps its own size and sits centred on its window, not at a remembered place" '"300,150,true"' "$DIALOG_UNTOUCHED"
place_window mem-a 120 90 520 360
close_window probe-dialog
check "closing a dialog remembers nothing" '"python3=700,400,333,222"' "$PLACES"
close_window mem-a
check "the main window's place is the one remembered, not the dialog's" '"python3=700,400,333,222;org.snaptile.MemA=120,90,520,360"' "$PLACES"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "the application's window reopens where the main window was, not at the dialog's size" '"[120,90,520,360]"' "$(frame_of mem-a)"
stop_apps

echo "  Window memory: Nautilus's file chooser is left alone, its file manager is remembered"
reset_places
# Stand-ins: a normal application window and a plain window (no GTK window path) of the same
# application, like the parentless chooser (docs/research/window-placement-on-wayland.md).
start_app files PROBE_APP_ID=org.gnome.Nautilus
check "stand-in for a file-manager window has a GTK window path" true "$(titled files).every(w => w.get_gtk_window_object_path() !== null)"
place_window files 150 100 600 400
close_window files
check "a Nautilus file-manager window is remembered" '"org.gnome.Nautilus=150,100,600,400"' "$PLACES"
start_app chooser PROBE_APP_ID=org.gnome.Nautilus PROBE_PLAIN_WINDOW=1
check "stand-in for the chooser is a Nautilus window without GTK window path" true "$(titled chooser).every(w => w.get_gtk_window_object_path() === null && w.get_gtk_application_id() === 'org.gnome.Nautilus')"
check "the chooser is not moved to the file manager's place" '"[440,226,400,300]"' "$(frame_of chooser)"
place_window chooser 300 200 450 350
close_window chooser
check "closing the chooser does not overwrite the file manager's place" '"org.gnome.Nautilus=150,100,600,400"' "$PLACES"
stop_apps

echo "  Window memory: open windows, corrupt data, big sizes, windows that maximise themselves, disabling"
ev "$DISABLE" >/dev/null
store_places "$MEM_A"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
ev "$ENABLE" >/dev/null
check "a window that was open when the extension was enabled is not moved" '"[440,226,400,300]"' "$(frame_of mem-a)"
stop_apps
ev "$DISABLE" >/dev/null
store_places "$MEM_A"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "with the extension disabled nothing is placed" '"[440,226,400,300]"' "$(frame_of mem-a)"
place_window mem-a 10 40 300 300
close_window mem-a
check "with the extension disabled nothing is remembered" '"org.snaptile.MemA=120,90,520,360"' "$PLACES"
stop_apps
ev "$ENABLE" >/dev/null

ev "$MEM.set_string('places', 'not json at all'), 1" >/dev/null
reload_extension
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "unreadable stored data reads as nothing remembered" '"[440,226,400,300]"' "$(frame_of mem-a)"
stop_apps

set_places '{"org.snaptile.MemA": {frame: {x: 120, y: 90, width: 520, height: 360}}, "org.snaptile.MemB": {frame: {x: "left", y: 0, width: 5, height: 5}}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
start_app mem-b PROBE_APP_ID=org.snaptile.MemB
check "a corrupt entry is dropped and the good one still works" '"[120,90,520,360]|[440,226,400,300]"' "[$(frame_of mem-a), $(frame_of mem-b)].join('|')"
stop_apps

set_places '{"org.snaptile.MemA": {frame: {x: 0, y: 0, width: 3000, height: 2000}}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "a remembered size larger than the work area is shrunk to it" '"[0,32,1280,688]"' "$(frame_of mem-a)"
stop_apps

set_places "$MEM_A"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_MAXIMIZE=1
check "SnapTile's place wins against an application that maximises itself" '"[120,90,520,360]"' "$(frame_of mem-a)"
stop_apps

echo "  Window memory: saved when a move or resize ends, last action wins, saved when the extension is disabled"
# Windows are put in place through Mutter (no grab, so nothing is saved by that), then moved and
# resized with the virtual pointer on the title bar and on the corner, like a user.
drag_title() { # drag_title <x> <y> <dx> <dy>: press at x,y on a title bar, move by dx,dy, let go
    move "$1" "$2"; button PRESSED
    move $(($1 + $3 / 2)) $(($2 + $4 / 2)); move $(($1 + $3)) $(($2 + $4))
    sleep 0.3
    button RELEASED
}
reset_places
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_SECOND=1
place_window mem-a 50 100 400 300
place_window mem-a-2 600 100 400 300
check "putting a window in place through Mutter saves nothing by itself" '""' "$PLACES"
drag_title 250 114 0 150
check "a move is saved as soon as it ends, the window stays open" '"org.snaptile.MemA=50,250,400,300"' "$PLACES"
drag_title 800 114 0 100
check "a later move of another window of the application is saved" '"org.snaptile.MemA=600,200,400,300"' "$PLACES"
close_window mem-a
check "closing the older window does not undo the newer move of the other window" '"org.snaptile.MemA=600,200,400,300"' "$PLACES"
drag_title 1002 502 60 50
check "a resize is saved as soon as it ends" '"org.snaptile.MemA=600,200,460,350"' "$PLACES"
close_window mem-a-2
check "closing the last window keeps its place" '"org.snaptile.MemA=600,200,460,350"' "$PLACES"
stop_apps

reset_places
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_SECOND=1
place_window mem-a 50 100 400 300
place_window mem-a-2 600 100 400 300
ev "$(titled mem-a)[0].activate(global.get_current_time()), 1" >/dev/null
ev "$DISABLE" >/dev/null
check "disabling saves the open windows, the one used last wins (first window)" '"org.snaptile.MemA=50,100,400,300"' "$PLACES"
ev "$ENABLE" >/dev/null
ev "$(titled mem-a-2)[0].activate(global.get_current_time()), 1" >/dev/null
ev "$DISABLE" >/dev/null
check "disabling saves the open windows, the one used last wins (second window)" '"org.snaptile.MemA=600,100,400,300"' "$PLACES"
ev "$ENABLE" >/dev/null
stop_apps

echo "  Window memory: tiled and maximised windows"
# What is stored per application, as text: "<Tile, maximized or free> <frame> <size before tiling>".
KINDS="Object.entries(JSON.parse($MEM.get_string('places'))).map(([key, e]) => key + '=' + (e.tile ?? (e.maximized ? 'maximized' : 'free')) + ' ' + Object.values(e.frame) + ' ' + (e.sizeBefore ? e.sizeBefore.width + 'x' + e.sizeBefore.height : '-')).join(';')"
size_of() { echo "$(titled "$1").map(w => { const r = w.get_frame_rect(); return r.width + 'x' + r.height; })[0]"; } # size_of <title>: JS for "WIDTHxHEIGHT"
tile_of() { echo "$(titled "$1").map(w => Main.extensionManager.lookup('$UUID').stateObj._tiledWindows.get(w.get_id())?.tile ?? null)[0]"; } # tile_of <title>: JS for the Tile SnapTile has the window in
LEFT_TILE='{"org.snaptile.MemA": {frame: {x: 0, y: 32, width: 640, height: 688}, tile: "left", sizeBefore: {width: 520, height: 360}}}'

reset_places
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
place_window mem-a 50 100 520 360
drag_title 250 114 -247 286 # the pointer ends in the left Edge zone
check "a window dropped into a Tile sits in it" '"[0,32,640,688]"' "$(frame_of mem-a)"
check "the drop is saved at once: the Tile, its rectangle and the size from before tiling" '"org.snaptile.MemA=left 0,32,640,688 520x360"' "$KINDS"
close_window mem-a
check "closing a tiled window keeps the Tile" '"org.snaptile.MemA=left 0,32,640,688 520x360"' "$KINDS"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "the application's next window reopens in the same Tile" '"[0,32,640,688]"' "$(frame_of mem-a)"
check "the reopened window is recorded as tiled in that Tile" '"left"' "$(tile_of mem-a)"
close_window mem-a
check "closing it again keeps the size from before tiling, not the application's default" '"org.snaptile.MemA=left 0,32,640,688 520x360"' "$KINDS"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
drag_title 300 46 400 250 # out of the Tile, to the middle of the screen
check "dragging the reopened window out of its Tile gives it the earlier size" '"520x360"' "$(size_of mem-a)"
check "a window dragged out is remembered as a free window again" '"free"' "(e => e.tile ?? (e.maximized ? 'maximized' : 'free'))(JSON.parse($MEM.get_string('places'))['org.snaptile.MemA'])"
stop_apps

# A window that opened tiled and never had a free size: nothing is invented from the default.
set_places '{"org.snaptile.MemA": {frame: {x: 640, y: 32, width: 640, height: 688}, tile: "right"}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "a Tile remembered without an earlier size still reopens in the Tile" '"[640,32,640,688]"' "$(frame_of mem-a)"
close_window mem-a
check "closing it invents no size from the application's default" '"org.snaptile.MemA=right 640,32,640,688 -"' "$KINDS"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
drag_title 900 46 -300 250
check "dragged out, a window that never had a free size keeps its own size" '"640x688"' "$(size_of mem-a)"
stop_apps

reset_places
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
place_window mem-a 50 100 400 300
drag_title 250 114 390 -111 # the pointer ends in the top Edge zone: the whole-screen Tile
check "a window dropped into the whole-screen Tile fills the work area" '"[0,32,1280,688]"' "$(frame_of mem-a)"
close_window mem-a
check "closing it in the whole-screen Tile remembers that Tile" '"org.snaptile.MemA=full 0,32,1280,688 400x300"' "$KINDS"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "it reopens in the whole-screen Tile" '"[0,32,1280,688]"' "$(frame_of mem-a)"
check "the whole-screen Tile is a Tile, not the maximised state" '"false|full"' "[$(titled mem-a)[0].is_maximized(), $(tile_of mem-a)].join('|')"
stop_apps

set_places '{"org.snaptile.MemA": {frame: {x: 120, y: 90, width: 520, height: 360}}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
ev "$(titled mem-a)[0].maximize(), 1" >/dev/null
close_window mem-a
check "closing a window maximised with the window button remembers the flag and the free size" '"org.snaptile.MemA=maximized 0,32,1280,688 520x360"' "$KINDS"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "the application's next window reopens maximised" '"true|[0,32,1280,688]"' "[$(titled mem-a)[0].is_maximized(), $(frame_of mem-a)].join('|')"
stop_apps

echo "  Window memory: a Tile is reached also by windows that fight it, and by those that do not fit"
set_places "$LEFT_TILE"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_MAXIMIZE=1
check "SnapTile's Tile wins against an application that maximises itself" '"false|[0,32,640,688]"' "[$(titled mem-a)[0].is_maximized(), $(frame_of mem-a)].join('|')"
check "that window is recorded as tiled, with the remembered earlier size" '"left"' "$(tile_of mem-a)"
stop_apps

start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_MIN=900x500
check "a window with a minimum size larger than its Tile is hung on the Tile's top left corner" '"[0,32,900,688]"' "$(frame_of mem-a)"
stop_apps

start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_SECOND=1
check "two windows opened together: exactly one is put into the Tile" 1 "[$(frame_of mem-a), $(frame_of mem-a-2)].filter(f => f === '[0,32,640,688]').length"
stop_apps

echo "  Window memory: a second window of an application opens offset from the first"
# The headless monitor has no physical size, so 1 cm is the 96 DPI fallback of the Edge zones:
# 37.8 pixels, 38 once rounded.
check "the test monitor has no physical size (1 cm is the 96 DPI fallback)" '"{}"' "JSON.stringify(Main.extensionManager.lookup('$UUID').stateObj._monitorSizes.get(0))"
set_places "$MEM_A"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_LATER=2
check "the first window opens at the remembered place" '"[120,90,520,360]"' "$(frame_of mem-a)"
check "the second window has the remembered size and sits 1 cm right and down from the first" '"[158,128,520,360]"' "$(frame_of mem-a-2)"
check "a third window steps once more" '"[196,166,520,360]"' "$(frame_of mem-a-3)"
close_window mem-a-2
close_window mem-a-3
stop_apps

set_places "$LEFT_TILE"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_LATER=1
check "the first window opens in the remembered Tile" '"[0,32,640,688]|left"' "[$(frame_of mem-a), $(tile_of mem-a)].join('|')"
check "the second window opens free with the size from before tiling, offset from the Tile's corner" '"[38,70,520,360]|no Tile"' "[$(frame_of mem-a-2), $(tile_of mem-a-2) ?? 'no Tile'].join('|')"
stop_apps

set_places '{"org.snaptile.MemA": {frame: {x: 0, y: 0, width: 3000, height: 2000}}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_LATER=1
check "a second window with a remembered size larger than the work area is shrunk to it" '"[0,32,1280,688]|[0,32,1280,688]"' "[$(frame_of mem-a), $(frame_of mem-a-2)].join('|')"
stop_apps

set_places "$MEM_A"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA PROBE_LATER=1 PROBE_MAXIMIZE=1
check "a second window that maximises itself ends up free, at the offset, not maximised" '"false|[158,128,520,360]"' "[$(titled mem-a-2)[0].is_maximized(), $(frame_of mem-a-2)].join('|')"
stop_apps

echo "  Window memory: a tiled window is saved when the extension is disabled"
set_places "$LEFT_TILE"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
store_places '{}' # behind the extension's back: it follows, so only saving the open window can bring the Tile back
check "the stored places are empty" '""' "$KINDS"
ev "$DISABLE" >/dev/null
check "disabling saves the open tiled window with its Tile and earlier size" '"org.snaptile.MemA=left 0,32,640,688 520x360"' "$KINDS"
ev "$ENABLE" >/dev/null
stop_apps

echo "  Window memory: the switch and the clear button in the Extensions manager"
# The real preferences window is opened in the test shell and driven like a user would: a click
# into it, then keys. The first control is the switch (Space), the next one the clear button
# (Tab, then Space). Whatever the keys did is read back from the settings.
check "the switch is on in a fresh install" true "$MEM.get_boolean('enabled')"
reset_places
gnome-extensions prefs "$UUID" >/dev/null 2>&1
await_settled SnapTile
check "the preferences window opens" 1 "$(titled SnapTile).length"
PREFS_FRAME=$(ev "JSON.stringify($(titled SnapTile).map(w => { const r = w.get_frame_rect(); return [r.x + r.width / 2, r.y + r.height / 2]; })[0])")
move $(echo "$PREFS_FRAME" | tr -d '[]"' | tr ',' ' ' | awk '{print int($1), int($2)}')
button PRESSED; button RELEASED
press_key() { # press_key <keysym>: to the focused window, like the keyboard would
    for state in PRESSED RELEASED; do
        ev "globalThis.__kbd.notify_keyval(imports.gi.GLib.get_monotonic_time(), $1, imports.gi.Clutter.KeyState.$state), 1" >/dev/null
    done
    sleep 0.3
}
prefs_key() { # prefs_key <keysym>: back to the preferences window first (opening a window took the focus)
    ev "$(titled SnapTile)[0].activate(global.get_current_time()), 1" >/dev/null
    sleep 0.3
    press_key "$1"
}
SPACE=0x20
TAB=0xff09

set_places "$MEM_A"
prefs_key $SPACE
check "the switch turns off" false "$MEM.get_boolean('enabled')"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "switched off: a window is not placed" '"[440,226,400,300]"' "$(frame_of mem-a)"
place_window mem-a 10 40 300 300
reload_extension
check "switched off: disabling the extension saves nothing" '"org.snaptile.MemA=120,90,520,360"' "$PLACES"
close_window mem-a
check "switched off: closing a window changes nothing stored" '"org.snaptile.MemA=120,90,520,360"' "$PLACES"
stop_apps

prefs_key $SPACE
check "the switch turns on again" true "$MEM.get_boolean('enabled')"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "switched on again: the earlier place is back" '"[120,90,520,360]"' "$(frame_of mem-a)"
place_window mem-a 200 120 500 350
# Another application's place is stored behind the extension's back, which it must follow.
store_places '{"org.snaptile.MemB": {frame: {x: 5, y: 40, width: 300, height: 200}}, "org.snaptile.MemA": {frame: {x: 120, y: 90, width: 520, height: 360}}}'
prefs_key $TAB; press_key $SPACE
check "the clear button empties the stored data" '""' "$PLACES"
close_window mem-a
check "closing the window after the clear brings back only its own place, not the cleared data" '"org.snaptile.MemA=200,120,500,350"' "$PLACES"
stop_apps

start_app mem-a PROBE_APP_ID=org.snaptile.MemA
place_window mem-a 220 140 450 330
prefs_key $SPACE # the clear button still has the focus
check "the clear button empties the stored data again" '""' "$PLACES"
ev "$MEM.set_boolean('enabled', false), 1" >/dev/null
close_window mem-a
check "a window that was open during the clear stores nothing while switched off" '""' "$PLACES"
ev "$MEM.set_boolean('enabled', true), 1" >/dev/null
stop_apps
# kill, not delete: closing asks the window first, and Mutter's warning about that ping names
# the window ("SnapTile"), which the shell log check below would take for an error of ours.
ev "$(titled SnapTile).forEach(w => w.kill()), 1" >/dev/null
sleep 0.3
check "the preferences window closes" 0 "$(titled SnapTile).length"
reset_places

echo "  Window memory: nothing is left behind when the extension is disabled"
# Every signal connection made from windowMemory.js is recorded (and forgotten when it is
# disconnected). Connections on windows that are gone do not count.
ev "$DISABLE" >/dev/null
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
ev '(() => { const proto = imports.gi.GObject.Object.prototype, connect = proto.connect, disconnect = proto.disconnect; globalThis.__conns = []; proto.connect = function (name, fn) { const id = connect.call(this, name, fn); if (new Error().stack.includes("windowMemory.js")) globalThis.__conns.push([this, id]); return id; }; proto.disconnect = function (id) { globalThis.__conns = globalThis.__conns.filter(([object, other]) => object !== this || other !== id); return disconnect.call(this, id); }; return 1; })()' >/dev/null
CONNS='globalThis.__conns.filter(([object]) => !(object instanceof imports.gi.Meta.Window) || global.get_window_actors().some(a => a.meta_window === object)).length'
ev "$ENABLE" >/dev/null
start_app mem-b PROBE_APP_ID=org.snaptile.MemB PROBE_MAXIMIZE=1
check "while enabled it holds signal connections (display, shell, one per open window)" true "$CONNS >= 4"
ev "$DISABLE" >/dev/null
check "no signal connection of the window memory is left after disabling" 0 "$CONNS"
check "no timer is left after the window memory ran" 0 "$TIMERS"
stop_apps
ev "$ENABLE" >/dev/null
gsettings set org.gnome.desktop.interface enable-animations true

echo "Two monitors (1280x720 with the top bar, 1024x768 to its right):"
kill $SHELL_PID 2>/dev/null
wait $SHELL_PID 2>/dev/null
SHELL_LOG_TWO=/tmp/smoke-shell-two.log
start_shell "$SHELL_LOG_TWO" 1280x720 1024x768
SHELL_LOGS+=("$SHELL_LOG_TWO")
ev "$ENABLE" >/dev/null
check "the shell sees both monitors side by side" '"[[0,0,1280,720],[1280,0,1024,768]]"' \
    'JSON.stringify(Main.layoutManager.monitors.map(m => [m.x, m.y, m.width, m.height]))'
setup_pointer
start_probe
snap "second monitor, left half (its edge touches the first monitor)" 1283 400 1280,0,512,768
snap "first monitor, right half (the same edge from the other side)" 1276 400 640,32,640,688
snap "second monitor, whole screen (no top bar there)" 1800 3 1280,0,1024,768
snap "second monitor, last third" 2100 764 1963,0,341,768
snap "second monitor, top-left quarter" 1283 3 1280,0,512,384

kill $WINDOW_PID 2>/dev/null

echo "Window memory with two monitors, then with the second one gone:"
# A virtual monitor has an id like a real one (connector, vendor, product, serial). The window
# memory keeps the monitor by that id and the position relative to it.
gsettings set org.gnome.desktop.interface enable-animations false
SECOND_ID='Meta-1|MetaVendor|MetaVirtualMonitor|0x01'
MONITOR_OF="(e => e.monitor + '@' + Object.values(e.offset ?? {}))(JSON.parse($MEM.get_string('places'))['org.snaptile.MemA'])"
reset_places
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
place_window mem-a 1380 100 500 400
close_window mem-a
check "closing a window on the second monitor remembers that monitor and the place on it" "\"$SECOND_ID@100,100\"" "$MONITOR_OF"
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "the application's next window reopens on the second monitor" '"[1380,100,500,400]"' "$(frame_of mem-a)"
stop_apps
set_places '{"org.snaptile.MemA": {frame: {x: 1280, y: 0, width: 512, height: 768}, tile: "left", monitor: "'"$SECOND_ID"'"}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "a Tile of the second monitor reopens in that Tile of the second monitor" '"[1280,0,512,768]"' "$(frame_of mem-a)"
stop_apps

kill $SHELL_PID 2>/dev/null
wait $SHELL_PID 2>/dev/null
SHELL_LOG_ONE=/tmp/smoke-shell-one.log
start_shell "$SHELL_LOG_ONE" 1280x720
SHELL_LOGS+=("$SHELL_LOG_ONE")
ev "$ENABLE" >/dev/null
check "the shell sees only the first monitor now" '"[[0,0,1280,720]]"' \
    'JSON.stringify(Main.layoutManager.monitors.map(m => [m.x, m.y, m.width, m.height]))'
set_places '{"org.snaptile.MemA": {frame: {x: 1380, y: 100, width: 500, height: 400}, monitor: "'"$SECOND_ID"'", offset: {x: 100, y: 100}}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "with the second monitor gone, the window opens on the remaining one, inside its work area" '"[780,100,500,400]"' "$(frame_of mem-a)"
stop_apps
set_places '{"org.snaptile.MemA": {frame: {x: 1300, y: 10, width: 1600, height: 900}, monitor: "'"$SECOND_ID"'", offset: {x: 20, y: 10}}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "a remembered size larger than the remaining work area is shrunk to it" '"[0,32,1280,688]"' "$(frame_of mem-a)"
stop_apps
set_places '{"org.snaptile.MemA": {frame: {x: 1280, y: 0, width: 512, height: 768}, tile: "left", monitor: "'"$SECOND_ID"'"}}'
start_app mem-a PROBE_APP_ID=org.snaptile.MemA
check "a Tile of the vanished monitor applies on the remaining monitor" '"[0,32,640,688]"' "$(frame_of mem-a)"
stop_apps
gsettings set org.gnome.desktop.interface enable-animations true

echo "Shell log:"
if grep -iE "snaptile|JS ERROR" "${SHELL_LOGS[@]}"; then
    fail "errors mentioning SnapTile or JS ERROR in the shell log"
else
    pass "no SnapTile or JS errors in the shell log"
fi

kill $SHELL_PID 2>/dev/null
wait $SHELL_PID 2>/dev/null
TOTAL=$(awk -v a="$(date +%s.%N)" -v b="$START" 'BEGIN { printf "%.0f", a - b }')
echo "TIME: $TOTAL s of at most $MAX_RUNTIME s"
if [ "$TOTAL" -gt "$MAX_RUNTIME" ]; then FAILS=$((FAILS + 1)); echo "  FAIL  the run took longer than its maximum of $MAX_RUNTIME s"; fi
if [ "$FAILS" -eq 0 ]; then echo "RESULT: all checks passed"; else echo "RESULT: $FAILS check(s) FAILED"; fi
exit $((FAILS > 0))
