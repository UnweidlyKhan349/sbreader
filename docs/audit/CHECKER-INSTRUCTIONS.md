# Question, key and grading check for Science Bowl questions

You are reviewing a chunk of Science Bowl questions for a practice website. On the site a player sees the question, buzzes, and **types** an answer on a phone or computer keyboard. A program then grades what they typed against the answer key, the way a Science Bowl moderator would judge a spoken answer. Your review has two jobs:

1. find questions whose **key or text is wrong**;
2. say **what a real player would type** for each short-answer question, so the grading can be tested.

## Input

One question per line:

`id | subject | format (SA short answer / MC multiple choice) | Q: question | CHOICES: W) .. X) .. Y) .. Z) .. | KEY: answer | ALSO ACCEPTED: a; b; c`

`ALSO ACCEPTED` lists alternates already on file for that question.

## What to do

Read EVERY line of your input file (read it in several parts with the Read tool if needed; do not skip any). For each question, answer it yourself from your own knowledge (work out any calculation) before looking at the key, then compare.

### Job 1: errors (expect roughly 1–5% of lines; under 1% for official DOE sets)

Flag a question ONLY when you are confident of one of these:

1. **Wrong key**: the keyed answer is factually or mathematically wrong and you know the right one. For MC, the right answer must be one of the four choices.
2. **No right answer**: MC where no choice is correct or more than one clearly is; SA with no single answer or not enough information.
3. **Unusable**: text cut off or garbled so it cannot be answered, a reference to a figure/graph/list/"previous question" that is not there, or a key that does not answer the question asked.
4. **Out of date**: the answer depended on when it was written and is no longer true ("how many moons are known", "the most recent …", Pluto as a planet).
5. **Text error with one obvious repair** in the question or in the key: a lost exponent, a wrong word ("sulfur" where phosphorus is meant), a misspelled answer, a moderator note or explanation left inside the key ("CARBON (accept: C)", "4/5 Solution: draw a triangle"), an "ALSO ACCEPTED" entry that is actually a wrong answer.

Do NOT flag style, capitalisation, awkward wording, missing question marks, or answers that are correct but could be more complete. When in doubt, do not flag.

### Job 2: what a player would type (short-answer questions only; skip MC)

Picture a good high-school Science Bowl player typing fast. For each SA question write:

- **`alt`**: up to 3 answers, other than the key as written, that such a player might well type **and that a moderator would accept as correct without hesitation**. Think of: a common synonym or the everyday name (`table salt` / `sodium chloride`), a standard abbreviation or the spelled-out form (`ATP`, `PCR`, `ITCZ`), a formula for a name or a name for a formula (`H2O`, `NaCl`), a scientist's last name for the full name, the answer without a word the question already supplies (`mitochondria` when the key is `THE MITOCHONDRIA OF THE CELL`), the number without its unit when the question names the unit, the unit abbreviated or spelled out, an equivalent way to write the math (`sqrt(2)/2`, `x^2+2x+1`, `1/2`, `0.5`, `2pi/3`), a list in another order when order does not matter, items by number or by name for an "identify all" question. Type them the way a player would on a keyboard: lower case is fine, no special symbols they would not have.
  - Only answers you are sure a moderator would take. Not partial answers, not vaguer answers, not answers that are right only loosely.
  - Skip the line entirely if the key is the only natural thing to type and it has no notable alternate (many numbers and single terms).
- **`not`**: up to 2 answers a player might plausibly type that look or sound like the key but **a moderator would mark wrong**: half of a two-part answer, the contrasting term (`hypotonic` for `HYPERTONIC`, `mitosis` for `MEIOSIS`), the right number with the wrong sign, power of ten or unit, a less specific answer (`acid` for `ACETIC ACID`), a near-identical name of a different thing (`nitrite`/`nitrate`). Give these for about one question in three, where a real near-miss exists.

## Output

Write with the Write tool to the output file named in your task. One item per line, pipe-separated, nothing else in the file (no header, no markdown, no blank lines). Do not put `|` inside a field.

```
id|a|CORRECT ANSWER|reason                 wrong key, short answer (short, in the style of the other keys)
id|a|LETTER|reason                         wrong key, multiple choice (W, X, Y or Z)
id|rm||reason                              remove the question
id|q|["exact old text","new text"]|reason  repair question text (old text copied exactly from the question; JSON array)
id|alt|answer one ;; answer two ;; answer three
id|not|wrong one ;; wrong two
```

Reasons are one short sentence stating the fact or the working ("3 half-lives leave 1/8, not 1/4"). Separate several answers on an `alt` or `not` line with ` ;; ` (two semicolons), because answers themselves may contain commas or single semicolons.

A question may have several lines (for example an `alt` line and a `not` line). If a question's key is wrong, give the `a` line and base its `alt`/`not` lines on the corrected answer.

When done, reply with just: the number of lines you read, and how many `a`/`rm`/`q` findings, `alt` lines and `not` lines you wrote.
