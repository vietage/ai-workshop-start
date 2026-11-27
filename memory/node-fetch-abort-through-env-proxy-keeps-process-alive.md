# Aborting a fetch through NODE_USE_ENV_PROXY leaves its socket open: the process does not exit

With `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=…` (Node 26, undici 8.12), `fetch(url, { signal })` rejects
with `AbortError` on abort, but the CONNECT tunnel to a proxy that never answers stays open, so
the event loop stays alive and a CLI that printed its error never exits. `src/cli.ts` therefore
calls `process.exit(code)` once stdout and stderr are written (`stream.write('', callback)`),
except for `serve`. `controller.abort()` alone, or a `Promise.race` with a timer, is not enough.

To reproduce a silent GitHub in a test: `silentGitHub()` in `tests/helpers.ts`, a `node:net`
server that accepts and holds every connection, used through `HTTPS_PROXY`, with
`SKILL_ATLAS_GITHUB_TIMEOUT=1`. On the old code these tests hang `node --test`: run mutation
checks under `timeout` (see `stalled-scan-tests-hang-node-test-on-old-code.md`).

Don't `pkill -f <name>` from a Bash command that itself contains `<name>`: it kills that shell.

**Why it matters:** a timeout test of the CLI passes in-process but hangs as a real process.

**Where it applies:** `src/cli.ts`, `src/core/github.ts` (`timed`), tests with stand-in servers.

Learned in #44, 2026-11-27.
