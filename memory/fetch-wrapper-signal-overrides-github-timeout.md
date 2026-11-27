# A fetch wrapper that sets `signal` overrides the GitHub timeout: combine with AbortSignal.any

`src/core/github.ts` passes its own `init.signal` to every `fetch` (the 30 s timeout, `timed()`).
A wrapper written as `fetch(url, { ...init, signal })` (e.g. to stop a scan) silently replaces it:
the timeout race still rejects, but the hung request is never aborted. Combine the two instead:
`withStop(init?.signal, signal)` in `src/core/organisation.ts` (`AbortSignal.any`), used there and
in `src/cli.ts`'s `open`.

**Why it matters:** tests on the error message still pass; only a test that checks the request's
own signal gets aborted (`tests/scan.test.ts`, "with a stop signal, not stopped") catches it.

**Where it applies:** any new `Fetch` wrapper around GitHub requests; merging branches that add a
signal or a timeout.

Learned in #43, 2026-11-27.
