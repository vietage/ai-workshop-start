# setTimeout with more than 2 147 483 647 ms, or Infinity, fires after 1 ms

Node's `setTimeout(fn, ms)` with `ms > 2 ** 31 - 1` (about 24.8 days) or `Infinity` prints
`TimeoutOverflowWarning: ... does not fit into a 32-bit signed integer` and fires after **1 ms**.
So any user-set limit (an env var in seconds × 1000) must be checked against that bound.
`src/core/github.ts` (`timed`, `TIMER_LIMIT`) treats a longer limit as no limit.

To test it: `process.on('warning', …)` and look for `name === 'TimeoutOverflowWarning'`; for the
CLI, spawn it through `silentGitHub()` and check it is still waiting after 1.5 s, then kill it.

**Why it matters:** `SKILL_ATLAS_GITHUB_TIMEOUT=Infinity` made every scan fail at once.

**Where it applies:** any timer from configuration: `src/core/github.ts`, `src/cli.ts`, scripts.

Learned in #53 (review of #44), 2026-11-27.
