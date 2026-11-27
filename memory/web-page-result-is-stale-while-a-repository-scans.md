# web-page.ts: `result` is the previous repository's scan while a new one runs

In `src/web-page.ts`, `openRepository(name)` sets `repository = name` before its request, but
`result` keeps the previously selected repository's scan until the new one answers. The filter's
`input` handler calls `show()` whenever `result` is set, so anything that combines `repository` with
`result` (e.g. `organisationWarnings()`) sees a mismatched pair during the scan.
Check that `result.repository.id` is the entry's id (`entry.url` without `https://github.com/`)
before treating `result` as the selected repository's scan.
To test it in jsdom: click a repository, then call `view.filter(...)` right away, before
`view.settled(...)`. The request is still pending at that point.

**Why it matters:** the previous repository's warnings or skills show up under the new name.

**Where it applies:** `src/web-page.ts` (organisation view), `tests/web.test.ts`.

Learned in #52, 2026-11-27.
