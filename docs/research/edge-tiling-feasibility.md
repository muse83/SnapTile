# Edge tiling feasibility for a GNOME Shell extension (GNOME 50 and 51, Wayland)

Researched 2026-10-23. Sources are primary only: GNOME Mutter and GNOME Shell source on
gitlab.gnome.org, gjs.guide. Source base: `main` unless a tag is named (tags `50.0`, `51.0` exist
in both repos; newest are 50.6 and 51.1). Items I could not verify are in the last section.

Base URLs used below:

- Mutter raw: `https://gitlab.gnome.org/GNOME/mutter/-/raw/<ref>/<path>`
- Shell raw: `https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/<ref>/<path>`

## 1. How stock GNOME edge tiling works

**Split of work: detection and rect in Mutter (C), drawing in Shell (JS).**

- Detection lives in Mutter `src/compositor/meta-window-drag.c`: `update_move_maybe_tile()`.
  `update_tile_preview()` then calls `meta_compositor_show_tile_preview(compositor, window,
  &tile_rect, monitor)` (or `hide`).
- That call reaches Shell as signals on the window manager object:
  `gnome-shell/js/ui/windowManager.js`:
  `this._shellwm.connect('show-tile-preview', this._showTilePreview.bind(this))`, handler
  `_showTilePreview(shellwm, window, tileRect, monitorIndex)`. There is a matching
  `hide-tile-preview`.
- The preview is a JS class `TilePreview` (St.Widget) in the same file. It is added to
  `global.window_group` and stacked directly below the dragged window's actor
  (`set_child_below_sibling`). On first show it starts at the window frame rect (clipped to the
  monitor), then eases position/size to `tileRect` and fades opacity 0 to 255 using
  `WINDOW_ANIMATION_TIME`, `EASE_OUT_QUAD`. `close()` fades to 0 and then hides.
- The Mutter-side call chain (`meta_compositor_show_tile_preview` to the `show-tile-preview` Shell WM signal)
  was not read end to end; the two ends (Mutter caller, Shell handler) are verified.

**Style classes.** `TilePreview._updateStyle(monitor)` sets `style_class` to `tile-preview`, plus
`on-primary` (primary monitor), `tile-preview-left` (rect touches monitor left edge) and
`tile-preview-right` (rect touches monitor right edge).

**CSS** (`gnome-shell/data/theme/gnome-shell-sass/widgets/_misc.scss`):

```scss
/* Tiled window previews */
.tile-preview {
  background-color: st-transparentize(-st-accent-color,0.5);
  border: 1px solid -st-accent-color;
}
```

So the look follows the system accent colour (half-transparent fill, 1px accent border).
Because the class is defined in the Shell theme, an extension can reuse it by setting
`style_class = 'tile-preview'` on its own St.Widget; no extra stylesheet is needed.

**Modes and rects.** `update_move_maybe_tile()` in `meta-window-drag.c` (main) has exactly three
modes (`MetaTileMode`): `META_TILE_LEFT`, `META_TILE_RIGHT`, `META_TILE_MAXIMIZED`
(plus `META_TILE_NONE`).

- Pointer in the left zone: x between the monitor's left edge and `work_area.x + shake_threshold`
  gives LEFT.
- Right zone: x from `work_area.x + work_area.width - shake_threshold` to the monitor's right edge
  gives RIGHT.
- Top: y between the monitor top and `work_area.y` (i.e. over the top bar) gives MAXIMIZED.
- Left/right only if `meta_window_can_tile_side_by_side()`, top only if `meta_window_can_maximize()`.
- The pointer position decides the monitor (`meta_monitor_manager_get_logical_monitor_at(x, y)`),
  and the work area comes from `meta_window_get_work_area_for_monitor`.
- Rects come from `meta_window_get_tile_area(window, mode, &tile_rect)`: half of the work area,
  or the full work area for maximize. No quarters/thirds exist in stock Mutter.

**Zone width in stock GNOME.** `shake_threshold = drag-threshold * 6`
(`DRAG_THRESHOLD_TO_SHAKE_THRESHOLD_FACTOR 6`). `drag-threshold` comes from the GSettings
`org.gnome.desktop.peripherals.mouse drag-threshold`, default `8` (gsettings-desktop-schemas
`schemas/org.gnome.desktop.peripherals.gschema.xml.in`). So the stock side zone is 48 logical px.
Preview is delayed by `TILE_PREVIEW_TIMEOUT_MS 200`.

**On drop** (`meta-window-drag.c`, button-release path): if `preview_tile_mode != NONE`, Mutter
builds a new `MetaWindowConfig` with that tile mode and calls `meta_window_process_config()`.
It also stores the pre-drag rect as `saved_rect` so un-tiling restores it.

**The switch.** Yes: GSettings `org.gnome.mutter edge-tiling` (type boolean).

- Schema default is `false` (`mutter/data/org.gnome.mutter.gschema.xml.in`).
- GNOME Shell overrides it to `true` for the GNOME session:
  `gnome-shell/data/00_org.gnome.shell.gschema.override`, section `[org.gnome.mutter:GNOME]` with
  `edge-tiling=true` (also `dynamic-workspaces=true`, `workspaces-only-on-primary=true`).
  So on a real GNOME session the effective default is `true`; on a non-GNOME session it is `false`.
- Mutter checks `meta_prefs_get_edge_tiling()` in `update_move()` before calling
  `update_move_maybe_tile()`. If it is off, no preview and no tiling happen.
- Consequence for SnapTile: if the extension draws its own zones, stock GNOME edge tiling should be
  switched off (or at least not conflict), otherwise two previews can appear. Changing
  another schema's key from an extension is possible but is a user-visible side effect; decide
  deliberately (not yet checked against extensions.gnome.org reviewers' view).

## 2. Own preview rectangles and snapping on drop

**Preview.** Feasible with plain Shell JS, no private Mutter access: create an `St.Widget` with
`style_class: 'tile-preview'`, add to `global.window_group` (as stock does) or
`Main.uiGroup`, set position/size, animate with `ease()`. Stock stacks it below the dragged
window actor; reproducing that needs `window.get_compositor_private()` and
`global.window_group.set_child_below_sibling()`. The extra classes (`on-primary`,
`tile-preview-left/right`) are only set by the stock code; check the stylesheet if more is needed
(only `.tile-preview` itself is defined in `_misc.scss`; I did not grep the other class names in
the theme).
Destroy the widget in `disable()` (review guidelines).

**Snapping to an arbitrary rect.** Public Mutter API (`META_EXPORT`, `src/meta/window.h`, 51.0):

- `meta_window_move_resize_frame(window, user_op, x, y, w, h)` in GJS:
  `win.move_resize_frame(true, x, y, w, h)`. Implemented in `src/core/window.c` as
  move + resize + `META_MOVE_RESIZE_CONSTRAIN`, so the rect is constrained (min size, struts).
- `meta_window_unmaximize(window)` (exists in 51.0; takes no flags there; older releases
  needed a MaximizeFlags argument. Check the call in the GJS version at runtime).
- `meta_window_unmake_fullscreen()`, `meta_window_move_to_monitor()`,
  `meta_window_get_work_area_for_monitor()`, `meta_window_get_frame_rect()`.

Practical order for a drop: if maximized or fullscreen, un-maximize/un-fullscreen first, then
`move_resize_frame`. Mutter's own drag code does the same style of sequence (restore tile mode,
saved rect). The exact required order and timing (same tick versus after `size-changed`) was
not verified; this needs a test on a running session.

**Wayland limits (what the sources say / what follows).**

- `move_resize_frame` is a request. For Wayland clients Mutter sends a configure and the client
  decides the final size (min/max size hints, aspect ratio, terminals with character grids,
  client-side decorations/shadows). The frame rect can end up different from the requested one.
  (Behavioural statement from general Mutter design; not tested here.)
- Moving a window on Wayland is compositor-side, so there is no X11-style restriction on
  positioning. GNOME 50 removed X11 sessions from the Shell (see porting guide 50), so Wayland is
  the only case; XWayland apps still exist.
- A window currently tiled by Mutter (`tile_mode` LEFT/RIGHT/MAXIMIZED) is also treated as
  constrained by drag code ("Don't allow movement in the maximized directions or while tiled",
  `meta-window-drag.c`). Un-tile first.

## 3. Observing a window drag

**Signals** on `global.display` (`mutter/src/core/display.c`):

- GNOME 50.0: `grab-op-begin (MetaWindow, MetaGrabOp)`, `grab-op-end (MetaWindow, MetaGrabOp)`.
- GNOME 51.0: `grab-op-begin (MetaWindow, MetaGrabOp, ClutterSprite)` (a **third argument**,
  `Clutter.Sprite`, was added), `grab-op-end (MetaWindow, MetaGrabOp)` unchanged.
  Extension handlers `(display, window, op)` keep working because extra args are ignored in JS;
  use the third argument only on 51+.
- Compare with `Meta.GrabOp.MOVING` (also `KEYBOARD_MOVING`; resize ops are separate values). The
  grab op may carry flag bits (e.g. `META_GRAB_OP_WINDOW_FLAG_UNCONSTRAINED`, seen in
  `meta_cursor_for_grab_op`), so compare after masking, or use equality to `MOVING` and test on a live
  session. Mutter's own helper is `meta_grab_op_is_moving()`; whether it is exposed to GJS was not checked.
- Stock Shell's `windowManager.js` has no `grab-op-*` handler (verified by search).

**Pointer position during the drag.**

- `global.get_pointer()` returns `[x, y, mods]` (`shell-global.c`, `shell_global_get_pointer`,
  identical in 50.0 and 51.0): it reads `meta_cursor_tracker_get_pointer()`, i.e. the compositor's
  own pointer, valid on Wayland. Coordinates are in stage/logical pixels.
- Polling: `GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, ...)` while a MOVING grab is active; remove
  the source on `grab-op-end` and in `disable()` (review guideline: all sources MUST be removed in
  `disable()`). Stop polling when the grab ends so no idle CPU cost.
- Stock Shell had `js/ui/pointerWatcher.js` (polling `global.get_pointer()` plus idle monitor).
  **It was removed in GNOME Shell 51** (porting guide 51: use
  `global.backend.get_cursor_tracker()`, a `Meta.CursorTracker`). So do not import it; write the
  own timeout loop (works on 50 and 51).
- Other options (not verified): `global.stage` `captured-event`/motion controller, or the
  `Meta.CursorTracker` `position-invalidated` signal. During a Mutter window grab the stage
  pointer events are consumed by the grab, so a stage motion listener may not see them; this
  was not tested. Polling is the safe baseline.

**Edge-resistance/tiling interplay.** Stock tiling decisions use the same pointer values
(`update_move()` receives x,y). The extension sees the pointer slightly independent of Mutter's
frame position.

## 4. Converting cm to pixels

- Mutter knows the physical size per monitor in **millimetres**: `meta_monitor_get_physical_dimensions()`
  (`src/backends/meta-monitor.c`) returns `output_info->width_mm/height_mm`. On the native
  backend these come from the DRM connector: `meta-kms-connector.c`
  `state->width_mm = drm_connector->mmWidth; state->height_mm = drm_connector->mmHeight;`
  (the kernel derives them from EDID; the EDID blob is also read separately).
- That function is declared in the **internal** header `src/backends/meta-monitor.h`, not in
  `src/meta/` (public). So I do **not** expect it in the GJS bindings; not confirmed against the
  installed typelib.
- **Public path for an extension:** the D-Bus API `org.gnome.Mutter.DisplayConfig`,
  method `GetCurrentState`. Per-monitor `properties` include `"width-mm"` (i) and `"height-mm"`
  (i), plus `"is-builtin"` and `"display-name"`
  (`mutter/data/dbus-interfaces/org.gnome.Mutter.DisplayConfig.xml`, 51.0). Use
  `Gio.DBusProxy`/`Gio.DBus.session.call` with `Gio.DBusProxy.makeProxyWrapper` (note 51: makeProxyWrapper now
  returns a class and must be used with `new`, see section 6). Monitors are identified by connector
  (first tuple element, e.g. `eDP-1`); match to `Main.layoutManager.monitors` via the logical monitor
  list in the same reply (x, y, scale, monitors).
- **Conversion** (my derivation, not from a source): logical px per cm =
  `logicalWidthPx / (width_mm / 10)`. Logical monitor geometry from `Main.layoutManager.monitors[i]`
  (`x, y, width, height`) is already in logical (scaled) pixels, which is what pointer coords
  use; so do not multiply by the scale again. Physical pixels would be `logical * scale`
  (`global.display.get_monitor_scale(i)`, or `monitor.geometry_scale`). Edge case: with
  rotated monitors width_mm/height_mm are swapped (Mutter swaps them for transforms in
  `meta-output-kms.c`), so use the dimension along the edge being measured against the
  logical size after the transform. Fractional scaling: the logical size is `physical / scale`, same formula.
- **Wrong/missing sizes.** Mutter itself treats these as invalid:
  - `0` width or height: scale falls back to 1.0 (`meta_monitor_calculate_mode_scale` area).
  - `meta_monitor_has_aspect_as_size()`: values (16,9), (16,10), (160,90), (160,100),
    (1600,900), (1600,1000) mm are ratios encoded by firmware, not real sizes (typical for
    projectors/VMs). Mutter ignores them for scale selection.
  - SnapTile fallback proposal: when mm is 0, or matches the aspect list above, or the implied
    DPI is implausible (e.g. outside roughly 50-400, my threshold, not from a source), assume a
    default DPI (e.g. 96 logical px per inch, i.e. about 37.8 px/cm) and optionally let the user
    override per monitor in preferences. VMs (virtio/QXL) often report 0 or odd sizes; I did
    not measure on the dev VM, so this should be checked there.
- Reference value: the stock zone is 8 px x 6 = 48 logical px, about 1.27 cm at 96 DPI, so 1 cm
  and 3 cm are in the same order of magnitude as the stock zone (1 cm roughly 38 px, 3 cm roughly 113 px at 96 DPI).

## 5. Multi-monitor and work area

- Monitors: `Main.layoutManager.monitors` (array with `x, y, width, height, index`), primary:
  `Main.layoutManager.primaryMonitor`/`primaryIndex`. Find monitor under the pointer:
  `global.display.get_monitor_index_for_rect(rect)` (used by `layout.js` `_findIndexForRect`) with a
  1x1 `Mtk.Rectangle` at the pointer. Mutter's own drag code picks the monitor via the pointer
  (not the window), same approach.
- Work area: `Main.layoutManager.getWorkAreaForMonitor(i)` (`js/ui/layout.js`, 51.0):
  takes workspace index 0 and returns `ws.get_work_area_for_monitor(i)`
  ("Assume that all workspaces will have the same struts"). Equivalent: 
  `global.workspace_manager.get_active_workspace().get_work_area_for_monitor(i)`
  or `window.get_work_area_for_monitor(i)` (public `META_EXPORT`, respects the window).
  It excludes the top bar (and dock struts), so it gives the area to tile into.
- Stock behaviour to mirror: left/right zones are measured from the **work area** edges; the top
  zone is the strip between monitor top and `work_area.y`, i.e. the top bar. The preview rect for
  halves is computed from the work area. If the extension defines "edge" at the physical monitor
  edge instead, zones above the top bar need explicit handling.
- Per-monitor edges: every monitor gets all its zones on its own, including edges that touch
  another monitor (maintainer decision, 2026-10-23; stock tiling also triggers at every
  monitor's own left/right work-area edge). A pointer crossing from monitor A to monitor B
  therefore passes through both monitors' zones and may show a preview on the way; this is
  wanted. SnapTile does not look at monitor neighbours at all.
- Per-monitor cm to px: compute pixel zone width per monitor (monitors can differ in DPI and scale).
- Work areas change when the top bar changes, on fullscreen apps, or monitor hot-plug: listen to
  `Main.layoutManager` `monitors-changed` and recompute (signal name from `layout.js`, not
  re-verified here).

## 6. Breaking changes in GNOME 50 and 51 that touch these APIs

From `https://gjs.guide/extensions/upgrading/gnome-shell-50.html` and `...-51.html`:

- **50:** No change to windows, grabs on windows, monitors, layoutManager, pointer, St. Relevant
  to the project: X11 session support removed from the Shell (restart signals on `global.display`
  `show-restart-message`/`restart` no longer emitted; `RunDialog._restart()` removed).
  `easeAsync()` added (rejects with CANCELLED if interrupted). `GLib.timeout_add_once()` etc. added.
  `Shell` keyboardManager `holdKeyboard()/releaseKeyboard()` removed.
- **51:**
  - `ui/pointerWatcher.js` removed (use `global.backend.get_cursor_tracker()`); relevant to drag polling.
  - `grab-op-begin` gained a third argument (Clutter.Sprite). This is **not** in the porting guide;
    found by diffing Mutter `src/core/display.c` at tags 50.0 and 51.0.
  - `disable()` must not be async (Shell now throws).
  - St `vertical` property removed (use `orientation`); `St.ButtonMask` ONE/TWO/THREE deprecated.
  - Connecting event signals (`key-press-event` etc.) on actors is deprecated; use
    `Clutter.*Controller`/`*Gesture`, `Clutter.MotionController` for motion.
  - `Shell.GLSLEffect` removed, `Clutter.get_default_backend()` removed,
    `Gio.DBus.makeProxyWrapper()` returns a class now (use `new`).
  - popupMenu `open()/close()` take an options object.
- `TilePreview`/`show-tile-preview` still present in Shell `windowManager.js` for 50.0 and 51.0
  (grep confirmed the signal connect line in both tags).

## Review-guideline constraints (extensions.gnome.org)

From `https://gjs.guide/extensions/review-guidelines/review-guidelines.html`: all main-loop sources
(timeouts) MUST be removed in `disable()` even if the callback would return false; all signal
connections MUST be disconnected; all objects/widgets created MUST be destroyed. GSettings schema
ID must start with `org.gnome.shell.extensions` and the XML be in the zip. The page has no rules on
private APIs, CSS or Wayland (searched; absent), so reusing `tile-preview` and calling a
non-default `org.gnome.mutter` key are not addressed by the written rules.

## Could not verify

1. Whether `Meta.Window.move_resize_frame`, `Meta.GrabOp.MOVING` flags handling and `Meta.CursorTracker`
   methods behave as described in the installed GJS typelibs on 50/51: no GNOME Shell is installed on
   this dev VM, nothing was run. `meta-window-drag.c` was read at `main`, not at tags 50.0/51.0.
2. Whether the `meta_monitor_get_physical_dimensions` is visible in GJS (assumed not; D-Bus path is documented).
3. Whether stage events (`captured-event`, motion controller) are delivered during a Mutter window grab.
4. Correct order/timing of unmaximize plus `move_resize_frame` for tiled/maximized windows.
5. Real values reported by the dev VM's virtual monitor (mm size).
6. Reviewer attitude toward changing `org.gnome.mutter edge-tiling` from an extension.
7. Full call chain `meta_compositor_show_tile_preview` to the Shell signal (plugin layer).
8. The `monitors-changed` signal name on `Main.layoutManager` and the `Meta.Window.unmaximize` signature in the
   GJS binding of each version.

## Verified while building drag to snap (2026-10-23, GNOME Shell 50.4 and 51.1)

Run in the headless shell (`tests/smoke/run.sh`); same behaviour on both versions. These close
items 1, 3 (partly), 4, 5 and 8 of "Could not verify".

- **Window API.** `Meta.Window.is_maximized()` and `unmaximize()` (no argument) exist on both;
  `get_maximized()` does not. `Meta.GrabOp.MOVING` compares equal with `===`.
  `Main.layoutManager` emits `monitors-changed`.
- **`move_resize_frame` is a request.** `get_frame_rect()` still shows the old frame right
  after the call and the new one within 100 ms, so anything that depends on the final size has
  to wait.
- **Minimum size larger than the Tile.** Mutter leaves the window where the drag put it (the
  request has no effect at all, and no `size-changed` or `position-changed` follows). Fix: after
  a short wait, move the window with `move_frame` to the Tile's top left, pulled back into the
  work area (`anchoredOrigin` in `src/tileDecision.js`).
- **Pointer during a drag.** Polling `global.get_pointer()` every 30 ms works on both versions.
- **Monitor sizes.** The headless virtual monitor reports no `width-mm` over `GetCurrentState`,
  so the 96 DPI fallback applies there. Real millimetres, rotated monitors and the swap of
  width and height are not covered by any test.
- **Hot corner.** A pointer left in a screen corner after a drop opens the Overview and the
  next simulated drag then fails; smoke tests end on a corner test last for that reason.
- **Escape during a drag.** Mutter puts the window back at its starting frame and emits
  `grab-op-end` at once, while the mouse button is still held; the key press never reaches a
  stage `captured-event` handler. At that moment `global.get_pointer()` still reports
  `BUTTON1_MASK` (a real release reports none), which is how SnapTile tells a cancel from a
  drop (see ADR 0006).
