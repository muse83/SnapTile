#!/bin/bash
# Smoke test on GNOME 50 and 51. Run from the host: tests/smoke/run.sh [gnome50|gnome51]
cd "$(dirname "$0")/../.." || exit 1
services=("$@")
[ $# -eq 0 ] && services=(gnome50 gnome51)
status=0
docker compose up -d "${services[@]}" >/dev/null 2>&1
for s in "${services[@]}"; do
    echo "=== $s ==="
    docker compose exec -T -u dev "$s" bash /workspace/tests/smoke/in-container.sh || status=1
done
exit $status
