# The web page: an organisation's warnings don't always hold a selected repository's

An organisation scan prefixes each repository's warnings with `<name>: `. A repository it could not
scan has only `<name>: not scanned: …`. When that repository is selected, the page scans it again,
and that scan can find more warnings. `organisationWarnings()` in `src/web-page.ts` replaces
the `<name>: ` lines with the selected repository's own scan. To test it, use a stand-in
`scanOrganisation` that marks a repository `skillCount: undefined` (not `null`, which fails the
typecheck) and swaps its warning for `not scanned`. Its commit is kept, so the recorded answers
serve the rescan.

**Why it matters:** "the organisation's warnings already include each repository's" is not true
for one that failed; a review caught this as a regression.

**Where it applies:** the web page's warnings area, organisation tests in `tests/web.test.ts`.

Learned in #52, 2026-11-27.
