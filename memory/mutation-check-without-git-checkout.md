# Mutation-check a test without `git checkout <file>`: it wipes your uncommitted change too

`jsdom-style-assertions-that-can-fail.md` says to break the CSS with `sed` and then
`git checkout src/web-page.ts`. Before the change is committed, that also throws away the change
itself: in #39 it reverted the whole web-page edit, and only the diff stat showed it. Back up and
restore instead:

```bash
cp src/web-page.ts /tmp/web-page.bak && sed -i 's/…/…/' src/web-page.ts
node --test tests/web.test.ts; cp /tmp/web-page.bak src/web-page.ts && git diff --stat
```

**Why it matters:** the tests go green again after the restore, so the lost change is easy to miss.

**Where it applies:** any mutation check of a test (`src/web-page.ts`, `src/commands.ts`, …)
before the task's commit.

Learned in #39, 2026-11-27.
