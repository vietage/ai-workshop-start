# Demos

Short videos of features, each recorded from the script next to it by the
[record-demo](../../.agents/skills/record-demo/SKILL.md) skill:

```bash
.agents/skills/record-demo/setup.sh
node .agents/skills/record-demo/record.mjs docs/demo/<slug>.json docs/demo/<slug>.mp4
```

| Video | Script | Shows |
| --- | --- | --- |
| [word-filter.mp4](word-filter.mp4) | [word-filter.json](word-filter.json) | the filter by several words, [#13](https://github.com/vietage/ai-workshop-start/issues/13) |
| [scan-progress.mp4](scan-progress.mp4) | [scan-progress.json](scan-progress.json) | the progress bar of an organisation's scan, [#18](https://github.com/vietage/ai-workshop-start/issues/18) |
| [failed-scan.mp4](failed-scan.mp4) | [failed-scan.json](failed-scan.json) | a failed scan shows its message and nothing else, [#20](https://github.com/vietage/ai-workshop-start/issues/20) |
| [organisation-cache.mp4](organisation-cache.mp4) | [organisation-cache.json](organisation-cache.json) | the cache of an organisation's scan, [#22](https://github.com/vietage/ai-workshop-start/issues/22) |
| [nicer-skill-list.mp4](nicer-skill-list.mp4) | [nicer-skill-list.json](nicer-skill-list.json) | the gradient style, an organisation's repositories in a column, [#30](https://github.com/vietage/ai-workshop-start/issues/30) |
| [scan-button.mp4](scan-button.mp4) | [scan-button.json](scan-button.json) | the Scan button back to `Scan` once the latest scan ends, [#34](https://github.com/vietage/ai-workshop-start/issues/34) |
| [github-no-answer.mp4](github-no-answer.mp4) | [github-no-answer.json](github-no-answer.json) | a GitHub that never answers: the scan gives up with a clear message, in the web view and the CLI, [#44](https://github.com/vietage/ai-workshop-start/issues/44) |

## word-filter

The web view on `JetBrains/kotlin` at a fixed commit (7 skills), then the CLI:

| Filter | Shows | Why |
| --- | --- | --- |
| `gradle` | 4 of 7 skills | one word, in the name or the description |
| `gradle bump` | 3 of 7 | every word must match (AND) |
| `BUMP Gradle` | 3 of 7 | any case, any order |
| `gradle wrapper` | 1 of 7 | `wrapper` only appears in the description |
| `gradle wrapper xyz` | 0 of 7, `no skills match "gradle wrapper xyz"` | no match is not an error |
| `test`, then reload | 5 of 7, both times | the URL keeps `filter=` |
| `--filter "gradle bump"` in the CLI | `3 of 7 skills` | the same rule ([spec/cli.md](../../spec/cli.md)) |

## scan-progress

The web view on the `Kotlin` organisation, on its default branches (107 repositories):

| Step | Shows | Why |
| --- | --- | --- |
| `github.com/Kotlin`, Scan | `0 of 107 repositories scanned`, then more | the bar fills as each repository is done |
| the scan ends | the repositories and their counts, no bar | hidden once the scan ends |
| `github.com/no-such-organisation-xyz` | its message, no bar | fails before the repositories are listed |

The CLI's bar is drawn only on a terminal ([spec/cli.md](../../spec/cli.md)), which the recorder's
terminal is not.

## failed-scan

The web view on `./fixture`, then a directory that does not exist:

| Step | Shows | Why |
| --- | --- | --- |
| `./fixture`, Scan | 4 skills, the filter, the SKILL.md of `code-style`, warnings | a scan that works |
| `/no/such/directory`, Scan | its message only; the Scan button enabled | a failed scan → its message, nothing else |
| reload | the same message | the URL keeps the failed link |

## organisation-cache

The CLI on the `Kotlin` organisation, on its default branches (107 repositories), then the web view.
Recorded with a cache of its own, which the script removes first, and the time of each scan:

```bash
SKILL_ATLAS_CACHE=/tmp/skill-atlas-demo/cache.db TIMEFORMAT='%R s' \
  node .agents/skills/record-demo/record.mjs docs/demo/organisation-cache.json docs/demo/organisation-cache.mp4
```

| Step | Shows | Why |
| --- | --- | --- |
| `scan github.com/Kotlin`, no cache yet | its repositories, 11.2 s | every repository is fetched, and kept |
| the same again | the same output, 7.5 s | only each repository's commit is asked for; no tree, no file |
| `--no-cache` | the same output, 10.8 s | every repository scanned again, the entries replaced |
| the file overwritten with `garbage` | the same output, `cache.db.corrupt`, `warning: cache: …` | a broken cache never fails a scan |
| the web view, `github.com/Kotlin` | the same repositories and counts | one cache for the CLI and the web view |

## nicer-skill-list

The web view on `./fixture`, then the `Kotlin` organisation, on its default branches:

| Step | Shows | Why |
| --- | --- | --- |
| `./fixture`, Scan | the gradient header, the page, the cards | the gradient style ([spec/web.md](../../spec/web.md), *Style*) |
| `invoices` selected | a gradient tint and an accent bar, its name in the gradient | the selected skill |
| `github.com/Kotlin`, Scan | the repositories one a line, each count in a pill next to its name | in a column, not in a row |
| `kotlinx-rpc` selected | the same accent on the repository; its skills below | a repository selected |

The CLI's bold names and dim links are drawn only when stdout is a terminal
([spec/cli.md](../../spec/cli.md)), which the recorder's terminal is not: it shows the plain text.

## scan-button

The web view on the `Kotlin` organisation, on its default branches, then a directory that does
not exist:

| Step | Shows | Why |
| --- | --- | --- |
| `github.com/Kotlin`, Scan | `Scanning…`, disabled; `Scan` once the repositories are shown | the button while a scan runs, and after |
| `kotlinx-rpc` selected | `Scanning…`, then `Scan` with its skills | a repository opened from an organisation |
| `dataframe`, then `multik` at once | `Scan` once `multik` is shown | the button follows the latest scan only |
| `/no/such/directory`, Scan | its message, `Scan`, enabled | after a failure too |

A scan that never ends (the case of [#34](https://github.com/vietage/ai-workshop-start/issues/34))
cannot be recorded against GitHub; `tests/web.test.ts` stalls one in a stand-in server.

## github-no-answer

Recorded through a stand-in for GitHub that accepts every connection and never answers (the
issue's `silent-proxy.py`, on port 4199), with a 5 s limit:

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:4199 NO_PROXY=localhost,127.0.0.1 SKILL_ATLAS_GITHUB_TIMEOUT=5 \
  node .agents/skills/record-demo/record.mjs docs/demo/github-no-answer.json docs/demo/github-no-answer.mp4
```
