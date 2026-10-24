#!/bin/bash
# Placement research on GNOME 50 and 51. Run from the host: tests/research/placement/run.sh [gnome50|gnome51] [experiment...]
cd "$(dirname "$0")/../../.." || exit 1
services=()
experiments=()
for arg in "$@"; do
    case $arg in gnome50|gnome51) services+=("$arg");; *) experiments+=("$arg");; esac
done
[ ${#services[@]} -eq 0 ] && services=(gnome50 gnome51)
docker compose up -d "${services[@]}" >/dev/null 2>&1
status=0
for s in "${services[@]}"; do
    echo "=== $s ==="
    docker compose exec -T -u dev -e PORTAL_CHOOSER="${PORTAL_CHOOSER:-gnome}" -e DIALOG_MODES="${DIALOG_MODES:-}" -e NAUTILUS_SERVICE="${NAUTILUS_SERVICE:-1}" "$s" bash /workspace/tests/research/placement/in-container.sh "${experiments[@]}" || status=1
done
exit $status
