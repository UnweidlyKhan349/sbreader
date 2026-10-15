# SB Reader

A static Science Bowl practice site built from real tournament packets: a searchable catalog, a solo buzzer trainer, a peer-to-peer multiplayer mode, and per-device bookmarks. It's plain HTML/CSS/JS, with no backend, build step, framework, or server-side code, so it can be deployed straight to GitHub Pages or any static host.

**Current question bank: 74,079 questions from 99 tournaments** (37,176 tossups / 36,903 bonuses; 46,658 short answer / 27,421 multiple choice), including **532 visual questions** whose figures (536 images) are shown with the question.

| Subject | Questions |
|---|---|
| Biology | 15,603 |
| Earth & Space | 15,138 |
| Physics | 13,498 |
| Math | 13,361 |
| Chemistry | 13,338 |
| Energy | 3,141 |

This README covers what the site does, how it's built, the data format, and how to run and test it. Where the questions came from and how they were cleaned is in [docs/data-history.md](docs/data-history.md), the per-tournament counts are in [docs/tournaments.md](docs/tournaments.md), and site changes are in [CHANGELOG.md](CHANGELOG.md).

---

## Contents

1. [Pages and features](#pages-and-features)
2. [Keyboard shortcuts](#keyboard-shortcuts)
3. [Answer grading](#answer-grading)
4. [Architecture](#architecture)
5. [Data format](#data-format)
6. [Visual questions](#visual-questions)
7. [Known limitations and open items](#known-limitations-and-open-items)
8. [Deploying](#deploying)
9. [Local development and tests](#local-development-and-tests)

---

## Pages and features

### `index.html` (Home)
A landing page with cards linking to Catalog, Solo Practice, and Multiplayer. The tagline shows the live question and tournament counts, read from `meta.json` alone (the home page never downloads the question bank).

### `catalog.html` (Catalog)
- Browse and search every question. Search covers question text, answers, and tournament name, with a debounce on input. Matches are highlighted in the results, and exponent markup is ignored, so `7100` finds `7^100`.
- Filters: subject chips, a dual-handle **round-range slider** with an "Include unlabeled" checkbox (1,318 questions have no round number), question type (Tossup/Bonus), format (Short Answer/Multiple Choice), level (High School/Middle School), **visual questions** (Visual/Text only; selecting neither means both), and a searchable multi-select tournament picker. There's also a "Clear all filters" button.
- Results are listed in packet order: by tournament (A–Z), then round (unlabeled rounds last), then question number, each tossup before its bonus. Filtering to MIT 2023 shows Round 1 from question 1, then Round 2, and so on. NSB Regs, whose rounds are numbered within each set, shows Round 1 of every set before Round 2 (`SBData.sortByPacketOrder`).
- 40 results per page, with pagination and a jump-to-page input.
- Each card shows subject/type/format tags (a bonus with a figure is tagged **Visual Bonus** instead of Bonus; a tossup with a figure gets a separate **Visual** tag), the question, its figure(s) (click to enlarge), MC choices, the answer line (with inline "also accept"), the tournament and round label, a link to the original packet (when there is one), and a bookmark star.

### `solo.html` (Solo Practice)
- **Setup screen**: pick subjects, round range, question type, format, level (High School/Middle School), visual questions (Visual/Text only), and tournament(s), plus reading speed. A live "N questions match your filters" count updates as you go.
- **Reveal instead of text-to-speech**: questions and their answer choices type themselves onto the screen (`js/reveal.js`) at an adjustable speed, from 0.5× to 2.5×. At 1.0× that's 21 characters per second. The reveal position is computed from wall-clock time rather than tick counts, so it doesn't fall behind in a backgrounded browser tab. Your speed is saved in `localStorage` (`sb_rate`).
- **Figures**: a visual question shows its figure (between the question text and the choices) as soon as the question starts (the figure is part of the question, not something revealed letter by letter). The space the question text will take is reserved up front, so the figure doesn't jump as the text types out, and the next question's images are preloaded while you answer this one. Click a figure to open it full-size; `Esc` or a click closes it.
- **Timers**: a 4 s buzz window for tossups and 20 s for bonuses once the reveal finishes, then 10 s to type an answer.
- **Grading**: automatic (see [Answer grading](#answer-grading)), with a manual **override** if the grader gets it wrong. The score bar tracks Correct, Incorrect, and Total.
- **Question queue**: built with `SBData.stratifiedQueue`, a round-robin across subjects that keeps cycling. Subjects stay evenly mixed for the whole session even when one subject has far fewer matching questions.
- **In-session Settings panel** (⚙ / `S`): change reading speed and every filter mid-session. Changes apply live and only rebuild the not-yet-asked part of the queue, so you won't see a question twice. If you turn off every subject and close the panel, it resets to all subjects, so the next time you open it you get a working selection instead of zero matches.
- Pause/resume, bookmarking, and a "Previous questions" log.
- **Bookmarked mode**: the bookmarks page's "Practice these" button opens `solo.html?bookmarked=1`, which skips setup and drills only your bookmarks, ignoring subject/format/round filters. An inline `<head>` script hides the setup screen before the first paint so it never flashes.

### `multiplayer.html` (Multiplayer)
- **Host or join a room** with a 5-character code. Codes use an alphabet without look-alike characters (no I/L/O/0/1). The underlying PeerJS peer ID is `sbowl-XXXXX`, but players only ever see and type `XXXXX`. Codes are **uppercased before connecting**, so typing `xfts2` joins `XFTS2`, and a pasted `sbowl-` prefix is handled whatever its case.
- Everyone can buzz. The first buzz locks everyone else out until that player answers, and a wrong answer locks that player out for the rest of the question.
- **Scoring**: +4 for a correct answer. A wrong answer costs −4 if you buzzed before the question finished revealing, and 0 otherwise. Players can override their own graded answer, except that a wrong answer can't be overridden to correct once someone else has scored the question.
- Visual questions show their figure to everyone when the question starts (the host preloads the next question's images); the Visual/Text-only choice is a room setting like the other filters.
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

While an enlarged figure is open, it takes the keyboard: `Esc` closes it and no game shortcut reaches the page underneath.

**Solo (in session)**: `Space` buzz · `Enter` submit · `N` next/skip · `Q` override grading · `B` bookmark · `P` pause/resume · `S` open settings (not in bookmarked mode) · `Esc` close settings

**Multiplayer (in game)**: `Space` buzz · `Enter` submit · `N` next (after reveal) / skip (while reading) · `P` pause · `Q` override your own grade · `B` bookmark · `S` room settings · `/` focus chat · `Esc` close settings


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
- **Ranking questions** keep order (a permutation) instead of being treated as sets, however the numbers are typed (`132`, `1, 3, 2`, `1 and 3 and 2`). A ranking is recognised from "order/rank/arrange/sort … the following", "in increasing/chronological order", "by increasing/decreasing …", "chronologically" or "from earliest … to …", but never in an "identify/select all" question, and "second-order" or "in order to" don't count. The ordering can come from the key or an accept (`2/5; 0.402; 42%` with accept `3, 2, 1`). Before this, a ranking stem that didn't put "the following" right after the verb was graded as a set, and even recognised rankings accepted any order typed with commas or spaces (`3, 2, 1` passed for `1, 3, 2`); only a bare digit run like `321` was checked.
- **Bare numbers** match answer keys like `8 FACTORS`. Leading-number extraction and set comparison handle numeric answers.
- **Spacing-insensitive match**: answers that contain a letter and are identical once whitespace is removed count as equal, so `SiO2` matches an answer key of `SI O2` and `MgCl2` matches `MgCl 2` (PDF extraction scattered spaces through formulas). Punctuation is kept, so `1.5` never meets `15`, and bare numbers are excluded because spacing can matter there. The same rule applies to reject lists. Checked against the whole corpus: grading every short-answer question with another question's answer gives exactly as many acceptances as before (no new false positives).
- **Multi-part answers** (a key with top-level `;` parts, e.g. `FIRST QUARTER; FULL`): every part must be given, and each is matched on its own. The typed answer can be split with `;`, `,`, `and`, `then`, or nothing at all (`first quarter full moon`), and a part can carry one extra word (`full moon` for `FULL`). A part's label or number can be left off (`25` for `MEDIAN = 25`, `magnons` for `1) MAGNONS`). Order is enforced for "respectively", ranking, or sequence questions and for labelled parts. Otherwise any order is accepted, as it is when the packet says "either order". A single-part accept is only an alternate for that one part (`LH` for `LUTEINIZING HORMONE`), and `1ST QUARTER | FULL MOON` gives an alternate for each part. Before this change, a single part often passed as a whole answer through the fuzzy fallback (`full moon` alone) or through a lone per-part accept (`LH`, `COPPER`), while `first quarter and full moon` was marked wrong. Checked across the corpus: a main answer, a whole-answer accept, or the parts joined by `,` or `and` now always pass (531 multi-part questions). The only inputs that no longer pass are single parts and out-of-order answers to ordered questions.
- **Signs on numbers**: `normalize()` strips `-`, so `-2` used to equal `2`. Now, when both answers start with a number, that leading number's sign must match. So `195 degrees` fails `-195 degrees`, `2+sqrt6` fails `-2+sqrt6`, and `negative 2`, `minus 2`, and `−2`/`–2` all equal `-2`. When both answers contain the same numbers in any order, each number's sign must also match: `3 + 5i` no longer passes `5i - 3`, and `5, 7` no longer passes `-5, 7`. A dash after a digit (`20 – 21`, `2 - 3i`) or attached to a letter (`G-2`, `A-1`) might be a range, subtraction, or label, so it isn't read as a sign. Leading zeros are kept (`001` ≠ `1`). Checked on the corpus: of 674 answer keys that start with a negative number, 659 used to accept the answer with the sign dropped. Now 18 do, and in each of those the main key or an alternate is written without a sign. The bare-number set comparison also skips multi-part keys, so a reversed answer to a "respectively" question (`18; 16` for `16; 18`) no longer passes.
- **Fractions and decimals**: a decimal and a fraction with exactly the same value match, so `0.5` = `1/2`, `0.75` = `3/4`, `5.5` = `11/2`, also with a trailing unit or symbol (`0.5 pi` for `1/2 PI`, a bare `0.5` for `1/2 METERS`). Nothing else is compared by value: two fractions, two decimals, or a decimal and an integer are still compared as written, because packets reject unreduced fractions (`15/60` for `1/4`) and dropped significant figures (`1 × 10^-8` for `1.0 × 10^-8`). The fraction must be in lowest terms, and `0.33` is not `1/3`. Checked on the corpus: no main answer stops passing, and the only new cross-answer matches are true fraction/decimal pairs.
- **Abbreviations**: `ER`, `RER` and `SER` read as endoplasmic reticulum, rough and smooth endoplasmic reticulum (so `rough ER` matches `ROUGH ENDOPLASMIC RETICULUM`). The table is in `normalize()` in `js/answer-check.js`.
- **Exponent markup is ignored**: `x^2` = `x2` and `e^(-x)` = `e-x`, so answer keys that gained `^` in the superscript repair still accept what students type.
- **Alternates inside the key**: a key that lists its own alternates (`ITCZ OR INTERTROPICAL CONVERGENCE ZONE`, `GREEN ACCEPT: EMERALD`) accepts each one, and a trailing note in parentheses can be left off (`TORRICELLI'S THEOREM (OR LAW)`). An `OR` is not split when the key is an equation or inequality, or says both answers are required (`x = 0 or x = 9 (MUST GIVE BOTH ANSWERS)`).
- **Exact key wins over the reject list**: typing the key character for character (`+6`) passes even when a reject entry only differs in punctuation (`6`).
- **Word order, stop words and plurals**: `jupiter saturn` = `SATURN AND JUPITER`, `the troposphere` = `TROPOSPHERE`, `mitochondrion` = `MITOCHONDRIA`.
- **Close, not correct**: a typo within a tolerance that grows with word length (`deuterosomes` for `DEUTEROSTOMES`), or the whole key plus more words (`sodium chloride` for `SODIUM`), is marked wrong with `close: true`. Solo and multiplayer then show "Close", and the player overrides with `Q` if they meant it. A swap that names a different term never counts as close: `hypertonic`/`hypotonic`, `alkane`/`alkene`, `nitrate`/`nitrite`, `triphosphate`/`diphosphate`, `aerobic`/`anaerobic` and the other pairs in `CONTRAST_SWAPS`.
- **Incomplete answers are wrong**: an answer that leaves out part of the key (`carbon` for `CARBON DIOXIDE`, `dwarf` for `WHITE DWARF`) gets no credit.

`npm test` checks these rules and grades every answer key and every whole-answer accept in the corpus against its own question (see [Local development and tests](#local-development-and-tests)).

---

## Architecture

```
index.html  catalog.html  solo.html  multiplayer.html  bookmarks.html
css/style.css
js/data.js          shared loader, text cleanup, math rendering, question cards, filters, UI widgets, bookmarks
js/answer-check.js  grading (SBAnswer)
js/mp-rules.js      multiplayer host rules with no DOM code: message validation, who may override (SBMpRules)
js/reveal.js        letter-by-letter reveal engine (replaced text-to-speech)
js/catalog.js  js/solo.js  js/multiplayer.js  js/bookmarks.js   page logic
js/peer.js          PeerJS wrapper: makeHost / makeClient / friendly error messages
js/vendor/peerjs.min.js   vendored PeerJS (no CDN dependency)
data/questions.json  data/meta.json
data/img/<tournament-slug>/<id>.webp   figures for visual questions (536 files, about 23 MB, loaded only when shown)
tests/              node --test suites: grader, multiplayer rules, data shape
.github/workflows/ci.yml   runs the syntax check and tests on every push and pull request
```

### `js/data.js` (`window.SBData`)
- **`SBData.loadMeta()`** fetches only `meta.json`; **`SBData.load()`** fetches both files and expands the compact records (`expandQuestions`). `normalizeMeta` fixes up `meta` in one place so every page benefits:
  - `meta.subjects`, a flat array of keys, is expanded to `{key, label}` objects. This fixed a long-standing bug where subject chips rendered **with no text** on every page.
  - Subjects are reordered to **Math, Physics, Biology, Chemistry, Earth & Space, Energy**. (`meta.json` stores them alphabetically, a leftover of how the Python scripts built it.)
  - Question types are reordered so **Tossup always comes before Bonus**.
- **Display-time text cleanup** (`cleanText` and friends). This is non-destructive, and each regex's scope was checked against the whole corpus:
  - `stripAuthorTag`: trailing Discord-style author tags (`name#1234`)
  - `stripTrailingWatermark`: trailing `2019 DSB ®`-style watermarks
  - `stripPronunciation`: bracketed phonetic hyphen-chains
  - `fixSpacedHyphens` / `fixSpacedApostrophes`: PDF-extraction spacing damage
- **`renderMathHTML`** turns real `^(...)`, `^token`, `_(...)`, and `_token` notation into `<sup>`/`<sub>`. Parenthesized groups may nest (`2^(2^(2^2))`, `n^(1/ln(n))`). By design it does **not** guess at lost notation; see [limitations](#known-limitations-and-open-items).
- **`answerDisplayText(q)`**: for MC questions the choice text wins over `a.t`, so a damaged answer field still displays correctly.
- **`answerLineHTML()`**: one shared "Answer: X (also accept: Y)" renderer.
- **Question cards**: `questionMetaRow`, `appendQuestionBody`, `answerBlock` and `bookmarkButton` build the cards in the catalog, the bookmarks page and both session logs. `escapeHtml`, `QTYPE_LABELS` and `FORMAT_LABELS` are shared from here too.
- **Figures**: `questionFigures(q, opts)` builds the figure strip (lazy-loaded `<img>` with its width/height set so the layout doesn't shift, eager in the live question panel), `openLightbox(src, alt)` shows one full-size, and `preloadImages(q)` warms the next question's images. `expandQuestions` turns a record's `im` into `q.images` (`{src, w, h}`) and sets `q.visual`, which the filter and the tags read: `qtypeLabel(q)` / `qtypeTagClass(q)` give a visual bonus its "Visual Bonus" type tag in the cards and in the solo and multiplayer question panels.
- **`cleanRoundLabel()`** tidies round labels for display: it strips "Copy of", strips a repeated tournament name, and spaces letters from digits (`DE1` → `DE 1`).
- Also here: filtering (`filterQuestions`, including the `visuals` set: `visual`/`text`), shuffles (`shuffle`, `stratifiedShuffle`, `stratifiedQueue`), the dual round slider (`wireRoundRangeSlider`), the searchable multi-select (`enhanceMultiSelect`), range-fill styling, and bookmark storage (kept in memory, re-read when another tab changes it).

### Multiplayer networking
Peer-to-peer over WebRTC via PeerJS. The free public PeerJS broker is used only for the connection handshake; no game data goes through a server. The host's browser holds the authoritative game state (queue, timers, buzzes, scoring) and broadcasts it. Clients send intents (`join`, `buzz`, `submitAnswer`, `next`, `skip`, `togglePause`, `override`, `typing`, `updateSettings`, chat).

Anyone with the room code can connect, so the host passes every message through `SBMpRules.cleanHostMessage` first. Unknown types are dropped, strings are cut to length (name 24, answer 200, chat 300), filter values must exist in `meta.json` (the visual filter only takes `visual`/`text`), and the reading rate is clamped to 0.5–2.5. Peers that haven't sent `join` are ignored. Messages aren't rate-limited.

Connections use Google's public STUN servers, with no TURN relay.

---

## Data format

### `data/questions.json`
A compact JSON array (about 30 MB raw, about 7.1 MB gzipped; GitHub Pages serves it gzipped automatically). The catalog, solo, multiplayer and bookmarks pages load all of it, because their filters and search span the whole bank. Each record looks like this:

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
| `u` | source packet URL, always `https://` (on 63,043 records) |
| `im` | figures for a visual question, in order: `[{f, w, h}]`, `f` a path under `data/img/` (`mit-2025/17415.webp`), `w`/`h` its pixel size. Absent on text-only questions. |

`(rl, n, qt)` is **not** guaranteed unique. Some packets really do contain spare or replacement questions that reuse a number (e.g. NWI 2025 DE5, CLASH "21A/21B", FE!M 2025).

### `data/meta.json`
`totalQuestions`, `tournaments[{slug, name, count, level}]` (sorted case-insensitively by name), `subjects`, `rounds`, `formats`, `qtypes`, `levels`, `idAliases`, `generatedAt`. It's rebuilt from `questions.json` after every data change, and `totalQuestions` always equals both the sum of tournament counts and the record count.

`level` is `hs` or `ms` and belongs to the tournament, not the record: every question inherits its tournament's level at load time (`SBData.load()`), which drives the Level filter chips (the level isn't shown as a tag on questions). The middle-school tournaments are NSB MS Regs, CLASH 2026 MS, Bay Ultimate MS Scibowl, BUMS 2026, Dasoni Standard1, Deadbird Invitational and MOOSE 2021 (13,697 questions); everything else is `hs` (60,218). **A rebuild of `meta.json` has to carry each tournament's `level` over**, and a new tournament needs one assigned (a missing `level` is treated as `hs`).

`idAliases` maps the id of every question removed as a duplicate to the id of the copy that was kept; `SBData.load()` uses it to move saved bookmarks onto the kept copy, so merging duplicates never silently deletes someone's bookmark. Keep it when rebuilding `meta.json`. One known blur: "Random Stuff" is a grab-bag tournament that includes one MS earth-science packet but is tagged `hs` as a whole.

---

## Visual questions

Some bonuses (and a few tossups) are about a picture: a diagram, graph, micrograph, spectrum, structure or photo. Earlier ingests left these out because their images weren't available; they are now in the bank with their figures.

- **Which questions**: 532 records in 31 tournaments carry an `im` list (536 images; NSBA1's and Bash 2025's two-part figures have two images each, and one WSBT bonus has three). The largest sets are LOST 2 (46), SBL (44), MIT 2025 (36), LOST 1 (34), NSBA1 (31), ESBOT 2 and CLASH 2026 HS (30 each), DASONI 2 and HSBT 2026 (27 each), Bash 2025 and MIT 2024 (25 each) and Fall 2023 (22). 99 of them were already in the bank as text and got their figure back; the rest were added. Where an existing record's text had been cut short, it was replaced with the packet's full text. Per-tournament counts are in [docs/tournaments.md](docs/tournaments.md), and how they were found and checked is in [docs/data-history.md](docs/data-history.md#visual-questions).
- **Where the images come from**: images embedded in the PDF and .docx packets of the user's packet archive (matched to the bank by question text and cropped to the figure; where a packet's image runs off the page, the embedded picture itself was taken instead of a page render); the separate visual-bonus slide decks (MIT 2024/2025, Fall 2023, DAST, CLASH, FE!M, …), rendered slide by slide with LibreOffice and trimmed to the figure; LOST 1's and LOST 2's slide decks from scibowl.live; HSBT 2026's public visual-bonus deck (Google Slides, exported as PDF); figures drawn inline in SBL's packets and in ICSBT 3's public PDFs; the public SMH 2026 Google Docs; and isobowl's structured Trio Online Math Bowl rounds. Figures drawn as vector graphics (LOST 1's reaction schemes and circuit, SBL's geometry diagrams) have no embedded image to extract, so the page region holding the drawing is rendered at 200 dpi instead, which captures vector strokes, text labels and any pictures layered on top together.
- **Files**: `data/img/<tournament-slug>/<question id>.webp` (`<id>-1.webp`, `<id>-2.webp` … when a question has more than one figure), referenced from the record as `{f, w, h}`. Images are WebP at quality 86, at most 1,400 px on the long side, with transparency flattened onto white so they read in dark mode too; five animated figures stay GIF. Total about 23 MB. They're downloaded only when a question that uses them is shown (lazy-loaded in lists, preloaded one question ahead in solo and multiplayer), so the bank's load time is unchanged.
- **Display**: figures sit between the question text and the choices, on a white card, capped at 420 px tall (300 px in catalog cards, `min(52vh, 460px)` in the live question panel), and open full-size in a lightbox on click. The card's `width`/`height` attributes reserve the space before the image arrives.
- **Filter**: a "Visual questions" chip row (Visual / Text only) in the catalog, solo setup, solo settings and multiplayer room settings; selecting neither or both means no filter. It's carried in the multiplayer settings messages like every other filter.
- **Grading** is unchanged: the answer still comes from the record's key and accept list.

---

## Known limitations and open items

- **Lost math notation that can't be recovered.** Most lost superscripts, radicals and fractions were restored from the source packets (font flags, Word run formatting and Word equation objects) or by unambiguous rules (see [Superscript recovery](docs/data-history.md#superscript-recovery-and-split-words) and [Notation pass](docs/data-history.md#notation-pass)). What remains: questions with no source file and no pattern that proves the exponent (a bare `x2` looks the same as a subscript x₂, a formula like H2O, or an ordinary number), trig powers like `sin2 x` (indistinguishable from `sin 2x` given the corpus's spacing), and stacked fractions flattened onto one line in packets that aren't in any archive (e.g. `3 √13 13` for 3√13/13 in some answer choices). The examples this list used to name (NWI 2024's ellipse, MHS Rounds' Laplace transform of t², CSUB's integrals, NSB Regs Set 6's area under y = √x) have been repaired from the packet archive.
- **Visual questions whose images aren't available**: SBST's (its packets print the question but not the figure, which was shown separately at the event; speriphery's one SBST visual row has a sentence where its image file should be), LOST 2 Round 13's harmonic-oscillator bonus (its deck has no slide for it), 8 visual questions in other scibowl.live packets whose page carries no figure (ESBOT 2's Haber mechanism, dragon cross and radius-of-convergence choices, FE!M 2025's tolmetin synthesis, ICSBT 2025's murex dyes, diffusion model and Mandelbrot set, NSBA1's audio bonus), and the packets that were never reachable (NWI2 2025's private Drive folder, ICSBT2 DE4 with downloads turned off). speriphery.com's 133 visual rows were checked: the other 132 are already in the bank with their figure.
- **Wrong keys still to review.** Wrong answer keys are corrected when the right answer can be worked out (see [Wrong-key corrections](docs/data-history.md#wrong-key-corrections)). The public packets (all 875 on scibowl.live, oly.mehvix.com's 400 and OSTI's 214 middle-school PDFs) were downloaded again and compared with the bank, and the wrong keys they turned up were corrected or added with the right answer. HSBT 2026's three, held back until its packets were public, are settled (two added with corrected keys; the third repeats a correctly keyed question in the same set). Still open: the one speriphery question the earlier notes mention, which couldn't be identified again, and ICSBT 3's PF5 bond-order question (the PDF confirms the key "axial 3/4, equatorial 1", which is doubtful, so it stays out). In the bank, every MC record whose answer text names a different choice than its letter was read: 33 letters were wrong and corrected, and the remaining disagreements are answer texts that are truncated or abbreviated (the site shows the keyed choice's text, so they display correctly) or choices too garbled to judge (e.g. Texas Science Bowl Invitational's stacked-fraction choices, a CSBL rate-constant unit). 20 groups of identical questions (same text and choices) are keyed differently and haven't all been read. Reworded repeats of a question across events are kept on purpose (see the [duplicate policy](docs/data-history.md#duplicate-policy)), and so is NSB MS Regs Set 16 Round 7, which repeats NSB Regs Set 17 Round 10 slot for slot but is a separately published document (the MS copy carries pronunciation guides).
- **Cut-off stems**: 92 records whose stem stopped before the question (CCWT's "Given that sin(2x) = 0.2, representing your", GWHS's "One of the questions researchers attempted to", a Random set's "If x and y are complex numbers, then expressing your", many MEHS stems cut after their first sentence) got the rest of the stem from the re-downloaded packets. Any still cut short have no complete copy in the packets that were re-read; they're kept because the answer is intact.
- **CSUB's combined packets**: the questions from `rround1-9`/`rround10-17` sit on rounds 1 and 10, because the source doesn't say which specific round each belongs to.
- **BASIS Peoria Rounds**: RR and DE are ordered (1–4, 5–13), but the "NATS" set's place in the sequence can't be inferred, so it stays on 1–4.
- **Rounds still unlabeled on purpose** (1,318 questions): replacement, tiebreak, extra, supplemental and combine sets; grab-bag packets in Random / Random Stuff; CCWTWO's three unnumbered packets plus Foothill's first-draft packet and Summer 2019's "Dan's Packet" (the packets carry no round header, and guessing a slot would be invention); ESBOT 1's Seeding Round; NSB MS Regs' Sample Rounds DE 1/DE 3 (the number of round-robin rounds before them isn't known); and LADWP 2023, whose only round is its reconstructed Finals.
- **Chemistry vs Physics on "Physical Science" sources** (NSB MS sets 1–13, Deadbird Invitational): chosen by a trained model (94.5% held-out accuracy) and then read by hand; a few borderline questions could still go either way. "General Science" questions sit under Energy per the subject rule.
- **Sources not ingested**: isobowl.com tournaments that are live, upcoming or not yet released (as of October 2026: National Chemistry Bowl, which is still live, Hawaii Science Bowl Tournament and the three ISOBowl Invitational divisions, which are completed but whose rounds the server doesn't serve, and Lexington Online Scibowl Tournament 3, upcoming; re-check after they're released); sciencebowl.org (login-gated; needs the owner's permission); Pleasanton Invitational's sheet returned 401; the SMH League Cup "information document" was never opened.
- **Round slider** is global (max 20), not scoped to the selected tournament.

---

## Deploying

1. Put the contents of this folder at the root of a GitHub repo.
2. Push, then go to **Settings → Pages → Deploy from a branch**, choose `main`, and pick `/ (root)`.
3. The site will be live at `https://<you>.github.io/<repo>/`.

There's no build step, `npm install`, or environment variables. `package.json` only defines `npm test` and has no dependencies.

## Local development and tests

```bash
python3 -m http.server 8000
# open http://localhost:8000/

npm test        # or: node --test tests/*.test.js  (Node 18+, no install needed)
```

The tests, which CI also runs on every push and pull request:
- `tests/answer-check.test.js`: grading rules, the known false positives, and every answer key and whole-answer accept in the corpus graded against its own question.
- `tests/mp-rules.test.js`: multiplayer message validation and override rules.
- `tests/data.test.js`: every record has the fields and values the site expects, ids are unique, `meta.json` counts match `questions.json`, every image a record names exists under `data/img/` and every file there is used, and the Visual filter splits the bank into visual and text-only questions with nothing left over. Run it after any data change.

`answer-check.js`, `data.js` and `mp-rules.js` attach to `globalThis` outside the browser, so tests `require` them directly.
