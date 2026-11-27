# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
- `github.com/<owner>/<repo>`: the default branch
- `github.com/<owner>/<repo>/tree/<commit or branch>`: that commit
- `github.com/<org>`: an **organisation** or a user, no repository; see *Organisation*
## Output
Every *project skill*: **name**, **description**, **link**
- A **filter**, optional: its text split on *whitespace* into words; only the skills whose name or
  description contains **every** word (*AND*), each a *substring*, *case-insensitive*, in *any
  order*, each word in the name or in the description; the count before filtering is kept.
  Applied after the scan
  - Quotes are characters like any other: `"code review"` is the words `"code` and `review"`
  - No words (empty, or only whitespace) → no filter
## Project skill
A skill that agents load when they work in the repository:
`<project>/<agent folder>/<skill>/SKILL.md`
- **Agent folders**: `.agents/skills`, `.claude/skills`, `.github/skills`, `agent/skills`
- **Project**: the repository root, or any directory in it; a monorepo's modules have their own
- **Skill**: a directory right in the agent folder, with a file named exactly `SKILL.md`
- **Copies**: the same skill directory in several agent folders of one project → *one skill*;
  the first folder in the order above is the skill, the others are its copies
- Copies with different contents → a *warning*
- Not a skill:
  - `SKILL.md` anywhere else: the repository root, `skills/<skill>/`, an agent folder itself,
    a skill's own subdirectories (`<skill>/examples/SKILL.md`)
  - another case: `skill.md`, `Skill.md`
  - a symbolic link, to a file or to a directory: its target is scanned where it is
  - anything under `node_modules` or `.git`
- The same model for GitHub and a local directory
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit, copies
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- A tree too large to list at once: only the agent folders at the root, and a *warning*;
  `GITHUB_TOKEN` searches everywhere, on the default branch only
- A commit or branch in the URL: always its tree; code search sees only the default branch
- The name: front matter, else the directory
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
- An answer GitHub cut off, or one that is not JSON (a proxy's error page) → a clear message,
  exit code 1
- An empty repository, without a commit → a clear message, exit code 1
- A request GitHub *does not answer* (the connection accepted, then nothing; an answer that stops
  halfway; a stalled network) → given up after **30 s**, the answer and its body together:
  `Cannot reach GitHub: no answer in 30 s for <url>`, exit code 1; never a hang
  - `SKILL_ATLAS_GITHUB_TIMEOUT=<seconds>`: another limit; `Infinity`, or more than about
    24.8 days (2 147 483 647 ms, the longest timer): *no limit*; not a number above 0: 30 s
  - The CLI exits once its output is written, even when a connection given up on stays open
## Organisation
`github.com/<org>`: every repository of an organisation, or of a user, each with its **skill count**
- **Output**: the organisation, its **repositories** (each with its name, commit, skill count),
  the count of all their skills, warnings
- Each repository on its *default branch*, by the same rules as one repository; its warnings start
  with `<repo>: `
  - Always through its *tree*, even with `GITHUB_TOKEN`: code search allows too few requests a
    minute for every repository; a tree too large → only the agent folders at the root, and a warning
- Sorted by skill count, the most first, then by **name**, *case-insensitive*
- **Skipped**: archived repositories and forks
- With `GITHUB_TOKEN`: the private repositories it can see too; a user: their public repositories
- A repository that fails, *whatever the error* (unreachable, rate limited, an answer cut off or
  not JSON, an unexpected one) → a *warning*, `<repo>: not scanned: <message>`; the scan goes on;
  it is listed **last**, with *no count* and no commit
- An empty repository → *0 skills*, no warning
- The output keeps *every* repository, those with 0 skills too; the CLI and the web page leave
  them out of the list (`spec/cli.md`, `spec/web.md`)
- **Progress**: `scanned` of `total` repositories, the archived ones and forks not counted; *0 of N*
  once listed, then one more as each repository is done, whatever its outcome, the failed ones too;
  nothing before the list (an unknown organisation)
- *8 repositories* at a time; no time budget: JetBrains, 549 repositories, in about a minute with
  `GITHUB_TOKEN`; less with a warm *cache*
- No filter: it is for one repository
- Unknown organisation → `Organisation not found: https://github.com/<org>`, exit code 1
## Cache
An organisation's scan keeps what each repository gave, so one that has *not changed* is not
fetched again
- **What**: per repository, `<owner>/<repo>`: the **commit** it was scanned at, its **skill count**,
  its **warnings**; no skills, no file contents
- **Key**: the repository and the commit of its default branch, *one small request* a repository,
  always made: the list has no commit
  - The same commit as the one kept → the count and the warnings from the cache; *no tree*, no files
  - Another commit, or nothing kept → scanned, and the entry *replaced*
- **Not kept**: a repository that failed (`not scanned`), tried again by the next scan; what was
  kept of it before stays, for its commit. An empty repository: it has no commit
- Kept as each repository is done: a scan that is interrupted, or rate limited halfway, keeps what
  it has scanned
- **The same output** with a cold or a warm cache: repositories, counts, commits, order, warnings,
  progress (a repository from the cache is one more done)
- **Valid** for one *version*: the file's schema and the **analysis rules** that gave the counts and
  the warnings (what is a skill, a copy, a warning). An entry kept by a skill-atlas of another
  version, older or newer, is *never used*: the file is emptied, no warning, and filled again
  - The rules' version is raised with every change that gives another count or another warning for
    the same files; a test on `./fixture` fails when they change and it was not
- **Bypass**: every repository scanned again, whatever is kept, and the entries replaced
- **Removed**: after a scan, the entries of the organisation's repositories that are *no longer
  listed*: deleted, moved, archived, now a fork; no expiry otherwise, no command to clear it:
  delete the file
- **Where**: one **SQLite** file (`node:sqlite`, no dependency), `skill-atlas/cache.db` in
  `XDG_CACHE_HOME` (an absolute path), else in `~/.cache`; `SKILL_ATLAS_CACHE=<file>` for another
  place; never in the repository. The file and its directory are created on first use, readable by
  the *user only*: with `GITHUB_TOKEN`, private repositories' counts and warnings are in it
  - An entry is used only after GitHub answered for the repository's commit, so only for who can
    see the repository now
- **Robust**: the cache never fails a scan
  - No file → created
  - Not a database, or a damaged one → moved to `<file>.corrupt`, a new one created, and a
    *warning*, `cache: <file> was not a readable database: …`
  - Another version, of the schema or of the rules → emptied, no warning; see *Valid*
  - Cannot be opened, read or written (a directory, no permission, a database another program
    keeps *locked*) → the scan goes on without it, one *warning*, `cache: not used: <message>`
    (`not read`, `not saved`)
    - After the first failure the cache is *left alone* for the rest of that scan, nothing more
      read or saved: a locked database is waited for *once*, 2 s at most, not for every repository
  - The cache's warnings come last, after the repositories'
- Two scans at the same time, the CLI and the web view: one database, each entry written at once;
  the last one written stays
- **One repository** (`github.com/<owner>/<repo>`, a commit, a directory): *no cache*, nothing read
  or stored
- In the core: the CLI and the web view / API use the same cache; the core decides what is kept
  and used, the file is the Node clients'
