---
name: update-memory
description: Adds a short note to memory/ with what a task learned (a gotcha, a command that works, a decision and why), one Markdown file per note, so the next agent doesn't learn it again. Only adds notes; the notes are never reviewed. Use at the end of a task, before its last commit.
---

# Update memory

Agents start every task from scratch. What a task learned, and the code, the spec and the commit
messages don't already say, is lost when the session ends unless it is written down. This skill
writes it down in [memory/](../../../memory/README.md), where the next agent searches it.

Use it at the end of a task, **before the task's last commit**, so the note is committed and
pushed with the change. A note that is never committed is lost.

## 1. Decide what is worth a note

Something the next agent would otherwise spend time on:

- a **gotcha**: what broke, why, and what works instead;
- a **command** that works, with the flags or setup it needs;
- a **decision** and why it was made, when the code alone doesn't show the reason;
- where something lives when it was hard to find.

Not worth a note: what `spec/`, `README.md`, `AGENTS.md`, a skill or the code already say; what
only mattered to this task; a summary of the change (that is the commit message). If the task
learned nothing new, write no note: that is a valid result.

Never write secrets, tokens, credentials or personal data into a note.

## 2. Check what is already there

```bash
ls memory/
grep -ril "<a word or two>" memory/
```

If a note already says it, write nothing. If it says something that is now wrong, don't edit it:
add a new note that says what changed and names the old note's file.

## 3. Write the note

One new Markdown file per note: `memory/<descriptive-name>.md`, lowercase words joined by `-`, that
say what the note is about (`npm-test-needs-node-24.md`, not `note-1.md` or `learnings.md`). If
the name is taken, choose another; never overwrite a file.

```markdown
# <What was learned, in one line>

<What was learned: the facts, the command, the decision. A few lines.>

**Why it matters:** <what goes wrong, or what it costs, without it>

**Where it applies:** <files, commands, skills or kinds of task>

Learned in <the issue or PR, e.g. #26>, <YYYY-MM-DD>.
```

Short and searchable: under 20 lines, with the words someone would search for (the command, the
file name, the error message).

## 4. Commit it with the task

```bash
git add memory/
```

It goes into the task's commit. If your task may not commit (review-pr doesn't edit, commit or
push), write no note.

## What this skill never does

- **No review.** These notes are never reviewed: no review step, no approval. They are not part of
  the [review chain](../../review-chain.md); [review-pr](../review-pr/SKILL.md) and
  [address-review](../address-review/SKILL.md) skip `memory/`. Don't ask anyone to approve a note.
- **No edits, no deletions.** It only adds notes, never changes or removes one.
