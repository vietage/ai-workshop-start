# Web page: every path that changes what is shown must call showWarnings()

Since #52 the page has one warnings area (`#problems` / `#warnings`), apart from `#organisation`
and `#main`. Hiding those does not hide it: a path that clears the view (Stop, a failure, a new
tab) must call `showWarnings()` in `src/web-page.ts`, or the previous scan's warnings stay on
screen. Before #52, `#org-warnings` sat inside `#organisation` and was hidden with it, so code
merged from before #52 can miss this.

**Why it matters:** PR #43's Stop-before-listing branch missed it after the merge with #52, and
its test started from an empty page, so it passed anyway.

**Where it applies:** `src/web-page.ts` (`run.stopped`, `failed`, `activate`); page tests in
`tests/web.test.ts`: run a scan that has warnings (the fixture has 2) before the case under test.

Learned in #43, 2026-11-27.
