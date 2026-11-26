# SB Reader

Static Science Bowl practice site (https://sbreader.org): plain HTML/CSS/JS, no build step, no framework, no server of its own. Bootstrap, PeerJS and supabase-js come from jsDelivr at pinned versions. Multiplayer is peer to peer (PeerJS); accounts, room lists and stats use Supabase (`supabase/schema.sql`). The README is the full reference (features, grading rules, data format, deploying); read the section you need rather than all of it.

## Layout

- Pages are top-level `*.html`; links have no `.html` (`solo`, `database?tournament=…`), as GitHub Pages serves them.
- `js/data.js` (`SBData`): loading the bank, question cards, filtering, search, packet order. Shared by every page.
- `js/answer-check.js` (`SBAnswer`): the grader. `js/mp-rules.js`: multiplayer message validation. Both run under Node for the tests.
- `js/solo.js` (Play), `js/multiplayer.js` (+ `peer.js`, `rooms.js`), `js/database.js` (Database search), `js/play-common.js` (shared by Play and Multiplayer).
- `data/bank/<slug>.json`: one file per tournament; `data/meta.json`: tournaments, counts, content stamps. `node tools/bank.js unpack`/`pack` converts to and from a flat record list for editing.
- `tools/ingest/`: the pipeline that rebuilds the bank from the source packets (see its README).
- `tools/`: maintenance scripts (stamps, page builds, audits). `docs/data-history.md`: how the bank was built and cleaned.

## Commands

- `npm test`: unit tests (grader, data shape, multiplayer rules, search). Run after any JS or data change.
- `npm run test:e2e`: browser tests (Playwright, Chromium). Run after UI changes (a few minutes). One file: `node --test tests/e2e/play.e2e.js`.
- Syntax check, as CI does: `for f in js/*.js tests/*.js tests/e2e/*.js tools/*.js sw.js; do node --check "$f"; done`
- After editing any file under `js/` or `css/`: `node tools/stamp-assets.js` (the `?v=` stamps in every page; a unit test fails otherwise).
- After changing the bank: `node tools/meta-counts.js` (counts and stamps in `meta.json`).
- Local server: `python3 -m http.server 8000`.

## Conventions

- Write comments, README and CHANGELOG entries in plain words about what the user sees and why, as the existing ones do. Date notes about removed behavior ("removed on November 22, 2026").
- Every user-visible change gets a CHANGELOG line (newest last); data changes go in `docs/data-history.md`. Update the README section for the feature you change.
- Keep behavior close to QB Reader's equivalent page unless told otherwise.
- New pages copy the shared `<head>` (analytics, icons, manifest, theme colors) and have exactly one `<h1>` (hidden with `visually-hidden` if the page shows no title); `tests/page-heads.test.js` checks both. Indexable pages go in `sitemap.xml`.
- Multiplayer: whoever runs the game ("host"/coordinator) validates every message with `SBMpRules.cleanHostMessage`. Never trust a client's message.
- Don't hand-edit `?v=` stamps or `meta.json` counts; use the tools above.
- Deploys happen from `main` only, after CI passes (`.github/workflows/deploy.yml`). Don't push to `main` unless asked.
