# Web page tests with a stalled scan: run them under `timeout`, and they hang on the old code

`tests/web.test.ts` has `stalledServer(<part of a link>)`: its `open` waits until `release()`,
so a scan that never ends can be tested (the Scan button, a repository opened from an
organisation). To check such a test fails without the fix (`git stash push src/web-page.ts`),
run it as `timeout 60 node --test --test-name-pattern=... tests/web.test.ts`: the page's
`settled()` loop keeps polling after the test's own timeout, so `node --test` never exits, and a
`git stash pop` chained after it never runs. Pop the stash yourself afterwards.

In a browser, a disabled *Scan* button also blocks Enter (implicit submission), so a link scan
can only be replaced by a test's dispatched `submit`, a reload, or a repository click.

**Why it matters:** without `timeout`, the check hangs the shell and leaves the fix stashed.

**Where it applies:** `tests/web.test.ts`, `src/web-page.ts`, mutation checks of page tests.

Learned in #34, 2026-11-27.
