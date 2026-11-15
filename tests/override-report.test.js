// tools/override-report.js: the CSV export is read right, and clicks are
// grouped by question and typed answer and graded with today's grader.
const test = require('node:test');
const assert = require('node:assert');
const { parseCsv, report } = require('../tools/override-report.js');

test('the dashboard\'s CSV export is parsed, quotes and all', () => {
  const rows = parseCsv('id,question_id,typed\r\n1,5,"a, ""b"""\r\n2,6,"two\nlines"\n');
  assert.deepStrictEqual(rows, [{ id: '1', question_id: '5', typed: 'a, "b"' }, { id: '2', question_id: '6', typed: 'two\nlines' }]);
});

test('clicks are grouped, regraded, and what still fails comes first', () => {
  const rows = [
    { question_id: 95023, typed: 'W', mode: 'solo', created_at: '2026-11-10' },
    { question_id: 95023, typed: 'one, time', mode: 'mp', user_id: 'u1', created_at: '2026-11-11' },
    { question_id: 95023, typed: 'One, time ', mode: 'solo', user_id: 'u2', created_at: '2026-11-12' },
    { question_id: 1860, typed: 'x', mode: 'solo', created_at: '2026-11-12' }, // a retired id: its alias
    { question_id: 999999999, typed: 'foo', answer_key: 'BAR', created_at: '2026-11-12' },
  ];
  const list = report(rows);
  assert.deepStrictEqual(list.map((g) => [g.id, g.count, g.now]), [[95023, 2, 'wrong'], [52648, 1, 'wrong'], [999999999, 1, 'missing'], [95023, 1, 'accepted']]);
  assert.strictEqual(list[0].players, 2);
  assert.strictEqual(list[0].modes, 'mp+solo');
  assert.strictEqual(list[2].key, 'BAR', 'a question no longer in the bank keeps the key it was logged with');
  assert.deepStrictEqual(report(rows, { since: '2026-11-12' }).map((g) => g.count), [1, 1, 1]);
});
