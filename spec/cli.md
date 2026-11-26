# Command line
`./skill-atlas scan <GitHub URL | directory>`

`./skill-atlas scan github.com/JetBrains/MPS/tree/<commit>`: the repository at that commit
`./skill-atlas scan <GitHub URL | directory> --filter <words>`: only the skills whose **name** or
**description** contains **every** word, *case-insensitive*, in *any order*; before or after the
URL; one argument, split on *whitespace* (`--filter "kotlin test"`), as in the web view
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*
- With `--filter`: the header counts both, `JetBrains/kotlin · 2 of 6 skills`; sorting, the first
  sentence, `also in` and the warnings are unchanged
- No match → the header, `· 0 of N skills`, then `no skills match "<words>"`, the words joined by
  one space; exit code 0
- `--filter` without words, an empty or blank one, twice, or followed by `--filter` → the usage,
  exit code 1
## End-to-end tests
`./skill-atlas scan github.com/JetBrains/<repo>/tree/<commit>` on real repositories,
JetBrains/MPS, JetBrains/android and JetBrains/koog, each at a fixed commit:
- Their stdout and stderr are stored in `tests/expected`; the tests compare with them
- `UPDATE_EXPECTED=1 npm test` stores the output again
