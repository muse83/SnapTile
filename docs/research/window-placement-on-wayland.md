# Placing a new window on Wayland: when, how visible, and which windows are dialogs

Date: 2026-10-24. Issue: research ticket for the window memory (spec: issue #8, ADR 0007).
Method: everything here was run in the headless GNOME Shell of the dev stack, GNOME Shell 50.4
(`gnome50`) and 51.1 (`gnome51`). Nothing is taken from source code. The raw terminal output is
in `docs/research/window-placement-output/gnome50.txt` and `gnome51.txt` (one full run each,
plus the two-monitor run and the GTK-backend chooser run).

Reproduce: `tests/research/placement/run.sh [gnome50|gnome51] [hooks early place noanim snap dialogs second]`.
A research-only extension (`tests/research/placement/placement-probe@snaptile.test`, never
shipped) logs every moment of a new window's life (signal, what the shell knows then, every
painted frame) and can place the window at a chosen moment. `client.py` is the stand-in
application (GTK 4.22 on 50, 4.24 on 51).

## Result in short

1. **Place the window at the shell's `map` signal.** That is the first moment where both the
   title/application id are known *and* a position request is kept. Placing at `map` shows no
   visible jump in these measurements.
2. **Placing earlier does not work for the position.** At window creation the window is still
   0x0 at 0,0. A requested size is kept, a requested position is lost: Mutter centres the
   window itself when it first places it, about 42 ms later.
3. **Dialogs are recognisable when they have a parent, not always when they do not.** In-process
   dialogs and the file chooser portal (with the real Nautilus chooser) are the window type
   "modal dialog" and, when given a parent, transient for it. The one exception found: the
   Nautilus file chooser opened *without a parent window* shows up as a plain normal window of
   the application `org.gnome.Nautilus`, with the same type, class and size as a real file-manager
   window. **It can still be told apart** by one property: file-manager windows carry a GTK window
   object path (`/org/gnome/Nautilus/window/1`, `/2`, ...), the chooser has none (section 2).
4. **GNOME's own placement of a second window** is a 50 px diagonal cascade from the centred
   slot when that slot is taken. It is not an offset from the open window.
5. **A remembered Tile works through the drag's own snap path** when called at `map` (also with
   a window whose minimum size is larger than the Tile). One detail needs changing, see below.
6. A window that asks to be **maximised at start** is already maximised at `map` and ignores a
   plain placement. It only ends at the remembered place if it is un-maximised first *and* the
   place is applied after the un-maximise has been answered (section 5).
7. A window that goes **full screen later** looks normal at `map`; placing it did not interfere.
8. Placing onto a **second monitor** works the same way (section 5).
9. GNOME 50 and 51 behave the same in every measurement that ran on both. The only difference:
   the GTK-backend file chooser could only be run on 50 (it aborts in the 51 container).

## 1. The earliest moment a new window can be placed

What happens to one new window, in order (`ms` since the shell created the window object;
GNOME 50, no placement; GNOME 51 is identical).
Times are from a typical run and vary by 1-3 ms between runs; exact values are in the raw
output files:

```
+  0ms window-created   title=None app=None class=None  type=0 frame=[0,0,0,0]
+  0ms notify::title    title='main'
+  0ms notify::wm-class                          class='org.snaptile.Research'
+  0ms notify::gtk-application-id  app='org.snaptile.Research'
+ 42ms position-changed frame=[440,226,400,300]          <- Mutter placed it (centred)
+ 42ms size-changed     frame=[440,226,400,300]
+ 42ms map              frame=[440,226,400,300] actor opacity=0
+ 43ms first-frame      opacity=0
+ 59ms (next painted frame) opacity=255
```

- Title, application id and window class arrive **before** the window has a size or place
  (same millisecond as creation). So the memory can already look the application up then.
- Asking for a place before Mutter placed the window, at creation or at the title or application
  id notification (tried, GNOME 50 and 51): `move_resize_frame(200,150,700,450)` ends at
  `[290,151,700,450]` (size kept, position replaced by the centred one), `move_frame` alone has
  no effect at all (stays `[440,226,400,300]`). The same with the drag's snap path: the Tile
  `left` requested at creation ended at `[320,32,640,688]` instead of `[0,32,640,688]`.
- Asking at `map` or at `first-frame` (both tried): the next painted frame has
  `frame=[200,150,700,450]`. Both moments gave the same end result; `map` is the earlier one.
- What `get_frame_rect()` reports right after the call depends on the call: a move alone shows
  the new position at once (`[200,150,400,300]`); a call that also changes the size still
  reports the old rectangle (`[440,226,400,300]`), the new size arrives with the client's
  answer. The snap path with a window that has a minimum size showed `[0,32,700,500]` right
  after the call (position and the minimum width taken, height still to come). So the glue must
  not read the rectangle back as proof; the `size-changed`/`position-changed` signals tell when
  the final size arrived (the Tile anchoring rule in ADR 0006 already works that way).

### How large and how visible is the jump

Measured per painted frame (`frame` = frame rectangle, `opacity` = the window actor's). The
times are typical, not quoted from one run (the animation-on and animation-off runs differ by a
few ms; see the raw files):

```
no placement:        +44ms frame=[440,226,400,300] opacity=0
                     +60ms frame=[440,226,400,300] opacity=255
placed at map:       +43ms frame=[440,226,400,300] opacity=0     <- old place, but invisible
                     +58ms frame=[200,150,700,450] opacity=255   <- first visible frame, already placed
placed at first-frame: same two frames
```

- In these measurements the window is drawn at its old place only while its opacity is 0, so
  it should not be seen there. This rests on the actor's opacity and on 16 ms frame steps in a
  headless shell; no pixels of the old place were checked. Read "no visible jump" as "none
  found", not as proven for a real desktop.
  The first frame with opacity above 0 is already at the target, in size and position, for a
  move alone (400x300 stays) and for move plus resize (400x300 to 700x450).
- This was the same with the shell's animations switched on and off (`enable-animations`).
  In this headless shell the fade-in is one step (0 to 255 in one frame, 15-20 ms); I did not
  see the longer fade a real desktop may show, so on a real desktop it can only be less visible,
  not more. **[U]** not checked on a real desktop.
- The test application is a fast GTK client: its new size was in the buffer by the first
  visible frame (`buffer=[186,138,728,479]` for a 700x450 frame, the extra is the client
  shadow). A slow application that answers the size request late could show its old size for
  a moment inside the new place. **[U]** not measured; one client only.
- Not measured: several monitors, fractional scaling, a window that asks for full screen or
  maximised by itself at start.

**What the placement glue should do:** hook the shell's `map` signal (or the window actor's
`first-frame`), look up the application there (title, application id and class are all known),
filter out dialogs, and call `move_resize_frame` once. It must not try earlier, and must not
hide the window (ADR 0007 already says so; nothing here argues against it).

## 2. Which windows are dialogs

Window type numbers are Meta's: 0 normal, 3 dialog, 4 modal dialog. "parent" is
`get_transient_for()`. What the shell knows at `map` (identical on 50 and 51 except the
GTK-backend row):

| Window | type | parent | application id / class |
|---|---|---|---|
| main window of the application | 0 | none | id and class = application id |
| non-modal transient window (`transient_for`) | 0 | main window | class `python3`, no id |
| modal `Gtk.Window` with parent | 4 | main window | class `python3`, no id |
| modal `Gtk.Window` without parent | 4 | none | class `python3`, no id |
| `Gtk.AlertDialog` (message box) | 4 | main window | class `python3`, no id; cannot be resized |
| `Gtk.AboutDialog` | 4 | main window | class `python3`, no id; cannot be resized |
| built-in GTK file chooser dialog | 4 | main window | class `python3`, no id |
| file chooser portal, **Nautilus** (GNOME's choice), parent given | 4 | main window **of the other application** | class `org.gnome.Nautilus`, no id |
| file chooser portal, Nautilus, **no parent** | **0** | **none** | id and class `org.gnome.Nautilus` |
| a real Nautilus file-manager window (for comparison) | **0** | none | id and class `org.gnome.Nautilus`, same default size 890x550 as the chooser |
| file chooser portal, GTK backend, with and without parent (GNOME 50 only) | 4 | main window / none | class `xdg-desktop-portal-gtk` |
| main window that cannot be resized | 0 | none | `allows_resize()` is false |

- **A rule "type is modal dialog, or it has a parent" catches every dialog row above except
  the parentless Nautilus chooser:** the non-modal transient window has type 0 but a parent;
  the parentless modal window has type 4.
- The cross-application case works: the chooser Nautilus opens for another application is
  transient for that application's window (presumably linked through the window handle the
  portal passes on; I only observed the result).
  The chooser's own class (`org.gnome.Nautilus`) differs from the main window's, so it is not
  mistaken for the main window of the other application.
- Dialogs of the same application are not identified by its application id: they have none
  and a different class (the program name). That agrees with ADR 0007 (key: application id,
  otherwise class), and it means a dialog must be excluded by type/parent, not by application.
- A window that cannot be resized shows `allows_resize()` false at `map`. A window that goes
  full screen later was not checked (the log shows only the state at `map`, where it is not yet
  full screen), so whether it must also be watched after `map` is open.

### Telling the parentless Nautilus chooser from a file-manager window

Every property the shell holds for the two windows was compared (34 values each, GNOME 50 and
51, `tests/research/placement/session.sh props`). Apart from values that differ for any two
windows (title, last user action time, internal handles, accessibility path), exactly one
differs in substance:

| | file-manager window | parentless chooser |
|---|---|---|
| GTK window object path (`gtk-window-object-path`) | `/org/gnome/Nautilus/window/1`, `/window/2` for the next | none |

GTK gives this path to windows that are application windows (`GtkApplicationWindow`); the
chooser is a plain window of the same application. It is known in the same millisecond as the
application id, before the window is placed or shown (checked at the application-id
notification and at `map`, GNOME 50 and 51, with two file-manager windows open and then the
chooser). So the memory can use "application `org.gnome.Nautilus`, no window path" as an
exception for the chooser while ordinary Nautilus windows are remembered as any other.

Limits: only the chooser was examined. Other Nautilus windows that are not application windows
(for example a properties window, which normally has a parent) were not. The path is a GTK
feature, so the rule is specific to GTK applications; a general version ("application id set but
no window path") would also catch other windows of that kind, but I did not measure how many
real main windows of other applications are plain windows without a path.

### The earlier finding, before this comparison

ADR 0007 and the spec say dialogs, "for example the file chooser a file manager opens", are
left alone completely. Found: **the Nautilus file chooser is a modal dialog only when its
requester gives a parent window.** Opened without a parent it is a normal window of the
application `org.gnome.Nautilus` (title set by the requester): type 0, no parent, application id
and class `org.gnome.Nautilus`, resizable and movable. A real Nautilus file-manager window
was captured next to it: the same fields, even the same default size. So by type, parent, class
and size flags the two cannot be told apart; the GTK window path above can. Without such a rule
the memory would treat the chooser as a Nautilus window, store its size and place as
Nautilus's, and place it where the file manager's last window was. **[U]** that consequence is
inferred, not run. How often a requester gives no parent window is unknown.

On GNOME 51 the GTK-backend chooser could not be tested: the GTK portal process aborts in the
container (`image-missing.svg: Unrecognized image file format`, no SVG loader in that image).
The Nautilus chooser, which is what GNOME uses, ran on both versions.

## 3. GNOME's own placement of a second window (informational)

Three windows of one application, GNOME 50 (51 identical), default placement:

```
main   [440,226,400,300]   centred
second [490,276,400,300]   +50,+50
third  [540,326,400,300]   +50,+50 again
```

With the first window moved by the extension to `[50,60,500,400]` before the second opens:

```
second [440,226,400,300]   centred again: the centred slot was free
third  [490,276,400,300]   +50,+50 because the centred slot was taken
```

GNOME cascades by 50 px from the centred slot and does not look at where the open window is,
so it cannot give "next to the open window, about 1 cm offset". This supports ADR 0007's
decision to do the offset itself. No finding contradicts it.

## 4. A remembered Tile through the drag's own path

The extension's real `DragSnap._snap` (the function a drag drop calls), called at each moment
with the Tile `left` and the rectangle `[0,32,640,688]`:

| Called at | Window | End result | Record in the shared tiled-window record |
|---|---|---|---|
| creation | no minimum | `[320,32,640,688]` (wrong, position lost) | size before = **0x0** |
| `map` / `first-frame` | no minimum | `[0,32,640,688]` | size before = 400x300 (the application's default) |
| `map` | minimum 700x500 | `[0,32,700,688]` (anchored at the Tile's top left, as ADR 0006 says) | size before = 700x500 |
| creation | minimum 700x500 | `[0,32,700,688]` (the anchoring rule moved it to the Tile's corner, so position is right here by that rule, not because the early call kept it) | size before = 0x0 |

- It works at `map`, including the anchoring rule, and the first visible frame was already at
  the end result.
- **This is in tension with the spec** ("placed using the same snapping path the drag uses,
  including remembering the size before tiling" and "an unknown free size is never invented"):
  the snap path records "the window's current size" as the size before tiling. For a window
  opened into a remembered Tile that is the application's own default size (or 0x0 if called
  too early), which invents a free size. The snap path needs to take the remembered earlier
  size (or "none") from the caller. This does not affect the free-window ticket.

## 5. Windows that restore themselves, and several monitors

Both from the full runs on GNOME 50 and 51 (identical on both). Target for all placements:
`[200,150,700,450]`, applied at `map`.

**Full screen later** (the client asks for full screen 3 s after it opened): at `map` the window
reports "not full screen"; 5 s after start it is full screen (`[0,0,1280,720]`). Placing it
at `map` (plain, with un-maximise, or through the snap path) changed nothing: full screen won in
every case. So the check "is it full screen" has to be repeated after `map` (for example on the
shell's full-screen change), not done once.

**Maximised at start** (the client asks to be maximised before it is shown): at `map` it is
already maximised (`max=True`, frame `[0,32,1280,688]`, not resizable while maximised). State
5 s after start:

| Placement at `map` | End state |
|---|---|
| none | maximised, `[0,32,1280,688]` |
| `move_resize_frame` | **still maximised**, the call is ignored |
| un-maximise, then `move_resize_frame` at once | un-maximised, but `[0,0,400,300]` (the application's default size at the top left): the place is lost |
| the drag's snap path (it un-maximises first, then places) | un-maximised, `[0,0,400,300]`: the Tile is lost too |
| un-maximise, wait for the first `size-changed`, then `move_resize_frame` | `[200,150,700,450]`, as wanted |

So "SnapTile's place wins against an application's own restoring" (spec) is possible, but not by
one call: un-maximise, wait until the window reports its new size, then place. The snap path
as it stands does not do that waiting and loses the Tile on such a window. Whether the
intermediate maximised frame is visible was not measured (the window is at opacity 0 at `map`;
same caveat as in section 1).

**Two monitors** (1280x720 and 1024x768 side by side, work areas `[0,32,1280,688]` and
`[1280,0,1024,768]`): an unplaced window opens on the first monitor (`monitor 0`, centred).
Placed at `map` onto the second (`[1400,100,700,450]`), the first visible frame is already
there and the window reports `monitor 1`. Not tested: monitor removal and fitting (a later
ticket), differing scale factors.

## Findings that change or confirm the spec

- Confirms: the offset for a second window must be done by SnapTile; dialogs keep a different
  class and no application id; SnapTile can place a window without hiding it.
- Refines: "as early as Mutter allows" is the `map` signal; earlier calls lose the position.
- Contradicts: the Nautilus file chooser without a parent window is not recognisable as a
  dialog by type or parent (section 2). It is recognisable by its missing GTK window path, so
  a narrow exception for exactly this window is possible and ordinary Nautilus windows can
  stay remembered. Decision for the maintainer: use that exception.
- Contradicts (in part): reusing the snap path unchanged would invent a size before tiling
  from the application's default; it must accept the remembered size or none (section 4).
- Refines: "SnapTile's place wins against an application's own restoring" holds for a window that
  maximises itself at start only with un-maximise, wait for the size change, then place; and a
  window that goes full screen later still wins against SnapTile (section 5).

## What I did not check

- A real desktop (longer fade-in, real monitors, scaling), monitor removal and fitting, X11
  (out of scope).
- Applications other than a small GTK 4 test client (Electron, Qt, Firefox and others may
  answer the size request later or ask for maximised/full screen in other ways).
- The GTK-backend file chooser on GNOME 51 (aborts in the container image). The Nautilus chooser,
  which GNOME uses, ran on both.
- Whether the maximised frame before an un-maximise is ever visible on screen.
