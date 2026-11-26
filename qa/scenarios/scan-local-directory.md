---
id: scan-local-directory
title: Scan a local directory
spec: spec/web.md#the-page
---
# Scan a local directory

## Steps
1. Open the web view.
2. Enter the absolute path of `fixture/` in the repository field.
3. Press **Scan**.

## Expected
- The header reads `fixture · 4 skills`.
- The skills are listed sorted by name: `code-style`, `commits`, `invoices`, `release-checklist`.
- Each skill shows its path; `commits` shows the first sentence of its description.
- The first skill, `code-style`, is selected and its SKILL.md is shown with its `file://` link.
- No error is shown.
