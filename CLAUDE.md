## Dev environment

The dev environment is a VM running Arch Linux with CLI only (no desktop, no GUI). The Head of Dev works from the host PC exclusively through an SSH terminal, so they have no access to screenshots, images, or direct file access for verification.

- Report results as terminal-readable text: command output, diffs, test results, file paths plus relevant excerpts.
- Don't rely on screenshots, rendered images, or opening files in a GUI/browser as proof. Verify with CLI-checkable means (tests, `curl`, logs, text snapshots) and show that output.
- Anything the Head of Dev needs to review must be viewable in the terminal (`cat`, `less`, `git diff`) or in the issue tracker, not only as a file on the VM.

## Reference material

- `reference/` holds a window memory module. It is not built, linted or run. Its decision part
  (no GNOME imports) is adapted into `src/` in plain JavaScript; its glue is written fresh (see
  `docs/adr/0007-window-memory-per-application-with-switch-and-clear-button.md`).
  SnapTile's licence is GPL-3.0-or-later (see `docs/adr/0005-licence-gpl-3-or-later.md`).
- `rev_Screenshots/` (formerly `Screenshoots_Magnet/`) holds screenshots of the macOS app Magnet, showing the snap behaviour
  SnapTile should have (preview frame while dragging a window, then the window snaps to it).
  They illustrate the target look; how areas are triggered is not decided and is a separate
  ticket.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Smoke test time budget

The smoke test (`tests/smoke/run.sh`, both GNOME versions in parallel) may take at most as many
seconds as it has checks: 193 checks, 193 seconds. A new check adds one second at most; if the
run gets slower than that, speed up other checks instead of raising the budget. The test checks
this itself and prints how long each check took. Wait for a state (a window shown, a window
gone) instead of a fixed pause wherever possible.
