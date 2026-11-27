# Simulate a network failure in a test's stand-in HTTP server with request.socket.destroy()

To test that a script retries a request that fails on the network (not an HTTP error), have the
local `node:http` stand-in server call `request.socket.destroy()` instead of answering. The
client's `fetch` then rejects with `TypeError: fetch failed`, exactly as for a dropped connection.
Record the request before destroying the socket if the test counts calls. An unreachable port
(`http://127.0.0.1:1`) only covers the first request failing, not one later in a run.

**Why it matters:** without it, the retry branch (`.catch(() => ({ retry: true }))`) has no test
and can be removed with every test still green.

**Where it applies:** `tests/issue-to-pr.test.ts` (the `'drop'` answer for `conversations.replies`),
any test with a stand-in server for an external API.

Learned in #29, 2026-11-27.
