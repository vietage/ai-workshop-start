# Manual QA

The web view, tested the way a person would: in a real browser, step by step, against
`./skill-atlas serve`. The [manual-qa skill](../.agents/skills/manual-qa/SKILL.md) runs it and
files an issue for each failure.

| Path | What |
| --- | --- |
| `scenarios/<id>.md` | A scenario: its steps and what is expected, for a person to read |
| `scripts/<id>.spec.ts` | Its script: the same steps in Playwright, one `test.step` each |
| `scripts/helpers.ts` | What the scripts share |
| `playwright.config.ts` | Starts the web view on port 4174 (`QA_PORT`), records every run |
| `file-issues.ts` | Files an issue per failed scenario, with its video |
| `results/<run>/` | A run: `report.json`, and per scenario a video, a trace and a screenshot (not committed) |

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

## A new scenario

1. `scenarios/<id>.md`: front matter with `id`, `title` and `spec` (the section of `spec/` it
   checks); then `## Steps` and `## Expected`, from the spec, not from what the page does now.
2. `scripts/<id>.spec.ts`: one test, titled `<id>: <title>`, a `test.step` for each step.
