# Rebuilding the question bank from its sources

The bank (`data/bank/`) can be rebuilt from the repository: the source packets are downloaded again, read by the parser here, and the corrections recorded in `corrections/` are applied on top. The result is checked byte for byte against `data/bank/`.

The original ingestion scripts (2025–2026) ran in a scratch directory and were never committed, so this is a new pipeline written in November 2026. It doesn't replay how each question was first ingested. It reads the same sources, and everything the sources alone don't give is recorded as a correction, question by question. That covers keys fixed by hand, notation evened out, questions merged, reworded or recategorized (see [docs/data-history.md](../../docs/data-history.md)), plus the ids and anything the parser gets wrong. The report says how much of the bank comes straight from the sources.

## Steps

Needs Node 18+, `pdftotext` (poppler-utils: `apt-get install poppler-utils`) and network access. Downloads go to `.ingest/` (git-ignored, about 800 MB; the first fetch takes 20–30 minutes).

```bash
node tools/ingest/fetch.js          # 1. download every source packet (a second run retries failures)
node tools/ingest/extract.js        # 2. PDFs, .doc, .docx, .odt, .pptx and text files -> plain text
node tools/ingest/build.js --check  # 3. parse, apply the corrections, compare with data/bank/
node tools/ingest/build.js --write-bank   # or write the rebuilt bank to data/bank/
```

Add `--only <slug>[,<slug>]` to any step to work on some tournaments.

`build.js` without flags prints, per tournament, how many questions come straight from the source, how many from the source with corrections, and how many are kept whole (no source to read).

As of November 25, 2026 (106,366 questions, every source fetched): **45.0%** come straight from the sources, **41.5%** from the sources with corrections (most often a key's capitals or a notation the bank evens out: `10^5`, `K^(+)`, `π`), and **13.5%** are kept whole. Of those 14,368: 4,612 the parser misses in a packet it otherwise reads; 3,801 in files it reads nothing from (scanned PDFs with no text layer, such as LOST 2; NOSB's form layout; a link to a whole repository); 3,319 in GitHub files and 1,440 in Drive files and Google Docs laid out in ways it doesn't know yet; and 1,089 from speriphery.com, which isn't fetched. The corrections take 13 MB. The whole rebuild (`--check`) takes about 10 seconds once the files are downloaded and extracted.

## Files

| File | What it is |
|---|---|
| `sources.json` | Every tournament and, in bank order, its packets: round label `rl`, round `r`, source link `u`, question count `n`. Written by `node tools/ingest/sources.js` from the bank. |
| `corrections/<slug>.json` | One line per question, per packet, in bank order: `{"i": id, "m": parsed record (-1: none), "set": {field: value}, "del": [field], "order": [...]}`. Fields are top-level keys, or `a.t`, `a.l`, `a.ac`, `a.rj`, `c.W` … `c.Z`. |
| `fetch.js` | Step 1. How each kind of link is fetched is in its header comment. |
| `extract.js` | Step 2. |
| `parse.js` | Packet text, and isobowl's and scibowldb's structured records, to question records. |
| `build.js` | Step 3: matching, corrections, rebuilding, the report. |
| `lib/` | Shared paths, a small zip reader for Office files, and a reader for old binary Word files (`doc.js`). |

## After changing the bank

A hand edit to `data/bank/` (or a new tournament) has to reach the corrections, or `--check` reports the tournament as different:

```bash
node tools/ingest/sources.js                              # if packets or tournaments changed
node tools/ingest/fetch.js --only <slug> && node tools/ingest/extract.js
node tools/ingest/build.js --write-corrections --only <slug>
```

`--write-corrections` matches each question to its parsed record (same toss-up/bonus and number, else the closest wording), stores the differences, and checks that they rebuild the bank exactly before it finishes. A better parser means smaller corrections: after changing `parse.js`, rerun `--write-corrections` for every tournament and compare the report.

## What can't be fetched

- **speriphery.com** (`u` = `https://speriphery.com/query`): its question table is only reachable through the site's own app, not a published download, so those questions are kept whole in the corrections.
- **Packets that were sent as files** and never posted (the user's desktop archive, the HSBT zip): the same.
- **Links that have since gone dead**, private Drive files and files that aren't documents: listed in `.ingest/fetch-log.json` and `.ingest/extract-log.json`. Their questions are kept whole. (In the November 2026 run every link answered.)
- **Scanned PDFs** (no text layer): there's no OCR step, so their questions are kept whole.
- **Figures** (`im`): the images are in `data/img/` and their names are part of the corrections; they aren't cut out of the packets again.
