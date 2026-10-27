#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 muse83
#
# Builds the zip for extensions.gnome.org into dist/, with the official `gnome-extensions pack`
# from the GNOME 51 dev image (the dev VM has no GNOME). Run from anywhere: ./scripts/pack.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
image=snaptile-dev:gnome51
mkdir -p "$root/dist"

# pack only takes extension.js, prefs.js, metadata.json and the schema by itself: every other
# module has to be named, or the extension fails to load.
extras=()
for f in "$root"/src/*.js; do
    case "$(basename "$f")" in
        extension.js|prefs.js) ;;
        *) extras+=(--extra-source="$(basename "$f")") ;;
    esac
done

docker run --rm --entrypoint bash -u "$(id -u):$(id -g)" \
    -v "$root/src:/src:ro" -v "$root/dist:/out" "$image" \
    -c 'gnome-extensions pack /src --out-dir /out --force "$@"' _ "${extras[@]}"

zip="$(ls "$root"/dist/*.shell-extension.zip)"
echo "Built $zip"
python3 -I - "$zip" <<'PY'
import sys, zipfile
names = sorted(zipfile.ZipFile(sys.argv[1]).namelist())
print("\n".join(names))
# The review guidelines forbid compiled schemas in the zip (extensions.gnome.org builds them).
if any(n.endswith("gschemas.compiled") for n in names):
    sys.exit("error: the zip contains gschemas.compiled")
PY
