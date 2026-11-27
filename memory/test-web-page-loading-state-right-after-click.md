# Test the web page's "while it scans" state right after the click, before awaiting

In `tests/web.test.ts` the page's `fetch` is async, so whatever the page shows while a request is in
flight (`Scanning <repo>…`, the Scan button disabled) is there synchronously right after
`item.dispatchEvent(new view.dom.window.Event('click'))`. Assert it, click on (another tab, a close
button), and only then `await view.settled(scans + 1)` to check what the late answer does. No
stand-in server with a gate is needed for one repository's request (`stoppedServer` is for an
organisation's stream).

**Why it matters:** the race guards (`if (active === state) activate(state)`) otherwise have no test
and can be removed with every test still green.

**Where it applies:** `src/web-page.ts`, `tests/web.test.ts`, any page state between a click and
its answer.

Learned in #37, 2026-11-27.
