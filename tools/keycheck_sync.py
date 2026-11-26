"""Keeps the subject files and the bookmark aliases in step with the bank
after questions are removed (used by tools/keycheck.js apply).

  python3 tools/keycheck_sync.py [removedId=keptId ...]

Drops removed ids from data/source-subjects.json and
data/subject-overrides.json, records the given aliases in
data/bank/aliases.json (a removed copy's id -> the kept question's id), and
drops any alias whose target is gone. Each file keeps its one-entry-a-line
form. Counts in meta.json are rebuilt by tools/meta-counts.js afterwards."""
import json, glob, os, re, sys
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '')
ids = set()
for f in glob.glob(R + 'data/bank/*.json'):
    if os.path.basename(f) in ('index.json', 'aliases.json'): continue
    for p in json.load(open(f)):
        for q in p['q']: ids.add(q['i'])

ENTRY = re.compile(r'^"(\d+)"\s*:')

def rewrite(path, keep, extra=()):
    """Rewrites a {"id": value, ...} file written one entry a line, keeping the
    lines whose entry passes keep(id, value) and adding extra (id, value) pairs."""
    lines = open(path).read().split('\n')
    body = [l.rstrip(',') for l in lines if ENTRY.match(l)]
    sep = ': ' if body and '": ' in body[0] else ':'
    out, dropped = [], 0
    for l in body:
        k, v = l.split(':', 1)
        if keep(int(k.strip('"')), json.loads(v)): out.append(l)
        else: dropped += 1
    out += ['"%s"%s%s' % (k, sep, json.dumps(v)) for k, v in extra]
    s = '{\n' + ',\n'.join(out) + '\n}\n'
    json.loads(s)
    open(path, 'w').write(s)
    return dropped

for name in ('source-subjects.json', 'subject-overrides.json'):
    print(name, 'dropped', rewrite(R + 'data/' + name, lambda k, v: k in ids))
pairs = [tuple(map(int, a.split('='))) for a in sys.argv[1:]]
print('aliases.json dropped', rewrite(R + 'data/bank/aliases.json', lambda k, v: v in ids and k not in ids, pairs), 'added', len(pairs))
print('bank', len(ids))
