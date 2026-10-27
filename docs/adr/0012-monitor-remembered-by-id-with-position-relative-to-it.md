# The monitor is remembered by its id, the position relative to it

Status: accepted (2026-10-25), extended 2026-10-27 by the ticket "Window memory keeps a remembered
monitor when a save cannot name the monitor" (see "A save that cannot name the monitor"). Builds
on ADR 0007 ("Monitors") and refines ADR 0010; ticket "Window memory with several monitors and a
vanished monitor" (spec: issue #8).

## Decisions

- **What is stored besides the frame.** The id of the monitor the window was on and, for a free
  window, its position relative to that monitor's work area. A tiled or maximised window stores
  the monitor id only (a Tile is worked out from the work area, ADR 0010). The frame stays in
  every entry as the last absolute position, the fallback when the monitor is gone.
- **The id is Mutter's own way to tell monitors apart:** connector, vendor, product and serial
  as one text. It is read from the same D-Bus answer that gives the monitor sizes. A monitor
  moved to another port therefore counts as a new monitor; that is the safe direction, because
  the fallback then still finds a sensible monitor.
- **A window reopens on its monitor, found by id, wherever that monitor sits now.** Free windows
  take the work area's top left plus the stored relative position, then are shrunk and moved
  back inside as before. Tiles apply to that monitor's work area, maximising goes to that
  monitor.
- **Monitor not connected, or no id known:** the work area nearest to the centre of the stored
  absolute frame takes the window, as in ADR 0010, and size and position are fitted to it. This
  covers the laptop without its dock, and also entries written before this ticket.
- **The monitor is chosen at save time from the frame**, the work area nearest to its centre.
  For a Tile this is the Tile's own rectangle, so a drop is saved on the right monitor before
  the window reports its new frame.
- **Corrupt data.** A monitor that is not text or is empty, or a relative position without a
  monitor or with bad numbers, drops that whole entry; good neighbours stay.
- **The decision module takes the monitors as a list of {id, work area}**, the same shape the
  second-window placement already used, instead of a bare list of work areas.

## A save that cannot name the monitor

Mutter's answer about the monitors arrives asynchronously: not yet right after SnapTile starts,
and not yet in the moment after the monitors were plugged or unplugged. Two rules keep a save
from storing a wrong monitor or from throwing a right one away.

- **A save waits for the answer.** While a question to Mutter is open (at the start and after
  every change of the monitors), the names are treated as unknown, because the answer held
  describes the arrangement before. A save made then (the user lets go of a window, a window
  closes) is held back and carried out when the last open question is answered, in the order it
  was made, with the monitors as they are then. The state to save is taken at once, so a window
  that closes meanwhile is not lost. If the question fails, the names stay unknown and the held
  saves are carried out anyway. When the extension is switched off first, the held saves are
  carried out at once without names. The clear button drops them, so they cannot bring back
  what was cleared.
- **A save without a name keeps the monitor remembered before, if the window is still on it.**
  This applies to what cannot wait (the held saves at switch-off, a failed question) and to
  monitors that have no name. "Still on that monitor" is worked out from the work areas as
  they are now, which are known even when the names are not:
  - if the remembered monitor is in the list by name, the window is on another one (the
    nearest monitor has no name), so nothing is kept;
  - otherwise it is kept when the old frame and the new frame are nearest to the same work
    area; a window that clearly moved to another monitor keeps nothing;
  - with no monitor information at all, nothing says the window left, so the monitor is kept;
  - a kept monitor of a free window gets the position relative to the work area now nearest;
    without any work area it gets none, and the window then reopens at its absolute position
    on that monitor.
  A save without a name for an application that never had a monitor stores none, and a save
  with a name behaves as before.

## Considered Options

- Using the answer from before while the monitors are being reconfigured. Rejected: it names the
  monitor by its position, and after a change another monitor can sit at that position.
- Keeping the remembered monitor without asking where the window is. Rejected: a window dragged
  to another monitor would be left with the old one.
- Storing the monitor's index. Rejected: indexes change when monitors are plugged or
  unplugged (already rejected in ADR 0010).
- Storing only the connector. Rejected: the same screen on another port of a dock would not be
  recognised; vendor, product and serial are what Mutter itself uses to remember a monitor.
- Storing the relative position for tiled windows too. Rejected: no free position of a tiled
  window is ever stored (ADR 0007).

## Consequences

- Entries without a monitor still work and behave as before.
- Two identical monitors on the same connector cannot exist, so the id is unique within a
  session. Two monitors that swap connectors count as two new monitors.
- Mutter's answer arrives asynchronously. A save before the first answer, or in the instant
  after the monitors changed, waits for it and then stores the right monitor (see "A save that
  cannot name the monitor"). This replaces the earlier known limit, where such a save stored no
  or a wrong monitor and could replace a good one.
- Placing a new window in that same moment still goes by the absolute position, because the
  names are not known yet. Not guarded.
- If the nearest monitor has no id while others do and nothing is remembered before, no monitor
  is stored for that save, and the window is later placed by its absolute position.
- A kept monitor can be wrong in one case: the names are missing, the monitors were rearranged
  since the last save, and old and new frame happen to lie on the same work area now. The waiting
  makes this reachable only for what cannot wait (switch-off, a failed question).
- The relative position is kept as a distance from the work area's top left. If the work area
  of that monitor changed size (a dock moved), the result is fitted back inside, so a window
  does not stay at the same distance from the bottom or right edge.
- Moving the monitors around is covered by plain Node tests only; the smoke test covers two
  monitors and then one, with virtual monitors that have ids like real ones.
- Verified on GNOME 50 and 51 (smoke test, 193 checks each). The smoke test's reload helper now
  waits for each state, because on GNOME 51 an enable right after a disable was undone by the
  shell; this was a problem of the test, not of the extension. The follow-up ticket adds three
  checks (196) and passed on both versions in 168 s.
