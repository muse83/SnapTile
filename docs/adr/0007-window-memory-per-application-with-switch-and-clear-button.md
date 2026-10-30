# Window memory: per application, stored in settings, with a switch and a clear button

Status: accepted (2026-10-23, maintainer decision in a grilling session). Spec: issue #8.

## Decisions

- **Per application, last action wins.** SnapTile keeps one Remembered place per application
  (key: GTK application id, otherwise window class). The window last moved, resized or closed
  counts. Closing a window does not overwrite a place that another still-open window of the
  same application saved more recently. At most 200 applications, least recently used dropped.
- **Same result however the place came about.** A reopened window gets the size and position
  it had when it was last closed; a window closed in a Tile comes back in that Tile (stored by
  name, one of the 14); one maximised with the window button comes back maximised. For a tiled
  window only the size from before tiling is kept, no position: dragging a tiled window out
  follows the pointer, so a stored position could never be used (what is stored for the
  monitor and the fallback is the Tile's own rectangle, see ADR 0010). An unknown size is never
  invented.
- **Exception to "SnapTile has no settings".** The first spec said SnapTile has no settings.
  For window memory this is deliberately changed: a settings schema shipped with the extension
  holds a switch (on by default) and the Remembered places as one text value; a preferences
  window in the GNOME Extensions manager offers exactly the switch and a button that clears
  everything. Switching off keeps the stored data until the button is used. Everything else
  (Edge zones, Window look) stays fixed and has no setting. Written down here so the two
  statements are not mistaken for a contradiction later.
- **Dialogs are left out completely, in both directions.** They are neither remembered nor
  moved, also windows that belong to another window, full-screen windows, windows without a
  recognisable application and windows that cannot be moved or resized. This differs from the
  Window look, which does cover dialogs. Reason: a dialog (for example the file chooser a file
  manager opens) is centred on its parent by design; applying the main window's place would
  look half-finished, and storing the dialog's size would overwrite the main window's.
- **Second window of an application.** When the application already has an open window, the new
  window opens free (never in a Tile, never maximised) with the remembered free size, offset by
  about 1 cm right and down from the most recently used open window. The Tile is used only when
  the application has no open window. SnapTile makes this offset itself instead of relying on
  GNOME's placement, which cannot know SnapTile's place and is not an offset from the open
  window.
- **Monitors.** The monitor is stored and the position kept relative to it. If it is gone, the
  nearest remaining monitor takes the window (also for a Tile), fitted to its work area.
- **When it is saved.** After the user finishes moving or resizing a window, on close, and for
  every open window when the extension is disabled. No timer.
- **Conflicts and jumping.** SnapTile's place wins against an application's own restoring.
  The window is placed as early as Mutter allows; a remaining visible jump is accepted. A window
  is never hidden or made transparent while it is placed, so a failure cannot leave an
  invisible window.

## Considered Options

- Per window instead of per application. Rejected: windows have no stable identity across
  closing, so SnapTile would have to guess which one is which.
- No settings at all, memory always on. Rejected by the maintainer: a user must be able to
  turn it off and to clear it.
- Data in a plain file in the user's data folder. Rejected by the maintainer in favour of the
  settings storage, which fits the new switch.
- Treating dialogs like main windows, or taking over their size and position fully. Rejected:
  see above.
- Letting GNOME's own placement handle the second window. Rejected for robustness; the facts
  about GNOME's behaviour are still checked in the research ticket but do not change this.
- Hiding the window until it is placed to avoid any jump. Rejected: a failing step could leave
  a window invisible.
- Saving only on close and disable. Rejected: a crash would lose every window still open.

## Consequences

- The extension now needs a settings schema and a preferences window. The first spec's "no
  preferences window" no longer holds for this feature; its other values stay fixed.
- Dialogs behave differently for memory and for the Window look; both are intended.
- A visible jump when a window opens is possible and accepted. The research ticket measures it.
- Tiled-window state must be asked from one place by both drag-to-snap and the memory.
- How the preferences window reaches the running extension (ticket "Switch and clear button",
  spec: issue #8): the preferences window runs in its own process and only changes the shared
  settings. The switch is read each time something would be saved or placed, so it takes
  effect at once. The clear button resets the stored places; the extension follows every
  change of the stored text that is not its own write, replaces its in-memory copy and forgets
  which open window saved last, so a window open during the clear stores its place anew when
  it closes (while the switch is on). The clear button first asked no confirmation (what it
  removes is only window places, which rebuild by use); since 2026-10-30 it opens a dialog
  that says what is removed and needs a second click on "Clear" (maintainer decision), so a
  mis-click cannot lose all places. The dialog's default is "Cancel", so Enter alone never clears.
- Known limit of the clear button: the extension learns of the clear through a change signal,
  not in the same instant. A window that closes in that fraction of a second would write the
  old places back over the cleared text. Not guarded; the user can press the button again.
