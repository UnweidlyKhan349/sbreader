"""Keeps data/meta.json and the subject files in step with the bank after
questions are removed (used by tools/keycheck.js apply).

  python3 tools/keycheck_sync.py [removedId=keptId ...]

Sets meta.totalQuestions, drops removed ids from data/source-subjects.json and
data/subject-overrides.json, records the given aliases, and drops any alias
whose target is gone. meta.json keeps its json.dumps(ensure_ascii=False) form."""
import json, re, glob, os, sys
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '')
ids = set()
for f in glob.glob(R + 'data/bank/*.json'):
    if f.endswith('index.json'): continue
    for p in json.load(open(f)):
        for q in p['q']: ids.add(q['i'])
sids = {str(i) for i in ids}
for name in ('source-subjects.json', 'subject-overrides.json'):
    p = R + 'data/' + name; s = open(p).read(); d = json.loads(s)
    gone = [k for k in d if k not in sids]
    for k in gone:
        s2 = re.sub(r'\s*"%s":\s*("[^"]*"|null),?' % k, '', s, count=1); assert s2 != s, k; s = s2
    s = re.sub(r',(\s*})', r'\1', s); json.loads(s); open(p, 'w').write(s)
    print(name, 'dropped', len(gone))
p = R + 'data/meta.json'; s = open(p).read(); m = json.loads(s)
m['totalQuestions'] = len(ids)
al = m['idAliases']
for a in sys.argv[1:]:
    k, v = a.split('='); al[k] = int(v)
bad = [k for k, v in al.items() if v not in ids]
for k in bad: del al[k]
open(p, 'w').write(json.dumps(m, ensure_ascii=False) + ('\n' if s.endswith('\n') else ''))
print('total', len(ids), 'aliases dropped', bad)
