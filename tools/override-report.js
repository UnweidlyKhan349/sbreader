/* The "I was right" clicks (answer_overrides) as a to-do list for the
   grader: each answer a player typed and then overrode to correct, grouped
   by question and typed text, with how many times it happened and how the
   grader marks it now. What it still marks wrong, most clicked first, is
   where the grader (or the question's accept list) needs work.

     node tools/override-report.js FILE         a CSV or JSON export of the
                                                table (Supabase dashboard:
                                                Table Editor, answer_overrides,
                                                Export)
     SUPABASE_SERVICE_ROLE_KEY=... node tools/override-report.js
                                                read the table directly (the
                                                service role key is in the
                                                dashboard, Project Settings, API
                                                Keys; keep it out of the repo).
                                                SUPABASE_URL defaults to the
                                                site's project (js/config.js).
   Options:
     --all       also list answers the grader accepts now
     --min N     only answers clicked at least N times
     --since D   only clicks on or after date D (YYYY-MM-DD)
     --json      print JSON instead of a table

   The site can only add rows to the table; reading it needs the export or
   the service role key, so the clicks stay private. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'js', 'answer-check.js'));
require(path.join(ROOT, 'js', 'data.js'));
const { checkAnswer, normalize } = globalThis.SBAnswer;
const SBData = globalThis.SBData;

// RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined ? '' : r[i]])));
}

function readFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/^\s*[[{]/.test(text)) {
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : (data.rows || data.data || []);
  }
  return parseCsv(text);
}

async function readTable() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Give an export file, or set SUPABASE_SERVICE_ROLE_KEY (see the top of this file).');
  let url = process.env.SUPABASE_URL;
  if (!url) {
    const m = /supabaseUrl:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'));
    if (!m) throw new Error('Set SUPABASE_URL.');
    url = m[1];
  }
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/answer_overrides?select=question_id,typed,answer_key,mode,user_id,created_at&order=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`Reading answer_overrides: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

function loadQuestions() {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'meta.json'), 'utf8'));
  const bank = meta.tournaments.map((t) => ({ slug: t.slug, packets: JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bank', t.slug + '.json'), 'utf8')) }));
  const byId = new Map(SBData.expandQuestions(meta, bank).map((q) => [q.id, q]));
  const aliases = meta.idAliases || {};
  return (id) => byId.get(id) || byId.get(aliases[id]) || null;
}

// Rows -> groups of the same answer to the same question, graded now.
function report(rows, { since = null } = {}) {
  const find = loadQuestions();
  const groups = new Map();
  for (const r of rows) {
    const id = Number(r.question_id);
    const typed = String(r.typed || '').trim();
    if (!id || !typed) continue;
    if (since && String(r.created_at || '') < since) continue;
    const q = find(id);
    const k = `${q ? q.id : id}|${normalize(typed)}`;
    if (!groups.has(k)) groups.set(k, { id: q ? q.id : id, typed, key: q ? q.answer.text : (r.answer_key || ''), q, count: 0, users: new Set(), modes: new Set(), last: '' });
    const g = groups.get(k);
    g.count++;
    g.users.add(r.user_id || `anon:${g.count}`);
    if (r.mode) g.modes.add(r.mode);
    if (String(r.created_at || '') > g.last) g.last = String(r.created_at || '');
  }
  return [...groups.values()].map((g) => {
    let now = 'missing';
    if (g.q) {
      const res = checkAnswer(g.q, g.typed);
      now = res.correct ? 'accepted' : res.close ? 'close' : 'wrong';
    }
    return {
      id: g.id, typed: g.typed, key: g.key, count: g.count,
      // (each logged-out click counts as its own player)
      players: g.users.size,
      modes: [...g.modes].sort().join('+'), last: g.last.slice(0, 10), now,
    };
  }).sort((a, b) => (a.now === 'accepted') - (b.now === 'accepted') || b.count - a.count || a.id - b.id);
}
module.exports = { parseCsv, report };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opt = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
    const flag = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
    const all = flag('--all'); const json = flag('--json');
    const min = Number(opt('--min') || 1); const since = opt('--since');
    const rows = args[0] ? readFile(args[0]) : await readTable();
    const list = report(rows, { since }).filter((g) => g.count >= min && (all || g.now !== 'accepted'));
    if (json) { console.log(JSON.stringify(list, null, 1)); return; }
    if (!list.length) { console.log(`${rows.length} clicks; nothing to look at.`); return; }
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    console.log(`${rows.length} clicks, ${list.length} answers${all ? '' : ' the grader still doesn\'t accept'}:\n`);
    console.log(['clicks', 'now    ', 'question', 'typed'.padEnd(30), 'key'].join('  '));
    for (const g of list) {
      console.log([String(g.count).padStart(6), g.now.padEnd(7), String(g.id).padStart(8), cut(g.typed, 30).padEnd(30), cut(g.key, 60)].join('  '));
    }
  })().catch((err) => { console.error(err.message); process.exit(1); });
}
