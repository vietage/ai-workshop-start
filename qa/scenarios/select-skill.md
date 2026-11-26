---
id: select-skill
title: Select a skill to see its SKILL.md
spec: spec/web.md#the-page
---
# Select a skill to see its SKILL.md

## Steps
1. Scan `fixture/`.
2. Click the `invoices` skill.

## Expected
- `invoices` is the only selected skill.
- The right pane shows the heading `invoices`, its link to
  `modules/billing/.claude/skills/invoices/SKILL.md`, and the file as it is (front matter included).
- The page's URL has `skill=modules/billing/.claude/skills/invoices/SKILL.md`.
