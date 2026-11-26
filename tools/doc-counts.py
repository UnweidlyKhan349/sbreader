"""Refreshes the question counts written in prose: the README's headline and
subject table, and docs/tournaments.md's per-tournament and total counts,
from the bank. Run after removing questions (tools/keycheck.js apply does).

  python3 tools/doc-counts.py"""
import json, glob, re, collections, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
fmt = lambda n: f'{n:,}'
qs, per = [], collections.Counter()
for p in glob.glob('data/bank/*.json'):
    if p.endswith(('index.json', 'aliases.json')): continue
    slug = p.split('/')[-1][:-5]
    for r in json.load(open(p)):
        for q in r['q']: qs.append(q); per[slug] += 1
c = collections.Counter(q['s'] for q in qs)
n = len(qs)
tu = sum(q['qt'] == 'tossup' for q in qs); sa = sum(q['f'] == 'SA' for q in qs)
pg = sum(1 for q in qs if 'pg' in q)
meta = json.load(open('data/meta.json'))
s = open('README.md').read()
s, k = re.subn(r'\*\*Current question bank: [\d,]+ questions from (\d+) sets\*\* \([\d,]+ tossups / [\d,]+ bonuses; [\d,]+ short answer / [\d,]+ multiple choice\)',
               lambda m: f'**Current question bank: {fmt(n)} questions from {m.group(1)} sets** ({fmt(tu)} tossups / {fmt(n - tu)} bonuses; {fmt(sa)} short answer / {fmt(n - sa)} multiple choice)', s)
assert k == 1
s, k = re.subn(r'and [\d,]+ of those links open the packet', f'and {fmt(pg)} of those links open the packet', s); assert k == 1
for name, key in (('Biology', 'bio'), ('Earth & Space', 'ess'), ('Physics', 'phys'), ('Math', 'math'), ('Chemistry', 'chem'), ('Energy', 'energy')):
    s, k = re.subn(r'^\| %s \| [\d,]+ \|$' % re.escape(name), f'| {name} | {fmt(c[key])} |', s, flags=re.M); assert k == 1, name
open('README.md', 'w').write(s)
names = {t['name']: t['slug'] for t in meta['tournaments']}
t = open('docs/tournaments.md').read()
def row(m):
    slug = names.get(m.group(1))
    return m.group(0) if slug is None else f'| {m.group(1)} | {fmt(per[slug])} |'
t = re.sub(r'^\| ([^|]+?) \| ([\d,]+) \|', row, t, flags=re.M)
open('docs/tournaments.md', 'w').write(t)
print(n, dict(c))
t = open('docs/tournaments.md').read()
t, k = re.subn(r'^\| \*\*Total \((\d+)\)\*\* \| \*\*[\d,]+\*\* \|', lambda m: f'| **Total ({m.group(1)})** | **{fmt(n)}** |', t, flags=re.M); assert k == 1
open('docs/tournaments.md', 'w').write(t)
