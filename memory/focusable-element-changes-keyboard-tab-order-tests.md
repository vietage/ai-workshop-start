# A new focusable element in the web page changes the keyboard tests' Tab order

The keyboard tests from #56 (`tests/web.test.ts`, `tabOrder(view)`) list every element Tab
reaches, in DOM order. #52's warnings list (`#warnings`, `tabindex=0` so the keyboard can scroll
it) put `'warnings'` in that list: after `'scan'` (or the tab's `'button'`) for a repository,
after the organisation's repositories in the organisation's tab. Merging main made both keyboard
tests fail with an extra `'warnings'`; the fix was the expected lists and the spec's Tab bullet,
not the code.

**Why it matters:** any `tabindex`, button or link added to the page breaks those assertions,
and the spec's "Tab reaches …" bullet in `spec/web.md` must name it too.

**Where it applies:** `src/web-page.ts` changes that add focusable elements; merges of main into
web-view PRs.

Learned in #52, 2026-11-27.
