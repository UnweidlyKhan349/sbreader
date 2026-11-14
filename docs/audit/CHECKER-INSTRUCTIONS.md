# Answer-key check for Science Bowl practice questions

You are checking a chunk of Science Bowl questions. A small share (roughly 1–5%, lower for official DOE sets) have a WRONG answer key or are unusable. Your job is to find those, and only those.

## Input
One question per line:
`id | subject | format (SA short answer / MC multiple choice) | Q: question | CHOICES: W) .. X) .. Y) .. Z) .. | KEY: answer | ALSO ACCEPTED: ...`

## What to do
Read EVERY line of your input file (read it in several parts with the Read tool if needed; do not skip any). For each question, answer it yourself from your own knowledge (work out any calculation), then compare with KEY.

Flag a question ONLY when you are confident of one of these:
1. **Wrong key**: the keyed answer is factually or mathematically wrong and you know the right one. For MC, the right answer must be one of the four choices.
2. **No right answer**: MC where none of the choices is correct, or more than one choice is clearly correct; SA that has no single answer or not enough information.
3. **Unusable**: the text is cut off or garbled so it cannot be answered, it refers to a figure/graph/list/"previous question" that is not there, or the key is not an answer to the question asked.
4. **Out of date**: the answer depended on when it was written and is no longer true (e.g. "how many moons are known", "the most recent ...", Pluto as a planet).
5. **Small text error in the question or key that changes the meaning** and has exactly one obvious repair (e.g. a lost exponent, "sulfur" where phosphorus is meant, a misspelled answer).

Do NOT flag: style, capitalisation, awkward wording, missing question marks, answers that are correct but could be more complete, questions you are merely unsure about, keys that are acceptable by common textbook convention. When in doubt, do not flag. Typical expected rate: roughly 1–5% of lines (under 1% for official DOE sets).

## Output
Write your findings with the Write tool to the output file named in your task. One finding per line, pipe-separated, nothing else in the file (no header, no markdown):

- wrong key, short answer:  `id|a|CORRECT ANSWER|reason`
- wrong key, multiple choice:  `id|a|LETTER|reason`   (LETTER is W, X, Y or Z)
- remove the question:  `id|rm||reason`
- repair question text:  `id|q|["exact old text","new text"]|reason`   (old text must be copied exactly from the question; JSON array)

Keep each reason to one short sentence that states the fact or the working (e.g. "3 half-lives leave 1/8, not 1/4"). The CORRECT ANSWER should be short, in the same style as the other keys (a term, a number with units, a list). Do not put `|` inside a field.

If you find nothing, write an empty file. When done, reply with just the number of lines you read and the number of findings.
