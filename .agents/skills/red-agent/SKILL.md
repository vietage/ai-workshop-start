---
name: red-agent
description: Tries to break the web view (./skill-atlas serve) on its own, beyond the scripted QA scenarios, and files one GitHub issue per bug, labelled "Delegated to AI" and "bug", with the steps to reproduce, what the spec expects, what happened and a video. Only files; never fixes. Use when asked to attack, break, fuzz, red-team or explore the web UI for bugs.
---

# Red agent

You try to **break the web view** (`./skill-atlas serve`): the page and its API. You find bugs and
**file one issue per bug** with a video. Each issue is labelled `Delegated to AI`, so another agent
picks it up and fixes it.

How this differs from [manual-qa](../manual-qa/SKILL.md): manual-qa runs the scripted scenarios in
[qa/scenarios](../../../qa/scenarios). You explore on your own and go after what those scenarios
don't cover.

[spec/web.md](../../../spec/web.md) and [spec/analysis.md](../../../spec/analysis.md) are the
source of truth. Read both, then read every scenario in `qa/scenarios`: what they already cover is
not your target.

## Scope

- **Only files issues, never fixes.** Don't change `src/`, `spec/`, `tests/` or `qa/`. Don't
  commit, push or open a pull request. The fix belongs to whoever picks up the issue.
- **Only the web view**: the page in a browser, and its HTTP API (`/api/scan`). The CLI is out of
  scope. You may run `./skill-atlas scan` as a reference, to compare the web view's result with it,
  but don't file CLI bugs.
- **Only your own machine.** Attack the server you started on `localhost`. Never attack GitHub or
  any other host. For huge or unusual repositories, build them as local directories (step 3). Keep
  GitHub to a few scans, with `GITHUB_TOKEN`.

## 1. Prepare

```bash
npm ci
.agents/skills/record-demo/setup.sh       # Playwright in /tmp/demo-tools, ffmpeg, a browser
export GITHUB_TOKEN=$(gh auth token)
mkdir -p /tmp/red-agent
./skill-atlas serve --port 4175 &         # the server under attack; restart it after a crash
```

Note the commit you test (`git rev-parse HEAD`). Every issue names it.

## 2. Know what is already filed

Before you file anything, list the open issues. Check the bugs from manual QA (`[QA] …`) too:

```bash
gh issue list --state open --limit 200 --json number,title,labels,body
```

A bug that already has an open issue is not filed again, whatever its title. If you found
something the issue doesn't say yet (another way to trigger it, a video), add it with
`gh issue comment <n> --body ...`. That's all you do for a duplicate.

## 3. Attack

Explore with `curl` against the API and with short Playwright scripts against the page. Load
Playwright from `/tmp/demo-tools` with `createRequire`, as
[record.mjs](../record-demo/record.mjs) does. The selectors are in `src/web-page.ts`.

Build odd repositories as local directories under `/tmp/red-agent/`, never in the repository.
Then scan them by path. Go after at least these areas:

- **Links**: odd or malformed. Trailing slashes, `.git`, `http://`, `www.`, upper case, a
  `/blob/`, `/tree/` or `/pull/` URL, a branch with `/` in it, query strings and `#`, spaces,
  unicode, a very long link, `file://`, a path with `..`, a non-GitHub host.
- **Repositories**: huge, empty or unusual. Thousands of skills, a very deep tree, a
  directory without any skill, an empty directory, one you can't read, a symbolic link loop.
- **Skill files**: weird ones. Empty, no or broken front matter, a huge SKILL.md, binary, CRLF or a
  BOM, unicode and emoji names, HTML or `<script>` in the name, description or body, very
  long lines, names with `&`, `?`, `#`, `%`, `/`, the same name twice.
- **Input**: fast or repeated. Double-click *Scan*, Enter held down, a new link while a scan
  runs (the earlier result must not win), typing fast in the filter, back and forward, reload in
  the middle of a scan.
- **The filter**: every case of the spec's filter rule against odd words. Regex characters,
  quotes, only spaces, unicode case, a very long text. Check the URL after each.
- **The organisation view**: its progress, an empty or failing repository, selecting while it
  scans, a second organisation while the first is still scanning, the URL.
- **Errors**: every message in the spec. Does the page show it, and nothing else? Does a reload
  bring it back?
- **The network**: GitHub slow, unreachable or cut off. Use a local stand-in server or a proxy
  that drops requests, not GitHub itself.
- **The localhost-only rule**: another `Host` header, an IP, `localhost.` with a trailing dot,
  `0.0.0.0`, a header with a port. Check which interfaces the server listens on (`ss -ltnp`).
- **The API**: malformed requests. Missing or repeated parameters, bad encoding, other methods,
  a huge query, `stream=1` with errors. Each must get the status and JSON the spec says.
- **Accessibility**: keyboard only (Tab, Enter, arrow keys), focus you can see, labels for the
  fields, the list's roles and `aria-selected`, contrast in light and dark.

A **bug** is anything that contradicts the spec. These count even where the spec says nothing: a
crash, a hang, a 500, an uncaught error in the browser console, script or HTML from a skill run
or rendered, the server answering another host, a page you can't use from the keyboard.

Something that is only taste or a gap in the spec is not a bug. List it in your report instead
of filing it.

## 4. Confirm each bug

1. Reproduce it **twice**, against a freshly started server. Something that happens only
   sometimes is still a bug. Say how often it happened.
2. Cut it down to the **fewest steps**. Save any repository it needs as a script that builds it,
   so the steps can be copied.
3. Check that it isn't a duplicate (step 2), and that it isn't the environment (the network,
   GitHub's rate limit, a busy port).

## 5. Record it

Record a video of each bug with [record-demo](../record-demo/SKILL.md)'s
[record.mjs](../record-demo/record.mjs). Write a script with `"serve": true`, a caption per step,
and the last caption saying what went wrong. For an API or `Host` bug, use `run` steps with
`curl` against the server on port 4175. `serve` starts a server of its own, on another port:

```bash
node .agents/skills/record-demo/record.mjs /tmp/red-agent/<key>.json /tmp/red-agent/<key>.mp4
ffmpeg -loglevel error -i /tmp/red-agent/<key>.mp4 -vf "fps=1/4,scale=480:-1,tile=4x4" /tmp/red-agent/<key>-frames.png
```

Look at the frames. The video must show the bug happening. If it doesn't, fix the script and
record again. Never commit the videos.

## 6. File one issue per bug

Write the body to `/tmp/red-agent/<key>.md` with these three sections:

```markdown
## Steps to reproduce
1. `./skill-atlas serve`, open http://localhost:4173
2. …

## Expected
What spec/web.md (or spec/analysis.md) says, quoted, with the section. If the spec says nothing,
say so and say what is expected instead.

## Actual
What happened: the message, the status, the console error, a screenshot or the response.
```

Check it first, then file it:

```bash
node .agents/skills/red-agent/file-bug.mjs --key <key> --title "<what goes wrong>" \
  --body /tmp/red-agent/<key>.md --video /tmp/red-agent/<key>.mp4 --dry-run
node .agents/skills/red-agent/file-bug.mjs --key <key> --title "<what goes wrong>" \
  --body /tmp/red-agent/<key>.md --video /tmp/red-agent/<key>.mp4
```

- `<key>`: short, lowercase words joined by `-`, naming the bug, e.g. `filter-regex-characters`.
  The same bug found again gets the same key.
- It refuses a body without the three sections, an *Expected* that cites no `spec/` file, or a
  missing video (exit 2).
- It uploads the video to the `red-agent-recordings` pre-release and files
  `[Red agent] <title>`, labelled `Delegated to AI`, `bug` and `red-agent`. The body has the
  commit, the video's link, your sections and the key.
- An open issue with the same key gets a comment, `Still happens.`, not a new issue.

**At most 5 issues a run**, the worst first: a security hole or a crash before a wrong
message. Each `Delegated to AI` label starts an agent. List the rest in your report, for the next
run.

## 7. Report

If `AIR_ARTIFACTS_DIR` is set, copy `/tmp/red-agent/` there so the videos and scripts outlive the
session:

```bash
[ -n "$AIR_ARTIFACTS_DIR" ] && mkdir -p "$AIR_ARTIFACTS_DIR/red-agent" && cp -r /tmp/red-agent/. "$AIR_ARTIFACTS_DIR/red-agent/"
```

Finish with:

- a table of what you tried, one row per area, and what you found
- the issues filed or commented on, with their links
- the bugs not filed: duplicates, those over the limit, those you couldn't confirm
- the gaps in the spec you noticed

Stop the server you started.
