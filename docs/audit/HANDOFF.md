# Handoff: the full review (every question read twice by subagents)

The owner asked for every question's text, key and grading to be reviewed with subagents, keeping in mind a player who types an answer and a moderator who judges it. This file is the procedure and the state. Read it all before continuing.

## What the review does

Each chunk of 300 questions goes through two readers:

1. **Reviewer** (`docs/audit/CHECKER-INSTRUCTIONS.md`): answers every question itself, flags wrong keys, unusable questions and text errors (`a`, `rm`, `q` lines), and for short answers writes what a player would type that a moderator would accept (`alt`) and near misses a moderator would refuse (`not`).
2. **Verifier** (`docs/audit/VERIFIER-INSTRUCTIONS.md`): a second, independent opinion on the reviewer's findings, on the `alt` answers the grader refuses, and on the `not` answers the grader accepts.

Only what both readers agree on is applied:

- a finding both make the same way is applied;
- when both say a question is wrong but disagree on the fix, the question is removed;
- a finding the verifier drops is not applied;
- an `alt` the verifier confirms becomes an accepted alternate (`ac`); a `not` it confirms goes on the reject list (`rj`); a wrong accept entry is removed (`rmac`).

The `alt` answers are also how grader gaps are found: a kind of answer refused again and again is fixed in `js/answer-check.js` (see "A second look" in the README's grading section), not accept by accept.

## State

`node tools/keycheck.js status` shows what is checked (`docs/audit/checked-ids.txt`). The earlier key-only check's list is kept as `checked-ids-keycheck-2026-11.txt`; the full review starts again from zero because it checks more.

Chunks are cut once, in this order, 300 questions each: practice (1–16), other bowls (17–24), team-written tournaments (25–186), official DOE sets (187–281), school-team sets (282–342). **Do not re-cut the chunks mid-review**: cut them all at the start (`chunks` skips checked ids, so re-cutting renumbers everything).

```bash
for g in practice other team official school; do node tools/keycheck.js chunks <dir> $g 300; done
```

(`chunks` numbers files after the ones already in `<dir>`.) If the scratch directory is lost, cut again; ids already in `checked-ids.txt` are skipped, so the new chunks hold only what is left.

## One wave

Reviewer agents: one per chunk, `general-purpose`, model `sonnet`, in the background, at most 20 at once. Prompt:

> Read the instructions at `<repo>/docs/audit/CHECKER-INSTRUCTIONS.md` and follow them exactly. Input file: `<dir>/in_NNN.txt` (300 lines). Output file: `<dir>/out_NNN.txt`. Do not modify any other file and do not touch the git repository. Your final reply must be only the word DONE.

Then:

```bash
node tools/keycheck.js verify <dir> 59 60 61
```

writes `vin_NNN.txt`. Verifier agents take three chunks each (same agent type and model). Prompt:

> Read the instructions at `<repo>/docs/audit/VERIFIER-INSTRUCTIONS.md` and follow them exactly. With D = `<dir>`, do this for each input file in turn, writing one output file per input file: D/vin_AAA.txt -> D/vout_AAA.txt, … Read every line of each input file. Do not modify any other file and do not touch the git repository. Your final reply must be only the word DONE.

Then:

```bash
node tools/keycheck.js collect <dir> 59 60 61
```

```bash
node tools/keycheck.js apply <dir>
```

```bash
node tools/keycheck.js done <dir> 59 60 61
```

`collect` appends the agreed lines to `<dir>/fixes.txt` and writes disagreements to `<dir>/disputed.txt`; read the `VERIFIER` and `NEW` lines there (few) and add a line to `fixes.txt` by hand where one is clearly right. `apply` changes the bank, syncs `meta.json` and the subject files, and runs `npm test`.

After `apply`, two tests often need attention:

- **Cross-accept snapshot** (`tests/grader-cross-accepts.json`): removing questions shifts which questions the test samples, so new pairs appear. Run `node tools/grader-cross-check.js`, read the new pairs (they should be the same answer said another way, such as `1` for `1 ONLY`), then `node tools/grader-cross-check.js --write`.
- **Sign-flip test**: a new accept written with other operators can let a flipped key pass (`4*pi*epsilon0*G` beside `G/k`). Remove that accept with an `id|rmac|…` line and apply again.

Keep the trail: append the wave's `out_*.txt`, `vout_*.txt` and `fixes.txt` to the `docs/audit/full-review-2026-11-*.txt` files, then commit and push. A stop hook refuses to end a turn with unpushed work.

Limits: about 15–20 reviewer chunks fit in one five-hour usage window. An agent that hits the limit has usually written its file already; relaunch only chunks with no `out` file. Subagents cannot launch subagents.

## When all chunks are done

1. Update `README.md` (headline counts, subject table, grading section), `docs/tournaments.md`, `docs/data-history.md` (a dated section: questions read, findings, agreed, removed, accepts added, sample checks, what was not verified), `CHANGELOG.md`.
2. `npm test` and `node --test --test-concurrency=4 tests/e2e/*.e2e.js`.
3. Merge `origin/main` normally (never force-push; other sessions land changes there; `CHANGELOG.md` conflicts keep both sides, then re-run `python3 tools/keycheck_sync.py`, `node tools/meta-counts.js`, `node tools/stamp-assets.js`).
4. Tell the owner which grading policies changed (listed under "A second look" in the README) and what was and wasn't verified. Do not open a pull request unless asked.

## Repo rules

- Work on the given branch only. No model names in commits, PRs or code.
- Never edit `data/bank/` by hand; use `tools/keycheck.js apply` or `tools/bank.js unpack`/`pack`.
- `data/meta.json` stays in Python `json.dumps(ensure_ascii=False)` form (`tools/keycheck_sync.py` keeps it).
- The README's inclusion rules apply to anything touched: place-name geography, minor history, dated facts and (in practice sets) non-science are removed, not repaired.
- Visual questions are skipped: a subagent can't see the figure.
