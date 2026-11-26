# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
- `github.com/<owner>/<repo>`: the default branch
- `github.com/<owner>/<repo>/tree/<commit or branch>`: that commit
## Output
Every *project skill*: **name**, **description**, **link**
- A **filter word**, optional: only the skills whose name or description contains it,
  *case-insensitive*; the count before filtering is kept. Applied after the scan, in the core
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
