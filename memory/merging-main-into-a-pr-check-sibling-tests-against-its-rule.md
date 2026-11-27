# Merging main into a PR: sibling features' tests may assume the PR's old behaviour

#48 (hide 0-skill repositories) merged main after #40 (repository tabs). Git conflicted in
`spec/web.md`, `src/web-page.ts`, `tests/web.test.ts`, `docs/demo/README.md`, but the merged
tests that auto-merged or came from main still asserted main's behaviour:
`view.$('repositories').children.length, 7` (now 4, `Docs`/`empty`/`huge` hidden), and a test
and spec bullet for "an empty repository selected", a case #48 removed. `src/web-page.ts` from
main also re-added an empty-repository special case in `openRepository`.

After resolving, grep main's new tests and code for what the PR changed (list counts, removed
cases), then run `GITHUB_TOKEN=$(gh auth token) npm test`.

Each approve → conflict → merge-main round needs a new review, and main can move again during
it (#41, then #40 and #50 here).

**Why it matters:** a clean-looking resolution leaves red tests or a spec case the PR removed.

**Where it applies:** address-review step 2 conflicts, any `git merge origin/main` in a feature PR.

Learned in #48, 2026-11-27.
