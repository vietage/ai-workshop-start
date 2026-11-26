# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

`--filter <word>` prints only the skills whose name or description contains the word, in any case:
`./skill-atlas scan https://github.com/JetBrains/kotlin --filter gradle`; the header shows `N of M skills`.

Or in a browser: `./skill-atlas serve` opens a local web view at http://localhost:4173, with a field
for the repository link, its skills (with a field to filter them) and each one's SKILL.md
(`--port <port>` for another port).

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests.

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
