# Red agent
An agent that tries to *break the web view* on its own and files an issue per bug: the
**red-agent skill** (`.agents/skills/red-agent`)
- Unlike manual QA (`spec/qa.md`), no scripted scenarios: it reads `spec/web.md`, `spec/analysis.md`
  and the scenarios, and goes after what they don't cover: odd or malformed links, huge, empty or
  unusual repositories, weird skill files, fast or repeated input, the filter, the organisation
  view, errors, the network, the localhost-only rule, the API, accessibility
- **Scope**: the web view only, the page and its API; the CLI only as a reference, no CLI bugs filed.
  *Only files*, never fixes: no change to `src/`, `spec/`, `tests/`, `qa/`, no commit, push or PR
- **Only localhost**: the server it started; odd repositories built as local directories; GitHub
  only for a few scans
- A **bug**: contradicts the spec; also, where the spec is silent, a crash, a hang, a 500, an
  uncaught error, a skill's HTML or script rendered, another host served, unusable by keyboard.
  Taste and spec gaps → the report, not an issue
- Each bug *confirmed*: reproduced twice on a fresh server, the fewest steps, not the environment
- **No duplicates**: the open issues listed first, the `[QA]` ones too; a duplicate → at most a
  comment with what it adds
- A **video** of each bug: a record-demo script (`record.mjs`), its frames checked; not committed
- **At most 5 issues a run**, the worst first; the rest in the report
- **Report**: what was tried per area, the issues, the bugs not filed, the spec gaps; the videos and
  scripts copied to `AIR_ARTIFACTS_DIR` when set
## Filing
`node .agents/skills/red-agent/file-bug.mjs --key <key> --title <title> --body <file> --video <file> [--commit <sha>] [--dry-run]`
- **Key**: lowercase words joined by `-`; one per bug, the same when found again
- **Body**: the sections `## Steps to reproduce`, `## Expected` (citing a `spec/` file) and
  `## Actual`
- Invalid input (a bad key, no title, a section missing, an *Expected* without `spec/`, no video or
  an empty one) → every problem on stderr, exit 2, nothing filed
- An unknown option, an option without its value, or an argument that is not an option → its
  message on stderr in one line, no stack trace, exit 2, nothing filed
- **Issue**: title `[Red agent] <title>`; labels `Delegated to AI`, `bug`, `red-agent`, created if
  missing; body: the commit tested (`HEAD`, or `--commit`), the video's link, the sections, the
  marker `<!-- red-agent: <key> -->`
- **Video**: uploaded to the `red-agent-recordings` pre-release, created if missing, as
  `<key>-<commit, 7 characters>.<ext>`
- An *open* issue whose body has the key's marker → a comment, `Still happens.` and the same body;
  no new issue. Another key, or a similar title → a new issue
- `--dry-run`: what would be filed, its labels and body; nothing uploaded or filed
- `gh` or `git` fails → its message, exit 1
