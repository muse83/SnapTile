# SnapTile

SnapTile is a GNOME Shell extension for arranging windows on screen, modelled on the
macOS app Magnet.

## Language

**SnapTile**:
The GNOME Shell extension this project builds; it snaps windows to fixed screen areas.
_Avoid_: Gtile (name already taken by another GNOME extension)

**Window memory**:
Remembering the size and position of an application's window so it reappears the same way.

**Tile**:
One of the 14 fixed screen areas a window can be snapped to: four quarters, four halves
(top, bottom, left, right), three thirds, two two-thirds, and the whole screen.
_Avoid_: Zone, slot, region (those mean the trigger areas, see Edge zone)

**Tile preview**:
The translucent frame shown while a window is dragged, marking the Tile it will snap to on
release. Looks the same as GNOME's own preview.

**Edge zone**:
An area at the screen edge or corner of one monitor that selects a Tile while the pointer is
in it during a window drag. Each monitor has its own Edge zones.
All Edge zones reach 1 cm in from the screen edge.
Every monitor has all its Edge zones on its own, whether there is one or five, also on
edges that border another monitor.
_Avoid_: Hot corner (a different GNOME feature)

**Window look**:
How SnapTile makes every window appear, tiled or floating: all four corners rounded to the
same radius (2 mm) and a visual margin (0.83 mm) around the window. Purely visual: it never
changes where a window can be placed, so floating windows can still overlap, touch or sit
anywhere. Applies to every application window and dialog. Not to menus, tooltips or the
GNOME interface, and not to full-screen windows (those that also hide the dock and top bar).

**Window margin**:
The 0.83 mm of empty space shown around the visible window, part of the Window look. Two
tiled windows next to each other therefore appear 1.66 mm apart.

**Merged thirds**:
Two neighbouring thirds combined into one two-thirds Tile by dragging the pointer along the
bottom edge from one third into the next. Always exactly two thirds: the one the pointer
came from and the one it is in now.

**GNOME edge tiling**:
GNOME's built-in snapping of a dragged window to the left half, right half or whole screen.
SnapTile replaces it; it must be switched off in the GNOME settings while SnapTile is used.
