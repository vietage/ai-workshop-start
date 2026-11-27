# With the repository tabs, read a repository's own scan from `active.result`, not `result`

Since #40, `src/web-page.ts` keeps each opened repository as `{ name, result, error, ... }` in
`opened`; `active` is the active tab's (undefined for the organisation's tab). `active.result` is
set only once that repository's own scan is done, so it is never the previous repository's.
This replaces the `result.repository.id` check from
`web-page-result-is-stale-while-a-repository-scans.md`: anything derived from "the selected
repository's scan" (e.g. `organisationWarnings()`) should read `active?.result`.

Note `tab` (the repository tab, open even when the organisation's tab is active) vs `active`:
using `tab` shows the repository's data in the organisation's tab.

**Why it matters:** merging a pre-tabs PR into main, the old guard still compiles and passes but
is the wrong model; `tab` vs `active` is an easy slip a test only catches by switching tabs.

**Where it applies:** `src/web-page.ts`, `activate()`, any per-repository state in the web view.

Learned in #52, 2026-11-27.
