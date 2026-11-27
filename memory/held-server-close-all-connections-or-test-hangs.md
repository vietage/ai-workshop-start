# A held request never aborted keeps `node --test` running: close all connections

In `tests/web.test.ts`, `heldServer()` holds a scan's request until its signal aborts. If the code
under test fails to abort it (a mutation check, a real bug), `until()` throws after 3 s, but
`server.close()` only stops new connections and waits for the open one, so the test process
never exits and `npm test` hangs instead of reporting the failure. `heldServer`'s `close` calls
`server.closeAllConnections()` after `server.close()` for that reason; do the same in any new
stand-in server that holds requests.

Also: a local directory scanned on the page selects its first skill, so `search()` has `skill=`
too; compare `search().repo` when only the link matters.

**Why it matters:** a mutation-checked test looks like it hangs, not fails (a 120 s timeout,
no output).

**Where it applies:** `tests/web.test.ts` (`heldServer`, `stoppedServer`), see also
`jsdom-page-abort-needs-node-abortcontroller.md`.

Learned in #43, 2026-11-27.
