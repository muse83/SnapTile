# Ctrl+Left, Ctrl+Down and Ctrl+Right snap the focused window into a third

Status: accepted (2026-10-29, maintainer decision)

Three global keyboard shortcuts snap the focused window into a third of the monitor it is on:
Ctrl+Left the left third, Ctrl+Down the middle third, Ctrl+Right the right third. They use the
same path as a drop (same Tile rectangle, same size kept from before tiling, same anchoring),
so a window tiled by key behaves exactly like one tiled by drag. A window that cannot be tiled
(dialogs, full-screen windows) is left alone. They work in the normal desktop, not in the
overview or on the lock screen.

The shortcuts are on by default and have a switch in the extension's preferences (settings key
`thirds-shortcuts`); switching it off hands the keys back to the applications at once, without
restarting the extension. The keys are in the settings schema (`tile-left-third`, `tile-middle-third`,
`tile-right-third`), so they can be changed or switched off (empty list) with gsettings or dconf.

Checked on 2026-10-29: GNOME's window shortcuts use Ctrl+arrow only together with Alt
(workspace switching), so these three were free.

## Consequences

- Many applications use Ctrl+Left and Ctrl+Right to jump word by word in text. A global
  shortcut takes the key away from them while the shortcuts are on. The maintainer accepted
  this and chose the preferences switch as the answer: every user decides for themselves. The
  switch's text in the preferences says which applications are affected. Whoever wants the
  shortcuts but other keys changes them with gsettings or dconf.
- Alternatives considered and rejected by the maintainer: Super+Ctrl+Arrow (free, but more
  keys to press) and Ctrl+Alt+Arrow (taken by GNOME's workspace switching).
- Two arrows together (Ctrl+Left+Down) cannot be a GNOME shortcut, so no corner Tiles by key
  for now.
