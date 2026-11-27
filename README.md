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

In a terminal, the names are bold and the links dim; piped, or with `NO_COLOR` set, the output is
plain text, the same words.

An organisation, or a user: `./skill-atlas scan github.com/JetBrains` lists its repositories, each
with its skill count, the most first; archived repositories and forks are skipped. Repositories with
no skills are left out of the list, but counted in its header; the ones that could not be scanned
stay. While it scans, a progress bar shows how many repositories are done, in the terminal and in
the web view.

An organisation's scan remembers each repository's skill count, warnings and commit in a local SQLite
cache, `~/.cache/skill-atlas/cache.db` (or in `XDG_CACHE_HOME`; `SKILL_ATLAS_CACHE=<file>` for another
place), shared by the CLI and the web view. The next scan asks only for each repository's current
commit and fetches again only the ones that changed; the output is the same.
`./skill-atlas scan github.com/JetBrains --no-cache` scans everything again; deleting the file clears
the cache, and a missing or broken one never fails a scan. One repository's scan stores nothing.

Or in a browser: `./skill-atlas serve` opens a local web view at http://localhost:4173, with a field
for the repository or organisation link (an organisation's repositories in a column, each with its
skill count; a repository selected opens its skills in a tab of its own in the page, next to the
organisation's tab), its skills (with a field to filter them) and each one's SKILL.md, in a gradient style,
light or dark as the system's colours (`--port <port>` for another port). While a scan runs, the
*Scan* button is **Stop**: it stops the scan, on the server too, and keeps what has been found so far,
an organisation's repositories already scanned with their counts, the rest `not scanned`.

Set `GITHUB_TOKEN` for a higher GitHub rate limit. A GitHub request that gets no answer gives up after 30 s with
`Cannot reach GitHub: no answer in 30 s for <url>` (`SKILL_ATLAS_GITHUB_TIMEOUT=<seconds>` for another limit, `Infinity` for none). `npm test` runs the tests. `npm run qa` tests the
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
- [issue-to-pr](.agents/skills/issue-to-pr/SKILL.md): an agent implements an issue and opens a PR; it
  asks the decisions the issue leaves open in Slack `#my-ai-workshop` and waits for the thread's reply
  ([spec/issue-to-pr.md](spec/issue-to-pr.md)).
- [red-agent](.agents/skills/red-agent/SKILL.md): an agent tries to break the web view beyond the QA
  scenarios and files an issue per bug, with the steps, what the spec expects and a video, labelled
  `Delegated to AI` so that issue-to-pr fixes it ([spec/red-agent.md](spec/red-agent.md)).
- [status-update](.agents/skills/status-update/SKILL.md): the pull requests merged and the issues
  resolved since a date, posted to your private Slack channel (`SLACK_STATUS_CHANNEL`), never the
  shared `#my-ai-workshop` ([spec/status-update.md](spec/status-update.md)).
- [memory/](memory/README.md): notes agents leave for the next task, what a task learned; written
  at the end of a task by the [update-memory](.agents/skills/update-memory/SKILL.md) skill, and
  never reviewed.
