# Every free window keeps the Window margin to the edges of the screen

Status: accepted (2026-11-26, maintainer decision). Replaces the part of ADR 0017 that gave
floating windows no margin.

## Problem

Since ADR 0017 the margin is real empty space, and only a window in a Tile had it. A window that
was never tiled, or was dragged out of its Tile, sat flush against the top bar, the dock or the
screen edge whenever it got there (opened large, restored by the window memory, resized to the
edge). The maintainer wants the spacing on every window, whether it has or ever had a Tile.

## Decision

- A free window (in no Tile, not maximised, not in a GNOME half, not full screen) is kept one
  Window margin away from every edge of its monitor's work area: the top bar, the dock and the
  screen edges. It is moved in, and made smaller if it does not fit. This is the same rectangle
  a window in the whole-screen Tile gets, so a free window can never come closer to an edge than
  a tiled one.
- Only edges the window is inside of count. A window the user put partly off the screen (or
  across onto the next monitor) stays where it was put on that side and keeps the margin on the
  sides that are still on the screen.
- Maximised windows stay the exception and have no margin, as before (ADR 0017).
- Two free windows have no margin between each other: they may overlap, and real space between
  overlapping windows cannot exist. A visible ring cut out of each window (ADR 0004) is not
  brought back, because it hides what the application draws at its edge.
- Applies to application windows and dialogs, not to dialogs attached to their window (Mutter
  keeps those on their parent).
- It happens when a window shows, when it changes size or place on its own (an application, an
  unmaximise), when the user lets go of it after a move or resize, and when the work areas
  change. Never while the user holds the window: during a drag it goes where the pointer takes it.
- Mutter tells a window's new frame only once the application has taken it. A window waiting
  for a new frame (after an unmaximise, or after the window memory placed it) is left alone
  until the frame arrives; otherwise SnapTile would move it on from the old frame and Mutter
  would drop the placement. The window memory therefore places free windows through the same
  module (`freeMargin.js`), which pulls the remembered place in by the margin at once. Any new
  size or place ends the wait, also one that is not what was asked for.
- A window is pulled in at most three times in a row without the user touching it. An
  application that puts its window back where it wants it after every move (some X11
  applications) would otherwise be moved back and forth for ever.
- A window that cannot be made as small as the work area pulled in by the margin is hung at the
  margin on the top and left and reaches beyond the far edges; it is then left there, so SnapTile
  does not ask again and again.

## Consequences

- A remembered place, or a remembered size larger than the work area, opens pulled in by the
  margin (it used to fill the work area exactly).
- Telling "is this window in a Tile" by its frame (ADR 0017) gets harder: a free window as large
  as the work area or larger is pulled in to exactly the frame of the whole-screen Tile. The
  window memory tells a free resize by the frame at the start of the resize (ADR 0016), so
  resizing such a window does not replace its application's free size. This was already so for
  a free window filling the work area exactly; it now happens to every window that opens that
  large. Open: telling it apart needs the window memory to learn whether the window was in a
  Tile before drag-to-snap lets go of it (a follow-up ticket).
- An application whose window opens as large as the work area or larger gets the work area
  pulled in by the margin as its free size (ADR 0015 follows the size a new window settles on).
- The pure rule lives in `clearOfEdges` in `tileDecision.js` and is unit tested; the smoke test
  checks a free window against the top bar and partly off the screen.
