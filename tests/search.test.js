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

const q = (question, answer, tournament, more = {}) => ({ question, answer: { text: answer, accept: more.accept || [], reject: more.reject || [] }, tournament, choices: more.choices || null });
const match = (item, search, ignoreOrder, type, exact) => SBData.searchMatcher(search, ignoreOrder, type, exact)(item);

test('question, answer and tournament; any word order or the phrase; never case-sensitive', () => {
  const item = q('Table salt is mostly which compound?', 'Sodium Chloride', 'MIT 2024');
  assert.ok(match(item, 'chloride sodium', true), 'words in any order');
  assert.ok(!match(item, 'chloride sodium', false), 'the phrase must be as typed');
  assert.ok(match(item, 'SODIUM   chloride', false), 'capitals and spacing never matter');
  assert.ok(match(item, 'mit sodium', true), 'the tournament counts too');
  assert.ok(match(item, 'table salt', false), 'and the question');
  assert.strictEqual(SBData.searchMatcher('   ', true), null, 'nothing to search for');
});

test('all text, question text only or answer text only', () => {
  const item = q('Which salt is in seawater?', 'Sodium chloride', 'MIT 2024');
  assert.ok(match(item, 'mit seawater', true, 'all'));
  assert.ok(!match(item, 'mit seawater', true, 'question'), 'the tournament isn\'t the question');
  assert.ok(match(item, 'salt seawater', true, 'question'));
  assert.ok(!match(item, 'sodium', true, 'question'), 'nor is the answer');
  assert.ok(match(item, 'sodium chloride', false, 'answer'));
  assert.ok(!match(item, 'seawater', true, 'answer'), 'the question isn\'t the answer');
  assert.ok(match(item, 'sodium seawater', true, 'all'));
});

test('choices, accepts and rejects are searched, each in its scope', () => {
  const item = q('Which of the following is a wetland?', 'Bog', 'MIT 2024', { choices: { W: 'Bog', X: 'Dune', Y: 'Mesa', Z: 'Butte' }, accept: ['Quagmire'], reject: ['Swamp'] });
  assert.ok(match(item, 'mesa', true, 'all'));
  assert.ok(match(item, 'mesa wetland', true, 'question'), 'a choice is part of the question');
  assert.ok(!match(item, 'mesa', true, 'answer'));
  assert.ok(match(item, 'quagmire', true, 'answer'), 'an accepted answer is an answer');
  assert.ok(!match(item, 'quagmire', true, 'question'));
  assert.ok(match(item, 'swamp', true, 'all'), 'a rejected answer is on the card');
  assert.ok(!match(item, 'swamp', true, 'answer'), 'but is not an answer');
  assert.ok(!match(item, 'bog dune', false, 'all'), 'a phrase never runs from one field into the next');
});

test('accents, curly quotes and long dashes are typed plain', () => {
  const item = q('What equation did Schrödinger write for the P–wave of Hooke’s “spring”?', 'Le Châtelier’s principle', 'MIT 2024');
  for (const s of ['schrodinger', 'SCHRÖDINGER', "hooke's", 'hooke’s', 'p-wave', '"spring"', 'le chatelier\'s principle']) assert.ok(match(item, s, false), s);
  assert.strictEqual(SBData.searchFold('Schrödinger’s P–wave').length, 'Schrödinger’s P–wave'.length, 'one character for each character');
  assert.strictEqual(SBData.searchFold('Schrödinger’s P–wave'), "schrodinger's p-wave");
});

test('exact words: each word typed must stand as a whole word', () => {
  const capillary = q('Which force restores capillary waves?', 'Surface tension', 'MIT 2024');
  const seismic = q('Which arrive first, S-waves or P-waves?', 'P waves', 'MIT 2024');
  const apart = q('Is p the momentum of the waves?', 'Yes', 'MIT 2024');
  assert.ok(match(capillary, 'p waves', true), 'without it, "p" is found inside "capillary"');
  assert.ok(!match(capillary, 'p waves', true, 'all', true));
  assert.ok(match(seismic, 'p waves', true, 'all', true), 'a hyphen ends a word');
  assert.ok(match(apart, 'p waves', true, 'all', true), 'the words needn\'t be together');
  assert.ok(!match(apart, 'p waves', false, 'all', true), 'unless word order counts');
  assert.ok(match(seismic, 'p waves', false, 'all', true));
  assert.ok(!match(seismic, 'p wave', true, 'all', true), '"wave" is not "waves"');
  assert.ok(match(seismic, 'P WAVES', true, 'answer', true));
  // Digits are part of a word; markup and punctuation aren't.
  const chem = q('What is the K_sp of H2O at 25 degrees?', 'x^2', 'MIT 2024');
  assert.ok(match(chem, 'ksp', true, 'all', true));
  assert.ok(match(chem, 'h2o', true, 'all', true));
  assert.ok(!match(chem, 'h2', true, 'all', true));
  assert.ok(!match(chem, '2', true, 'question', true), '25 and H2O hold a 2, but not as a word');
  assert.ok(match(chem, '25', true, 'all', true));
  assert.ok(match(chem, 'x^2', true, 'answer', true));
  assert.strictEqual(SBData.wholeWordIndex('a p-wave and p waves', 'p', 3), 13);
  assert.strictEqual(SBData.wholeWordIndex('capillary waves', 'p', 0), -1);
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
  // Packets LeBot hosts: the tournament's page on scibowl.live, which lists them.
  assert.strictEqual(src('tjsbt-2025'), 'https://www.scibowl.live/packets/tjsbt-2025');
  assert.strictEqual(src('basis-peoria-rounds'), 'https://www.scibowl.live/packets/basis-peoria-rounds');
  // A folder given in meta.json.
  assert.strictEqual(src('bums-2026'), 'https://drive.google.com/drive/folders/1d7K7cB4BemHpx2ky5Hhf-uS1xZ3n2h_Q');
  // Every tournament in the bank has such a link now.
  for (const x of SBData.meta.tournaments) assert.ok(SBData.tournamentSourceUrl(x, SBPlay.packetsOf(x.slug)), x.slug);
  // Separate files only (no set in the bank any more): each packet's own link is listed instead.
  const packets = [1, 2].map((n) => ({ questions: [{ sourceUrl: `https://drive.google.com/file/d/file${n}/view` }] }));
  assert.strictEqual(SBData.tournamentSourceUrl({ slug: 'x' }, packets), null);
  const html = SBData.tournamentSourceHTML({ slug: 'x' }, packets);
  assert.match(html, /^<p class="set-source">Source packets: <a href="https?:\/\/[^"]+" target="_blank" rel="noopener">1<\/a>/);
  // Every tournament has one or the other.
  for (const x of SBData.meta.tournaments) assert.ok(SBData.tournamentSourceHTML(x, SBPlay.packetsOf(x.slug)), x.slug);
});

test('a packet page\'s Source packet link is to the packet, without a question\'s page or line', () => {
  const SBData = globalThis.SBData;
  const packet = { questions: [
    { sourceUrl: 'https://example.org/p/round3.pdf#page=5' },
    { sourceUrl: 'https://example.org/p/round3.pdf#page=6' },
    { sourceUrl: 'https://example.org/p/other.pdf#page=1' },
  ] };
  assert.strictEqual(SBData.packetSourceUrl(packet), 'https://example.org/p/round3.pdf');
  assert.strictEqual(SBData.packetSourceUrl({ questions: [{ sourceUrl: 'https://github.com/a/b/blob/main/r1.txt#L120' }] }), 'https://github.com/a/b/blob/main/r1.txt');
  assert.match(SBData.packetSourceHTML(packet), /href="https:\/\/example\.org\/p\/round3\.pdf"/);
});
