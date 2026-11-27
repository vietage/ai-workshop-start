# Agent memory
What a task learned, kept for the next agent: `memory/`
- A **note**: `memory/<descriptive-name>.md`, one per note, lowercase words joined by `-`; short
  and searchable: what was learned, why it matters, where it applies, the issue or PR and the date
  - Worth a note: a gotcha, a command that works, a decision and why; not what `spec/`, the
    README, `AGENTS.md`, a skill or the code already say. Nothing new → no note
  - Never secrets, tokens or personal data
- `memory/README.md`: what the folder is, how to search and add notes; it keeps `memory/` in the
  repository before any note
- The **update-memory skill** (`.agents/skills/update-memory`): adds a note at the end of a task,
  *before its last commit*, so the note ships with the change
  - *Only adds*: never edits, renames, overwrites or deletes a note; a note that is now wrong → a
    new note naming the old one
  - A task that may not commit (review-pr) → no note
- `AGENTS.md`: the notes are in `memory/`, search them when needed; use update-memory at the end
  of a task; issue-to-pr uses it before its commit
- **Never reviewed**: no review step, no approval; not part of the review chain
  (`.agents/review-chain.md`); review-pr and address-review skip `memory/`
- `./skill-atlas scan .` lists update-memory with this repository's other skills
