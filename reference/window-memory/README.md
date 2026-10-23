# Reference: window memory

> Nothing in here is built, linted or run by SnapTile. The decision part (`frameMemory`) is
> adapted to plain JavaScript in `src/`; the glue and the settings storage are written fresh
> (see `docs/adr/0007-window-memory-per-application-with-switch-and-clear-button.md` and
> issue #8). Check every decision against the SnapTile spec rather than assuming the
> original still holds.

## What it does
Remembers the last frame (size, free position, tile, maximised flag) per application and puts
a new window of that app back there. Decision background: `docs/adr-0002-remember-windows-per-app.md`.

## What is reusable
- `src/frameMemory.ts`: pure decisions without GNOME code (parse stored data, remember on close,
  fit onto the nearest monitor, cascade a second window). Closest to reusable; has tests.
- `tests/frameMemory.test.ts`, `tests/windowMemorySettings.test.ts`: show which behaviour was
  pinned down. Good starting point for SnapTile's own tests.

## What must NOT be taken as is
- `src/windowMemory.ts`: glue to GNOME windows. Imports modules that do not exist in SnapTile
  (settings, signal handling, logger, tile state).
- `src/windowMemorySettings.ts`: tied to a settings storage SnapTile does not have.
- `src/windowFacts.ts`: excerpt, only the app-id lookup matters.
- The tile part (tile, size before tiling, whole-screen tile) only makes sense with SnapTile's
  14 fixed Tiles; SnapTile stores the Tile by name.
- Decisions the snapshot made that SnapTile answers for itself in ADR 0007: one slot per app
  vs per window, default off, 200-app limit, never inventing a size.
