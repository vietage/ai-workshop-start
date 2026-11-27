# An approval on a conflicting PR gets no air-chain/review status: check `mergeable` before waiting on checks

On #53, review-pr posted `Verdict: approve` on 3e590e0, but the Review chain workflow made no
`pull_request_review` run for it, so `air-chain/review` stayed `pending` ("Ready for review").
The PR was `CONFLICTING` with main. Probably GitHub creates no `pull_request*` runs while a PR
has a merge conflict (its merge ref can't be built). Other PRs' reviews got their runs at that time.

`timeout 540 gh pr checks $pr --watch --fail-fast` then waits the whole 9 minutes on that pending
status and exits 124. In address-review step 2, run `gh pr view $pr --json mergeable` first.
If it says `CONFLICTING`, go straight to merging main (see
approved-pr-merge-conflict-shallow-clone.md). Don't wait on checks, and don't treat the missing
status as a broken workflow.

**Why it matters:** about 9 wasted minutes, and you might wrongly report the workflow as broken.

**Where it applies:** address-review step 2 (and step 7 → approve), `gh pr checks --watch`.

Learned in #53, 2026-11-27.
