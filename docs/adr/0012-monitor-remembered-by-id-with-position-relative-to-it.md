# The monitor is remembered by its id, the position relative to it

Status: accepted (2026-10-25). Builds on ADR 0007 ("Monitors") and refines ADR 0010; ticket
"Window memory with several monitors and a vanished monitor" (spec: issue #8).

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

## Considered Options

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
- Mutter's answer arrives asynchronously. A place saved before the first answer (or in the
  instant after the monitors changed) carries no id or the previous arrangement's id and is
  then placed by its absolute position. Not guarded.
  Such a save also replaces an earlier entry that had a good monitor with one that has none
  (found in the review of this ticket). Not guarded; a candidate for a follow-up ticket.
- If the nearest monitor has no id while others do, no monitor is remembered for that save, and
  the window is later placed by its absolute position.
- The relative position is kept as a distance from the work area's top left. If the work area
  of that monitor changed size (a dock moved), the result is fitted back inside, so a window
  does not stay at the same distance from the bottom or right edge.
- Moving the monitors around is covered by plain Node tests only; the smoke test covers two
  monitors and then one, with virtual monitors that have ids like real ones.
- Verified on GNOME 50 and 51 (smoke test, 193 checks each). The smoke test's reload helper now
  waits for each state, because on GNOME 51 an enable right after a disable was undone by the
  shell; this was a problem of the test, not of the extension.
