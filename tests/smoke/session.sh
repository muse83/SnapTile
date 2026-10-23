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

start_shell() { # start_shell <log file> <virtual monitor size>...
    local log=$1; shift
    local args=()
    for size in "$@"; do args+=(--virtual-monitor "$size"); done
    gnome-shell --headless --wayland --no-x11 "${args[@]}" >"$log" 2>&1 &
    SHELL_PID=$!
    for _ in $(seq 40); do
        ev 1 >/dev/null 2>&1 && break
        sleep 0.5
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
check "extension is active" $ACTIVE "$STATE"
check "one hint source appears" 1 "$SOURCES"
check "hint names the setting" '"Switch off GNOME edge tiling"' "$NOTE"
check "hint text names Active Screen Edges" true \
    'Main.messageTray.getSources().some(s => s.notifications.some(n => n.body.includes("Active Screen Edges") && n.body.includes("edge-tiling false")))'
# Urgency 1 is NORMAL; HIGH (2) and CRITICAL (3) would break through Do Not Disturb.
check "hint has normal urgency, so Do Not Disturb silences it" '"1"' \
    'Main.messageTray.getSources().filter(s => s.title === "SnapTile").flatMap(s => s.notifications.map(n => n.urgency)).join("|")'
gsettings set org.gnome.mutter edge-tiling false
sleep 0.5
check "hint goes away when the user switches GNOME edge tiling off" 0 "$SOURCES"
gsettings set org.gnome.mutter edge-tiling true
sleep 0.5
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
sleep 4
RECT='JSON.stringify(global.get_window_actors().map(a => a.meta_window).filter(w => w.title === "probe-window").map(w => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; })[0])'
check "client window appears at its default place" '"[440,226,400,300]"' "$RECT"

# Virtual pointer inside the shell: real input events, handled by Mutter like a mouse.
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
resize_window() { # resize_window X Y WIDTH HEIGHT: asks Mutter for a new frame, like an application would
    ev "global.get_window_actors().map(a => a.meta_window).filter(w => w.title === 'probe-window')[0].move_resize_frame(true, $1, $2, $3, $4), 1" >/dev/null
}
press_escape() {
    for state in PRESSED RELEASED; do
        ev "globalThis.__kbd.notify_keyval(imports.gi.GLib.get_monotonic_time(), 0xff1b, imports.gi.Clutter.KeyState.$state), 1" >/dev/null
        sleep 0.2
    done
}
setup_pointer() { # a virtual pointer for this shell, recording the window grabs it causes
    ev 'globalThis.__dev = global.stage.context.get_backend().get_default_seat().create_virtual_device(imports.gi.Clutter.InputDeviceType.POINTER_DEVICE), globalThis.__kbd = global.stage.context.get_backend().get_default_seat().create_virtual_device(imports.gi.Clutter.InputDeviceType.KEYBOARD_DEVICE), globalThis.__ops = [], global.display.connect("grab-op-begin", (d, w, op) => globalThis.__ops.push(["begin", op])), global.display.connect("grab-op-end", (d, w, op) => globalThis.__ops.push(["end", op])), 1' >/dev/null
    move 32 14; button PRESSED; button RELEASED # the first click after start is needed before clients get input
    sleep 1
}
setup_pointer
move 640 240; button PRESSED
for step in "620 220" "500 180" "300 120" "100 60" "20 20"; do move $step; done
check "dragging the title bar starts a window move" '"begin:1"' 'globalThis.__ops.map(o => o.join(":")).join(",")'
button RELEASED
sleep 1
check "window followed the pointer (y held below the top bar)" '"[-180,32,400,300]"' "$RECT"
check "release ends the move" '"begin:1,end:1"' 'globalThis.__ops.map(o => o.join(":")).join(",")'

take_shot() { # take_shot FILE: the shell's screenshot, as a PNG file; prints "done" or the error
    rm -f "$1"
    ev "globalThis.__shot = 'pending', (() => { const {Shell, Gio} = imports.gi; const sh = new Shell.Screenshot(); const st = Gio.File.new_for_path('$1').replace(null, false, Gio.FileCreateFlags.NONE, null); sh.screenshot(false, st, (o, res) => { try { sh.screenshot_finish(res); st.close(null); globalThis.__shot = 'done'; } catch (e) { globalThis.__shot = 'error ' + e; } }); })(), 1" >/dev/null
    sleep 2
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

start_probe() { # start_probe [WIDTHxHEIGHT]: a fresh probe window, with a minimum size if given
    kill $WINDOW_PID 2>/dev/null
    sleep 1
    PROBE_MIN=${1:-} WAYLAND_DISPLAY=wayland-0 python3 "$(dirname "$0")/probe-window.py" >/tmp/smoke-window.log 2>&1 &
    WINDOW_PID=$!
    sleep 4
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
    sleep 0.6
}
snap() { # snap <description> <pointer x> <pointer y> <expected Tile rectangle x,y,w,h> [expected window x,y,w,h]
    grab_window
    drag_to "$2" "$3"
    local preview frame
    preview=$(ev "$PREVIEW")
    button RELEASED
    sleep 1
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
    sleep 0.6
    local preview frame
    preview=$(ev "$PREVIEW")
    button RELEASED
    sleep 1
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
move 640 716; sleep 0.6
check "into the next third: left two-thirds" '"[[0,32,854,688]]"' "$PREVIEW"
move 1200 716; sleep 0.6
check "on into the last third: right two-thirds" '"[[427,32,853,688]]"' "$PREVIEW"
move 640 716; sleep 0.6
check "back to the middle third: only that third" '"[[427,32,427,688]]"' "$PREVIEW"
move 640 400; sleep 0.6
check "leaving the bottom strip hides the preview" '"[]"' "$PREVIEW"
BEFORE=$(ev "$RECT")
button RELEASED
sleep 1
check "releasing outside every zone leaves the window where it is" "$BEFORE" "$RECT"
snap_merged "release on the left two-thirds" 100 640 0,32,854,688
snap_merged "release on the right two-thirds, merged from the right" 1200 640 427,32,853,688

echo "Size before tiling:"
start_probe
snap "left half" 3 360 0,32,640,688
grab_window
drag_to 640 300
check "dragging a tiled window out restores its earlier size" '"[400,300]"' "$SIZE"
check "no preview in the middle of the screen" '"[]"' "$PREVIEW"
button RELEASED
sleep 1
snap "left half again" 3 360 0,32,640,688
ev "$DISABLE" >/dev/null
ev "$ENABLE" >/dev/null
grab_window
drag_to 640 300
check "a window with no remembered size keeps its own" '"[640,688]"' "$SIZE"
button RELEASED
sleep 1

echo "Cancelling a drag with Escape:"
start_probe
grab_window
drag_to 3 360
check "preview is shown before Escape" '"[[0,32,640,688]]"' "$PREVIEW"
press_escape
sleep 0.6
check "Escape hides the preview" '"[]"' "$PREVIEW"
button RELEASED
sleep 1
check "Escape leaves the window unsnapped" '"[440,226,400,300]"' "$RECT"
snap "left half" 3 360 0,32,640,688
grab_window
drag_to 3 360
check "dragging the tiled window back to a zone shows its preview" '"[[0,32,640,688]]"' "$PREVIEW"
press_escape
sleep 0.6
button RELEASED
sleep 1
check "Escape puts a tiled window back into its Tile" '"[0,32,640,688]"' "$RECT"
grab_window
drag_to 640 300
check "it still remembers its earlier size" '"[400,300]"' "$SIZE"
button RELEASED
sleep 1

echo "Window that cannot get as small as the Tile (minimum 900x500):"
start_probe 900x500
snap "top-left quarter: window anchored at the Tile's top left" 3 3 0,32,640,344 0,32,900,500
snap "bottom-right quarter: window pulled back onto the screen" 1276 716 640,376,640,344 380,220,900,500

echo "A tiled window that grows beyond its Tile:"
start_probe
snap "top-left quarter" 3 3 0,32,640,344
resize_window 100 100 700 400
sleep 0.5
check "it is hung on the Tile's top left corner again" '"[0,32,700,400]"' "$RECT"
ev "$DISABLE" >/dev/null
resize_window 100 100 720 420
sleep 0.5
check "after disabling, SnapTile no longer touches it" '"[100,100,720,420]"' "$RECT"
ev "$ENABLE" >/dev/null
kill $WINDOW_PID 2>/dev/null

echo "Window look: rounded corners and margin (probe window at 440,226, 400x300, 8 px corners and 3 px margin at 96 DPI):"
# The shell starts in the overview, which shows windows smaller, and animations would move
# them during a screenshot. Both are switched off for the pixel checks.
gsettings set org.gnome.desktop.interface enable-animations false
ev 'Main.overview.hide(), 1' >/dev/null
sleep 1
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
sleep 1
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
sleep 1

echo "Window look: what it leaves alone"
FULLSCREEN_EFFECTS="($PLAIN_ACTOR.meta_window.make_fullscreen(), $EFFECTS)"
check "a full-screen window has no effect" 0 "$FULLSCREEN_EFFECTS"
sleep 1
check "leaving full screen brings it back" 1 "(($PLAIN_ACTOR.meta_window.unmake_fullscreen()), $EFFECTS)"
sleep 1
kill $WINDOW_PID 2>/dev/null
sleep 1
PROBE_POPOVER=1 start_probe
sleep 2
check "a menu is its own window next to the application window" 2 'global.get_window_actors().length'
check "only the application window has the effect, the menu has none" '"application:1,menu:0"' \
    'global.get_window_actors().map(a => `${a.meta_window.get_window_type() === 0 ? "application" : "menu"}:${a.get_effects().length}`).sort().join(",")'
kill $WINDOW_PID 2>/dev/null
sleep 1

echo "Window look: the application's own shadow stays"
start_probe
ev "$DISABLE" >/dev/null
take_shot /tmp/shadow-off.png >/dev/null
ev "$ENABLE" >/dev/null
sleep 1
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
sleep 4
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
sleep 1
RECT=$FIRST_RECT
DROPPED='(() => { const frame = n => global.get_window_actors().map(a => a.meta_window).find(w => w.title === n).get_frame_rect(); const one = frame("probe-window"), two = frame("probe-second"); return JSON.stringify([[one.x, one.y, one.width, one.height], two.width, two.height, two.x < one.x + one.width, two.x <= 700 && 700 < two.x + two.width && two.y <= 300 && 300 < two.y + two.height]); })()'
check "a window dropped over another one: its earlier size, over the other window, under the pointer, nothing pushes it away" '"[[0,32,640,688],400,300,true,true]"' "$DROPPED"
kill $SECOND_PID 2>/dev/null
kill $WINDOW_PID 2>/dev/null
sleep 1

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
sleep 1
check "the snapped window's frame is the Tile the preview marked" '"[640,32,640,344]"' "$RECT"
kill $WINDOW_PID 2>/dev/null
sleep 1

echo "Disabling SnapTile during and right after a drag:"
# Records the timers SnapTile starts and still has pending (not removed, not finished).
ev '(() => { const GLib = imports.gi.GLib; const add = GLib.timeout_add, remove = GLib.source_remove; globalThis.__timers = new Set(); GLib.timeout_add = function (priority, ms, fn) { const ours = new Error().stack.includes("dragSnap.js"); const id = add.call(GLib, priority, ms, ours ? () => { const again = fn(); if (!again) globalThis.__timers.delete(id); return again; } : fn); if (ours) globalThis.__timers.add(id); return id; }; GLib.source_remove = function (id) { globalThis.__timers.delete(id); return remove.call(GLib, id); }; return 1; })()' >/dev/null
TIMERS='globalThis.__timers.size'
start_probe
grab_window
drag_to 3 3
check "preview is shown before disabling" '"[[0,32,640,344]]"' "$PREVIEW"
check "the drag has a timer running" 1 "$TIMERS"
ev "$DISABLE" >/dev/null
sleep 0.3
check "no timer is left when disabled during the drag" 0 "$TIMERS"
check "preview is gone when disabled during the drag" '"[]"' "$PREVIEW"
move 1276 3
sleep 0.5
check "no preview comes back while the drag goes on" '"[]"' "$PREVIEW"
button RELEASED
sleep 1
check "the window is not snapped after disabling" '"[400,300]"' "$SIZE"
ev "$ENABLE" >/dev/null
grab_window
drag_to 3 3
button RELEASED
check "a drop starts no timer" 0 "$TIMERS"
ev "$DISABLE" >/dev/null
check "no timer is left after a drop and after disabling" 0 "$TIMERS"
sleep 1
check "extension is inactive after disabling right after a drop" $INACTIVE "$STATE"
check "no preview left after disabling right after a drop" '"[]"' "$PREVIEW"
kill $WINDOW_PID 2>/dev/null
SHELL_LOGS=("$SHELL_LOG")

echo "Two monitors (1280x720 with the top bar, 1024x768 to its right):"
kill $SHELL_PID 2>/dev/null
wait $SHELL_PID 2>/dev/null
sleep 2
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

echo "Shell log:"
if grep -iE "snaptile|JS ERROR" "${SHELL_LOGS[@]}"; then
    fail "errors mentioning SnapTile or JS ERROR in the shell log"
else
    pass "no SnapTile or JS errors in the shell log"
fi

kill $SHELL_PID 2>/dev/null
wait $SHELL_PID 2>/dev/null
if [ "$FAILS" -eq 0 ]; then echo "RESULT: all checks passed"; else echo "RESULT: $FAILS check(s) FAILED"; fi
exit $((FAILS > 0))
