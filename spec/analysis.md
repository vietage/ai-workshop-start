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
- An empty repository, without a commit → a clear message, exit code 1
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
- A repository that fails (unreachable, rate limited, …) → a *warning*, `<repo>: not scanned:
  <message>`; the scan goes on; it is listed **last**, with *no count* and no commit
- An empty repository → *0 skills*, no warning
- *8 repositories* at a time; no time budget: JetBrains, 549 repositories, in about a minute with
  `GITHUB_TOKEN`
- No filter: it is for one repository
- Unknown organisation → `Organisation not found: https://github.com/<org>`, exit code 1
