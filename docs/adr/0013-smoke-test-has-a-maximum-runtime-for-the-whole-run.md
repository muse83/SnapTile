# The smoke test has a maximum runtime for the whole run

Status: accepted (2026-10-25, maintainer decision). Applies to the smoke test described in
ADR 0002 and extended by every ticket since.

## Decisions

- **The whole run has a maximum runtime**, set as `MAX_RUNTIME` at the top of
  `tests/smoke/session.sh`: 193 seconds now, for 193 checks. The run fails when it takes longer.
  Every new check raises the maximum by one second and by no more. If the run is still too
  slow, other checks are sped up; the maximum is never raised further.
- **A single check has no limit of its own.** A check may take longer than a second. Each check
  prints how long it took, counted from the end of the check before it, so that slow spots can
  be found.
- **No fixed pauses where a state can be waited for.** A window is waited for until it is shown
  and its frame stopped changing; a closed window until it is gone; the extension until it has
  the state. A fixed pause is used only where there is nothing to wait for (a pointer event
  settling), found by running without it and adding 0.1 s steps, plus 0.2 s of buffer.
- **The two GNOME versions run at the same time**, each in its own container; their output is
  printed one after the other.

## Consequences

- A run took about 8 minutes per version, one after the other, with fixed pauses. It takes about
  168 seconds for both versions together now (measured 2026-10-25), 25 seconds under the maximum.
- The slowest spots left: the screenshots of the Window look (about 37 s), the restart of the shell
  for the one-monitor case (about 30 s) and starting the test application (2 to 4 s each).
- On GNOME 51 the shell can undo an enable shortly after a disable. The test's reload therefore
  looks again after a moment and retries. This is a property of the test setup, not of the
  extension.
- Two runs in parallel share one machine; a slow machine can make timing-sensitive checks fail.
  The waits for states make this less likely but cannot rule it out.
