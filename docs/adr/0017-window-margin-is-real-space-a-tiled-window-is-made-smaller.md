# The Window margin is real empty space: a tiled window is made smaller by it

Status: accepted (2026-11-06, maintainer decision). Replaces the part of ADR 0004 that made the
margin a visual cut inside the window frame.

## Problem

ADR 0004 made the margin by turning the outer 0.83 mm (3 px at 96 DPI) *inside* the window's
frame transparent, so the window kept its frame and the look stayed purely visual. The
application knows nothing about that cut and keeps drawing up to its frame, so everything it
puts there disappears under the margin: buttons, text, scrollbars and borders at the window
edge. Seen with the Warp terminal, which draws its content right up to the edge; any
application doing so is affected. The window cannot be told to lay out inside a smaller area,
so a visual cut can never be correct.

## Decision

- A window in a Tile is given the Tile pulled in by the margin as its frame (`insetRect`, the
  same rectangle the Tile preview already drew). The margin is empty space outside the window,
  as in other tiling window managers, and the application lays its content out inside the
  visible window. Two neighbouring tiled windows are 2 margins apart, 1 margin from the work
  area edge.
- The margin is no longer cut from the window picture. The shader keeps the rounded corners
  and the cleared shadow, both exactly at the frame.
- Floating windows therefore have **no margin**: a margin around a window that can sit
  anywhere cannot exist without hiding part of it. They keep the rounded corners and have no
  shadow. This narrows the "Window look" of ADR 0004 (margin on tiled and floating windows) to
  tiled windows.
- The Tile itself (the rectangle that names the Tile and tells the monitor, ADR 0010) is
  unchanged and is still what is stored in the TiledWindows record and in the remembered place.
  Only the frame given to the window is pulled in.
- A window that cannot get as small as its frame is hung on the top left corner of the frame
  and kept inside the work area pulled in by the margin, so the margin to the screen edge is
  kept as far as possible.
- "Is this window in a Tile" (after a restart of SnapTile, and for Free size, ADR 0016) compares
  the window with the Tile pulled in by the margin of its monitor.

## Consequences

- Applications that only take sizes in whole steps (terminals) end up slightly smaller than
  their frame, as they already did in the Tile.
- A window in the whole-screen Tile is smaller than the work area by the margin on every side.
- Free size is unaffected: a tiled window's size is still never taken as the size to give back.
