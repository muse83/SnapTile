# Releasing SnapTile on extensions.gnome.org

## Each release

1. `npm test` and `tests/smoke/run.sh` pass on GNOME 50 and 51.
2. `./scripts/pack.sh` builds `dist/snaptile@muse83.shell-extension.zip`. The script fails if
   the zip holds a compiled schema (the review guidelines forbid it).
3. `SMOKE_ZIP=dist/snaptile@muse83.shell-extension.zip tests/smoke/run.sh` passes: the zip
   itself, not `src/`, loads and works.
4. Tag the commit that was packed (`git tag v1.0.0`) and push the tag.
5. Upload the zip at https://extensions.gnome.org/upload/ (needs the maintainer's account; a
   human does this step). The site assigns the integer `version` itself; `version-name` in
   `src/metadata.json` is the human-readable one.

## First release only

- The repo must be public before the upload: `metadata.json` links to it and reviewers read
  the source from the zip against it.
- The `uuid` is fixed for good once uploaded.
- Review is by volunteers and can take days to weeks. Expect questions on the parts below.

## What reviewers will look at

- **Window look on every window**: a shader effect on all application windows (ADR 0004).
  Cleaned up in `disable()`; the smoke test checks that no connection or timer is left.
- **Mutter D-Bus call**: `GetCurrentState` on the session bus to learn monitor sizes and ids.
  Read-only, no other bus calls.
- **Notification**: shown while GNOME's own edge tiling is on. No other notifications.
- **No subprocesses, no network, no files outside the extension's settings.**
- **Licence**: GPL-3.0-or-later, SPDX header in every source file.
