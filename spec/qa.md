# Manual QA
The web view in a real browser, scenario by scenario: `qa/`
- A **scenario**: `qa/scenarios/<id>.md`, its steps and what is expected, from the spec; its
  **script**: `qa/scripts/<id>.spec.ts`, the same steps in Playwright. Every scenario has a script
- `npm run qa [-- <id>]`: starts the web view, runs the scripts; *every run is recorded*: a video,
  a trace and a screenshot per scenario, in `qa/results/<run>/`, with the commit it tested
- `npm run qa:issues [-- --dry-run] [--run <run>] [--scenario <id>]`: an **issue** per failed scenario
  - Title `[QA] <id>: <title> fails`; labels `Delegated to AI`, `qa`, `bug`
  - Body: the scenario, the failed step, the error, the commit the run tested, how to reproduce,
    a link to the **video**, uploaded to the `qa-recordings` pre-release
  - An open issue for that scenario → a comment on it, not a new issue
  - A skipped or passed scenario → no issue
- The **manual-qa skill** (`.agents/skills/manual-qa`): runs it, sorts the failures into product
  bugs and the rest, files the product bugs
## End-to-end on CI
The same scenarios, scripts and helpers, as end-to-end tests: one suite. `npm run e2e [-- <args>]`
- Runs in the official **Playwright Docker image** of the installed `@playwright/test` version
  (`mcr.microsoft.com/playwright:v<version>-noble`, `linux/amd64`), the checkout copied to `/work`:
  the same fonts, rendering and fixture path on CI and on any machine with Docker
- Every scenario, against `./skill-atlas serve` on `fixture/`; a failed scenario fails the run
- **Screenshots** of each scenario's *key moments*, the states a person would check (not one per
  step): `qa/screenshots/<id>-<moment>.png`, compared with `toHaveScreenshot`; a difference fails
  the run
  - Stable: a fixed viewport (1280×800, scale 1), light colours, `en-US`, UTC, animations disabled,
    the caret hidden; the page shows no times, durations or progress for `fixture/`, nothing masked;
    no tolerance beyond Playwright's default
  - Compared only with `QA_SCREENSHOTS=1`, which `npm run e2e` sets, and only at `/work`; elsewhere
    an error. `npm run qa` does not compare them: the manual QA and `npm run qa:issues` as before
- `github-repository`: on CI too, with `GITHUB_TOKEN`; its screenshot is compared, the repository
  being pinned to a commit. `QA_OFFLINE=1` skips it
- A run: in `qa/results/<run>/`, also an HTML **report** (`report/`), with the expected, actual and
  diff images of each screenshot that differs
- **CI** (`.github/workflows/ci.yml`, job `e2e`): on every push and pull request; on a failure,
  `qa/results/` is uploaded as the `e2e-report` artifact: the report, the videos and the traces
- **Baselines**: made only by the *Update screenshots* workflow
  (`.github/workflows/update-screenshots.yml`), by hand on a branch, on GitHub's Linux runners:
  `--update-snapshots` (the changed and missing ones), then a second run against them; uploaded as
  the `screenshots` artifact, *not pushed*: a person looks at them and commits them
  - A baseline for every screenshot a script names, and none that no script names
