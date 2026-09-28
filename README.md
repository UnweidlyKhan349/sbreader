# SciBowl Practice

A static Science Bowl practice site built from real tournament packets: a searchable catalog, a solo buzzer trainer, a peer-to-peer multiplayer mode, and per-device bookmarks. It's plain HTML/CSS/JS, with no backend, build step, framework, or server-side code, so it can be deployed straight to GitHub Pages or any static host.

**Current question bank: 74,966 questions from 97 tournaments** (37,737 tossups / 37,229 bonuses; 47,167 short answer / 27,799 multiple choice).

| Subject | Questions |
|---|---|
| Earth & Space | 14,110 |
| Biology | 13,971 |
| Math | 13,052 |
| Chemistry | 12,165 |
| Physics | 12,120 |
| Energy | 9,548 |

This README covers the whole project: what the site does, how the data is shaped, where the questions came from, every major data-quality pass, the conventions the work followed, and the known limitations that are still open.

---

## Contents

1. [Pages and features](#pages-and-features)
2. [Keyboard shortcuts](#keyboard-shortcuts)
3. [Answer grading](#answer-grading)
4. [Architecture](#architecture)
5. [Data format](#data-format)
6. [Where the questions came from](#where-the-questions-came-from)
7. [Ingestion pipeline and methodology](#ingestion-pipeline-and-methodology)
8. [Data-quality work history](#data-quality-work-history)
9. [Site/UI change history](#siteui-change-history)
10. [Project conventions and hard-won lessons](#project-conventions-and-hard-won-lessons)
11. [Known limitations and open items](#known-limitations-and-open-items)
12. [Deploying](#deploying)
13. [Local development](#local-development)
14. [Appendix: tournament list](#appendix-tournament-list)

---

## Pages and features

### `index.html` (Home)
A landing page with cards linking to Catalog, Solo Practice, and Multiplayer. The tagline shows the live question and tournament counts, read from `meta.json`.

### `catalog.html` (Catalog)
- Browse and search every question. Search covers question text, answers, and tournament name, with a debounce on input.
- Filters: subject chips, a dual-handle **round-range slider** with an "Include unlabeled" checkbox (1,555 questions have no round number), question type (Toss-Up/Bonus), format (Short Answer/Multiple Choice), level (High School/Middle School), and a searchable multi-select tournament picker. There's also a "Clear all filters" button.
- 40 results per page, with pagination and a jump-to-page input.
- Each card shows subject/type/format tags, the question, MC choices, the answer line (with inline "also accept"), the tournament and round label, a link to the original packet (when there is one), and a bookmark star.

### `solo.html` (Solo Practice)
- **Setup screen**: pick subjects, round range, question type, format, level (High School/Middle School), and tournament(s), plus reading speed. A live "N questions match your filters" count updates as you go.
- **Reveal instead of text-to-speech**: questions and their answer choices type themselves onto the screen (`js/reveal.js`) at an adjustable speed, from 0.5× to 2.5×. At 1.0× that's 21 characters per second. The reveal position is computed from wall-clock time rather than tick counts, so it doesn't fall behind in a backgrounded browser tab. Your speed is saved in `localStorage` (`sb_rate`).
- **Timers**: a 4 s buzz window for tossups and 20 s for bonuses once the reveal finishes, then 10 s to type an answer.
- **Grading**: automatic (see [Answer grading](#answer-grading)), with a manual **override** if the grader gets it wrong. The score bar tracks Correct, Incorrect, and Total.
- **Question queue**: built with `SBData.stratifiedQueue`, a round-robin across subjects that keeps cycling. Subjects stay evenly mixed for the whole session even when one subject has far fewer matching questions.
- **In-session Settings panel** (⚙ / `S`): change reading speed and every filter mid-session. Changes apply live and only rebuild the not-yet-asked part of the queue, so you won't see a question twice. If you turn off every subject and close the panel, it resets to all subjects, so the next time you open it you get a working selection instead of zero matches.
- Pause/resume, bookmarking, and a "Previous questions" log.
- **Bookmarked mode**: the bookmarks page's "Practice these" button opens `solo.html?bookmarked=1`, which skips setup and drills only your bookmarks, ignoring subject/format/round filters. An inline `<head>` script hides the setup screen before the first paint so it never flashes.

### `multiplayer.html` (Multiplayer)
- **Host or join a room** with a 5-character code. Codes use an alphabet without look-alike characters (no I/L/O/0/1). The underlying PeerJS peer ID is `sbowl-XXXXX`, but players only ever see and type `XXXXX`. Codes are **uppercased before connecting**, so typing `xfts2` joins `XFTS2`, and a pasted `sbowl-` prefix is handled whatever its case.
- Everyone can buzz. The first buzz locks everyone else out until that player answers, and a wrong answer locks that player out for the rest of the question.
- **Scoring**: +4 for a correct answer. A wrong answer costs −4 if you buzzed before the question finished revealing, and 0 otherwise. Players can override their own graded answer.
- Live scoreboard, live typing preview (other players watch you type, throttled to 150 ms), room chat (last 60 messages), pause, bookmarks, and a question log.
- **Room settings** (⚙ / `S`) can be edited by anyone in the room, not just the host. Changes go to the host and are then broadcast to everyone. An echo-suppression guard stops programmatic repaints from bouncing settings back and forth between clients. The "all subjects off → reset to all on close" rule applies here too, and the reset is pushed to the room like any other settings change.
- **Joining mid-game**: late joiners get a full state sync and catch up immediately. Duplicate display names are made unique.

### `bookmarks.html` (Bookmarked questions)
Lists every bookmarked question as a card, with a "Practice these" button that starts solo bookmarked mode. Bookmarks are stored per device in `localStorage` under `sb_bookmarks_v1`.

### Mobile
- Below 640 px the nav bar scrolls horizontally with a hidden scrollbar, and the brand text and links shrink. There's no horizontal page overflow on any page.
- Below 480 px the hero heading shrinks from 34 px to 26 px.
- Verified with Playwright screenshots at 375 px across all pages and during an active solo session.

---

## Keyboard shortcuts

Shortcuts are ignored while you're typing in a text field (except Enter to submit) and when modifier keys are held.

**Solo (in session)**: `Space` buzz · `Enter` submit · `N` next/skip · `Q` override grading · `B` bookmark · `P` pause/resume · `S` open settings (not in bookmarked mode) · `Esc` close settings

**Multiplayer (in game)**: `Space` buzz · `Enter` submit · `N` next (after reveal) / skip (while reading) · `P` pause · `Q` override your own grade · `B` bookmark · `S` room settings · `/` focus chat · `Esc` close settings

> History: an `N` shortcut was briefly added to the home page (jump to solo), then moved to solo's "Start practice" button, then removed entirely at the user's request. `N` now only means next/skip during a session.

---

## Answer grading

All grading lives in `js/answer-check.js` (exposed as `window.SBAnswer`). The core is `checkAnswer(question, userInput)`, which follows Science Bowl conventions.

**Normalization** (`normalize()`): uppercases, unifies apostrophes, and strips punctuation. It also maps symbols to words so either form matches the other:
- `√` ↔ `SQRT`, `∛` ↔ `CBRT`, `π`/`Π` ↔ `PI`
- "square root(s) of X" → `SQRT X`, and "cube root(s) of X" → `CBRT X`

So `128 π` = `128 pi`, `cube root of 35` = `cbrt 35` = `cbrt(35)`, and `square root of 16` = `sqrt 16`.

> Bug caught during testing: `.toUpperCase()` runs first and turns `π` into capital `Π`, so the first version's `/π/` pattern never matched and the symbol was silently deleted. The fix matches `[πΠ]`. This was verified by running the code in Node, not just by reading it.

**Other rules**:
- **Accept and reject lists** (`a.ac`, `a.rj`) are honored.
- **Multiple choice**: accepts the letter (W/X/Y/Z) or the full choice text.
- **"Identify all" and list questions**: the item count is detected from the question's `1) … 2) …` markers, and the answer is canonicalized, so `1 and 3`, `13`, and `1, 3` all match. Item *names* are resolved to their numbers (e.g. "diatoms radiolarians"). **"All but X"** phrasing is resolved by excluding the named or numbered item(s).
- **Ranking questions** keep order (a permutation) instead of being treated as sets.
- **Bare numbers** match answer keys like `8 FACTORS`. Leading-number extraction and set comparison handle numeric answers.
- **Lenient matching**: stop-word-tolerant word matching, whole-run containment, and a Levenshtein typo tolerance that scales with answer length.

Regression-tested against about 4,000 real "identify all" questions from the corpus, with 0 regressions.

---

## Architecture

```
index.html  catalog.html  solo.html  multiplayer.html  bookmarks.html
css/style.css
js/data.js          shared loader, text cleanup, math rendering, filters, UI widgets, bookmarks
js/answer-check.js  grading (SBAnswer)
js/reveal.js        letter-by-letter reveal engine (replaced text-to-speech)
js/catalog.js  js/solo.js  js/multiplayer.js  js/bookmarks.js   page logic
js/peer.js          PeerJS wrapper: makeHost / makeClient / friendly error messages
js/vendor/peerjs.min.js   vendored PeerJS (no CDN dependency)
data/questions.json  data/meta.json
```

### `js/data.js` (`window.SBData`)
- **`SBData.load()`** fetches `questions.json` and `meta.json` and expands the compact records. It also normalizes `meta` in one place so every page benefits:
  - `meta.subjects`, a flat array of keys, is expanded to `{key, label}` objects. This fixed a long-standing bug where subject chips rendered **with no text** on every page.
  - Subjects are reordered to **Math, Physics, Biology, Chemistry, Earth & Space, Energy**. (`meta.json` stores them alphabetically, a leftover of how the Python scripts built it.)
  - Question types are reordered so **Tossup always comes before Bonus**.
- **Display-time text cleanup** (`cleanText` and friends). This is non-destructive, and each regex's scope was checked against the whole corpus:
  - `stripAuthorTag`: trailing Discord-style author tags (`name#1234`)
  - `stripTrailingWatermark`: trailing `2019 DSB ®`-style watermarks
  - `stripPronunciation`: bracketed phonetic hyphen-chains
  - `fixSpacedHyphens` / `fixSpacedApostrophes`: PDF-extraction spacing damage
- **`renderMathHTML`** turns real `^(...)`, `^token`, `_(...)`, and `_token` notation into `<sup>`/`<sub>`. By design it does **not** guess at lost notation; see [limitations](#known-limitations-and-open-items).
- **`answerDisplayText(q)`**: for MC questions the choice text wins over `a.t`, so a damaged answer field still displays correctly.
- **`answerLineHTML()`**: one shared "Answer: X (also accept: Y)" renderer, used by the catalog, solo, and multiplayer pages (previously copied three times). The "also accept" part now inherits the answer line's color, size, and weight instead of being dimmed and smaller.
- **`cleanRoundLabel()`** tidies round labels for display: it strips "Copy of", strips a repeated tournament name, and spaces letters from digits (`DE1` → `DE 1`).
- Also here: filtering (`filterQuestions`), shuffles (`shuffle`, `stratifiedShuffle`, `stratifiedQueue`), the dual round slider (`wireRoundRangeSlider`), searchable single and multi selects (`enhanceSelect`, `enhanceMultiSelect`), range-fill styling, and bookmark storage.

### Multiplayer networking
Peer-to-peer over WebRTC via PeerJS. The free public PeerJS broker is used only for the connection handshake; no game data goes through a server. The host's browser holds the authoritative game state (queue, timers, buzzes, scoring) and broadcasts it. Clients send intents (`join`, `buzz`, `submitAnswer`, `next`, `skip`, `togglePause`, `override`, `typing`, `updateSettings`, chat).

---

## Data format

### `data/questions.json`
A compact JSON array (about 25 MB raw, about 5.9 MB gzipped; GitHub Pages serves it gzipped automatically). Each record looks like this:

| Key | Meaning |
|---|---|
| `i` | unique integer id (the only hard uniqueness constraint) |
| `t` / `ts` | tournament name / slug |
| `r` | round number, or `null` for unlabeled |
| `rl` | raw round label (e.g. `RR 5`, `Set 3 · Round 12`) |
| `s` | subject key: `math`, `phys`, `bio`, `chem`, `ess`, `energy` |
| `f` | format: `SA` or `MC` |
| `qt` | `tossup` or `bonus` |
| `n` | question number within the round |
| `q` | question text |
| `c` | MC choices `{W, X, Y, Z}` |
| `a` | answer: `t` text, `l` MC letter, `ac` also-accept list, `rj` do-not-accept list |
| `u` | source packet URL (on 62,831 records) |

`(rl, n, qt)` is **not** guaranteed unique. Some packets really do contain spare or replacement questions that reuse a number (e.g. NWI 2025 DE5, CLASH "21A/21B", FE!M 2025).

### `data/meta.json`
`totalQuestions`, `tournaments[{slug, name, count, level}]` (sorted case-insensitively by name), `subjects`, `rounds`, `formats`, `qtypes`, `levels`, `generatedAt`. It's rebuilt from `questions.json` after every data change, and `totalQuestions` always equals both the sum of tournament counts and the record count.

`level` is `hs` or `ms` and belongs to the tournament, not the record: every question inherits its tournament's level at load time (`SBData.load()`), which drives the Level filter chips (the level isn't shown as a tag on questions). The middle-school tournaments are NSB MS Regs, CLASH 2026 MS, Bay Ultimate MS Scibowl, BUMS 2026, Dasoni Standard1, Deadbird Invitational and MOOSE 2021 (13,749 questions); everything else is `hs` (61,217). **A rebuild of `meta.json` has to carry each tournament's `level` over**, and a new tournament needs one assigned (a missing `level` is treated as `hs`). One known blur: "Random Stuff" is a grab-bag tournament that includes one MS earth-science packet but is tagged `hs` as a whole.

---

## Where the questions came from

The standing goal throughout was **every question from every tournament, no duplicates, verified by actual content** (never by file names alone), with **nothing fabricated or guessed**.

Sources used:
- **scibowl.live/packets**: the original ~875 packet PDFs across 66 tournaments (the first release had 36,145 questions). Later fully re-audited across all 4 listing pages; nothing new found.
- **scibowl.stanford.edu/tournaments**: about 136 tournament entries across seasons back to 2019–20. Packets came from per-tournament Google Drive folders, Google Docs (exported as `?format=txt`), niskyscibowl.com, and the `lebot.djiang.xyz/packets/…` mirror. A useful trick: an existing record's `u` field often pointed at a still-live mirror. Results-only hubs (isobowl.com, eyrieshub, results spreadsheets) had no packet content.
- **oly.mehvix.com** (the old cloud.mehvix.com, back online as a static file tree; 400 files across 20 folders): used for Dasoni Standard1, LOST 2, CSBL Rounds 7–10, ISBL Replacements, University Prep, Lexington HS 2020-21, and more.
- **science.osti.gov HS Sample Questions**: all 17 official NSB regional sample sets (242 PDFs, 12,331 questions at ingestion). Originally 16 "OSTI Sample Set N" tournaments; now consolidated into **NSB Regs** (see below).
- **science.osti.gov MS Sample Questions**: the official NSB middle-school sample sets 1–13 plus the four "Sample Rounds" PDFs (214 PDFs, fetched through a browser context because the site's Azure WAF serves curl a JavaScript challenge). Sets 14–16 were already in the bank via isobowl and were skipped. This added **9,868 questions** to **NSB MS Regs** (labelled `Set N · Round R`, or `Sample Rounds · Round Robin N` / `Double Elimination N`, whose DE rounds have no round number). Notes:
  - Superscripts were recovered from the PDFs' font flags rather than guessed (`4.56 × 10^11`, `6 × 10^3`), and Symbol/Wingdings private-use glyphs were decoded (θ, √, °, −, reaction arrows →, absolute-value bars).
  - Excluded, never guessed: 170 records with stacked math (fractions, radicals, big brackets) that the text layer splits into loose fragments, 7 more whose math was flattened onto one line (found by hand review), 4 lost radicals/fractions, 2 short-answer prompts whose expression is an image, 5 whose answer letter and answer text name different choices, 6 with missing or mislabelled choices, 4 whose answer is missing from the text layer, and 1 with no subject label. 117 questions already in the bank (from other tournaments) and 106 repeats across the MS sets were skipped.
  - Subjects: Life Science → Biology, Earth Science / Earth and Space → Earth & Space, General Science → Energy (the subject rule below). The old combined **Physical Science** category was split into Chemistry or Physics by a keyword classifier; on the 277 isobowl-labelled chem/phys MS questions it agrees with isobowl 88% of the time, so treat those two tags on the older MS sets as approximate.
- **2024 'Iolani Invitational Drive folder** (`drive.google.com/drive/folders/1-piDufZ3ECJNFpzU4pKyZ-uNHBuyI5uN`): all 7 round files checked by content; every question was already in **ISBL 2024**. The check did turn up one mangled answer there (the derivative of x·sin(x), whose nested "(Accept: …)" had been split mid-parenthesis), which was restored from the source.
- **The user's personal desktop archive** (865 files, 63 tournament folders of PDF/DOCX/PPTX): produced the new **2026 Texas Science Bowl Invitational** (640 questions) plus 2,594 missing questions spread across 48 existing tournaments.
- **The Science Bowl Periphery (speriphery.com) Google Drive folder** (`drive.google.com/drive/folders/1IIpY8rbKS2_tf5_Kwl2Ns_qAJ1FIkMic`; 67 tournament folders, 869 files, crawled via `embeddedfolderview`): every folder turned out to be a tournament already in the bank, so this was a straggler merge. Each packet was parsed and every question checked against the whole bank by content; only questions with no match were added. That produced **395 questions**: 224 Lexington HS 2020-21 questions (rounds 4–17 previously had only their bonuses; rounds 3 and 8 were partial), 104 CLASH 2026 replacement questions (62 HS / 42 MS, labelled `CLASH Replacement Questions` with no round number, like DASONI's replacements), 22 DASONI 2 (mostly DE8/DE9), 22 NSBA1, and 23 spread over 11 other tournaments. Excluded: visual bonuses, cross-subject "Synergy"/"Duality" questions, the SMH boss-battle joke round, questions whose equations or answers are missing from the source text, and LOST2 (image-only scans whose OCR was too noisy; LOST 2 was already ingested). Not reachable: the NWI2 2025 folder (private, 401) and ICSBT2 DE4 (owner disabled downloads). The sets speriphery.com has beyond this Drive (LBB 2026, MOOSE 2021, Yale 2026, LADWP 2023) came from its database instead; see the next two entries.
- **isobowl.com Premier packets** (public API: `/api/tournaments`, then `/api/tournaments/{id}/rounds` and `/rounds/{n}/questions`): only tournaments marked `completed` whose rounds the server actually releases. The server itself hides live packets ("hidden until the tournament concludes"), and live/upcoming events (e.g. National Chemistry Bowl, ICSBT 3) and completed-but-unreleased ones (Hawaii, ISOBowl Invitational) were not touched. Records are structured (choices, correct letter, accept/reject lists), so no text parsing was needed; LaTeX (`$$…$$`) was converted to plain text (√, ^, Σ, ∫, Greek) and the 20 records it couldn't fully convert were dropped, as were 20 image questions. Added: **NSB MS Regs** (new; the official MS sample sets 14–16), **Trio Online Math Bowl 2026** (479), **NSBA4** (432, including 76 computer/general-science questions filed under Energy), and 69 NSB Regs high-school questions that fill empty (set, round, number) slots, almost all clean copies of records removed earlier as unrecoverable. The other ~11,800 NSB high-school questions lined up slot-for-slot with existing records and were skipped.
- **speriphery.com database** (its public Supabase `questionbank` table, the same read-only endpoint its own site uses; 18,070 rows): dedup against the bank plus the isobowl batch left 994 candidates, and **984** were added. 888 went into new tournaments: **Lexington Biology Bowl 2026** (428), **MOOSE 2021** (349; an MS event, unrelated to our older "Moose" tournament, which actually holds DAST packets), **Yale 2026** (80), and **LADWP 2023** (31, labelled `Finals (reconstructed)` because speriphery's maintainer rebuilt that round from the match video). The other 96 are stragglers placed in the tournament/round their already-ingested siblings map to. Skipped: 113 visual bonuses, 77 rows whose LaTeX didn't fully convert, 9 of speriphery's rewrites of questions we already have (e.g. a classification question turned into "identify all"), and one question whose answer choices speriphery had silently corrected.
- **sciencebowl.org (atombowl)**: not ingested. Its Firestore question store only serves signed-in users (unauthenticated reads return `PERMISSION_DENIED`); bulk-exporting it through an account would use the login to get around that restriction, so it would need the owner's permission or an export from them.

### Middle-school content, subject rule, and NSB repair
- **Middle-school content** is kept. It was briefly removed (3,879 questions) and then restored from git: NSB MS Regs (the official MS sample sets: 14–16 via isobowl, 1–13 and the Sample Rounds from OSTI), CLASH 2026 MS, Bay Ultimate MS Scibowl, BUMS 2026 (the same event ingested twice), Dasoni Standard1 (Davidson's MS "Standard" division), Deadbird Invitational (DBHSST), and MOOSE 2021. A re-check of isobowl's and speriphery's MS data against the bank found 4 more questions (2 isobowl general-science items filed under Energy, 1 NSB 2021 MS question, 1 MOOSE question), which were added.
- **Subject rule**: any question whose source subject isn't Math, Earth & Space, Physics, Chemistry or Biology (general science, computer science, "Synergy", and so on) is filed under **Energy** rather than dropped.
- **NSB Regs repaired from isobowl's structured copies of the same official sets**, matched slot by slot (set, round, question number, tossup/bonus) and confirmed as the same question by answer or near-identical wording: 131 questions whose text or choices had lost their math (doubled italic glyphs, missing expressions, empty choices) were replaced with the clean text and answer; 348 answers that had lost math or had an "ACCEPT" note mashed into them were replaced; and 618 more questions had flattened exponents restored (`2x4 + 3x3` → `2x^4 + 3x^3`). Existing accept/reject lists were kept and merged with isobowl's.
- **Whole-bank formatting pass** (every record audited against the data format):
  - Inline accept notes moved into the answer lists: "(ACCEPT: …)", "(ALSO ACCEPT …)", "(DO NOT ACCEPT: …)" inside answers (~700), and "ACCEPT: x; DO NOT ACCEPT: y" strings stored as single list items, were split into `ac`/`rj`. Pronunciation notes, empty lists, and joke comments were dropped from `ac`. Instructions such as "(accept any order)" were kept in the answer text.
  - Multiple choice: 186 answers that had the letter only in the text ("W) …") now have `l` set. 3 choice sets that had merged ("… Y) …") were split back into four. 3 NSB questions with missing choices were restored from isobowl. 8 "MC" records that were really short-answer questions split at a variable name were rejoined. 8 multi-part questions whose W–Z choices belong to one sub-part became short-answer with the choices written inline.
  - Answers with the next question glued on, trailing "BONUS"/"TOSS-UP" markers, solution notes, and packet footers ("MIT Science Bowl Invitational", "Page 7") were trimmed.
  - Characters: Wingdings arrows (→), α, bracket-glyph fragments, control characters and stray LaTeX were fixed. Whitespace and newlines were collapsed, and "word ?" spacing was fixed (ratios like "3 : 4 : 5" were left alone).
  - **57 unrecoverable records removed**: 36 truncated stems ("Giving your", "Short", "Evaluate.."), 13 MC questions with missing or empty choices, and 8 whose answer was lost or whose answer field held the rest of the question.
  - Left as is: 548 records without a question number (their sources don't number them; the site doesn't display numbers).

### Corpus size over time
36,145 (first release) → 44,742 → 45,475 (broken-parse repairs) → 47,074 → 47,891 → 59,822 (OSTI) → 63,048 (desktop archive) → 62,976 (unrecoverable/visual-bonus removals) → 61,619 (duplicate removal) → 61,618 → 62,013 (speriphery Drive stragglers) → 65,075 (isobowl + speriphery databases) → 61,272 (MS removed, NSB repair) → 65,155 (MS restored) → 65,098 (formatting pass) → **74,966** (OSTI MS sample sets 1–13, current).

---

## Ingestion pipeline and methodology

1. **Find the source**, then download each round. Browser-context `fetch()` + blob download was needed because the container's network proxy blocked direct downloads. Files were then staged into the workspace.
2. **Extract text**: `pdftotext -layout` for PDFs, direct text export for Google Docs, and python-docx/python-pptx for Office files.
   - **Corrupted PDF text layers go straight to OCR** (`pdftoppm -gray -r 200` + `tesseract --psm 6`). Three corruption variants were found: ligatures mapped to the wrong characters ("diHerent", "Jips", "=rst"; Dasoni Standard1), the letter "r" silently dropped ("Ans er"; CSBL R7–10), and random spaces inserted mid-word ("AN SWER"; NESB tiebreak). A different text extractor reproduces the same corruption, so OCR is the only fix. LOST 2 was entirely scanned images and was OCR'd from scratch.
3. **Parse** with a shared marker-based parser (`parse_packets.py`, kept in the working scratchpad, not shipped). Each fix below was checked against a 15-folder self-test to confirm no regressions:
   1. spurious sub-blocks flipping tossup/bonus alternation
   2. `CHOICE_RE` accepting bare `W Sigma 2p`
   3. case-insensitive footer stripping
   4. CLASH `TOSSUP N` format preprocessing
   5. `LONG BONUS` marker
   6. `\x0c` page breaks treated as line breaks
   7. an `ANSWER:` regex matching questions that begin "Answer the following…"
   8. the bare-space choice form restricted to uppercase, so `y = 3x2…` equation lines aren't swallowed
   9. `Y-Risk`/`Estimation` subject labels
   10. title-word extraction on titles like `FE!M 2025`
   11. a wider footer character class plus bare page-number stripping
   12. the literal `ESS` subject self-mapping (this alone took FE!M from 78.5% to 97.8% parsed)
4. **Dedup and compare in both directions**: check which fresh-parse records are missing from the corpus, and which corpus records are missing from the fresh parse, before choosing **merge** (add stragglers) or **replace** (the existing rows are the same content but structurally corrupted). Dasoni Comp1 showed why: a blind replace would have destroyed 7 good records.
5. **QA every new record**: header or footer text bleeding in, marker words left behind, MC choice-count and answer-letter checks, garbled inline math, interleaved two-column text. Unrecoverable records are **excluded, never guessed**.
6. **Back up, write, validate** (`final_validate.py`, `node --check` on every JS file), then remove the backups.

Subject-specific tournaments (Earth and Space Scrimmage, National ChemBowl) have every question forced to their single subject.

---

## Data-quality work history

### Structural repairs
- **Broken legacy parses replaced**: 9 tournaments whose original rows were structurally corrupt (all question numbers missing, and/or every question tagged as one type): TJSBT 2025, CLASH 2026 HS/MS, Pohaku 2024, Bash 2025, THUMB 2025, MNSBT 2024, ISBL 2024, and CSUB (1,211 → 1,642; it has two separate question pools, individual `rround01–17` plus combined `rround1-9`/`10-17`). ISBL's old rows also had every subject wrongly forced to Earth & Space.
- **Hidden duplicate-number corruption** found by content comparison even where the coarse scan passed: Berkeley 2023, ESBOT 1, BASED 2025, NWI 2025, all replaced. MIT 2020–2025, SSBT, WISC, and ESBOT 2 were clean, and got straggler merges only.
- **Round ordering**:
  - Phases numbered continuously within each tournament (RR → DE/Playoffs → Finals) so the round slider makes sense: 1,100 records fixed in WSBT, Dasoni Standard1, CLASH HS/MS, NSBA1, and SSBT 2023.
  - A later label-collision bug (e.g. `RR5` and `Stanford RR 5` both *display* as "RR 5" but had different `r` values, which put a Stanford 2026 question in "round 28"): 220 records fixed across 10 tournaments. Global max round went from 28 to 20.
- **OSTI → NSB Regs**: the 16 "OSTI Sample Set" tournaments were merged into one **NSB Regs** tournament. Round `r` equals the round number *within the set*, so "Round 1" gathers Round 1 from every set. Labels read `Set N · Round M` so the set is still visible. (The first version offset each set's rounds, reaching 257; it was reworked at the user's request.)

### Content cleanup
- **Visual/audio bonuses removed**: questions that depend on an image or audio clip (8, then another 63 after tightening the detector so words like "imaged" or "shown" in ordinary prose don't trigger it). One deliberate exception, i=21330, says to ignore its image.
- **Contamination stripped**: page footers, round labels, copyright marks, and author tags that leaked into 362 fields; a trailing "Texas Science Bowl Invitational" on 26 answers; "NOTE:" trivia removed from accept lists (24 removed, 1 cleaned).
- **MC fixes**: 186 records that had choices but were tagged SA were retagged MC; 175 records whose W/X/Y/Z choices were still embedded in the question text were split out.
- **Math-notation repair**, done only where it could be proven (computation with sympy, or unambiguous context):
  - about 280 missing carets (`10 N` → `10^N`, `10 − N` → `10^-N`, `2 100` → `2^100`, …)
  - about 80 missing fraction slashes, and about 15 missing radicals
  - digit-split numbers and stray tournament years in answers
  - about 140 decimals with a space inside (`4 . 0` → `4.0`)
  - an Ohm sign OCR'd as "Q", and `!` standing in for lost `−`/`∫`
  - 13 OSTI records with missing √/^/÷ derived and verified by hand
  - FE!M's steepest-descent answer computed exactly: (−12/13, −5/13)
- **Pronunciation and reading aids removed across the corpus**:
  - About 7,965 spans in 5,175 records: `( rih-KETT-see-uh )`, `(read: f of x)`, `[read: e raised to…]`, `(READ AS …)`, `(pron: …)`, and spelled-out restatements like `[2 square root of x plus …]`.
  - A second pass (10 more spans) fixed a classifier bug that wouldn't treat ordinals like "38th" as part of a reading aid.
  - A third pass removed short Roman-numeral and subscript read-outs (`[H one]`, `[R two]`, `(III) [three]`, `Ice X [ten]`, `[plus ten]`): all 49 matches were checked by hand, 31 records cleaned.
  - Protected, and not touched: `(ACCEPT: …)`, `(DO NOT ACCEPT: …)`, `(NOTE: …)`, oxidation states like `(II)`, intervals like `[0,1]`, coordinates, chemical formulas like `[Ni(CN)4]`, and math in parentheses like `(N log N)`.
- **Leaked metadata stripped**:
  - Segment/format prefixes such as `[Mid SE] - Short Answer` or `[3] – Multiple Choice` on 118 + 155 questions. A required space after `]` protects the real compound name `[18]-annulene`.
  - CLASH 2026 subject tags stuck on the end of answers (`80/3 GEO 6` → `80/3`): 988 records.
  - NSI 2023 author initials (`… (MK)`): 104. Dasoni Standard1 initials: 2.
  - A corrupted `[GKD}]` on 18 Dasoni Standard1 answers.
- **Small targeted fixes**:
  - CSUB round-label typo `rround` → `round` (1,642 records)
  - stray Markdown `**`/`*` in NSBA1/NSBA2 (41 records; real multiplication and a question about the `*` operator were left alone)
  - BTHS 2025 degree signs lost as `*` (`90*` → `90°`)
  - a stray `→` in Texas Sci Bowl 2025
- **Unrecoverable records removed** instead of guessed: 6 collapsed OSTI Set 3 equations, Dasoni Standard1 i=54985, MEHS Rounds i=12276, orphan fragment i=3115, and others noted during ingestion.

### Duplicate removal
A later "re-scrape" batch (mostly ids ≥ 70000) had duplicated content from about 30 tournaments without removing the originals.

The detector:
- groups records by tournament, round, type, format, subject, and normalized answer (keeping digits and minus signs)
- within a group, requires word-overlap (Jaccard) similarity ≥ 0.75 **and** at least 3 shared significant words, plus a length-ratio check
- merges multi-way duplicates with union-find

The **better-quality** copy wins, not the newer one. The quality score rewards intact √, π, ∫, and °, and italic math letters, and penalizes spacing damage. In 28 groups the older record won because the re-scrape had lost symbols. Examples: the IGNIS 2022 radicals, and a CSBL "π/2 radians" that the re-scrape had cut to "2 radians".

Result: **1,357 duplicates removed** (62,976 → 61,619). One more pair was removed by hand (ESBOT 2 inner product, garbled i=8106, whose clean copy uses Unicode italic 𝑤/𝑣/𝑖 the detector didn't match) → **61,618**.

---

## Site/UI change history

- **Text-to-speech replaced** with the on-screen reveal engine, which is robust in background tabs and supports live speed changes mid-question.
- Subject chips showing no text: fixed centrally in `SBData.load()`.
- Mobile nav overflow and oversized hero heading fixed.
- "Also accept" moved onto the answer line via the shared `answerLineHTML()`, then restyled to match the "Answer:" text.
- Subject chip order set to Math → Physics → Biology → Chemistry → Earth & Space → Energy; Tossup before Bonus everywhere, including the settings panels.
- Stratified subject queue made fully round-robin, which fixed a report of 60% Physics in a 40-question session.
- In-session settings for solo; room settings editable by every player in multiplayer.
- All-subjects-off resets to all-on when the settings panel closes (solo and multiplayer).
- Room codes uppercased before joining.
- `N` shortcut added to home, moved to solo start, then reverted (see [shortcuts](#keyboard-shortcuts)).
- π/Π, ∛, and "square/cube root of" equivalences added to grading.

---

## Project conventions and hard-won lessons

- **Never trust file or folder names.** The FE!M 2025 Drive file "DE1.pdf" was internally "Round 6". The Moose folder held DAST files. Lexington's "Round 8.pdf" carried a leftover "[ROUND 3]" header. Always confirm by content.
- **"Looks healthy" isn't proof.** Always compare against a fresh parse in both directions.
- **Never fabricate.** If math or content can't be derived and verified, leave it or remove the record. Don't guess.
- **Fix things once, centrally.** Display-order and label problems were fixed in `SBData.load()` instead of at every call site.
- **Prefer assert-then-replace.** A plain `str.replace` built from terminal output that had been cut off at the window width once matched a *substring* ("AUDITOR" inside "AUDITORY") and left fragments behind.
- **Check your own tools.** The dedup normalizer first stripped digits, which made "2 AND 3" equal "1 AND 3", and then minus signs, which made "1" equal "−1". Both were caught by reviewing candidates before deleting anything.
- Back up before every data write, validate after, and keep `meta.json` in sync with every record removal.

---

## Known limitations and open items

- **Lost exponent/radical notation that can't be recovered.** Some PDFs lost `^`, `√`, or superscripts during the original extraction, leaving `x2`, `t2`, `738` (meant as 7³⁸), `e2x`, and so on. A bare `x2` looks the same as a subscript (x₂), a chemical formula (H2O), or an ordinary number, so the project deliberately does **not** reconstruct these by pattern-matching. Examples still affected: NWI 2024's ellipse question (one copy is cut off, the other has a garbled equation), MHS Rounds' Laplace transform of `t2`, several CSUB integrals, and NSB Regs Set 6's "area under … y = ?" (the function itself is missing from the source text).
- **Duplicates across tournaments.** Dedup ran *within* each tournament. Checking across tournaments (normalized question text) shows real overlap: **Bay Ultimate MS Scibowl vs BUMS 2026** (446 of 516 match; almost certainly the same event ingested twice), **DAST 2 / DAST1 / Moose** (360), **Cast 2021 vs Lexscibowl 2021** (309), **CSBL vs NNHS Rounds 2020-21** (133), CSBL vs Deadbird (68), CCWT vs Random Stuff (45), BTHS 2025 vs Brooklyn Tech Invitational (33), and smaller amounts elsewhere. Some reuse between tournaments is legitimate (organizers do reuse questions), but the larger pairs should be reviewed and merged.
- **CSUB's combined packets**: 448/400 questions from `rround1-9`/`rround10-17` sit on rounds 1 and 10, because the source doesn't say which specific round each belongs to.
- **BASIS Peoria Rounds**: RR, DE, and "NATS" labels overlap in round number, and the phase order can't be inferred, so it was left as-is.
- **SSBT 2023**: one Finals group has no round number (`r = null`).
- **NSB MS Regs, sets 1–13**: Chemistry vs Physics on questions the source labels "Physical Science" comes from a keyword classifier (see sources above), and "General Science" questions sit under Energy per the subject rule.
- **Sources not ingested**: isobowl.com packets that are live, upcoming, or not yet released (re-check after those tournaments conclude); sciencebowl.org (login-gated; needs the owner's permission); Pleasanton Invitational's sheet returned 401; the SMH League Cup "information document" was never opened.
- **Round slider** is global (max 20), not scoped to the selected tournament.

---

## Deploying

1. Put the contents of this folder at the root of a GitHub repo, or in `docs/`.
2. Push, then go to **Settings → Pages → Deploy from a branch**, choose `main`, and pick `/ (root)` or `/docs`.
3. The site will be live at `https://<you>.github.io/<repo>/`.

There's no build step, `npm install`, or environment variables. The `node_modules/` folder in the working copy was only used for local Playwright testing and isn't needed to deploy. Delivery zips exclude `node_modules/` and `*.bak*` files.

## Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

Checks used throughout development:
- `node --check js/*.js` for syntax
- Node harnesses that load `answer-check.js` directly (it attaches to `globalThis` outside the browser)
- Playwright with the preinstalled Chromium for DOM and screenshot verification

---

## Appendix: tournament list

| Tournament | Questions |
|---|---|
| 2026 Texas Science Bowl Invitational | 639 |
| AVES 2 | 563 |
| AVES 2025 | 538 |
| BASED 2025 | 610 |
| Bash 2025 | 625 |
| BASIS Peoria Rounds | 755 |
| Bay Ultimate MS Scibowl | 516 |
| Berkeley 2023 | 644 |
| Brooklyn Tech Invitational | 367 |
| BTHS 2025 | 297 |
| BUMS 2026 | 516 |
| Cast 2021 | 410 |
| CCWT | 275 |
| CCWTWO | 265 |
| CLASH 2026 HS | 677 |
| CLASH 2026 MS | 418 |
| Clements 2025 | 506 |
| CSBL | 934 |
| CSUB | 1,641 |
| CUT 2026 | 625 |
| DASONI 2 | 613 |
| Dasoni Comp1 | 427 |
| Dasoni Standard1 | 503 |
| DAST 2 | 452 |
| Dast 2025 | 495 |
| DAST1 | 456 |
| David Rounds 2019 | 299 |
| Deadbird Invitational | 401 |
| Dvhs 2025 | 422 |
| Earth and Space Scrimmage 2024 | 250 |
| Earth and Space Scrimmage 2025 | 340 |
| ESBOT 1 | 562 |
| ESBOT 2 | 591 |
| Fall 2023 | 621 |
| FE!M 2025 | 631 |
| GWHS Rounds | 735 |
| ICSBT 2 | 535 |
| ICSBT 2025 | 469 |
| IGNIS 2022 | 747 |
| ISBI 2025 | 452 |
| ISBL 2024 | 292 |
| LADWP 2023 | 31 |
| Lexington Biology Bowl 2026 | 428 |
| Lexington HS 2020-21 | 758 |
| Lexscibowl 2021 | 402 |
| LOST 1 | 628 |
| LOST 2 | 561 |
| MEHS Rounds | 773 |
| MHS Rounds | 871 |
| MIT 2020 | 625 |
| MIT 2021 | 621 |
| MIT 2022 | 683 |
| MIT 2023 | 637 |
| MIT 2024 | 651 |
| MIT 2025 | 968 |
| MNSBT 2024 | 650 |
| Moose | 454 |
| MOOSE 2021 | 350 |
| MOSFET 2 | 506 |
| MOSFET 2024 | 600 |
| Mosfet1 | 605 |
| NCB 2026 | 283 |
| NESB | 991 |
| NNHS Rounds 2020-21 | 778 |
| NSB MS Regs | 11,045 |
| NSB Regs | 11,988 |
| NSBA1 | 726 |
| NSBA2 | 311 |
| NSBA4 | 432 |
| NSFBL | 549 |
| NSI 2023 | 272 |
| NSI 2024 | 261 |
| NWI 2024 | 286 |
| NWI 2025 | 395 |
| Olympus 2022 | 656 |
| Pohaku 2024 | 322 |
| Prometheus 2021 | 849 |
| Random | 779 |
| Random Stuff | 489 |
| SBL | 1,590 |
| SBST | 659 |
| SBST (Spring) | 628 |
| SCB 2025 | 492 |
| SMH 2025 | 548 |
| SSBT 2023 | 558 |
| Stanford 2025 | 667 |
| Stanford 2026 | 655 |
| Summer 2019 | 134 |
| Texas Sci Bowl 2025 | 678 |
| THUMB 2025 | 205 |
| Tjsbt 2025 | 566 |
| Trio Online Math Bowl 2026 | 479 |
| University Prep | 50 |
| Walton Rounds | 755 |
| WISC 2021 | 392 |
| WSBT | 502 |
| Yale 2026 | 80 |
| **Total (97)** | **74,966** |
