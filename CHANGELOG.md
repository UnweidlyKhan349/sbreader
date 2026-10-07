# Changelog

Site and UI changes, newest last. Data changes are in [docs/data-history.md](docs/data-history.md).

- **Text-to-speech replaced** with the on-screen reveal engine, which is robust in background tabs and supports live speed changes mid-question.
- Subject chips showing no text: fixed centrally in `SBData.load()`.
- Mobile nav overflow and oversized hero heading fixed.
- "Also accept" moved onto the answer line via the shared `answerLineHTML()`, then restyled to match the "Answer:" text.
- Subject chip order set to Math → Physics → Biology → Chemistry → Earth & Space → Energy; Tossup before Bonus everywhere, including the settings panels.
- Stratified subject queue made fully round-robin, which fixed a report of 60% Physics in a 40-question session.
- In-session settings for solo; room settings editable by every player in multiplayer.
- All-subjects-off resets to all-on when the settings panel closes (solo and multiplayer).
- Room codes uppercased before joining.
- `N` shortcut added to home, moved to solo start, then reverted (it now only means next/skip during a session).
- π/Π, ∛, and "square/cube root of" equivalences added to grading.
- "Toss-Up" renamed "Tossup" everywhere; Tjsbt 2025 renamed TJSBT 2025.
- Multiplayer guests see the same lobby prompt as the host ("Ready when you are — click Start or press N to begin."); anyone in the room can start.
- Solo scrolls back to the question when moving to the next one.
- The page scroller reserves the scrollbar's width (`scrollbar-gutter: stable`), so the nav's "Bookmarked questions" link no longer shifts sideways when a page starts or stops scrolling.
- Catalog search highlights the matching text.
- Grading accepts equal decimals and fractions (`0.5` for `1/2`) and `ER` for endoplasmic reticulum.
- Grading: typos and "the key plus extra words" are no longer scored as correct. They're marked wrong with a "Close" hint, and the player presses Q (Override) if they meant it. Swaps that change the term (hypertonic/hypotonic, alkane/alkene, nitrate/nitrite, ...) aren't even close. Answers that drop part of the key ("carbon" for CARBON DIOXIDE) are wrong. Alternates written inside a key ("ITCZ OR INTERTROPICAL CONVERGENCE ZONE", "GREEN ACCEPT: EMERALD") and singular/plural forms now pass. Typing the key exactly ("+6") is no longer caught by a reject entry that only differs in punctuation ("6").
- Multiplayer: the host validates every message from a client (type, string lengths, known filter values, rate clamped to 0.5–2.5) and ignores peers that haven't joined. A player can't override a wrong answer to correct after someone else has scored the question.
- Multiplayer: removed Open Relay's shared TURN login, which no longer works. Connections use STUN only.
- The home page loads only `meta.json` (58 KB) instead of the whole question bank.
- Question cards in the catalog, bookmarks and both session logs use one shared renderer, so they all show "also accept" and "do not accept" lines.
- Added tests (`npm test`) and a CI workflow.
- Rebranded the site as **SB Reader** (page titles, nav brand, README).
- Grading: ranking answers must be in the keyed order. Typing the item numbers with commas or spaces in the wrong order (`3, 2, 1` for `1, 3, 2`) used to pass, and longer ranking stems ("Order the convectively available potential energy of the following…", "Place the following in chronological order") were graded as order-free sets.
- Catalog results are listed in packet order (tournament, round, question number, tossup before bonus) instead of storage order.
- Question cards in the catalog and bookmarks no longer show a "Round N" tag; the tournament and round label ("AVES 2025 · DE 1") already say which round it is.
