# SnapTile provides all 14 tiles itself and never changes GNOME's tiling setting

Status: accepted (2026-10-23, maintainer decision)

SnapTile handles every Tile itself, including the ones GNOME already has (left half, right
half, whole screen). It only checks whether GNOME edge tiling is switched on and, if so, shows
the user a hint to switch it off in the GNOME settings. It does not switch the setting itself.

Reason: if both run, two previews appear on top of each other, and GNOME's side zones overlap
SnapTile's corner zones. Splitting the work between GNOME and SnapTile (GNOME for what it can,
SnapTile for the rest) would need SnapTile to draw exactly around GNOME's zones.

## Considered Options

- Hybrid, GNOME tiling on: GNOME does left half, right half and whole screen, SnapTile adds the
  rest. Rejected: overlapping zones and flickering previews at the hand-over.
- SnapTile switches GNOME's setting off and restores it later. Rejected by the maintainer: the
  user should stay in control of their system settings.

## Consequences

- While GNOME edge tiling is on, the user sees two previews until they follow the hint.
- The hint is a notification shown every time the extension is switched on (so on every login)
  while GNOME edge tiling is still on. It names exactly which setting to switch off and where.
  It stops once the user has switched the setting off.
- The extension runs on Wayland only (maintainer decision, same day); nothing X11-specific is used.
