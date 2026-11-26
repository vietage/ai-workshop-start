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

`--filter <words>` prints only the skills whose name or description contains every word, in any case
and any order: `./skill-atlas scan https://github.com/JetBrains/kotlin --filter "gradle bump"`; the
header shows `N of M skills`. The web view's filter field works the same way.

An organisation, or a user: `./skill-atlas scan github.com/JetBrains` lists its repositories, each
with its skill count, the most first; archived repositories and forks are skipped. While it scans, a
progress bar shows how many repositories are done, in the terminal and in the web view.

Or in a browser: `./skill-atlas serve` opens a local web view at http://localhost:4173, with a field
for the repository or organisation link, its skills (with a field to filter them) and each one's SKILL.md
(`--port <port>` for another port).

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests. `npm run qa` tests the
web view in a browser, scenario by scenario, and records each one; `npm run qa:issues` files an issue
for each failure ([qa/](qa/README.md), the [manual-qa skill](.agents/skills/manual-qa/SKILL.md)).

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
- [docs/demo/](docs/demo/README.md): short videos of features, recorded by the
  [record-demo](.agents/skills/record-demo/SKILL.md) skill.
- [.agents/review-chain.md](.agents/review-chain.md): two agents review and merge every pull request.
