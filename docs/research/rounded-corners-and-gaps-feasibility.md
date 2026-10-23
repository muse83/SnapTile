# Rounded corners and gaps: feasibility (GNOME 50/51, Wayland)

Date: 2026-10-23. Method: primary sources read via web fetch (no code run, nothing installed).
Marker legend: **[V]** verified in a source I read; **[U]** not verified / inference.

Sources read:
- Mutter: `src/wayland/meta-wayland-xdg-shell.c`, `src/wayland/meta-window-wayland.c`, `src/core/constraints.c`, `src/core/window.c` (first ~200k chars), `src/compositor/meta-window-actor.c` (gitlab.gnome.org/GNOME/mutter, `main` branch, not a GNOME 50/51 tag).
- GTK: `gtk/gtkwindow.c` (gitlab.gnome.org/GNOME/gtk, `main`).
- libadwaita: `src/stylesheet/widgets/_window.scss` (`main`).
- Extension evidence: github.com/flexagoon/rounded-window-corners (`src/effect/*`, `src/manager/*`).
- gjs.guide extension review guidelines.
- discourse.gnome.org "Corner Consistency" thread; extensions.gnome.org review page of "Smooth Shell Corners".

Caveat: all sources are `main`, fetched through a summarising tool, so quotes are second-hand. Check against the actual 50/51 tags before building.

## 1. Rounding all four corners on Wayland

### Why windows look square when tiled/maximized and rounded otherwise
- The look is drawn by the **client**, not by Mutter. libadwaita draws the window radius via CSS: `.csd` uses `border-radius: var(--window-radius)` plus a three-layer shadow; `.tiled*`, `.maximized`, `.fullscreen` set `--window-radius: 0px`. Maximized/fullscreen also set `box-shadow: none`; tiled keeps a 1px border and a transparent 20px shadow ring. **[V]** (`_window.scss`)
- GTK sets those CSS classes from the xdg-toplevel state it receives: `GDK_TOPLEVEL_STATE_TILED` (or per-edge tiled bits) gives `tiled` / `tiled-top` etc.; maximized gives `maximized`. **[V]** (`gtkwindow.c`)
- Mutter sends `XDG_TOPLEVEL_STATE_MAXIMIZED` if `meta_window_is_maximized()`, and `XDG_TOPLEVEL_STATE_TILED_<edge>` for each edge whose `edge_constraints` is not `NONE` (only for clients with protocol version >= the tiled-since version). **[V]** (`meta-wayland-xdg-shell.c`, `fill_states()`)
- So the "rounded only at the top" look in GNOME 49+ apps is a mix: libadwaita windows round all four corners in floating state per CSS; many other apps (GTK4 without libadwaita, Electron, Qt, terminals) draw their own or no radius. Per the GNOME discourse thread, GNOME developers say rounding must be opt-in by the app and will not be enforced by the shell. **[V]** (thread; the exact "only top corners" cause for specific apps is **[U]**)

### What an extension can do
Existing extension flexagoon/rounded-window-corners (and forks) shows the technique **[V]**:
- Subclass `Shell.GLSLEffect`, override only `vfunc_build_pipeline()`, add a fragment snippet via `add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, ...)`. The shader multiplies each pixel's alpha by a corner mask (circle, optional superellipse, 1px anti-aliased band); fast path returns 1.0 away from the corners.
- Attach with `actor.add_effect_with_name(...)` to the `Meta.WindowActor`.
- Uniforms (outer bounds, radius, border) are set per window and updated on size change.
- Bounds are computed from the **difference between frame rect and buffer rect** (`frameRect.x - bufferRect.x` etc.), because the actor covers the whole buffer including client-drawn shadow/invisible resize border. The mask must hug the *visible frame*, not the actor. (Mutter confirms the actor syncs to the **buffer rect**. **[V]** `meta-window-actor.c`)
- The effect gives all four corners any uniform radius, independent of what the client draws. Windows get a hard alpha cut, so it works for client-rounded windows as well (the mask just removes more or the same pixels).

Not usable / not applicable:
- **CSS** (`St` theme): shell CSS only styles shell widgets, not client surfaces. **[U]** inference, not found in a doc; no source suggests otherwise.
- **Clipping** via `Clutter.Actor.set_clip` is rectangular only. **[U]** (standard Clutter behaviour, not re-verified).
- Mutter has no radius feature of its own; I found no mention in `meta-wayland-surface.c` (single file only, so not conclusive). **[U]**

### Shadows
- Client-drawn shadows (libadwaita `.csd`) live inside the buffer outside the frame rect. A mask that hugs the frame rect **cuts the client's shadow off**. The extension therefore draws its own shadow actor (an `St.Bin` with a `ClipShadowEffect`) under the window in `global.windowGroup`, bound by `Clutter.BindConstraint`s plus property bindings (pivot, translation, scale, visible). Cost: a second actor per window to keep in sync, with a workaround for GNOME shell issue 4474 (shadow drawn behind window contents). **[V]**
- For maximized/fullscreen the extension hides its shadow by default. **[V]**
- Whether Mutter's own shadow (for windows without client shadow) is also affected: **[U]**, `meta-window-actor.c` excerpt did not show the shadow code.

### Apps with their own corner radius
- Masking on top of an already rounded window is harmless if our radius is smaller or equal (nothing extra removed). If ours is larger, we cut deeper than the app's own corner and any inner element near the corner gets clipped; if ours is smaller, the app's own transparent corners remain visible (so uniformity is not guaranteed). To get truly uniform corners across apps you must *also* know the app's own radius, which the shell cannot query. **[U]** (logical consequence; no source measured it)
- libadwaita's radius value (I recall 15px in recent versions) was not read in my sources: **[U]**. So an 8px target will be *smaller* than libadwaita's own radius, meaning the shader would only add the missing corners but not shrink libadwaita's.
- Apps that draw nothing in the corners (square bg): the mask works as intended.
- Shadows of such apps: no client shadow -> only the extension's own shadow.

### Server-side decorated windows
- Mutter on Wayland uses client-side decorations by default; with `xdg-decoration` (SSD) Mutter draws the frame. I did not read how Mutter 50/51 draws SSD frames (it is a `MetaFrame` for X11; Wayland SSD handling was not verified). **[U]** For a Wayland SSD window the frame rect and buffer rect may differ because the title bar is added by the compositor; the same effect would apply to the actor but the mask bounds must include the title bar. Not verified.
- Xwayland is out of scope per the brief.

## 2. Cost and risk

Performance **[mostly U]**:
- Any `Clutter.Effect` that adds a GLSL snippet on a window actor is just an extra fragment snippet in the existing pipeline (`Shell.GLSLEffect` builds a Cogl pipeline); no extra render pass is needed for that part. The extension caches uniform locations because lookup is expensive (comment in source). **[V]**
- Shader comments say sqrt is avoided, with a fast path for the non-corner pixels. **[V]**
- Actual GPU cost was not measured by anyone in my sources. **[U]** Expect it to be small per window, but the shadow actors add real compositing work (more blended actors, blur-like shadow textures). **[U]**
- Bypassing direct scan-out/unredirect: an effect on a fullscreen window can prevent the compositor from skipping compositing. **[U]**, not verified in Mutter 50/51; the extension disables rounding for fullscreen by default, which sidesteps it. **[V]** (that it disables) / **[U]** (why)

Known bug classes visible in the reference extension **[V]** unless noted:
- Window geometry timing: needs deferred setup (waits for `wm-class`, for `first-child` for Xwayland), a re-refresh 250 ms after unminimize for Chromium, and *both* `notify::size` on the actor and `size-changed` on the texture ("weird bugs" and invisible windows with Dash to Dock otherwise).
- Animations: shadow actor must follow the window's translation/scale; minimize with "magic lamp" requires hiding shadow + disabling the effect and re-enabling at ~98% animation progress.
- Fullscreen: size does not change, so `notify::fullscreen` needs its own handler.
- Fractional scaling / HiDPI: the effect file contains **no** scale-factor handling and the shader's `pixelStep` is `1/actor size` ("not sure what this does" comment). Whether corners are crisp or off by a pixel at fractional scale is **[U]**. Also, an unrelated "Smooth Shell Corners" listing advertises "crisp text at fractional scaling", implying text blur is a known issue with some approaches (that extension also replaces GTK4 corners natively; details not verified). **[U]**
- A code bug in that extension's max-radius cap (`NaN`) shows that edge cases (radius larger than window) are easy to get wrong. **[V]**
- Screen recording: Mutter paints window actors for capture via `cogl_offscreen` in `meta_window_actor_paint_to_content_full()`; whether effects added by extensions are included was not read. **[U]** (Likely yes, since the actor is painted, but not verified.)
- GNOME 49 removed `Meta.Window.get_maximized` (from an EGO review note of another extension). Maintenance burden: Shell/Meta JS API breaks between releases; the extension needs a version check per release. **[V]** (that one removal) / maintenance estimate **[U]**.

Review guidelines (gjs.guide) **[V]**:
- No rule against shaders, effects or window manipulation. Rules that bite: create everything in `enable()`, undo everything in `disable()`; disconnect all signals; remove all main-loop sources; no excessive logging; no minified/obfuscated code; "large amounts of unnecessary code" or AI-generated-looking code can be rejected; no binaries. The reference extension itself got an EGO review asking for signal/timeout cleanup in `disable()` (a one-shot `wm-class`/`first-child` handler there is not tracked, a leak risk). **[V]**
- Extensions that interact with other extensions are discouraged. Compatibility workarounds for Dash to Dock / Magic Lamp, as in the reference, go in that direction. **[V]**

## 3. Gaps via `Meta.Window.move_resize_frame`

### Mechanics
- `meta_window_move_resize_frame(window, user_op, x, y, w, h)` builds a rect and calls `meta_window_move_resize()` with move + resize + constrain flags (plus user-action flag if `user_op`). **[V]**
- Gap strategy: take the work area (`window.get_work_area_current_monitor()`; not seen in the excerpt: **[U]** for exact name/behaviour in 50/51), compute the tile rect, then inset it: outer gap at the work-area edge, half the gap on interior edges (or full gap on one side only, to avoid double gaps). Pure arithmetic in logical pixels. Rounding: use integer pixels; with fractional scaling, Mutter works in logical pixels, so odd values are fine for the protocol but pixel alignment on screen is **[U]**.
- Constraints still apply to a floating window: partially/fully onscreen, single monitor, size limits (min/max, increments, aspect ratio). Size-limit constraint is clamped, then re-gravity'd. **[V]** (`constraints.c`, via summary).
- **Client minimum size:** the window cannot be made smaller than its min size; the requested gap-inset rect is clamped, so the window may overlap its neighbour or exceed the work-area edge. For tiling Mutter's own `constrain_tiling` *skips* the tile if the target is smaller than min size (and ignores max size). **[V]** For floating, SnapTile must detect that the resulting frame rect != requested rect (read back `get_frame_rect()` after the configure) and decide: shift, overlap, or refuse. **[U]** for the exact read-back timing; on Wayland the configure round-trip is async ("the size is always determined by the client" in `meta-window-wayland.c`), so the final size is only known after the client acks. **[V]** for the async/authority part.
- Max-size-limited clients (dialogs) won't fill their tile: gap becomes larger on that side. **[V]** (limits clamp) / consequence **[U]**.
- Maximized/tiled windows: `move_resize_frame` on a maximized window is constrained back by `constrain_maximization`; SnapTile must `unmaximize` first (and for Mutter-tiled windows, un-tile). **[V]** for constraints existing; the exact call sequence **[U]**.

### Does the client learn it is "tiled"?
- Tile state is computed in `update_edge_constraints()` from `tile_mode` (and maximize flags): `META_TILE_NONE` -> all edges `NONE`; `META_TILE_MAXIMIZED` -> all `MONITOR`; `META_TILE_LEFT/RIGHT` -> edges `MONITOR`, inner edge `WINDOW` if a tile match exists else `NONE`. Then maximize flags add edges. **[V]**
- `move_resize_frame` does **not** touch tile mode (it only builds a rect and flags). Therefore a window placed by SnapTile via `move_resize_frame` stays `META_TILE_NONE`, edge constraints `NONE`, and **no** `TILED_*` and no `MAXIMIZED` state is sent. **[V]** (inference from the two code paths above; I did not trace every call path in `meta_window_move_resize`, so a small residual **[U]**)
- Consequence for the look: the app thinks it is floating: libadwaita keeps its own rounded corners and its full drop shadow (extents around the frame). Good for gaps (the corners stay round and shadow stays), but the client's shadow overlaps neighbouring windows and gap areas, and the frame rect (what we position) excludes the shadow, so the visible gap is correct but shadows may look heavier. Resize handles stay active. **[V]** for CSS/state, appearance **[U]**.
- Mutter's own tiling (left/right half via `meta_window_tile`) does send `TILED_*` -> square corners; but a gap is not possible there because `constrain_tiling` forces exactly the tile rect. **[V]** (`constrain_tiling` forces x, y, width, height to the tile area.)
- Can the extension force the tiled look without Mutter's tile mode? **[U]**: no public API found; setting `edge_constraints` is internal C. Not verifiable from JS.

So: with gaps, the apps keep their natural round corners and shadows (floating look). Square-corner "tiled" look is only available with Mutter tile mode (no gaps). The two goals "no gaps + square" vs "gaps + round" are naturally paired. The extra shader is needed only for apps that are *not* round when floating.

## 4. Scope: only SnapTile's windows or all windows?

Facts:
- The reference extension applies to all normal windows by default, with allow/block lists, per-app config, maximized/fullscreen toggles. It has to handle each window class separately (e.g. a Kitty-specific tweak to trim Kitty's own shadow). **[V]** This shows the "all windows" path is a long tail of per-app workarounds.
- Gap logic only makes sense for windows SnapTile moves; SnapTile cannot keep a gap for windows the user resizes manually. **[U]** (design consequence)

Least invasive approach (recommendation reasoning, **[U]** as judgment):
1. **Gaps: only for windows SnapTile places.** That is a pure geometry computation inside `move_resize_frame`; no actor hooks. Track placed windows in a WeakSet/Map; forget a window when the user drags or resizes it away.
2. **Corners: ship version 1 without any shader.** libadwaita apps already round all four corners when floating, and gap placement via `move_resize_frame` keeps them floating (see §3). The look is then correct for the most common modern GNOME apps with zero GPU/compat risk.
3. **If non-rounding apps matter**, add the shader as an optional, separate, off-by-default feature, applied *only* to windows SnapTile placed (add effect on placement, remove on un-place/disable), skip fullscreen, and do not draw own shadows (accept clipped client shadow, or accept its absence) in a first cut. That removes the largest chunk of the reference extension's complexity (shadow actors, animation sync). **[U]** whether that looks acceptable needs a prototype in the real VM.
4. "All windows" is not recommended: GNOME maintainers explicitly dislike forcing it (thread), review burden and the per-app long tail are high, and it duplicates existing extensions (users can install one next to SnapTile).

## Open items to verify before committing
- Read the GNOME 50 and 51 tags (not `main`) for: `meta_window_move_resize_frame` path, `update_edge_constraints`, `Meta.Window` JS API names (`get_work_area_current_monitor`, maximize APIs).
- Measure: GPU cost, fractional scaling correctness, screencast result with an effect on a window actor.
- Check libadwaita's current `--window-radius` value (so we know how 8 px compares).
- Check Wayland SSD handling in Mutter 50/51.
- Prototype: place a libadwaita app and a non-libadwaita app with `move_resize_frame`, read back frame rect and observe client state and look in the VM.

## Zusammenfassung (Klartext)

- **Einfach:** Abstände (Gaps) zwischen Fenstern und zum Rand sind reine Rechnerei mit der Arbeitsfläche und lassen sich über die normale Fenster-Verschieben-Funktion umsetzen. Moderne GNOME-Apps behalten dabei ihre eigenen runden Ecken, weil Mutter ihnen bei dieser Methode nicht sagt, dass sie "gekachelt" sind (nur die eingebaute Kachelfunktion von Mutter löst die eckige Darstellung aus; das ist aus dem Quelltext abgeleitet, aber noch nicht im Betrieb geprüft).
- **Riskant:** Runde Ecken für alle Apps per Grafik-Effekt (Shader) sind machbar (andere Erweiterungen machen es), kosten aber viel Pflege: eigene Schatten, Animationen, Skalierung und Sonderfälle pro App. Wirkung auf Bildschirmaufnahme und gebrochene Skalierung ist nicht belegt. Zudem wollen die GNOME-Entwickler keine erzwungene Rundung.
- **Grenzen bei Gaps:** Fenster mit Mindestgröße lassen sich nicht beliebig verkleinern; der Abstand kann dort kleiner ausfallen oder das Fenster ragt über.
- **Empfehlung:** Gaps zuerst, nur für von SnapTile platzierte Fenster. Runde Ecken in Version 1 weglassen und GNOMEs eigene Rundung nutzen. Den Shader später optional, ausgeschaltet als Standard und nur für SnapTile-Fenster nachliefern, nach einem Prototyp in der VM. Alles mit "[U]" oben ist ungeprüft.

File: /home/muse83/SnapTile/docs/research/rounded-corners-and-gaps-feasibility.md
