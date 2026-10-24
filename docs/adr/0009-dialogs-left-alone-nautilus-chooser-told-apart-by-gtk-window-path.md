# Which windows the window memory leaves alone, and how Nautilus's file chooser is told apart

Status: accepted (2026-10-24, maintainer decision). Builds on ADR 0007; facts from
`docs/research/window-placement-on-wayland.md`. First built in the ticket "A free window
reopens at its remembered size and position" (spec: issue #8).

## Decisions

- **Windows that count.** A window is remembered and placed only if it is a normal window
  without a parent window, not a dialog attached to a parent, can be moved and resized, is not
  full screen, and has a recognisable application (GTK application id, otherwise window
  class). Everything else is left alone in both directions. A window that is maximised
  reports that it cannot be resized; that does not count against it.
- **Nautilus is not excluded, only its parentless file chooser.** The file chooser that Nautilus
  opens for another application is a modal dialog when the requester gives a parent window.
  Without a parent it is a plain normal window of the application `org.gnome.Nautilus`, equal
  to a file-manager window in type, parent, class, size and size flags. Only one property
  differs in substance: file-manager windows have a GTK window object path
  (`/org/gnome/Nautilus/window/N`), the chooser has none. The rule is: application
  `org.gnome.Nautilus` and no GTK window path means left alone. Ordinary Nautilus windows are
  remembered like any other application's. The path is known before the window is placed or
  shown (GNOME 50 and 51).
- **When a window is placed.** At the shell's `map` signal, the earliest moment a position
  request is kept. Earlier requests lose the position. The first visible frame is already at
  the remembered place. A window that maximises itself at start is un-maximised, and placed
  only after it reports its new size (placing at once loses the place).
- **Only the first window of an application is placed for now.** If the application already has
  an open window that counts, GNOME places the new one as usual. The offset for a second window
  is a later ticket (ADR 0007).
- **What is remembered for now.** The frame of a free window, when the user lets go of it
  after moving or resizing, when it closes, and for every open window when the extension is
  disabled (most recently used last, so it wins). A closing window does not overwrite what
  another open window of the same application saved after it. Tiled and maximised
  windows leave the remembered place as it is until their ticket. Windows that were open when
  the extension was enabled are never moved, but their close is remembered.
- **Stored data.** One text value in the extension's settings schema, application key to
  frame, in order of use, at most 200 applications (ADR 0007). The extension reads it once when
  enabled and keeps a copy.
- **Full screen.** A window is checked when it is shown and again when it closes; a window that
  went full screen in between is not remembered.

## Considered Options

- Leaving Nautilus out of the memory completely. Rejected by the maintainer: normal Nautilus
  windows must be remembered.
- Doing nothing about the chooser. Rejected: it would overwrite the file manager's remembered
  place and open at the file manager's place.
- A general rule "a window of a known application without a GTK window path is a dialog".
  Not taken: it would also catch main windows of applications whose windows are plain
  windows, and nobody measured how many there are. A general rule can follow if a second
  case turns up.
- Recognising the chooser by watching the file chooser request on the session bus. Rejected:
  far more machinery for the same answer.

## Consequences

- The exception relies on a GTK feature and on the application id of Nautilus. Another
  application that opens parentless plain windows of its own application is not covered.
- Until the ticket for second windows, a second window of an application opens where GNOME
  puts it, not at the remembered place.
- Smoke tests use a stand-in application (a plain window with the Nautilus application id).
  The real Nautilus and its real file chooser were checked once with the extension enabled
  (research note, section 6).
- Saving (ticket "Saving is reliable", spec: issue #8): "last action" is a counter per open
  window, set when the user lets go after moving or resizing. A closing window is skipped if a
  sibling has a higher number. Known limits: a sibling that was tiled or maximised after its
  last save still blocks the close of an older window until the tiled and maximised ticket
  handles it; windows missing from the shell's tab list count as oldest when the extension is
  disabled; the order of use is the key order of the stored object, so purely numeric
  application keys would be misordered (not expected for application ids or window classes).
  The move/resize save relies on drag-to-snap handling the same signal first (it is enabled
  first), so a drop into a Tile is not saved as a free place.
