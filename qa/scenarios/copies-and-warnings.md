---
id: copies-and-warnings
title: Copies and warnings are shown
spec: spec/web.md#the-page
---
# Copies and warnings are shown

## Steps
1. Scan `fixture/`.

## Expected
- `code-style` shows `also in .github/skills/code-style/SKILL.md`.
- `commits` shows `also in .github/skills/commits/SKILL.md`.
- Under the skills, two warnings: the malformed front matter of `release-checklist`, and the
  copies of `commits` that differ.
