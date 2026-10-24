"""Prints the properties on which two describe() results differ (the files hold gdbus Eval output)."""
import json
import sys


def load(path):
    text = open(path).read().strip()
    if text.startswith('"'):
        text = text[1:-1]
    return json.loads(text.replace('\\\\"', '"'))


a, b = load(sys.argv[1]), load(sys.argv[2])
print(f"  {len(a)} values for the file-manager window, {len(b)} for the chooser")
same = 0
for key in sorted(set(a) | set(b)):
    if a.get(key) == b.get(key):
        same += 1
    else:
        print(f"  DIFFERS {key}: window={a.get(key)!r} chooser={b.get(key)!r}")
print(f"  {same} values are equal")
