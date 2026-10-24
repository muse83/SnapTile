# A second window opens free and offset from the most recently used open window

Status: accepted (2026-10-24). Builds on ADR 0007 ("Second window of an application") and
replaces the line in ADR 0010 that left the second window to GNOME; ticket "A second window of
an application opens offset from the first" (spec: issue #8).

## Decisions

- **What counts as a second window.** A new window whose application has another window that is
  shown and not closing (the same test as before: a window still being created or fading out does
  not count). Two windows opened together: the one shown first is the first window, the other is
  the second.
- **Reference window.** The most recently used open window of the application (first in the
  Alt-Tab list), whatever state it is in. If it is tiled or maximised, its frame is the Tile or
  the work area, so the new window starts at that corner plus the offset.
- **Free size.** The free size the application remembers (the frame of a free place, the size
  from before tiling for a tiled or maximised one), else the new window's own default size. For a
  window that maximises itself the default size is only known after it was un-maximised, so the
  placement is worked out again at that moment.
- **Offset.** 1 cm right and down, converted with the monitor the reference window is on, using the
  same lookup and 96 DPI fallback as the Edge zones, rounded to whole pixels.
- **Stepping.** If another window of the application sits on exactly the same top left position,
  the offset is added once more. "Sits on" is compared after fitting into the work area, because
  that is where the window really would end up. At most 10 offsets from the reference window; the
  10th spot is used even if taken (windows then overlap exactly; no further guessing).
- **Fitting.** Into the work area of the reference window's monitor: shrunk if larger, moved back
  inside if it reaches out. Without any monitor the frame is not fitted.
- **Never a Tile, never maximised.** Whatever the application remembered; the Tile is used only
  when the application has no open window.
- **A first window keeps its placement.** A window waiting for its self-maximising to end is not
  re-evaluated as a second window just because another window of the application opened
  meanwhile.

## Consequences

- At the right or bottom edge the stepping can run out of room: every step then lands on the same
  spot (the corner), and the 10th step is used.
- Only the top left position is compared. A window of another size on the same position still
  counts as taking the spot.
- The new window's place is not saved when it opens; as for every window, it is saved when moved or
  resized, on close and on disable.
- Known limits, found in the review of this ticket and not guarded:
  - A second window that the user never moved is still saved when it closes (ADR 0007: the window
    closed last counts). If the first window was never moved either, the application's
    remembered place becomes the second window's offset position, and the next first window
    opens 1 cm further down and right, again each session. Guarding it would need a rule like
    "an offset window the user never moved does not save on close", which is a new decision.
  - The reference window is read by its frame at that moment. A window still waiting to
    un-maximise reports the whole work area, so the new window starts at that corner.
  - A minimised window is not shown, so it does not count as open: the next window of the
    application is treated as a first window (and can land in a Tile).
  - The stepping over a taken spot is tested in plain Node tests only. In the smoke tests the
    newest window is always the reference, so a third window never meets a taken spot.
