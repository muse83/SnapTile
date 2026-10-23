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
