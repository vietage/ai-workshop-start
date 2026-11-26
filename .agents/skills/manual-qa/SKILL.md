---
name: manual-qa
description: Tests the web view in a real browser against the QA scenarios in qa/, records a video of every scenario, and files a GitHub issue labelled "Delegated to AI", with the video, for each scenario that fails. Use when asked to QA, smoke-test or manually test the web UI, or to check a change in the browser.
---

# Manual QA

You open the web view (`./skill-atlas serve`) in a real browser and go through the scenarios in
[qa/scenarios](../../../qa/scenarios). Each scenario has a script in [qa/scripts](../../../qa/scripts)
that does the steps. Every scenario is recorded. You decide which failures are product bugs, and
you file an issue for each one. [qa/README.md](../../../qa/README.md) explains the layout.

The scenarios and [spec/](../../../spec/) are the source of truth, and the page is what's under
test. Never change a scenario's *Expected* just because the page does something else.

## 1. Prepare

```bash
npm ci
npx playwright install --with-deps chromium
```

If the Chromium download fails (e.g. a blocked CDN), use Google Chrome. `npx playwright install chrome`
downloads it from Google. Then set `QA_CHANNEL=chrome` for every run below. Video recording needs
Playwright's ffmpeg. If that can't be downloaded either, install the system one and link it where
Playwright looks (the revision is in `node_modules/playwright-core/browsers.json`):

```bash
sudo apt-get install -y ffmpeg
mkdir -p ~/.cache/ms-playwright/ffmpeg-<revision>
ln -sf "$(which ffmpeg)" ~/.cache/ms-playwright/ffmpeg-<revision>/ffmpeg-linux
touch ~/.cache/ms-playwright/ffmpeg-<revision>/INSTALLATION_COMPLETE
```

For `github-repository`, export `GITHUB_TOKEN` (`export GITHUB_TOKEN=$(gh auth token)`) against
the rate limit. Without the network, set `QA_OFFLINE=1` to skip it.

## 2. Run the scenarios

All of them, unless the user named some:

```bash
npm run qa                          # every scenario
npm run qa -- filter-skills failed  # those whose file name matches
```

The config starts the web view on port 4174 (`QA_PORT`) and stops it at the end. Each run goes to
`qa/results/<run>/`. That folder has `report.json`, plus a `video.webm`, `trace.zip` and screenshot
for each scenario, passed or failed.

## 3. Look at each failure

For every failed scenario, before you file anything:

1. Read the error and the failed step in the output, and look at the screenshot
   (`qa/results/<run>/artifacts/<scenario>…/test-failed-1.png`) with the Read tool.
   `error-context.md` next to it has the page's accessibility snapshot.
2. Compare what the page did with the scenario's *Expected* and with the spec section in its
   `spec:` front matter.
3. Put the failure in one of three groups:
   - **Product bug**: the page contradicts the scenario and the spec. File it.
   - **Environment**: the network, GitHub's rate limit, a missing browser, a busy port. Fix the
     environment and run that scenario again. Don't file it. If you can't fix it, report it to
     the user.
   - **Script bug**: the script is wrong and the scenario is right, e.g. a stale selector or a
     race. Fix the script, run it again, and tell the user. Don't file it.
4. Run a failing scenario once more (`npm run qa -- <id>`) to rule out flakiness. A scenario
   that fails only sometimes is still a bug. File it, and say in the summary that it is flaky.

## 4. File the issues

Check what would be filed:

```bash
npm run qa:issues -- --dry-run --scenario <id> [--scenario <id>]...
```

Then file the product bugs, naming each with `--scenario` so the environment and script
failures are left out:

```bash
npm run qa:issues -- --scenario <id> [--scenario <id>]...
```

For each scenario, this does the following:
- uploads its video to the `qa-recordings` pre-release
- files `[QA] <id>: <title> fails` with the labels `Delegated to AI`, `qa` and `bug`. The body has
  the scenario, the failed step, the error, the commit the run tested, how to reproduce and the
  video link.
- if that scenario already has an open issue, comments on it instead of filing a duplicate

`--run <run>` files from a run other than the newest. If your findings add to the generated body
(what you saw in the video or screenshot, the likely cause in `src/`), add them with
`gh issue comment <n> --body ...`.

## 5. Save the recordings, then report

If `AIR_ARTIFACTS_DIR` is set, copy the run there so the recordings outlive the session:

```bash
[ -n "$AIR_ARTIFACTS_DIR" ] && mkdir -p "$AIR_ARTIFACTS_DIR/qa" && cp -r qa/results/<run> "$AIR_ARTIFACTS_DIR/qa/"
```

Finish with a table that has one row per scenario: passed, failed (product bug, with the issue
link), environment, or script fixed. Add where the recordings are.

## Adding a scenario

When the user asks for a new scenario, or when you find a spec case with no scenario:
1. Write `qa/scenarios/<id>.md` with front matter (`id`, `title`, `spec`), then `## Steps` and
   `## Expected`. Take them from the spec, not from what the page does now.
2. Write `qa/scripts/<id>.spec.ts` with one test titled `<id>: <title>` and one `test.step` per step.
   Use the helpers in `qa/scripts/helpers.ts`.
3. Run `npm test`. `tests/qa.test.ts` checks that every scenario has a script and front matter.
