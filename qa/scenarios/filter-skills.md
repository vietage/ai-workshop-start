---
id: filter-skills
title: Filter the skills as you type
spec: spec/web.md#the-page
---
# Filter the skills as you type

## Steps
1. Scan `fixture/`.
2. Type `BILLING invoices` in the filter field.
3. Replace it with `way commit` (words in another order than in the description).
4. Replace it with `no-such-skill`.
5. Clear the filter.

## Expected
- After 2: only `invoices`; the header reads `fixture · 1 of 4 skills`; `filter=BILLING invoices`
  in the URL. No new scan is made.
- After 3: only `commits`.
- After 4: no skills, the message `no skills match "no-such-skill"`, no error.
- After 5: all 4 skills, the header reads `fixture · 4 skills`, no `filter=` in the URL.
