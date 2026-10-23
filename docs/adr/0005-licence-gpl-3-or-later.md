# SnapTile is licensed GPL-3.0-or-later

Status: accepted (2026-10-23, maintainer decision)

SnapTile is released under the GNU General Public License, version 3 or (at the user's
choice) any later version. The full text is in the `LICENSE` file at the repo root.

Reason: a GNOME Shell extension runs inside GNOME Shell (GPL-2.0-or-later). The extension
review guidelines require extensions to be distributed under terms compatible with
GPL-2.0-or-later, and name GPL-3.0-or-later as a compatible example. The maintainer wrote
all existing code and chose a free licence because SnapTile will not be commercialised and is meant to be
distributed as a GNOME extension.

## Considered Options

- GPL-2.0-or-later: the licence of the Shell itself. Also fine, not chosen: the maintainer
  preferred GPL-3 as long as it causes no friction with the review.
- A permissive licence such as MIT: allowed by the guidelines, but unusual for extensions.

## Consequences

- Anyone may use, change and redistribute SnapTile, but derived works must stay under the same
  terms.
- Code from other projects may only be copied if its licence is compatible and its author is
  credited.
- Source files get a licence header (SPDX identifier) when the first source file is written.
