"""Prints the probe's JSON lines as short text. Usage: fmt.py LOGFILE [event,event,...]"""
import json
import sys

wanted = sys.argv[2].split(',') if len(sys.argv) > 2 else None
seen = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    e = json.loads(line)
    if wanted and e['ev'] not in wanted:
        continue
    n = seen.setdefault(e['id'], len(seen) + 1)
    head = f"  w{n} +{e['t']:>4}ms {e['ev']:<14}"
    if e['ev'].startswith('notify::') or e['ev'] in ('position-changed', 'size-changed'):
        print(f"{head} title={e['title']!r} app={e['appId']!r} class={e['cls']!r} frame={e['frame']} buffer={e['buffer']} mapped={e['actor'] and e['actor']['mapped']}")
    elif e['ev'] == 'frame':
        print(f"{head} frame={e['frame']} buffer={e['buffer']} actor={e['actor']} opacity={e['opacity']}")
    elif e['ev'] == 'placed':
        print(f"{head} via={e['via']} at={e['at']} before={e['before']} after={e['after']}")
    elif e['ev'] in ('unmanaged', 'place-error'):
        print(f"{head} {e.get('error', '')}")
    else:
        a = e.get('actor')
        actor = 'none' if a is None else f"mapped={a['mapped']} visible={a['visible']} opacity={a['opacity']}"
        print(f"{head} title={e['title']!r} app={e['appId']!r} class={e['cls']!r} type={e['type']} "
              f"parent={e['parent']!r}/{e['parentCls']!r} move={e['move']} resize={e['resize']} "
              f"fs={e['fullscreen']} max={e['maximized']} frame={e['frame']} buffer={e['buffer']} actor[{actor}]")
