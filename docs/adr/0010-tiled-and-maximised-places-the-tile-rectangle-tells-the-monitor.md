# Tiled and maximised places: the Tile rectangle tells the monitor

Status: accepted (2026-10-24). Builds on ADR 0007 and ADR 0008; ticket "Tiled and maximised
windows reopen in their Tile or maximised" (spec: issue #8).

## Decisions

- **What a Remembered place holds.** A free window: its frame. A tiled window: the Tile by name,
  the rectangle of that Tile and the size from before tiling (left out when none is known). A
  window maximised with the window button: a flag, its frame and the free size the application
  had. A window closed in the whole-screen Tile is a tiled window (Tile `full`), not a maximised
  one, and reopens as that Tile. No free position of a tiled window is ever stored; the
  rectangle stored for it is the Tile's own.
- **The monitor is found from the stored rectangle, not from a stored monitor number.** The
  work area nearest to the centre of the stored frame takes the window. For a Tile this is its
  own monitor, also with several monitors (a Tile always lies inside its monitor). If that
  monitor is gone, the nearest remaining one takes the Tile, which is the fallback ADR 0007
  asks for. A monitor number would change when monitors are plugged or unplugged. The ticket
  "Window memory with several monitors and a vanished monitor" may refine this; it does not
  have to change what is stored. Refined in ADR 0012: the monitor is now also stored by its id
  and found by it; the rectangle described here stays the fallback when that monitor is gone.
- **A Tile is read from the shared record, not from the window.** When the user drops a window
  into a Tile the window may not have its new frame yet. The record (ADR 0008) knows the Tile
  rectangle at once, so the drop is saved from there.
- **Maximised wins over Tile.** A window that is maximised with the button counts as maximised
  even if it was tiled before. Maximising with the button is saved when the window closes or
  the extension is disabled, not when the button is pressed (ADR 0007: no save without a
  move/resize end, close or disable).
- **A maximised window keeps the free size.** Closing a window maximised would otherwise erase
  the size the application had. The size is kept (taken from the window's Tile record, else
  from what was stored before) so a later ticket can use it. The reopened window is only
  maximised; it is not first given that size.
- **A corrupt entry is dropped whole.** An entry whose Tile is no Tile, whose size or flag is
  unusable, or that claims to be tiled and maximised, is dropped; its good neighbours stay.
- **Placement waits for a window that maximised itself.** As for free windows, a Tile is applied
  only after the window reported its size back from un-maximising (measured in
  `docs/research/window-placement-on-wayland.md`, section 5); the snap path alone loses the Tile.

## Considered Options

- Storing the monitor as a number or name next to the Tile. Rejected for now: needs a way to
  recognise a monitor that outlives re-plugging, which belongs to the several-monitors ticket,
  and the rectangle already gives the answer.
- Storing a Tile without any rectangle. Rejected: then the monitor, and the fallback when it is
  gone, would be lost.
- Treating the whole-screen Tile and the maximised flag as one thing. Rejected: they are made
  differently (drag to the top edge, window button), and "the same result however the place
  came about" is kept by reopening each the way it was.

## Consequences

- Entries written before this ticket (a frame only) are still read, as free windows.
- A maximised window reopens maximised but, when un-maximised, gets Mutter's size for it, not
  yet the free size that is stored.
- A second window of an application is still placed by GNOME; it never goes into a Tile (ticket
  "A second window of an application opens offset from the first"). Superseded: SnapTile now
  places it itself, see ADR 0011.
- Known limits, found in the review of this ticket and not guarded: a window closed or saved
  while it is being dragged out of its Tile is saved as a free window (the record is released
  when the drag starts); a window that goes full screen after it was placed in a Tile keeps the
  Tile in the record but is not remembered (full screen is left alone, ADR 0009). The smoke
  tests cover neither this nor the Escape path with a window that has no earlier size.
- Dropping a window with no known earlier size into another Tile records its size at that
  moment as the size from before: the user dragged it there, which is the one case where the
  current size is recorded (ADR 0008).
