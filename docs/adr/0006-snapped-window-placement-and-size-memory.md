# Where a snapped window sits, which size it gets back, and what Escape does

Status: accepted (2026-10-23). The anchoring rule comes from the drag-to-snap ticket
(maintainer); the size restore details and the Escape rule were settled while building it and
are recorded here so they are not only in code comments.

## Decisions

- **Window too big for its Tile.** A window whose minimum size is larger than the Tile is
  hung on the Tile's top left corner and may reach beyond the Tile. It is moved back only as
  far as needed to lie fully inside the work area of that monitor (a window larger than the
  work area sits at its top left). The Tile itself and the preview are never changed.
  Mutter leaves such a window where the drag put it, so SnapTile moves it once the size has
  settled (150 ms after the drop).
- **Size from before tiling.** Dragging a tiled window out gives it the size it had before
  SnapTile tiled it, and the pointer keeps its relative place along the window. The size is
  remembered once per tiling; resizing or keyboard-moving a tiled window forgets it, and
  closing the window forgets it. A window SnapTile did not tile keeps its own size.
- **Escape.** Cancelling a drag with Escape never snaps. If the window was a tiled one that
  had already got its earlier size back, it goes back into its Tile. The drop is told apart
  from the cancel by the pointer button: on a cancel Mutter ends the drag while the button is
  still held.

## Considered Options

- Shrinking the Tile to the window's minimum size, or placing the window centred in the Tile.
  Rejected: the Tile rectangle stays fixed (ticket) and top left is the predictable place.
- Restoring the earlier size only when the drag ends. Rejected: the window would stay tile-sized
  while the user moves it.
- Listening for the Escape key. Rejected: the key is not delivered to the shell while Mutter
  holds the drag; the button state is.

## Consequences

- The 150 ms wait is measured only in the headless shell (windows settled within 100 ms). A
  slow real application could still be resizing after it; revisit if that shows up.
- Applications that ignore the requested size (fixed grids such as terminals) end up anchored
  by the same rule, not exactly in the Tile.
