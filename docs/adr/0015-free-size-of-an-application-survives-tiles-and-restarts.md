# The free size of an application survives Tiles and restarts

Status: accepted (2026-10-29). Builds on ADR 0006, 0008 and 0010; found when windows left a
Tile either at a size far too small or at the size of the Tile.

## Problem

A window leaving a Tile should get back the size the application's windows normally have (the
Free size, see CONTEXT.md). It did not, for three reasons:

- The size from before tiling lived only in the shared record of tiled windows (ADR 0008),
  which is empty after SnapTile starts. A window that sat in a Tile at that moment (extension
  reloaded, SnapTile updated, tiled by an earlier run) kept the Tile's size when dragged out,
  was then saved as a free window of that size, and the real size was lost for good.
  Nothing remembered the size a window opened with unless it was moved, resized or closed.
- A tiled window with no size of its own was saved with none, wiping the free size the
  application had in the stored place.
- A window dragged from one Tile into another without a known size recorded the old Tile's
  size as its size before tiling, so a quarter or third became the application's free size.

## Decisions

- **The size a window opens with is the application's free size.** When a window of an
  application with no known free size shows (the first time ever, or after only Tile or
  maximised places were stored without a size), the size it has then is remembered at once,
  before anything is moved. It stays the application's free size, over restarts and
  repositioning, until the user moves it away by resizing a window freely; that size then
  replaces it (maintainer decision, 2026-10-29). A window that opens maximised or full screen
  shows no free size and is skipped.
- **The free size belongs to the application, not to a window.** A tiled or maximised window
  that has no earlier size of its own is stored with the one the application already had.
  The size of a Tile is never stored as a free size. Where no free size is known at all (an
  application that so far only opened maximised), nothing is invented and the window keeps the
  Tile's size when dragged out (the fallback).
- **Windows already in a Tile when SnapTile starts are adopted.** A window whose frame sits in
  one of the 14 Tiles of its monitor (a few pixels smaller or larger are allowed, for
  applications that resize in steps) is recorded as tiled in it, without being moved, and
  gets the application's free size as its size before tiling. This also keeps the Tile and
  the size when SnapTile is stopped again (ADR 0007: saved on disable). Only with the window
  memory switched on and only for windows the memory handles at all (not dialogs).
- **A window leaving a Tile asks the memory when it has no size of its own.** The memory hands
  the free size of the window's application to drag-to-snap through one function; drag-to-snap
  knows nothing of the stored places.
- **A window that came out of a Tile is not measured at the drop.** A window that was free
  before the drag still records its size at the drop (ADR 0008). One that was in a Tile
  records the size it was given back, or none.

## Considered Options

- Writing the record of tiled windows into the settings. Rejected: windows have no identity
  across a restart of the shell, and the stored place per application already holds what is
  needed.
- Recognising tiled windows lazily when they are dragged. Rejected: saving on disable and the
  keyboard shortcuts would need the same check; once, at start, is enough.
- Remembering a free size per application separately from the last place. Rejected for now:
  the last place already carries it and a second copy could disagree with it.
- Taking the opening size only when a window is closed or moved. Rejected by the maintainer:
  the size of the very first opening is the application's standard and must not depend on
  what the user does next.

## Consequences

- Behaviour changed on purpose: ADR 0010's last known limit (a Tile-to-Tile drop without a
  known size records the current size) no longer holds, and an adopted window is saved as
  tiled, not as a free window of the Tile's size.
- A window that was only placed by hand at exactly a Tile's rectangle is treated as tiled
  after a restart. It then gets the application's free size when dragged out.
- The opening size is read when the window shows. An application that resizes itself right
  after showing (restoring its own size) is remembered with the size it showed first.
- Windows whose free size was already overwritten by a Tile's size before this change stay
  that way until the application's window is resized freely once.
- Not covered, found on the way: a maximised window cannot be dragged into a Tile (it counts
  as not resizable while Mutter still has it maximised), and a window SnapTile reopens
  maximised gets Mutter's size, not the remembered free size, when it is un-maximised.
