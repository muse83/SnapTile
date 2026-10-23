#!/bin/sh
set -e
mkdir -p /run/dbus
rm -f /run/dbus/pid
dbus-daemon --system --fork
python3 -m dbusmock --system -t logind >/tmp/logind-mock.log 2>&1 &
sleep 1
exec runuser -u dev -- "$@"
