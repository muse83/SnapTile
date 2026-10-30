# SnapTile

A GNOME Shell extension that snaps windows to fixed screen areas, modelled on the macOS app
[Magnet](https://magnet.crowdcafe.com/). Drag a window to a screen edge or corner, a preview
frame shows where it will go, and on release the window snaps there.

## Features

- **14 Tiles**: four quarters, four halves (top, bottom, left, right), three thirds, two
  two-thirds and the whole screen.
- **Edge zones on every monitor**: each monitor has all its zones on its own, whether you have
  one monitor or five.
- **Merged thirds**: drag along the bottom edge from one third into the next to get two thirds.
- **Keyboard shortcuts for the thirds**: Ctrl+Left, Ctrl+Down and Ctrl+Right snap the focused
  window into the left, middle or right third, also a maximised window or one that GNOME put
  into a half with Super+Left/Right. On by default; switch them off in the extension's
  preferences if you need Ctrl+Left and Ctrl+Right for jumping by word in your applications.
  Other keys can be set with gsettings (`tile-left-third`, `tile-middle-third`,
  `tile-right-third`).
- **Window memory**: an application's next window reopens where the last one was (size,
  position, Tile or maximised, and the monitor). A second window opens slightly offset from the
  first. Dialogs are left alone. Switch it off or clear it in the extension's preferences.
- **Window look**: rounded corners, a small margin around every window and no shadow, for tiled
  and floating windows alike.

## Requirements

- GNOME Shell 50 or 51.
- **Switch off GNOME's own edge tiling** (Settings > Multitasking > Edge tiling, or
  `gsettings set org.gnome.mutter edge-tiling false`). SnapTile replaces it and shows a
  notification if it is still on.

## Install

From [extensions.gnome.org](https://extensions.gnome.org/) (once published), or from source:

```sh
./scripts/pack.sh   # needs Docker and the snaptile-dev images, see docs/adr/0002
gnome-extensions install --force dist/snaptile@muse83.shell-extension.zip
```

Log out and back in (Wayland), then enable SnapTile in the Extensions app.

## Development

- `npm test` runs the unit tests of the pure logic.
- `tests/smoke/run.sh` starts a headless GNOME Shell 50 and 51 in Docker and checks the
  extension. `SMOKE_ZIP=dist/snaptile@muse83.shell-extension.zip tests/smoke/run.sh` tests the
  release zip instead of `src/`.
- Terms are defined in [CONTEXT.md](CONTEXT.md); decisions are recorded in
  [docs/adr/](docs/adr/).

## Licence

GPL-3.0-or-later, see [LICENSE](LICENSE).
