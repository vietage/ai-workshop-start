# A stopped organisation's repositories are the stream's 0-of-N listing entries

`partialOrganisation()` in `src/web-page.ts` (Stop, #43) builds `organisation.repositories` from
the `stream=1` 0-of-N line's `repositories` for those not done yet. So every field the page reads
from `organisation.repositories` must also be on that listing, which `scanOrganisation()` in
`src/core/organisation.ts` builds in its `progress?.(0, …)` call, and on `repositoryJson()` in
`src/web.ts`. When #60 (each repository's own `warnings`) merged #43, the listing had no
`warnings`, and opening a repository after Stop threw
`TypeError: Cannot read properties of undefined (reading 'length')` in `organisationWarnings()`.
The fix was `warnings: []` on the listing entries. The test that catches it is
`page: while an organisation scans, Stop → …`.

**Why it matters:** a new per-repository field added to the result passes every result test and
still breaks the page after Stop.

**Where it applies:** new fields on `OrganisationRepository`, `src/web-page.ts` organisation code.

Learned in #60, 2026-11-27.
