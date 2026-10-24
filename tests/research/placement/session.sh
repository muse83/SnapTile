#!/bin/bash
# Runs inside the D-Bus session started by in-container.sh. Each experiment prints text.
set -u
HERE=$(dirname "$0")
export WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland
dbus-update-activation-environment XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=GNOME WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" 2>/dev/null

ev() {
    local out
    out=$(gdbus call --session --dest org.snaptile.Test --object-path /org/snaptile/Test \
        --method org.snaptile.Test.Eval "$1") || { echo "EVAL-ERROR"; return 1; }
    out=${out#\(true, \'}
    echo "${out%\'\)}"
}

gsettings set org.gnome.shell enabled-extensions "['placement-probe@snaptile.test']"
gsettings set org.gnome.shell disable-user-extensions false
monitor_args=()
for size in ${MONITORS:-1280x720}; do monitor_args+=(--virtual-monitor "$size"); done
gnome-shell --headless --wayland --no-x11 "${monitor_args[@]}" >/tmp/research-shell.log 2>&1 &
SHELL_PID=$!
for _ in $(seq 40); do ev 1 >/dev/null 2>&1 && break; sleep 0.5; done
echo "GNOME Shell $(gnome-shell --version | sed 's/GNOME Shell //'); work areas $(ev 'JSON.stringify(Main.layoutManager.monitors.map((m, i) => { const a = Main.layoutManager.getWorkAreaForMonitor(i); return [a.x, a.y, a.width, a.height]; }))')"

# The shell starts in the overview, where the window layer is not painted at all (no map, no
# first-frame). A user's desktop is out of the overview, so leave it before any experiment.
ev 'Main.overview.hide(), 1' >/dev/null
sleep 1

if [ "${NAUTILUS_SERVICE:-}" = 1 ]; then # the GNOME file chooser portal hands the dialog to Nautilus
    nautilus --gapplication-service >/tmp/research-nautilus.log 2>&1 &
    sleep 3
fi

UUID=snaptile@muse83
ENABLE="(Main.extensionManager.enableExtension('$UUID'), 1)"
DISABLE="(Main.extensionManager.disableExtension('$UUID'), 1)"

CLIENT_PID=
start_client() { # start_client <ENV=value>...: a stand-in application
    env "$@" python3 "$HERE/client.py" >/tmp/research-client.log 2>&1 &
    CLIENT_PID=$!
}
stop_client() {
    [ -n "$CLIENT_PID" ] && kill "$CLIENT_PID" 2>/dev/null
    pkill -f "$HERE/client.py" 2>/dev/null
    pkill -f xdg-desktop-portal-gnome 2>/dev/null
    CLIENT_PID=
    sleep 1.5
    ev 'probe.forget()' >/dev/null
}
dump() { # dump <events>: the recorded lines, as text
    ev 'probe.dump("/tmp/research-log.jsonl")' >/dev/null
    python3 "$HERE/fmt.py" /tmp/research-log.jsonl ${1:+"$1"}
}
arm() { # arm <place json> | arm null
    ev "probe.setPlace($1)" >/dev/null
}

STATE='JSON.stringify(global.get_window_actors().map(a => a.meta_window).filter(w => w.get_title() === "main").map(w => { const r = w.get_frame_rect(); return {fullscreen: w.is_fullscreen(), maximized: w.is_maximized(), frame: [r.x, r.y, r.width, r.height], monitor: w.get_monitor()}; }))'

experiments="${*:-hooks early place noanim snap dialogs second nautilus late twomon}"
for exp in $experiments; do
    echo
    case $exp in
    hooks)
        echo "## 1. Life of a new window, no placement (what is known at each moment)"
        arm null
        start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
        sleep 4
        dump
        stop_client
        ;;
    early)
        echo "## 1b. The moments before the window is shown (no placement)"
        arm null
        start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
        sleep 4
        dump 'window-created,notify::title,notify::gtk-application-id,notify::wm-class,position-changed,size-changed,map,first-frame'
        stop_client
        for hook in 'notify::gtk-application-id' 'notify::title'; do
            echo "-- placing at $hook (move_resize to 200,150 700x450)"
            arm "{hook: '$hook', via: 'move_resize', match: '*', rect: [200, 150, 700, 450]}"
            start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
            sleep 4
            dump 'placed,map,frame'
            stop_client
        done
        arm null
        ;;
    noanim)
        echo "## 2b. Same as 2 with the shell's window animations switched off (map and first-frame only)"
        gsettings set org.gnome.desktop.interface enable-animations false
        for hook in map first-frame; do
            echo "-- via=move_resize at=$hook, animations off"
            arm "{hook: '$hook', via: 'move_resize', match: '*', rect: [200, 150, 700, 450]}"
            start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
            sleep 4
            dump 'placed,frame'
            stop_client
        done
        echo "-- no placement, animations off"
        arm null
        start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
        sleep 4
        dump 'frame'
        stop_client
        gsettings set org.gnome.desktop.interface enable-animations true
        ;;
    place)
        echo "## 2. Placing at each moment: target x=200 y=150 700x450 (default would be 400x300)"
        for via in move_resize move; do
            for hook in window-created map first-frame; do
                echo "-- via=$via at=$hook"
                arm "{hook: '$hook', via: '$via', match: '*', rect: [200, 150, 700, 450]}"
                start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
                sleep 4
                dump 'window-created,map,first-frame,placed,frame'
                stop_client
            done
        done
        arm null
        ;;
    snap)
        echo "## 3. Placing through the drag's own snap path (left half, then a window with minimum size 700x500)"
        ev "$ENABLE" >/dev/null
        for min in "" 700x500; do
            for hook in window-created map first-frame; do
                echo "-- at=$hook minimum=${min:-none}"
                arm "{hook: '$hook', via: 'snap', match: '*', tile: 'left', rect: [0, 32, 640, 688]}"
                start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain CLIENT_MIN=$min
                sleep 4
                dump 'placed,frame'
                echo "   tiled record (Tile, size from before): $(ev "JSON.stringify([...Main.extensionManager.lookup('$UUID').stateObj._tiledWindows._windows.values()])"); final frame: $(ev 'JSON.stringify(global.get_window_actors().map(a => a.meta_window).filter(w => w.get_title() === "main").map(w => { const r = w.get_frame_rect(); return [r.x, r.y, r.width, r.height]; }))')"
                stop_client
            done
        done
        arm null
        ev "$DISABLE" >/dev/null
        ;;
    dialogs)
        echo "## 4. Dialogs: what the shell knows about them at the three moments"
        arm null
        modes=${DIALOG_MODES:-modal transient alert about chooser portal portal-orphan orphan-modal fixed fullscreen}
        for mode in $modes; do
            echo "-- mode=$mode"
            start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=$mode GTK_USE_PORTAL=1
            sleep 9
            dump 'window-created,map'
            stop_client
        done
        ;;
    nautilus)
        echo "## 6. A real Nautilus file-manager window next to the parentless file chooser (compare with section 4)"
        arm null
        nautilus --new-window /tmp >/tmp/research-nautilus-window.log 2>&1 &
        sleep 6
        dump 'window-created,map'
        pkill -f "nautilus --new-window" 2>/dev/null
        ev 'global.get_window_actors().forEach(a => a.meta_window.delete(global.get_current_time())), 1' >/dev/null
        sleep 1.5
        ev 'probe.forget()' >/dev/null
        ;;
    late)
        echo "## 7. Windows that restore themselves: asking for full screen later, and for maximised at start"
        for mode in fullscreen maximized; do
            for hook in none map unmax unmaxwait snap; do
                echo "-- mode=$mode placement=$hook (200,150 700x450 at map)"
                case $hook in
                none) arm null;;
                map) arm "{hook: 'map', via: 'move_resize', match: '*', rect: [200, 150, 700, 450]}";;
                unmax) arm "{hook: 'map', via: 'unmaximize_move_resize', match: '*', rect: [200, 150, 700, 450]}";;
                unmaxwait) arm "{hook: 'map', via: 'unmaximize_wait', match: '*', rect: [200, 150, 700, 450]}";;
                snap) ev "$ENABLE" >/dev/null; arm "{hook: 'map', via: 'snap', match: '*', tile: 'left', rect: [0, 32, 640, 688]}";;
                esac
                start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=$mode
                sleep 1
                dump 'map,placed'
                sleep 4
                echo "   state 5 s after start: $(ev "$STATE")"
                stop_client
                [ $hook = snap ] && ev "$DISABLE" >/dev/null
            done
        done
        arm null
        ;;
    twomon)
        echo "## 8. Several monitors (needs MONITORS='1280x720 1024x768'): default place, and placing onto the second monitor at map"
        arm null
        start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
        sleep 4
        dump 'map'
        echo "   state: $(ev "$STATE")"
        stop_client
        arm "{hook: 'map', via: 'move_resize', match: '*', rect: [1400, 100, 700, 450]}"
        start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=plain
        sleep 4
        dump 'map,placed,frame'
        echo "   state: $(ev "$STATE")"
        stop_client
        arm null
        ;;
    second)
        echo "## 5. GNOME's own placement of a second and third window of one application"
        arm null
        echo "-- first window left where GNOME puts it"
        start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=two
        sleep 10
        dump 'map'
        stop_client
        echo "-- first window moved by the extension to x=50 y=60 500x400 before the second opens"
        start_client CLIENT_APP_ID=org.snaptile.Research CLIENT_TITLE=main CLIENT_MODE=two
        sleep 1.5
        ev 'global.get_window_actors().map(a => a.meta_window).find(w => w.get_title() === "main").move_resize_frame(true, 50, 60, 500, 400), 1' >/dev/null
        sleep 9
        dump 'map'
        stop_client
        ;;
    esac
done

echo
echo "Shell log (errors only):"
grep -iE "JS ERROR|placement" /tmp/research-shell.log | head -20
kill $SHELL_PID 2>/dev/null
wait $SHELL_PID 2>/dev/null
