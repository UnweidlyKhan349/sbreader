/* Answer-key check with reader agents: splits questions into chunk files,
   shows an agent's findings beside the questions, validates and queues them,
   and applies the queue to the bank. The procedure is in docs/audit/HANDOFF.md.

     node tools/keycheck.js status
     node tools/keycheck.js chunks <dir> <group> [size]   group: team | official | practice | other | school | all
     node tools/keycheck.js review <dir> <n> [n...]       findings of chunk n beside their questions
     node tools/keycheck.js queue  <dir> <n> [n...]       validate out_<n>.txt, append to <dir>/fixes.txt
     node tools/keycheck.js apply  <dir>                  apply <dir>/fixes.txt to the bank, sync, run npm test
     node tools/keycheck.js done   <dir> <n> [n...]       mark chunk n's ids as checked

   Files in <dir>: in_<n>.txt (one question per line), out_<n>.txt (an agent's
   findings), fixes.txt (id|action|value, edited by hand as needed),
   fixes.done (lines already applied). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHECKED = path.join(ROOT, 'docs', 'audit', 'checked-ids.txt');
const SCHOOL = new Set(['mira-loma-question-database', 'stuyvesant-question-bank', 'tycho-practice-rounds', 'evan-zhong-study-sets']);
const pad = (n) => String(n).padStart(3, '0');

function corpus() {
  const { loadCorpus } = require(path.join(ROOT, 'tests', 'helpers.js'));
  return loadCorpus();
}
function groupOf(q, kind) {
  if (SCHOOL.has(q.tSlug)) return 'school';
  const k = kind.get(q.tSlug);
  if (k === 'practice') return 'practice';
  if (k === 'other') return 'other';
  return /^nsb-|^science-bowl-subject/.test(q.tSlug) ? 'official' : 'team';
}
function checkedIds() {
  return new Set(fs.existsSync(CHECKED) ? fs.readFileSync(CHECKED, 'utf8').split('\n').filter(Boolean).map(Number) : []);
}
function line(q) {
  return `${q.id} | ${q.subject} | ${q.format} | Q: ${q.question}` +
    (q.choices ? ' | CHOICES: ' + Object.entries(q.choices).map(([l, t]) => l + ') ' + t).join('  ') : '') +
    ` | KEY: ${q.answer.letter ? q.answer.letter + ') ' : ''}${q.answer.text}` +
    ((q.answer.accept || []).length ? ' | ALSO ACCEPTED: ' + q.answer.accept.join('; ') : '');
}

const cmds = {
  status() {
    const { questions, meta } = corpus();
    const kind = new Map(meta.tournaments.map((t) => [t.slug, t.kind]));
    const done = checkedIds();
    const c = {};
    for (const q of questions) {
      const g = groupOf(q, kind);
      c[g] = c[g] || { questions: 0, checked: 0, visual: 0 };
      c[g].questions++;
      if (done.has(q.id)) c[g].checked++;
      if (q.visual) c[g].visual++;
    }
    console.table(c);
  },

  // Visual questions are left out: an agent can't see the figure.
  chunks(dir, group, size) {
    size = +size || 300;
    const { questions, meta } = corpus();
    const kind = new Map(meta.tournaments.map((t) => [t.slug, t.kind]));
    const done = checkedIds();
    const qs = questions.filter((q) => !q.visual && !done.has(q.id) && (group === 'all' || groupOf(q, kind) === group));
    qs.sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : a.id - b.id));
    fs.mkdirSync(dir, { recursive: true });
    const first = fs.readdirSync(dir).filter((f) => /^in_\d+\.txt$/.test(f)).length;
    let n = first;
    for (let i = 0; i < qs.length; i += size) {
      n++;
      fs.writeFileSync(path.join(dir, `in_${pad(n)}.txt`), qs.slice(i, i + size).map(line).join('\n') + '\n');
    }
    console.log(`${qs.length} questions -> chunks ${pad(first + 1)}..${pad(n)} in ${dir}`);
  },

  review(dir, ...ns) {
    const { questions } = corpus();
    const by = new Map(questions.map((q) => [q.id, q]));
    for (const n of ns) {
      const f = path.join(dir, `out_${pad(n)}.txt`);
      if (!fs.existsSync(f)) { console.log('no findings file for chunk', n); continue; }
      for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        const q = by.get(+l.split('|')[0]);
        if (!q) { console.log('?? ' + l); continue; }
        console.log(`${l}\n   [${q.tSlug}] Q: ${q.question}` +
          (q.choices ? ' [' + Object.entries(q.choices).map(([k, v]) => k + ') ' + v).join(' / ') + ']' : '') +
          ` => ${q.answer.letter ? q.answer.letter + ') ' : ''}${q.answer.text}\n`);
      }
    }
  },

  // A finding is queued only if it can be applied as written: the id exists, a
  // new multiple-choice key is one of the four choices and differs from the old
  // one, a text repair matches the stem exactly.
  queue(dir, ...ns) {
    const { questions } = corpus();
    const by = new Map(questions.map((q) => [q.id, q]));
    const fixes = path.join(dir, 'fixes.txt');
    const have = new Set(fs.existsSync(fixes) ? fs.readFileSync(fixes, 'utf8').split('\n') : []);
    const out = []; let rejected = 0;
    const reject = (why, l) => { rejected++; console.log(why, l.slice(0, 140)); };
    for (const n of ns) {
      const f = path.join(dir, `out_${pad(n)}.txt`);
      if (!fs.existsSync(f)) { console.log('no findings file for chunk', n); continue; }
      for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
        if (!l.trim()) continue;
        const m = l.match(/^(\d+)\|(a|rm|q)\|(.*)$/);
        if (!m) { reject('BAD LINE', l); continue; }
        const id = +m[1], act = m[2], q = by.get(id);
        if (!q) { reject('NO SUCH ID', l); continue; }
        let fix;
        if (act === 'rm') fix = `${id}|rm|`;
        else if (act === 'q') {
          const k = m[3].lastIndexOf(']|');
          let arr; try { arr = JSON.parse(k >= 0 ? m[3].slice(0, k + 1) : m[3]); } catch (e) { reject('BAD JSON', l); continue; }
          if (!Array.isArray(arr) || arr.length !== 2 || !arr[0] || !q.question.includes(arr[0])) { reject('TEXT NOT IN STEM', l); continue; }
          fix = `${id}|q|${JSON.stringify(arr)}`;
        } else {
          const k = m[3].indexOf('|');
          const val = (k >= 0 ? m[3].slice(0, k) : m[3]).trim();
          if (!val) { reject('EMPTY', l); continue; }
          if (q.format === 'MC') {
            let L = /^[WXYZ]$/i.test(val) ? val.toUpperCase() : '';
            if (!L) { const hit = Object.entries(q.choices).find(([, v]) => v.toLowerCase().trim() === val.toLowerCase()); L = hit ? hit[0] : ''; }
            if (!L || !q.choices[L]) { reject('NOT A CHOICE', l); continue; }
            if (L === q.answer.letter) { reject('SAME KEY', l); continue; }
            fix = `${id}|a|${L}`;
          } else {
            if (val.toLowerCase() === q.answer.text.toLowerCase()) { reject('SAME KEY', l); continue; }
            fix = `${id}|a|${val}`;
          }
        }
        if (!have.has(fix)) { out.push(fix); have.add(fix); }
      }
    }
    if (out.length) fs.appendFileSync(fixes, out.join('\n') + '\n');
    console.log(`queued ${out.length}, rejected ${rejected} -> ${fixes}`);
  },

  // fixes.txt lines: id|rm|   id|a|<new key or MC letter>   id|q|["old","new"]   id|ac|<extra accepted answer>
  apply(dir) {
    const fixes = path.join(dir, 'fixes.txt'), doneFile = path.join(dir, 'fixes.done'), flat = path.join(dir, 'flat.json');
    const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
    run('node', ['tools/bank.js', 'unpack', flat]);
    let a = JSON.parse(fs.readFileSync(flat, 'utf8'));
    const done = new Set(fs.existsSync(doneFile) ? fs.readFileSync(doneFile, 'utf8').split('\n') : []);
    const by = new Map(a.map((r) => [r.i, r]));
    const rm = new Set(); let n = 0, bad = 0;
    for (const l of fs.readFileSync(fixes, 'utf8').split('\n')) {
      if (!l || l[0] === '#' || done.has(l)) continue;
      const i = l.indexOf('|'), j = l.indexOf('|', i + 1);
      const id = +l.slice(0, i), act = l.slice(i + 1, j), val = l.slice(j + 1), r = by.get(id);
      const fail = (why) => { bad++; console.log(why, l.slice(0, 140)); };
      if (!r) { fail('MISSING'); continue; }
      if (act === 'rm') rm.add(id);
      else if (act === 'a') {
        if (r.f === 'MC') { if (!/^[WXYZ]$/.test(val) || !r.c[val]) { fail('BAD MC KEY'); continue; } r.a = { t: r.c[val], l: val }; }
        else { const o = { t: val }; if (r.a.rj) o.rj = r.a.rj; r.a = o; }   // old alternates went with the old key
      } else if (act === 'ac') {
        const o = { t: r.a.t }; if (r.a.l) o.l = r.a.l; o.ac = (r.a.ac || []).concat([val]); if (r.a.rj) o.rj = r.a.rj; r.a = o;
      } else if (act === 'q') {
        const [x, y] = JSON.parse(val);
        if (!r.q.includes(x)) { fail('TEXT NOT IN STEM'); continue; }
        r.q = r.q.replace(x, y).replace(/\s+/g, ' ').trim();
      } else { fail('UNKNOWN ACTION'); continue; }
      done.add(l); n++;
    }
    a = a.filter((r) => !rm.has(r.i));
    fs.writeFileSync(flat, JSON.stringify(a));
    fs.writeFileSync(doneFile, [...done].join('\n'));
    console.log(`applied ${n} (removed ${rm.size}), could not apply ${bad}; bank is ${a.length}`);
    run('node', ['tools/bank.js', 'pack', flat]);
    console.log(run('python3', ['tools/keycheck_sync.py']).trim());
    // A repaired practice-set question can become a word-for-word copy: remove it, with an alias to the kept one.
    const pairs = copies();
    if (pairs.length) {
      console.log('now copies, removing:', pairs.join(' '));
      fs.appendFileSync(fixes, pairs.map((p) => p.split('=')[0] + '|rm|').join('\n') + '\n');
      let b = JSON.parse(fs.readFileSync(flat, 'utf8'));
      const gone = new Set(pairs.map((p) => +p.split('=')[0]));
      b = b.filter((r) => !gone.has(r.i));
      fs.writeFileSync(flat, JSON.stringify(b));
      fs.appendFileSync(doneFile, '\n' + pairs.map((p) => p.split('=')[0] + '|rm|').join('\n'));
      run('node', ['tools/bank.js', 'pack', flat]);
      console.log(run('python3', ['tools/keycheck_sync.py', ...pairs]).trim());
    }
    run('node', ['tools/meta-counts.js']);
    run('node', ['tools/stamp-assets.js']);
    try { run('npm', ['test', '--silent']); console.log('npm test: pass'); }
    catch (e) { console.log('npm test: FAILED - run `npm test` and fix before committing'); process.exitCode = 1; }
  },

  done(dir, ...ns) {
    const ids = checkedIds();
    for (const n of ns) {
      for (const l of fs.readFileSync(path.join(dir, `in_${pad(n)}.txt`), 'utf8').split('\n')) if (l) ids.add(+l.split(' | ')[0]);
    }
    fs.writeFileSync(CHECKED, [...ids].sort((x, y) => x - y).join('\n') + '\n');
    console.log(`${ids.size} ids marked checked`);
  },
};

// Same test as tests/data.test.js: a practice-set question word for word the
// same as a tournament question or an earlier practice-set question.
function copies() {
  delete require.cache[require.resolve(path.join(ROOT, 'tests', 'helpers.js'))];
  const { questions, meta } = corpus();
  const practice = new Set(meta.tournaments.filter((t) => t.kind === 'practice').map((t) => t.slug));
  const key = (q) => (q.question + ' | ' + ['W', 'X', 'Y', 'Z'].map((L) => (q.choices || {})[L] || '').join(' | ')).toLowerCase()
    .replace(/[−–]/g, '-').replace(/[^a-z0-9+\-=<>^/*.%√π ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const seen = new Map();
  for (const q of questions) { const k = key(q); if (k.length < 20) continue; if (!seen.has(k)) seen.set(k, []); seen.get(k).push(q); }
  const out = [];
  for (const g of seen.values()) {
    if (g.length < 2) continue;
    const keep = g.find((q) => !practice.has(q.tSlug)) || g[0];
    for (const q of g) if (q !== keep && practice.has(q.tSlug)) out.push(q.id + '=' + keep.id);
  }
  return out;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmds[cmd]) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].slice(3)); process.exit(1); }
cmds[cmd](...args);
