# Handoff: check every answer key in the bank with reader subagents

You are taking over a job on `UnweidlyKhan349/sbreader`, a static Science Bowl practice site. The bank holds about 102,000 questions in `data/bank/`. The job is to have **every question read once by a subagent that answers it independently**, then fix or remove the ones whose key or text is wrong. About 19,600 are done; about 82,000 remain. The owner has asked for all of them and has approved using subagents for this.

Read this whole file before starting. Everything you need is in the repo; nothing from the previous session's scratch space survives.

## Where things stand

Run this first. It is the source of truth for what is left:

```bash
node tools/keycheck.js status
```

At handoff it printed:

| Group | What it is | Questions | Checked |
|---|---|---|---|
| `school` | Mira Loma, Stuyvesant, Tycho, Evan Zhong | 18,108 | all |
| `team` | tournaments written by teams | 48,978 | 939 (a sample) |
| `official` | DOE sets (`nsb-*`, Science Bowl Subject Sets) | 28,297 | 557 (a sample) |
| `practice` | the other practice sets | 4,793 | 0 |
| `other` | Ocean Sciences Bowl, Chemistry Bowl, Biology Bowl, Math Bowl | 2,195 | 0 |

Checked ids live in `docs/audit/checked-ids.txt`. Visual questions (about 570) are skipped: a subagent can't see the figure.

What the earlier passes found, so you know what to expect:

- School-team sets: 16% of computational math, physics and chemistry questions needed a fix; 4.9% of the rest.
- A hand-verified random sample of 1,500 tournament questions: 1.9% had a confirmed error (2.5% team-written, 0.7% official). Of 35 flags, 28 were right, 1 was wrong, 6 were judgment calls, and one right flag proposed the wrong replacement answer.

That last point drives the main rule below.

## The one rule that matters

**Read every finding yourself before it is applied.** In the school-team pass the findings were applied after only mechanical checks, and the owner was told some of those changes will be wrong. Do not repeat that. A subagent flag is a lead, not a verdict: about one in five should not be applied as written. For each flag, look at the question and decide one of:

- apply as proposed,
- apply with a different answer (work it out yourself),
- remove the question instead (no right choice, not enough given, needs a missing figure),
- drop the flag (the key was fine, or you can't tell).

When you can't tell, drop the flag. A key is changed only when the right answer is unambiguous. Where two conventions give two answers and the question doesn't say which, remove the question rather than pick one.

This reading is the owner's quality bar for this job; it is the part subagents can't do for you. Expect roughly 1,500 flags in total across the remaining groups.

## Order of work

1. `practice` (16 chunks). Never checked, user-written, likely the highest error rate left.
2. `other` (8 chunks).
3. `team` (about 161 chunks). The bulk of the errors.
4. `official` (about 93 chunks). Lowest rate; many flags will be typos or dated facts.

Finish and merge one group before starting the next, so a lost session costs at most one group.

## Procedure for one group

Use your session's scratchpad directory for `<dir>`; one directory per group.

**1. Make the chunks**

```bash
node tools/keycheck.js chunks <dir> practice
```

This writes `in_001.txt`, `in_002.txt`, … with 300 questions each, sorted by subject, skipping visual and already-checked questions.

**2. Send each chunk to a subagent**

One subagent per chunk, type `general-purpose`, model `sonnet`, run in the background. Use exactly this prompt, filling in the three paths (use absolute paths):

> Read the instructions at `<repo>/docs/audit/CHECKER-INSTRUCTIONS.md` and follow them exactly. Input file: `<dir>/in_NNN.txt` (300 lines). Output file: `<dir>/out_NNN.txt`. Do not modify any other file and do not touch the git repository.

For `official` chunks add: "These are official DOE questions; expect well under 1% errors and flag only what you are sure of."

Limits you will hit:

- **At most 20 subagents run at once.** Launch 20, then top up as they report back.
- **Usage limit.** A wave of 20 Sonnet chunks uses most of a five-hour usage window. When the limit hits, running subagents fail with a rate-limit error. Their `out_NNN.txt` may or may not exist. After the reset, relaunch only the chunks with no `out` file. Do not use Opus for this: it exhausts the window after a few chunks, and Sonnet's findings were good.
- A chunk takes one to two minutes. A subagent that finishes writes its file and replies with "300 lines read, N findings".

**3. Read the findings**

```bash
node tools/keycheck.js review <dir> 1 2 3
```

This prints each finding with its reason, followed by the question, choices and current key. Read them all.

**4. Queue, then edit the queue**

```bash
node tools/keycheck.js queue <dir> 1 2 3
```

This validates each finding (the id exists, a new multiple-choice key is one of the four choices and differs from the current one, a text repair matches the question exactly) and appends the survivors to `<dir>/fixes.txt`. Then **edit `fixes.txt` by hand** to reflect your decisions from step 3: delete the lines you rejected, change the ones where you have a better answer, add `rm` lines where removal is right.

Line formats:

```
12345|rm|
12345|a|NEW ANSWER              (short answer: the new key text)
12345|a|X                       (multiple choice: the letter W, X, Y or Z)
12345|q|["exact old text","new text"]
12345|ac|ANOTHER ACCEPTED ANSWER
```

Changing a short-answer key drops its old accept list, since the alternates belonged to the old key. Add any that still apply with `ac` lines.

**5. Apply**

```bash
node tools/keycheck.js apply <dir>
```

This unpacks the bank, applies the lines not yet applied, repacks, fixes `meta.json` totals and the subject files, drops star aliases that point at removed questions, removes any practice-set question that became a word-for-word copy (adding an alias to the kept one), refreshes counts and asset stamps, and runs `npm test`. It must end with `npm test: pass`. If it fails, run `npm test`, read the failure and fix it before going on.

**6. Mark the chunks checked**

```bash
node tools/keycheck.js done <dir> 1 2 3
```

Only for chunks whose findings you have fully processed.

**7. Keep the findings**

Append the group's raw findings to the audit file so any change can be traced:

```bash
cat <dir>/out_*.txt >> docs/audit/key-check-<group>-<yyyy-mm>.txt
```

**8. Commit and push** after every wave of chunks, not just at the end of a group. A stop hook refuses to end a turn with uncommitted or unpushed work.

## When a group is finished

1. Update the docs. All four are required; the counts must agree with the bank:
   - `README.md` line 15, the headline: total questions, tossups and bonuses, short answer and multiple choice, and the count of links that open at a page. Get the numbers from the bank, not by subtraction.
   - `docs/tournaments.md`: per-set counts and the total row, from `data/meta.json`.
   - `docs/data-history.md`: add a dated section before "Rule history taken out of the README". State how many questions were read, how many flags came back, how many you applied, changed, removed or dropped, the error rate, and a handful of typical corrections with ids. Say plainly what was and wasn't verified. Follow the tone of the "Error rate of the tournament sets" section.
   - `CHANGELOG.md`: one line.
2. Run both test suites:

```bash
npm test
```

```bash
node --test --test-concurrency=4 tests/e2e/*.e2e.js
```

   The browser suite takes several minutes; one multiplayer test is occasionally flaky under load, so re-run before concluding it is broken.
3. Commit, push, and report to the owner. **Do not open or merge a pull request unless the owner asks.** They usually ask for "create pr and merge" once a piece is done.

## Repo rules you must follow

- Work on the branch you are given; push only there. If its pull request has already merged, restart the branch from `origin/main` first (`git fetch origin main && git checkout -B <branch> origin/main`). Before opening a PR, merge `origin/main` in and re-run the tests: other sessions land changes on `main` (the last merge had a `CHANGELOG.md` conflict; keep both sides).
- Commit messages end with the attribution lines your session gives you. No model names in commits, PRs or code.
- Never edit files in `data/bank/` by hand. Go through `tools/keycheck.js apply`, or `tools/bank.js unpack` / `pack` for anything it doesn't cover.
- `data/meta.json` is written in Python `json.dumps(ensure_ascii=False)` form. `tools/keycheck_sync.py` preserves that; don't rewrite the file with `JSON.stringify`.
- The left-out rules in the README's "Inclusion and duplicate policy" apply to every question you touch. A flagged question that is place-name geography, minor history trivia, a dated fact, or (in practice sets) not science is removed, not repaired.
- The owner has said twice not to check every question personally and then asked for subagents to do it. Reading the flagged few percent is expected; reading unflagged questions is not.

## What to tell the owner at the end

Lead with what is now true: every non-visual question has been read once, and how many were fixed. Then give, per group, questions read, flags, and what you did with them. State the limits honestly: one reader misses some errors, visual questions were not checked, and the school-team findings from the earlier pass were applied without a hand review (the list is `docs/audit/school-team-key-check-2026-11.txt`; a second-opinion pass over those 759 is a sensible follow-up if the owner wants it).
