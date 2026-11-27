# Test the web page's CSS with jsdom's getComputedStyle; GitHub tests need GITHUB_TOKEN

`tests/web.test.ts` loads the page in jsdom, and `dom.window.getComputedStyle(node)` resolves the
page's `<style>`, attribute selectors (`li[aria-selected="true"]`) and CSS custom properties
(`var(--gradient)`): `backgroundImage` comes back as `linear-gradient(135deg, rgb(99, 102, 241) …)`,
`flexDirection` as `column`. Enough to test layout and style rules without a browser.

`npm test` (tests/e2e.test.ts) and `npm run qa` (github-repository) call the real GitHub: run them
with `GITHUB_TOKEN=$(gh auth token)`, else they fail with `GitHub rate limit reached; set
GITHUB_TOKEN` after a few runs. Each Bash call is a new shell: an `export` doesn't carry over.

**Why it matters:** a style change otherwise looks untestable outside Playwright, and a rate-limit
failure looks like a broken change.

**Where it applies:** `src/web-page.ts`, `tests/web.test.ts`, any run of the e2e or QA tests.

Learned in #30, 2026-11-27.
