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
  shadow, so shadows have to be redrawn. Applications that draw their own corners cannot be
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
  What an application draws outside the frame, its own shadow above all, stays as it is.
  SnapTile draws no shadow of its own.
- GNOME 50 and 51 want the shader handed over in different ways (GNOME 51 dropped the
  interface the reference extension uses), so the effect supports both. Details and the
  pitfalls found while building it are in `docs/research/rounded-corners-and-gaps-feasibility.md`.
- Not yet verified: fractional scaling, flicker during open/close/minimize animations, and
  shadows that Mutter itself draws for windows without a client shadow.

## How the margin and the preview are made (2026-10-23, built in the second window look ticket)

- The margin is made by the same shader as the corners: inside the window frame the outer
  0.83 mm are made transparent and the corners are rounded around what is left. The window
  keeps its frame, so placement, overlap and touching are untouched; two tiled windows appear
  1.66 mm apart because each one hides its own margin.
- The application's shadow stays where it is, outside the frame. It therefore sits one margin
  further away from the visible window than before. Clicks in the margin still reach the
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
