# fixture

A small repository for the tests: the cases of [what a project skill is](../spec/analysis.md).

| Path | Case |
| --- | --- |
| `.claude/skills/commits` | a skill |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.agents/skills/release-checklist` | malformed front matter |
| `.claude/skills/code-style` | the same copy in two agent folders: one skill |
| `.github/skills/commits` | a copy that differs: a warning |
| `modules/billing/.claude/skills/invoices` | a skill of a module |
| `SKILL.md`, `skills/publish`, `.claude/skills/SKILL.md`, `.claude/skills/commits/examples` | not where skills are |
| `.claude/skills/lowercase/skill.md` | not named exactly `SKILL.md` |
| `.agents/skills/linked`, `.agents/skills/linked-file` | symbolic links |
