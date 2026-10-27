# SnapTile forces its window look (rounded corners, margin) on all windows

Status: accepted (2026-10-23, maintainer decision)

SnapTile gives every window the same rounded corners (2 mm, all four corners) and a 0.83 mm
visual margin, whether the window is tiled or floating. The look is applied by SnapTile
itself, not left to each application. Reason: GNOME makes tiled windows square and leaves
the look of floating windows to each application, so the result is inconsistent. The
maintainer wants the uniform look macOS has, and it is part of the first version.

## Considered Options

- Only margin in the first version, applications keep their own corners (GNOME applications
  stay rounded because SnapTile does not report them as tiled). Recommended by the research,
  rejected by the maintainer: a uniform look needs the forced version anyway.
- Look only for windows SnapTile placed in a Tile. Rejected: the look should not depend on
  how a window got where it is.

## Consequences

- Forcing corners means cutting the window picture, which also cuts the application's own
  shadow, so shadows have to be redrawn (decided otherwise later: see the last section, no
  shadows). Applications that draw their own corners cannot be
  made smaller, only cut. Animations, other extensions, fractional scaling and screen
  recording are known trouble spots. See `docs/research/rounded-corners-and-gaps-feasibility.md`.
- GNOME maintainers advise against forcing corners on all windows. Expect extra upkeep with
  every GNOME release.
- The look is purely visual and must never change window placement or make floating harder.
- It is a fixed requirement of the first version, not up for debate (maintainer's decision). It still starts with a prototype in the dev VM to see how it behaves.
- Scope: every application window and dialog; not menus, tooltips or the GNOME interface, and
  not true full-screen windows (the ones that hide the dock and top bar).

## How the corners are made (2026-10-23, built in the first window look ticket)

- A shader effect on each window cuts the corners, and only inside the visible window frame.
  What an application draws outside the frame, its own shadow above all, stayed as it was
  (replaced: see the last section, the shadow is now cleared).
- GNOME 50 and 51 want the shader handed over in different ways (GNOME 51 dropped the
  interface the reference extension uses), so the effect supports both. Details and the
  pitfalls found while building it are in `docs/research/rounded-corners-and-gaps-feasibility.md`.
- Not yet verified: fractional scaling, flicker during open/close/minimize animations, and
  shadows that Mutter itself draws for windows without a client shadow (the last section
  clears everything outside the visible window, which covers those too, not yet seen on a
  window without a client shadow).

## How the margin and the preview are made (2026-10-23, built in the second window look ticket)

- The margin is made by the same shader as the corners: inside the window frame the outer
  0.83 mm are made transparent and the corners are rounded around what is left. The window
  keeps its frame, so placement, overlap and touching are untouched; two tiled windows appear
  1.66 mm apart because each one hides its own margin.
- The application's shadow stayed where it was, outside the frame (replaced: see the last
  section). It therefore sat one margin further away from the visible window. Clicks in the margin still reach the
  window, as the margin is only visual.
- The Tile preview is drawn on the Tile pulled in by the margin, with the same corner radius
  as a window. The Tile decision hands out the pulled-in rectangle (`visible`) and the
  window effect takes margin and radius from the same conversion, so both follow one source;
  they are still two separate drawings, so a change to either must be checked against the
  other (the smoke test does).
- Verified in the headless shell on GNOME 50 and 51 (pixels read from screenshots): the margin
  on all four sides of a floating window, two windows dragged into neighbouring halves 2
  margins apart and 1 margin from the work area edge, a window dropped over another one stays
  where it is dropped, and the preview shows the same margin and corner radius as the window.
- Margin and radius are whole pixels, so on a monitor at 96 DPI the visible gap is 6 px
  (1.59 mm), not exactly 1.66 mm.

## No shadow, and a fast preview (2026-10-27, maintainer decision after the first run on a real desktop)

- The application's own shadow is now cleared too. Until now it stayed, but it sits around the
  window frame while the visible window is pulled in by the margin, so it showed as a second
  border at the old window size. SnapTile has no shadow of its own, so windows now have none:
  rounded corners and the margin only. Drawing a consistent shadow of SnapTile's own was
  considered and left out: windows without a client shadow have no room in their picture for
  one, so it would need a second actor per window (see the research note), and the maintainer
  allowed removing the effect. It can be added later as its own ticket.
- This replaces the sentence above "The application's shadow stays where it is" and the
  smoke test that protected it; the test now checks that the pixels around a window show the
  bare desktop.
- The Tile preview used to start at the size of the dragged window and glide to the Tile over
  250 ms, and the animation restarted at every pointer poll (every 30 ms), so it took seconds
  to arrive on a real desktop. It now appears at its Tile at once with an 80 ms fade, glides
  between Tiles in 80 ms, and does nothing when the Tile has not changed. The smoke test checks
  that the preview is born at its final size.
