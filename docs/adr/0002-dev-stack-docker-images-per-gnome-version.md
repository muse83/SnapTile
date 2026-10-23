# Dev stack: one Docker image per GNOME version, Arch-based

Status: accepted (2026-10-23, maintainer decision)

The development VM is Arch Linux with CLI only and has no GNOME installed. To run and check the
extension against a real GNOME Shell, the stack is two Docker images started with
`docker compose`: `gnome50` and `gnome51`. Arch-based images were wanted (ideally CachyOS).

- `gnome51`: CachyOS image, rolling (GNOME Shell 51.1 when built).
- `gnome50`: plain Arch image pinned to the Arch Linux Archive snapshot of 2026-09-14
  (GNOME Shell 50.4), the last day before 51 landed in Arch.

## Considered Options

- Fedora images (44 ships GNOME 50, 45 ships 51): easy to pin, but not Arch-based. Rejected.
- CachyOS for both: not possible. Arch and CachyOS only ship the newest GNOME, and the CachyOS
  package repository has no dated snapshots to pin an older version.

## Consequences

- `gnome50` is plain Arch, not CachyOS. Behaviour that differs between the two distributions
  is not covered.
- A headless GNOME Shell runs in the container (no screen needed). There is no systemd in the
  container, so the entrypoint starts a system D-Bus and a mock of `logind`, which the shell
  requires. The calendar service of the shell is not installed and logs a harmless error.
- The project folder is mounted at `/workspace`; work as the `dev` user.
- The archive server is slow; image builds disable pacman's download timeout.
- Each image is about 4-5 GB. Build only when needed.
