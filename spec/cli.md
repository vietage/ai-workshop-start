# Command line
`./skill-atlas scan <GitHub URL | directory>`

`./skill-atlas scan github.com/JetBrains/MPS/tree/<commit>`: the repository at that commit
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
## End-to-end tests
`./skill-atlas scan github.com/JetBrains/<repo>/tree/<commit>` on real repositories,
JetBrains/MPS, JetBrains/android and JetBrains/koog, each at a fixed commit:
- Their stdout and stderr are stored in `tests/expected`; the tests compare with them
- `UPDATE_EXPECTED=1 npm test` stores the output again
