# Window drag and screenshots in the headless GNOME Shell

Verified 2026-10-23 by running `tests/smoke/run.sh` on GNOME Shell 50.4 (`gnome50`) and 51.1
(`gnome51`) in the dev stack. Unlike the other notes in this folder, everything here was run.

## Result

Both work on both versions, with the same code.

- **Drag**: a virtual pointer created inside the shell sends real input events. A GTK4 client
  window (`probe-window.py`) receives them, starts a window move, and Mutter fires `grab-op-begin`
  and `grab-op-end` (grab op `MOVING` = 1). The window ends up where the pointer left it.
- **Screenshot**: `Shell.Screenshot().screenshot(false, stream, callback)` called inside the shell
  writes a 1280x720 PNG. Pixels can be read in the terminal (`tests/smoke/pixels.py FILE X Y`).
  The window area and the desktop area gave different colours on both versions.

## How

- Start: `gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x720` inside
  `dbus-run-session`, with `XDG_RUNTIME_DIR` set. Clients use `WAYLAND_DISPLAY=wayland-0`.
- **`org.gnome.Shell.Eval` is locked** (returns `(false, '')`) and the D-Bus Screenshot service
  answers `AccessDenied`. So the tests install a test-only helper extension
  (`tests/smoke/helper@snaptile.test`) that offers `org.snaptile.Test.Eval` on the session bus and
  runs JavaScript inside the shell. It is never part of SnapTile.
- Virtual pointer (same call on 50 and 51):
  `global.stage.context.get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE)`,
  then `notify_absolute_motion(time_us, x, y)` and `notify_button(time_us, 1, Clutter.ButtonState.PRESSED | RELEASED)`.
  `global.backend` and `Clutter.get_default_backend()` do not exist any more.
- Coordinates are logical pixels. Frame rect of the 400x300 test window: x 440, y 226.

## Pitfalls found

- **Send every motion twice.** The first absolute motion to a new point can apply only its x
  (y keeps the old value). A second event to the same point settles it. Dragging in several steps
  with a doubled event per step is reliable.
- **A first click is needed before clients receive pointer events.** Without it the client saw no
  motion and no press at all. The smoke test clicks once on the top bar, waits 1 s, then drags.
- Wait about 4 s after starting a client before touching it, and 0.2-0.3 s between events.
- A window dragged above the top bar is held at y 32 (the work area starts below the top bar).
- gdk-pixbuf has no PNG loader in the `gnome51` image, so `pixels.py` decodes PNG with the Python
  standard library only.
- The shell log shows harmless errors: calendar server (missing library), fuse for the document
  portal, UPower/PolicyKit/GeoClue. The smoke script sends bus noise to `/tmp/smoke-session.log`.

## What this means for the later tickets

- Drag to an Edge zone and compare the final frame rect: possible, as in the smoke test.
- Window look by pixels: possible. Caveat: the shell's screenshot includes the desktop background,
  so "transparent corner" shows as the background colour, not as alpha 0. Compare against the
  background colour measured next to the window.
- Not tested yet: the Tile preview widget in a screenshot, and drags starting on a window that is
  already tiled.

## Settings label (verified 2026-10-23)

The notification names Settings → Multitasking → General → "Active Screen Edges". Checked
against primary sources:

- GNOME Settings source (`panels/multitasking/cc-multitasking-panel.c`, `main`) binds the
  `edge-tiling` key of `org.gnome.mutter` to the switch of the "Active Screen Edges" row.
- GNOME Help, "Enable or disable window resizing at screen edges"
  (https://help.gnome.org/gnome-help/multitasking-screen-edges.html): Settings → Multitasking →
  General → "Active Screen Edges".

Not checked on a running GNOME 50/51 desktop (the dev containers have no Settings app); the
label is English and may differ in other languages. The notification also gives the exact
`gsettings` command.
