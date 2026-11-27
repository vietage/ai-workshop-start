# Command line
`./skill-atlas scan <GitHub URL | directory>`

`./skill-atlas scan github.com/JetBrains/MPS/tree/<commit>`: the repository at that commit
`./skill-atlas scan github.com/<org>`: the organisation's repositories, each with its skill count
`./skill-atlas scan <GitHub URL | directory> --filter <words>`: only the skills whose **name** or
**description** contains **every** word, *case-insensitive*, in *any order*; before or after the
URL; one argument, split on *whitespace* (`--filter "kotlin test"`), as in the web view
`./skill-atlas scan github.com/<org> --no-cache`: every repository scanned again, see *Cache*
Prints the result **at once**; *nothing is stored*, but an organisation's *cache*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*
- stdout a *terminal*: the names (and `<owner>/<repo>`) **bold**, the links and `also in` *dim*;
  with `NO_COLOR` set, or stdout not a terminal (piped, a file, the tests' stored output) → plain
  text; the text is the same either way
- With `--filter`: the header counts both, `JetBrains/kotlin · 2 of 6 skills`; sorting, the first
  sentence, `also in` and the warnings are unchanged
- No match → the header, `· 0 of N skills`, then `no skills match "<words>"`, the words joined by
  one space; exit code 0
- `--filter` without words, an empty or blank one, twice, or followed by `--filter` → the usage,
  exit code 1
## Organisation
```
JetBrains · 549 repositories · 144 skills
MPS — 43 skills
intellij-community — 41 skills
…
<repo> — not scanned
```
- `<org> · N repositories · M skills`, as GitHub spells the name; then `<repo> — N skills`, in the
  order of `spec/analysis.md`; one that failed: `<repo> — not scanned`
- Repositories scanned with **0 skills** (an empty one too) → *not listed*; `not scanned` ones stay;
  the header's `N repositories` still counts *all* of them; their warnings stay
  - Every one with 0 skills → only the header, `<org> · N repositories · 0 skills`; exit code 0
- While it scans, a **progress bar** on *stderr*, when it is a *terminal*:
  `[########------------] 12/30 repositories`, 20 characters filled in proportion; redrawn on one
  line as each repository is done; *erased* when the scan ends, before the result, also on an error
  - stderr not a terminal (piped, a file, the tests' stored output) → no progress bar; the output
    is the same either way
- stdout a *terminal*: `<org>` and each `<repo>` **bold**, `not scanned` *dim*; as for one
  repository, plain otherwise
- Warnings go to *stderr*, `warning: <repo>: …`; exit code 0
- With `--filter` → `--filter works on one repository, not on an organisation`, exit code 1
- Unknown organisation → its message, exit code 1
## Cache
An organisation's scan keeps each repository's count in a local SQLite file, as `spec/analysis.md`
says; a repository that has not changed is not fetched again
- The output is *the same* with a cold or a warm cache: stdout, stderr, the progress bar, the exit code
- `--no-cache`, before or after the URL: every repository scanned again, the entries replaced
  - With one repository or a directory: accepted, changes nothing; nothing is stored there
- `SKILL_ATLAS_CACHE=<file>`: the database; by default `skill-atlas/cache.db` in `XDG_CACHE_HOME`,
  else in `~/.cache`; never in the repository or the current directory
- A cache that is missing, not a database, or cannot be used → the scan as without it, exit code 0;
  at most `warning: cache: …` on *stderr*
## End-to-end tests
`./skill-atlas scan github.com/JetBrains/<repo>/tree/<commit>` on real repositories,
JetBrains/MPS, JetBrains/android and JetBrains/koog, each at a fixed commit:
- Their stdout and stderr are stored in `tests/expected`; the tests compare with them
- `UPDATE_EXPECTED=1 npm test` stores the output again

`./skill-atlas scan github.com/vietage`, a real organisation, on its default branches: the header,
one line per repository listed, none with 0 skills, counts that add up, the order, its fork
skipped; an unknown organisation
→ exit code 1; a second scan, with a warm cache → the same output
