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

An organisation's scan remembers each repository's skill count, warnings and commit in a local SQLite
cache, `~/.cache/skill-atlas/cache.db` (or in `XDG_CACHE_HOME`; `SKILL_ATLAS_CACHE=<file>` for another
place), shared by the CLI and the web view. The next scan asks only for each repository's current
commit and fetches again only the ones that changed; the output is the same.
`./skill-atlas scan github.com/JetBrains --no-cache` scans everything again; deleting the file clears
the cache, and a missing or broken one never fails a scan. One repository's scan stores nothing.

Or in a browser: `./skill-atlas serve` opens a local web view at http://localhost:4173, with a field
for the repository or organisation link, its skills (with a field to filter them) and each one's SKILL.md
(`--port <port>` for another port).

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests. `npm run qa` tests the
web view in a browser, scenario by scenario, and records each one; `npm run qa:issues` files an issue
for each failure ([qa/](qa/README.md), the [manual-qa skill](.agents/skills/manual-qa/SKILL.md)).
`npm run e2e` runs the same scenarios in the Playwright Docker image, as CI does on every push and
pull request, and compares the screenshots of their key moments with the Linux baselines in
`qa/screenshots`; the *Update screenshots* workflow makes new ones
([qa/README.md](qa/README.md#update-the-baselines)).

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
- [docs/demo/](docs/demo/README.md): short videos of features, recorded by the
  [record-demo](.agents/skills/record-demo/SKILL.md) skill.
- [.agents/review-chain.md](.agents/review-chain.md): two agents review and merge every pull request.
- [memory/](memory/README.md): notes agents leave for the next task, what a task learned; written
  at the end of a task by the [update-memory](.agents/skills/update-memory/SKILL.md) skill, and
  never reviewed.
