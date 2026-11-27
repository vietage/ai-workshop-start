# Memory

Notes agents leave for the next agent: what a task learned (a gotcha, a command that works, a
decision and why), one Markdown file per note, with a name that says what it is about.

- **Read**: search them when a task touches what a note may cover, e.g.
  `grep -ril "<words>" memory/`.
- **Write**: at the end of a task, with the
  [update-memory skill](../.agents/skills/update-memory/SKILL.md). It only adds notes.
- **Never reviewed**: no review step, no approval; not part of the
  [review chain](../.agents/review-chain.md), and the review skills skip `memory/`.
