#!/bin/bash
# Smoke test on GNOME 50 and 51. Run from the host: tests/smoke/run.sh [gnome50|gnome51]
# The versions run at the same time, each in its own container; their output is printed one
# after the other when both are done.
cd "$(dirname "$0")/../.." || exit 1
services=("$@")
[ $# -eq 0 ] && services=(gnome50 gnome51)
docker compose up -d "${services[@]}" >/dev/null 2>&1
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
for s in "${services[@]}"; do
    docker compose exec -T -u dev "$s" bash /workspace/tests/smoke/in-container.sh >"$out/$s" 2>&1 &
done
status=0
for s in "${services[@]}"; do
    wait -n || status=1 # any order; the exit codes are only summed up here
done
for s in "${services[@]}"; do
    echo "=== $s ==="
    cat "$out/$s"
    grep -q "RESULT: all checks passed" "$out/$s" || status=1
done
exit $status
