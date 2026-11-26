---
id: failed-scan
title: A failed scan shows its message and nothing else
spec: spec/web.md#the-page
---
# A failed scan shows its message and nothing else

## Steps
1. Scan `fixture/`, so that skills are shown.
2. Scan a directory that does not exist, `/no/such/directory`.
3. Reload the page.

## Expected
- After 2: an error message is shown; the skills, the filter and the SKILL.md are hidden.
  The Scan button is enabled again.
- After 3: the same error message is shown again, for the same link in the URL.
