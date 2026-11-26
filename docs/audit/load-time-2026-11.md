# Load-time audit, November 26, 2026

Every page was opened on a first visit (nothing cached, service worker off,
logged out) from a local copy served the way GitHub Pages serves the site
(gzip, `max-age=600`), with Bootstrap, supabase-js and the Google tag coming
from the real CDNs. Two connections:

- **Slow phone**: Lighthouse's mobile profile, 150 ms round trips, 1.6 Mbps
  down, a CPU 4x slower than the test machine. Median of 2 runs.
- **Desktop**: 40 ms round trips, 10 Mbps down. Median of 3 runs.

`node tools/load-audit.js` repeats the measurement (see its header).

## Results before this change

"Ready" is when the page has what it waits for: the whole question bank on
Play, Multiplayer, Database and a subject's frequency list; meta.json on
the others that load it. First paint is the first text on screen;
largest paint is when the biggest block of content is drawn. KB is what the
slow phone downloaded (the home page's figure includes the bank it
prefetches in the background after it has loaded).

| Page | KB | Phone: first paint (s) | Phone: largest paint | Phone: ready | Desktop: first paint | Desktop: ready |
|---|---:|---:|---:|---:|---:|---:|
| Home | 9,070 | 1.2 | 1.2 | 2.6 | 0.3 | 0.5 |
| Play (solo) | 9,161 | 1.5 | 1.7 | **48.3** | 0.3 | **7.8** |
| Multiplayer | 9,265 | 1.7 | 1.7 | **48.9** | 0.3 | **7.9** |
| Database | 9,082 | 1.3 | 1.3 | **48.1** | 0.2 | **7.8** |
| Database, `?answer=mitochondria` | 9,083 | 1.3 | 1.5 | **48.8** | 0.3 | **8.0** |
| Set List | 351 | 1.2 | 1.4 | 2.4 | 0.2 | 0.4 |
| Set (`set?set=lost-3-hs`) | 418 | 1.1 | 2.7 | 2.9 | 0.2 | 0.5 |
| Packet (`packet?set=lost-3-ms&packet=10`) | 403 | 1.1 | 2.6 | 2.9 | 0.2 | 0.5 |
| Built set page (`sets/lost-3-hs/`) | 418 | 1.1 | 1.1 | 2.9 | 0.2 | 0.5 |
| Built packet page (`sets/lost-3-ms/10`) | 545 | 1.2 | 1.2 | 3.4 | 0.2 | 0.5 |
| Frequency List | 350 | 1.0 | 1.6 | 2.5 | 0.2 | 0.5 |
| Frequency List, one subject | 9,070 | 1.1 | **48.3** | **48.2** | 0.3 | **8.0** |
| About | 289 | 1.0 | 1.0 | – | 0.3 | – |
| Tips | 287 | 0.9 | 0.9 | – | 0.3 | – |
| Log in / Sign up / Forgot password | 323 | 1.1 | 1.1 | – | 0.3 | – |
| Account, Edit profile, Edit password (logged out: sent on to Log in) | 464 | 1.1 | 1.1 | – | 0.2 | – |
| Stats | 335 | 1.2 | 1.8 | – | 0.2 | – |
| Graphs | 386 | 1.3 | 2.6 | – | 0.2 | – |
| Starred Questions | 358 | 1.1 | 1.1 | 2.5 | 0.2 | 0.5 |
| Offline, 404 | 227 | 0.8 | 0.8 | – | 0.2 | – |

Where the bytes go on a light page (Set List, slow phone): the Google tag
181 KB, supabase-js 47 KB, the site's own scripts 54 KB, meta.json 29 KB,
Bootstrap 23 KB, style.css 11 KB. On the bank pages the bank is 8,719 KB of
the 9,100.

## Fixed in this change: the home page

The home page downloaded js/data.js (34 KB) and meta.json (29 KB) only to
print "106,366 questions from 114 tournaments". The numbers are now part of
the page, written by `node tools/meta-counts.js` (a test fails if they go
stale), and the page loads no question data until it is idle and starts its
background prefetch.

| Home page | First paint (phone) | Counts on screen (phone) | Counts on screen (desktop) |
|---|---:|---:|---:|
| Before | 1.18 s | 2.44 s | 0.50 s |
| After | 0.93 s | **0.93 s** | **0.20 s** |

## Done on November 26, 2026: items 1, 4 and 5 below

Measured the same way (median of 2 runs), on this branch against the one
before it. "Usable" is when Play's Start button works, a frequency list is
drawn, or the Database shows its first results.

| Page | Before: phone | After: phone | Before: desktop | After: desktop |
|---|---:|---:|---:|---:|
| Play, usable | 48.5 s | **6.5 s** | 7.9 s | **1.0 s** |
| Frequency List (one subject), usable | 48.3 s | **2.4 s** | 7.9 s | **0.6 s** |
| Frequency List (one subject), KB downloaded | 9,066 | **337** | | |
| Database, first results | 5.6 s | 5.4 s | 0.9 s | 0.7 s |
| Set List, meta.json in | 2.4 s | 2.3 s | 0.8 s | 0.4 s |
| First paint: Play / Database / Set List / About | 1.7 / 1.3 / 1.2 / 0.9 s | 1.4 / 1.2 / 1.1 / 0.9 s | 0.2–0.4 s | 0.2–0.3 s |

- **Play** starts once the files the settings need have arrived (the six
  newest tournaments, the picked ones, or those holding the starred
  questions) and mixes the rest in as it comes. Its 6.5 s on a slow phone
  is the page's own load event (the Google tag finishes at about 5.5 s);
  the first six files are in by about 4 s.
- **Frequency lists** come from `data/frequency.json`, written by
  `node tools/meta-counts.js`.
- **Multiplayer's lobby** fetches the bank at low priority until you join
  a room. This lab setup has no measure of when the lobby is ready (the
  room list comes from Supabase, which the audit blocks), so there's no
  number for it.
- **The id aliases** moved out of meta.json into `data/bank/aliases.json`
  (meta.json 97 KB → 23 KB; 29 → 5 KB gzipped). Pages that wait for
  meta.json gain about a tenth of a second on a slow phone.
- **Bootstrap's stylesheet** is served by the site. The gain in first
  paint here is up to 0.25 s on a slow phone, less than estimated below:
  Chromium's network throttling delays each request but doesn't simulate
  the DNS, TCP and TLS round trips of a new connection, which is what
  serving it from the site saves, so the real gain on a phone should be
  larger than this measures. (The site's gzipped copy is 31 KB, against
  the CDN's 23 KB in Brotli.)

## Ways to cut loading time, biggest first

### 1. Four pages wait for the whole 8.7 MB bank (48 s on a slow phone, 8 s on 10 Mbps)

Play, Multiplayer, the Database and a subject's frequency list all need
every tournament file before they are usable. The bank is 30 MB, 8.7 MB
gzipped, and almost all of it is question text and choices, so trimming
fields would save about 1% (dropping `pg` and the packet links: 1.1%).
What helps is downloading less before the page is usable:

- **Frequency List, one subject: compute the lists ahead of time.** The page
  downloads 8.7 MB to show a 50-row table. A tool like `meta-counts.js`
  could write `data/frequency.json` (the six lists, a few KB) whenever the
  bank changes, with a test that it's current. 48 s → about 2.5 s on a slow
  phone; 8 s → 0.5 s on desktop.
- **Play: let Start work before the whole bank has arrived.** With a
  tournament picked in the settings, only those files are needed
  (`SBData.loadSet` already loads one). In Starred mode only the
  tournaments holding starred questions are needed (`SBData.loadBookmarked`
  exists for the Stars page). With no tournament picked, Play could start
  once the first files (the six newest, fetched at high priority, arrive
  in about 4 s on a slow phone) are in and add each later file to the pool
  as it arrives (the `sb-bank-part` event the Database already listens
  to). The catch: until the bank is complete, random questions lean
  toward the tournaments that came first.
- **Multiplayer: the lobby downloads the whole bank at once**, at the
  same priority as the lobby itself, before anyone has joined a room.
  Fetching it at low priority until the player enters a room would keep
  the lobby quick on a slow connection; joining a room later could still
  find most of it downloaded.

Repeat visits are already fast: the service worker keeps every bank file
under its content stamp, so a second visit loads the bank from the device.

### 2. The Google tag is 181 KB on every page

`gtm.js` is more than half of what every light page downloads (181 of
289 KB on About) and arrives last (2.1 s on Set List, 5.5 s on Play, on a
slow phone). It is `async`, so it doesn't stop the page drawing, but on a
slow line it shares the bandwidth with meta.json, data.js and
answer-check.js while they are on the critical path, and its 554 KB of
script has to be parsed. Loading it after the `load` event (or when the
browser is idle) keeps the analytics but takes it off the critical path.
Some visits that leave in the first second or two would no longer be
counted.

### 3. supabase-js (47 KB, 214 KB of script) loads for every visitor

`js/account.js` loads supabase-js on every page, logged in or not. A
logged-out visitor only needs it on Log in, Sign up, Forgot password and
the pages an email link opens. When there is no saved session in
`localStorage` (supabase-js keeps it under `sb-<project>-auth-token`), the
other pages could skip it and show "Log in" straight away. Question stats
and the room list already use plain REST calls and don't need it.

### 4. Most of meta.json is bookmark aliases

meta.json is 97 KB (29 KB gzipped) and 75 KB of it is `idAliases`, the
4,718 old-to-new question ids used once to update old starred questions.
Every bank page waits for meta.json before it asks for the first tournament
file (on a slow phone the bank requests start at 1.6 s, after meta.json
arrives at 1.2 s and data.js runs). Moving `idAliases` into its own file,
fetched only when the visitor has starred questions, makes meta.json 23 KB
(5 KB gzipped instead of 29), so every bank page, Set List and Starred
Questions get it sooner. On a slow phone meta.json took 1.05 s to arrive,
sharing the line with a dozen other files, so a file a sixth the size
should save a few tenths of a second there.

### 5. Bootstrap's stylesheet needs its own connection before anything is drawn

The page can't be drawn until `bootstrap.min.css` arrives, and it comes
from cdn.jsdelivr.net, so the browser first opens a second connection
(DNS, TCP and TLS: three round trips). On a slow phone it arrives at
1.1–1.4 s, while style.css from the site arrives at 0.6 s, and first paint
follows it. Serving Bootstrap's CSS from the site itself should bring first
paint 0.3–0.5 s sooner on every page; a cheaper half-step is
`<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>` at
the top of `<head>`. (Bootstrap from jsDelivr is a deliberate choice in
this project, so this one is a trade-off to decide.)

### 6. Minify the site's scripts when deploying

The site's own scripts are 251 KB gzipped (answer-check.js 66 KB,
multiplayer.js 58 KB, data.js 34 KB), about half of it comments and
spacing. Minifying the deploy copy (terser, as the deploy workflow already
builds the set pages and stamps the version into its copy) gives 123 KB:
Play's scripts 145 → about 70 KB, Multiplayer's 221 → about 105 KB, and
less to parse on a slow phone. The repository keeps the readable files, so
there's still no build step for working on the site.

### 7. Smaller things

- **Account pages when logged out** (Account, Edit profile, Edit
  password) load the whole page and supabase-js, then go to Log in: 464 KB
  and two page loads. A check for a saved session at the top of the page
  could go to Log in at once.
- **js/data.js blocks drawing on pages that don't need it to draw**: Log
  in, Sign up, Forgot password, Account and the edit pages load it in
  `<head>` only so starred questions sync on login; at the end of `<body>`
  it would not hold up the page. (On Play, the Database and Multiplayer it
  is in `<head>` on purpose, to start the bank download early.)
