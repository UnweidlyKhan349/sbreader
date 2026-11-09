// The Database's search (SBData.searchMatcher, used by filterQuestions):
// word order and capital letters; the year range (Play and Multiplayer); and the
// set pages' source links (SBData.tournamentSourceUrl).
const test = require('node:test');
const assert = require('node:assert');
const { loadCorpus } = require('./helpers');

const { questions, meta } = loadCorpus();
const SBData = globalThis.SBData;
SBData.questions = questions;
SBData.meta = meta;
globalThis.window = globalThis;
require('../js/play-common.js');

const q = (question, answer, tournament) => ({ question, answer: { text: answer }, tournament });
const match = (item, search, ignoreOrder) => SBData.searchMatcher(search, ignoreOrder)(item);

test('question, answer and tournament; any word order or the phrase; never case-sensitive', () => {
  const item = q('Table salt is mostly which compound?', 'Sodium Chloride', 'MIT 2024');
  assert.ok(match(item, 'chloride sodium', true), 'words in any order');
  assert.ok(!match(item, 'chloride sodium', false), 'the phrase must be as typed');
  assert.ok(match(item, 'SODIUM   chloride', false), 'capitals and spacing never matter');
  assert.ok(match(item, 'mit sodium', true), 'the tournament counts too');
  assert.ok(match(item, 'table salt', false), 'and the question');
  assert.strictEqual(SBData.searchMatcher('   ', true), null, 'nothing to search for');
});

test('the year range keeps only the tournaments of those years', () => {
  const out = SBData.filterQuestions({ yearRange: [2021, 2022] });
  assert.ok(out.length > 0);
  assert.ok(out.every((x) => x.year >= 2021 && x.year <= 2022));
  assert.ok(questions.every((x) => Number.isInteger(x.year)), 'every question has its tournament\'s year');
});

test('a set page links its whole tournament where the packets point to one place', () => {
  const src = (slug) => SBData.tournamentSourceUrl(SBData.meta.tournaments.find((t) => t.slug === slug), SBPlay.packetsOf(slug));
  assert.strictEqual(src('ncb-fall-2026'), 'https://isobowl.com/premier/tournaments/national-chemistry-bowl');
  assert.strictEqual(src('nsb-regs'), 'https://science.osti.gov/wdts/nsb/Regional-Competitions/Resources/HS-Sample-Questions');
  assert.match(src('clash-2026-hs'), /^https:\/\/drive\.google\.com\/drive\/folders\//);
  assert.strictEqual(src('aves-2025'), 'https://drive.google.com/drive/folders/1-ZwTmmC0L-v4hjQGavnbOWIkecD2OxNv');
  // Separate files only: each packet's own link is listed instead.
  const t = SBData.meta.tournaments.find((x) => !SBData.tournamentSourceUrl(x, SBPlay.packetsOf(x.slug)));
  assert.ok(t, 'some tournament has only separate packet files');
  const html = SBData.tournamentSourceHTML(t, SBPlay.packetsOf(t.slug));
  assert.match(html, /^<p class="set-source">Source packets: <a href="https?:\/\/[^"]+" target="_blank" rel="noopener">1<\/a>/);
  // Every tournament has one or the other.
  for (const x of SBData.meta.tournaments) assert.ok(SBData.tournamentSourceHTML(x, SBPlay.packetsOf(x.slug)), x.slug);
});
