# The Air checkout is shallow: `git fetch --unshallow` before merging main

An Air run's clone is shallow (`git rev-parse --is-shallow-repository` → `true`), so
`git merge-base HEAD origin/main` and `git diff HEAD...origin/main` fail with `no merge base`, and
`git merge origin/main` can't find a common ancestor. Run `git fetch --unshallow origin` first.

**Why it matters:** an approved PR that GitHub reports as `mergeable: CONFLICTING` (main moved
on) has to get main merged in before address-review can merge it; without the full history the
merge looks impossible.

**Where it applies:** address-review step 2 (merge conflicts), any task that merges or diffs
against `origin/main`.

Learned in #48, 2026-11-27.
