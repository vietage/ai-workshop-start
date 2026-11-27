# A change to the web page's layout makes `npm run e2e` fail until the baselines are remade

`qa/screenshots/*.png` are compared by `npm run e2e` (CI job `e2e`). Moving or adding an element
on the page (e.g. the warnings card above the skills, #36) changes most full-page screenshots of
`fixture/`. An agent can't remake them: baselines come only from the *Update screenshots*
workflow (`.github/workflows/update-screenshots.yml`), run by hand, and a person commits them.

**Why it matters:** the PR's e2e check goes red for an expected reason; say so in the PR and ask
for the workflow to be run on the branch, instead of chasing a bug.

**Where it applies:** any change to `src/web-page.ts` that moves things; `spec/qa.md`, *Baselines*.

Learned in #36, 2026-11-27.
