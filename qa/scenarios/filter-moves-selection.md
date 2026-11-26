---
id: filter-moves-selection
title: Filtering out the selected skill selects the first match
spec: spec/web.md#the-page
---
# Filtering out the selected skill selects the first match

## Steps
1. Scan `fixture/`.
2. Click `commits`.
3. Type `the way` in the filter field.
4. Type ` billing` after it (`the way billing`).

## Expected
- After 3: `commits` and `invoices` match, `commits` stays selected.
- After 4: `commits` is filtered out; `invoices`, the first match, is selected and shown.
