# GitHub search takes a date and time to the second in gh's --search: merged:>=2026-11-27T11:22:47+00:00

Checked against the real API with gh 2.104: `gh pr list --state merged --search "merged:>=<time>"`
and `gh issue list --state closed --search "closed:>=<time> reason:completed"` accept a full ISO
time, with `+00:00` or `Z`, and `>=` includes that second. `reason:completed` leaves out issues
closed as not planned; `--json stateReason` (`COMPLETED`, `NOT_PLANNED`) and `mergedAt`/`closedAt`
let a script check the window again itself, which is what makes it testable with a stub `gh`.

**Why it matters:** a bare date (`merged:>=2026-11-27`) widens the window to the whole day.

**Where it applies:** `.agents/skills/status-update/status-update.mjs`, any `gh ... --search` by time.

Learned in #49, 2026-11-27.
