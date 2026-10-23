## Dev environment

The dev environment is a VM running Arch Linux with CLI only (no desktop, no GUI). The Head of Dev works from the host PC exclusively through an SSH terminal, so they have no access to screenshots, images, or direct file access for verification.

- Report results as terminal-readable text: command output, diffs, test results, file paths plus relevant excerpts.
- Don't rely on screenshots, rendered images, or opening files in a GUI/browser as proof. Verify with CLI-checkable means (tests, `curl`, logs, text snapshots) and show that output.
- Anything the Head of Dev needs to review must be viewable in the terminal (`cat`, `less`, `git diff`) or in the issue tracker, not only as a file on the VM.

## Reference material

- `reference/` holds a window memory module. It is not built, linted or run.
- `Screenshoots_Magnet/` holds screenshots of the macOS app Magnet, showing the snap behaviour
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
