# Manual QA

The web view, tested the way a person would: in a real browser, step by step, against
`./skill-atlas serve`. The [manual-qa skill](../.agents/skills/manual-qa/SKILL.md) runs it and
files an issue for each failure.

| Path | What |
| --- | --- |
| `scenarios/<id>.md` | A scenario: its steps and what is expected, for a person to read |
| `scripts/<id>.spec.ts` | Its script: the same steps in Playwright, one `test.step` each, and a `screenshot()` at each key moment |
| `scripts/helpers.ts` | What the scripts share |
| `screenshots/<id>-<moment>.png` | The baselines of the key moments, made on Linux by the *Update screenshots* workflow |
| `playwright.config.ts` | Starts the web view on port 4174 (`QA_PORT`), records every run |
| `e2e.ts` | `npm run e2e`: the scenarios in the Playwright Docker image, the screenshots compared |
| `file-issues.ts` | Files an issue per failed scenario, with its video |
| `results/<run>/` | A run: `report.json` (with the commit it tested), the HTML `report/`, and per scenario a video, a trace and a screenshot (not committed) |

```bash
npx playwright install chromium   # once; or QA_CHANNEL=chrome for an installed Google Chrome
npm run qa                        # every scenario
npm run qa -- filter-skills       # only the scenarios whose file name matches
npm run qa:issues -- --dry-run    # what would be filed for the newest run
npm run qa:issues                 # file them
```

- Every scenario is recorded, passed or failed: `video.webm`, `trace.zip`
  (`npx playwright show-trace <path>`) and a screenshot.
- The scenarios use `fixture/`, a local directory: no network. `github-repository` needs the
  network (`QA_OFFLINE=1` skips it), and `GITHUB_TOKEN` against the rate limit.
- `npm run qa:issues` files a failed scenario as `[QA] <id>: <title> fails`, with the labels
  `Delegated to AI` (`QA_ISSUE_LABEL`), `qa` and `bug`. The video is uploaded to the `qa-recordings`
  pre-release and linked from the issue. A scenario with an open issue gets a comment instead.
  `--run <id>` picks a run other than the newest; `--scenario <id>`, repeated, only those.

## End-to-end tests, with screenshots

The same scenarios run on CI on every push and pull request (the `e2e` job of
[ci.yml](../.github/workflows/ci.yml)). Each script takes `screenshot(page, '<id>-<moment>')` at
the moments a person would check; the screenshot must match `screenshots/<id>-<moment>.png`, or the
scenario fails.

```bash
npm run e2e                       # every scenario, screenshots compared; needs Docker
npm run e2e -- filter-skills      # only some
npx playwright show-report qa/results/<run>/report   # the expected, actual and diff images
```

- `npm run e2e` runs `playwright test` in the official Playwright Docker image of the installed
  `@playwright/test` version (`mcr.microsoft.com/playwright:v<version>-noble`, `linux/amd64`), with
  the checkout copied to `/work`: the same fonts and pixels on CI and on your machine. Only
  `results/` and `screenshots/` come back. On Apple silicon, Docker emulates amd64: slower, the
  same pixels.
- `npm run qa` does not compare the screenshots: outside the image the rendering differs. With
  `QA_SCREENSHOTS=1` outside it, the config stops with an error.
- `github-repository` runs on CI too, with `GITHUB_TOKEN`; the repository is pinned to a commit,
  so its screenshot is compared. `QA_OFFLINE=1` skips it.
- A failed run on CI uploads `qa/results/` as the `e2e-report` artifact: the HTML report, the
  videos and the traces.

### Update the baselines

The baselines are made on GitHub's Linux runners, never on a developer's machine:

1. Push the branch with the change, then run the **Update screenshots** workflow on it: Actions →
   Update screenshots → Run workflow, or `gh workflow run update-screenshots.yml --ref <branch>`.
   It runs `npm run e2e -- --update-snapshots` (the changed and missing baselines), then
   `npm run e2e` again to check that they are stable.
2. Look at them: `gh run download <run id> -n screenshots -D qa/screenshots` (the `screenshots`
   artifact), then `git diff --stat qa/screenshots` and open the changed PNGs.
3. Commit them, with the change that explains them. The workflow pushes nothing.

A new screenshot without a baseline fails until its baseline is committed; `npm test` checks that
every screenshot a script names has a baseline, and that no baseline is left over. To check a
baseline locally, `npm run e2e` in Docker gives the same pixels as CI.

## A new scenario

1. `scenarios/<id>.md`: front matter with `id`, `title` and `spec` (the section of `spec/` it
   checks); then `## Steps` and `## Expected`, from the spec, not from what the page does now.
2. `scripts/<id>.spec.ts`: one test, titled `<id>: <title>`, a `test.step` for each step, and
   `screenshot(page, '<id>-<moment>')` at each key moment.
3. Its baselines: the *Update screenshots* workflow, as above.
