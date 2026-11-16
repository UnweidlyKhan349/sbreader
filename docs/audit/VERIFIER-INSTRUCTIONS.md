# Second opinion on a reviewer's findings

A first reviewer read a chunk of Science Bowl questions for a practice website and wrote down (1) questions whose key or text they think is wrong and (2) answers they think a player would type that a moderator would accept. You are the second opinion. Nothing is changed unless you independently agree, so judge each item yourself; do not defer to the first reviewer. About one finding in five is wrong, and about half of the proposed alternate answers are too generous.

On the site a player types an answer and a program grades it against the answer key and its list of accepted alternates, the way a Science Bowl moderator judges a spoken answer.

## Input

One item per line, fields separated by ` | `. The first field is the kind of item.

- `F` — a finding: `F | id | subject | SA or MC | Q: question | CHOICES: … | KEY: current key | ALSO: accepted alternates | FINDING: what the first reviewer wants | WHY: their reason`
  - `FINDING: a=…` change the key to this (for MC, a letter W/X/Y/Z)
  - `FINDING: rm` remove the question
  - `FINDING: q=["old","new"]` replace text in the question
- `A` — alternates: `A | id | subject | Q: question | KEY: key | ALSO: alternates on file | TYPED: answer ;; answer ;; answer` — answers the grader currently refuses, which the first reviewer says a moderator would accept.
- `N` — a near miss the grader currently ACCEPTS: `N | id | subject | Q: … | KEY: … | ALSO: … | TYPED: answer` — the first reviewer says a moderator would mark it wrong.

## What to do

Read every line. For each one, answer the question yourself first (work out any calculation), then judge.

**F lines.** Decide what is true:
- The key really is wrong and you know the right answer → `id|a|RIGHT ANSWER` (your answer, which may differ from the reviewer's; short, in the style of a key; for MC the letter).
- The question cannot be fixed (no right choice, two right choices, missing figure or context, out of date, not answerable) → `id|rm|`
- The text repair is right → `id|q|["exact old text","new text"]` (old text copied exactly from the question).
- The current key is fine, or you cannot tell → `id|drop|`
- The finding is about a wrong entry in ALSO → `id|rmac|the entry copied exactly` (and `id|drop|` is not needed).
Be strict: change a key only when the right answer is unambiguous. If two conventions give two answers and the question does not say which, use `rm`. If unsure, `drop`.

**A lines.** For each typed answer decide: would a Science Bowl moderator, holding this key, accept this answer **without hesitation**? Write `id|ac|the answer copied exactly` only if yes. Accept:
- another name for exactly the same thing (a true synonym, the everyday or the technical name, a standard abbreviation or its expansion, formula for name, a scientist's last name, an equivalent way to write the same number or expression, the same unit);
- the key with or without a word that adds nothing (`thyroid gland` for THYROID).
Do NOT accept, and write nothing for:
- something broader, narrower or only related (`radiation` for INFRARED RADIATION, `gland` for THYROID, `alphavirus` for TOGAVIRUS, a member for its class or a class for its member);
- an approximation or different rounding of a number (`1.41` for `1.4`, `0.33` for `1/3`), a wrong sign, a different unit or power of ten;
- a different form when the question asks for a form (a decimal when it asks for a fraction, a name when it asks for the formula or symbol);
- part of a multi-part answer; a different (even if arguably correct) answer to the question; anything you would have to think about.
If the typed answer is right and the KEY itself is wrong, write an `id|a|…` line instead.

**N lines.** If a moderator would indeed mark the typed answer wrong → `id|rj|the answer copied exactly`. If it is actually acceptable (or is the key itself) write nothing.

## Output

Write with the Write tool to the output file named in your task. One line per decision, exactly in these forms, nothing else in the file:

```
id|a|RIGHT ANSWER
id|a|LETTER
id|rm|
id|q|["exact old text","new text"]
id|drop|
id|rmac|entry copied exactly from ALSO
id|ac|typed answer copied exactly
id|rj|typed answer copied exactly
```

Do not put `|` inside a field. Every F line must get exactly one of a / rm / q / drop / rmac. When done, your final reply must be only the word DONE.
