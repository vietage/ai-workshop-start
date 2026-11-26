---
name: record-demo
description: Records a short demo video (MP4) of a Skill Atlas feature, in the web view and/or the CLI, from a JSON script of steps, into docs/demo. Use when asked for a demo, a screencast or a video of a change, and from issue-to-pr before opening a PR.
---

# Record a demo

A demo is a JSON script in `docs/demo/<slug>.json` and the video it records,
`docs/demo/<slug>.mp4`, both committed. The script makes the video reproducible: anyone can
record it again after a change. [docs/demo/word-filter.json](../../../docs/demo/word-filter.json)
is an example.

## 1. Set up (once per machine)

```bash
.agents/skills/record-demo/setup.sh
```

It installs Playwright in `/tmp/demo-tools` (`DEMO_TOOLS` for another place), never in the
repository's `package.json`, plus ffmpeg and a Chromium. When Playwright's browser CDN is
unreachable it falls back to Google Chrome. Set `GITHUB_TOKEN` (`export GITHUB_TOKEN=$(gh auth token)`)
if the demo scans GitHub: the anonymous rate limit runs out fast.

## 2. Write the script

Show the feature, not the whole app: **under a minute**, one idea per caption, each case of the
spec the change adds, including the edge cases a user would notice (no match, an error message).
Use a GitHub link pinned to a commit (`…/tree/<sha>`) or `./fixture`, so it records the same each time.

```json
{
  "serve": true,
  "steps": [
    { "goto": "/" },
    { "caption": "Scan a repository" },
    { "type": "#repo", "text": "./fixture" },
    { "click": "#scan" },
    { "waitFor": "#skills li", "pause": 2000 },
    { "caption": "The same in the CLI" },
    { "run": "./skill-atlas scan ./fixture", "pause": 3000 }
  ]
}
```

Top level: `serve` (start `./skill-atlas serve` on a free port; `goto` paths are relative to it),
or `url` for another base; `viewport` (default `{ "width": 1280, "height": 760 }`);
`typingDelay` (ms per key, default 120). Each step does one thing, then waits `pause` ms:

| Step | Does |
| --- | --- |
| `{ "goto": "/?repo=…" }` | opens a page |
| `{ "type": "<selector>", "text": "…" }` | types at the end of a field, key by key |
| `{ "fill": "<selector>", "text": "" }` | sets a field at once (clears it by default) |
| `{ "click": "<selector>" }` | clicks the first match |
| `{ "press": "Enter" }` | presses a key |
| `{ "waitFor": "<selector>", "timeout": 120000 }` | waits until it shows; a long wait is cut from the video |
| `{ "reload": true }` | reloads the page |
| `{ "run": "<shell command>" }` | types it in a terminal and shows its real stdout, then stderr (amber) and a non-zero exit code; runs in the repository root |
| `{ "caption": "…" }` | a caption at the bottom until the next one; `""` hides it |
| `{ "pause": 1000 }` | only waits |

The web view's selectors are in `src/web-page.ts`: `#repo`, `#scan`, `#filter`, `#skills li`,
`#summary`, `#no-match`, `#warnings`, `#skill`, `#error`.

## 3. Record and check

```bash
node .agents/skills/record-demo/record.mjs docs/demo/<slug>.json docs/demo/<slug>.mp4
```

It prints the video's length. **Look at it before you use it**: extract a few frames and check
each step shows what its caption says (a typo in a selector or a slow scan shows up here):

```bash
ffmpeg -loglevel error -i docs/demo/<slug>.mp4 -vf "fps=1/4,scale=480:-1,tile=4x4" /tmp/<slug>-frames.png
```

Fix the script and record again until it does. Keep the MP4 small (a minute is about 1 MB).
Add the demo to the table in [docs/demo/README.md](../../../docs/demo/README.md).
