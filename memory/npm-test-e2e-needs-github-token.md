# npm test fails with "GitHub rate limit reached; set GITHUB_TOKEN" without a token

`tests/e2e.test.ts` calls the real GitHub API (repositories at a commit, an organisation).
Anonymously, a few runs of `npm test` use up the rate limit and 2–3 tests fail with
`GitHub rate limit reached; set GITHUB_TOKEN`, whatever the change. Run it with a token:

```bash
GITHUB_TOKEN=$(gh auth token) npm test
```

**Why it matters:** the failures name e2e tests unrelated to the change; without the token you may
chase a bug that isn't there.

**Where it applies:** the definition of done (`npm test`) in any task, in the Air environment.

Learned in #32, 2026-11-27.
