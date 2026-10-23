# One extension for GNOME 50 and 51

Status: accepted (2026-10-23, maintainer decision)

SnapTile is one extension that supports GNOME Shell 50 and 51 at the same time, not one build
or branch per release. The same code must work on both, so `shell-version` in the extension
metadata lists both.

## Consequences

- Every change is checked against both versions before it counts as done.
- Anything that differs between 50 and 51 has to be handled inside the one code base.
