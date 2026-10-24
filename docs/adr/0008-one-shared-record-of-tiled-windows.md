# One shared record of tiled windows: their Tile and their size from before tiling

Status: accepted (2026-10-24). Prefactor for the window memory, issue #10 (spec: issue #8).

Window memory has to know which of the 14 Tiles a window sits in and what size it had before
tiling (ADR 0007). Until now only drag-to-snap knew, and only the size. The knowledge now
lives in one place, the `TiledWindows` record (`src/tiledWindows.js`, no GNOME imports), which
replaces the old size memory.

## Decisions

- **One record, two readers.** Drag-to-snap writes it; the window memory reads it. The
  extension creates the record, hands it to drag-to-snap and clears it on disable. Drag-to-snap
  does not own or clear it, so the window memory can still read it while the extension is
  being disabled (it must save every open window then, see ADR 0007).
- **What it holds per window.** The Tile by name (one of the 14) and the size from before
  tiling, or none for a window that never had a free size. Tiling a tiled window again moves it
  to the new Tile but keeps the first size (ADR 0006: remembered once per tiling).
- **Dropped at the same moments as before.** Dragged out of the Tile, resized, moved by
  keyboard, closed, extension disabled. Drag-to-snap's own bookkeeping (the signals that watch
  a tiled window) stays in drag-to-snap; the record is plain data and creates no timers or
  signals.
- **Escape keeps the Tile.** A drag cancelled with Escape puts a tiled window back into its
  Tile and records that Tile again (the size from before is the one the window was just given
  back).

## Considered Options

- Letting the window memory ask drag-to-snap. Rejected: it would tie the window memory to the
  drag code and its lifetime.
- Keeping the record inside drag-to-snap and cleared by it. Rejected: it would be gone before
  the window memory can save on disable.

## Consequences

- Drag-to-snap keeps a second map of the same windows for its signals. Both are written and
  ended in the same two places; a future caller must not release a window in the record only.
- Behaviour for the user does not change.
