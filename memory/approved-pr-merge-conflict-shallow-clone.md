# An approved PR can conflict with main: unshallow the clone before merging main

`gh pr merge --squash` failed with `Pull Request has merge conflicts` on an approved PR, even
though `gh pr view --json mergeable` had just said `UNKNOWN`, not `CONFLICTING`. A sibling PR,
started from the same base, was merged into main first. Both had added a row to
`docs/demo/README.md`, the usual conflict.

The automation's checkout is shallow, so `git merge-base HEAD origin/main` prints nothing and
`git merge` fails. Run `git fetch --unshallow origin` first, then `git merge --no-commit origin/main`.

After an auto-merge, also check the PR against what main changed in `src/web-page.ts`. Main may
already fix a reviewer's nit (here, #41 had the `organisation === shown` guard).

**Why it matters:** address-review's "merge" step turns into a "fix and re-review" round.

**Where it applies:** address-review step 2, any merge of origin/main in this checkout.

Learned in #40, 2026-11-27.
