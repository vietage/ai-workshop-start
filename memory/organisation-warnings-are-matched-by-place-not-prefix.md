# The web page finds a repository's warnings by their place, not by the `<name>: ` prefix

Updates `organisation-warnings-vs-selected-repository-scan.md`: `organisationWarnings()` in
`src/web-page.ts` no longer matches lines by `<name>: `. Each `OrganisationRepository` (core and
API) has its own `warnings`, without its name; the top-level `warnings` are exactly those, prefixed,
in the order of `repositories`, then the cache's `cache: …`. The page walks the repositories and
counts lines. A stand-in `scanOrganisation` in tests must keep the two consistent: build the
top-level `warnings` from `repositories` (see the `cache` test in `tests/web.test.ts`).

**Why it matters:** a repository named `cache` has the same prefix as the cache's own warnings
(#58). And a stand-in whose `repositories[].warnings` and `warnings` disagree shows the wrong lines.

**Where it applies:** `src/core/organisation.ts`, `src/web.ts`, `src/web-page.ts`, organisation
stand-ins in `tests/web.test.ts`.

Learned in #58, 2026-11-27.
