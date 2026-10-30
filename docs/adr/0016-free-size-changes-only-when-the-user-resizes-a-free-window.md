# The free size changes only when the user resizes a free window

Status: accepted (2026-10-30). Refines ADR 0015, found when an application lost the size its
first window had opened with, although the user had never resized it freely.

## Problem

ADR 0015 made the size of an application's first window its Free size, to be replaced only when
the user resizes a window freely. The code did not keep that promise. Every save (end of a move
or resize, close, extension disabled) stored the window's frame, so the Free size was whatever
size the window happened to have at that moment. That size is often not the user's doing:

- a window shrunk to fit a smaller monitor or the work area when it was put in place, or made
  larger by its own minimum size, then only moved or closed;
- a window an application resized itself (a terminal changing its font, an editor restoring a
  layout) and then closed;
- a window in one of GNOME's own halves (Super+Left, Super+Right). Mutter does not call it
  maximised, so it was stored as a free window of half the screen, and the opening-size
  follower of ADR 0015 also took the half as the opening size;
- a window resized out of a Tile, which stored the size of that Tile-like result as the
  application's size;
- a Tile's save that carried a window's own size before tiling, overwriting the application's.

## Decisions

- **Only one event replaces the Free size: the user finishes resizing a window that was free
  when they took hold of it.** Free means: in none of the 14 Tiles (told by the frame, because
  drag-to-snap has already let go of its record when a resize starts), not maximised, not in a
  GNOME half, not full screen. The resize must have changed the size. Moving, closing, tiling
  and disabling never replace it, whatever size the window has then.
- **Everything else keeps the Free size and takes only the position.** A free window is stored
  at its position with the Free size already known; a tiled or maximised one with the known
  Free size as its size before tiling. The size before tiling a window keeps for itself (for
  dragging it out, ADR 0006) is unchanged, it is only no longer copied over the application's.
  Where no Free size is known yet, the window's own is taken, as before.
- **The opening-size follower (ADR 0015) also stops for a GNOME half** and does not start for a
  window that opens in one. It still follows an application that resizes its own new window.
- **The decision lives in `rememberedPlaces.js`** (the `resized` flag of `rememberWindow`), so it
  is tested without GNOME. `windowMemory.js` only sets the flag, from the window's state at the
  start of the grab and the resize operation at its end.

## Considered Options

- Fixing each source (GNOME half, shrunk windows, ...) one by one. Rejected: a new source of an
  odd size would reintroduce the bug; one rule that names the single legitimate source cannot.
- Counting a resize that starts in a Tile as a free resize, since the user did resize. Rejected
  following the maintainer's statement that the size only changes when the window is in no Tile.
- A separate stored Free size next to the last place. Still rejected (ADR 0015): the place
  already carries it.

## Consequences

- A window the user resizes out of a Tile, or from a GNOME half or maximised, is stored at its
  new position but with the old Free size; reopened, it has the old size. Resizing a window
  freely once changes the Free size.
- A window the application resizes itself, or that the shell fitted to a smaller screen, no
  longer changes what the next window of the application gets.
- Free sizes already damaged before this change stay as they are until a free resize.

## Known limits (found in the review, not changed here)

- Where an application has no Free size yet, any save takes the window's own size (nothing is
  invented). This also holds for a window that was already open when SnapTile started, that
  opened while the memory was off, that opened maximised or in a GNOME half, or that was open
  when the memory was cleared. Only the first such save counts; after it the size is kept.
- The opening-size follower of ADR 0015 has no time limit: until the user first takes hold of a
  window, a resize by the application still replaces the Free size it stored itself. That is
  the price of supporting applications that restore their own size after showing (Electron).
- A window in a Tile is told from a free one by its frame (as at the start of SnapTile), because
  drag-to-snap lets go of its record before a resize starts. A window hung off its Tile because
  of a larger minimum size, or resized by its application after tiling, therefore counts as free.
- Unchanged and out of scope: a window dropped into a Tile takes its own size at that moment as
  its size before tiling, which can differ from the application's Free size (ADR 0015).
