---
id: url-state-reload
title: Reload keeps the repository, the skill and the filter
spec: spec/web.md#the-page
---
# Reload keeps the repository, the skill and the filter

## Steps
1. Scan `fixture/`.
2. Type `the  way` (two spaces) in the filter field, then click `invoices`.
3. Reload the page.

## Expected
- Before the reload, the URL has `repo=<fixture path>`, `skill=<invoices path>`, and
  `filter=the way` (the words joined by one space).
- After the reload: the repository field holds the fixture path, the filter field holds the
  filter, `invoices` is selected and its SKILL.md shown, the header reads `fixture · 2 of 4 skills`.
