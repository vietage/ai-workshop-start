# The web page's fetch in jsdom: pass init through, and give the window Node's AbortController

`tests/web.test.ts` replaces the page's `window.fetch` with Node's `fetch`. A page that aborts a
request (`fetch(url, { signal })`) needs two things there:

- the stand-in passes `init` on: `(input, init) => fetch(new URL(input, base), init)`, else the
  signal is dropped and nothing is aborted;
- `window.AbortController` is Node's (`Object.assign(window, { TextDecoder, AbortController })` in
  `beforeParse`): Node's `fetch` rejects jsdom's own `AbortSignal` as "not an instance of AbortSignal".

A test that waits in a `while (!done()) await sleep` loop never ends when `done` stays false: the
test times out but the process hangs. Bound the wait (`until()` in the Stop tests throws after 3 s).

To hold a scan midway, wrap `github` (helpers.ts) in a `Fetch` that waits on a promise rejected by
`init.signal`; open the organisation's repositories through the tree (`openGitHub(link, { fetch:
github })`, no token): the recordings have no code search for them.

**Why it matters:** without it, Stop looks broken in the tests while it works in a browser, or a
broken test hangs `npm test` instead of failing.

**Where it applies:** `tests/web.test.ts` (`page()`, `heldServer()`), `src/web-page.ts`.

Learned in #38, 2026-11-27.
