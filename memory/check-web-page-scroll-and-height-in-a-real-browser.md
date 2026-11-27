# jsdom has no layout: test a height limit by its CSS, check it in Chromium with a stubbed API

In jsdom `clientHeight`, `scrollHeight` and `getBoundingClientRect()` are all `0`, so a test in
`tests/web.test.ts` can't measure "does not grow past its limit". Assert the rule instead
(`getComputedStyle(list).maxHeight === '160px'`, `overflowY === 'auto'`; the shorthand `overflow:
auto` is expanded) and break the CSS to see it fail.

To see the real layout, use the Playwright that `.agents/skills/record-demo/setup.sh` puts in
`/tmp/demo-tools` (`createRequire('/tmp/demo-tools/')('playwright')`), run `./skill-atlas serve
--port 4199`, and `page.route('**/api/scan*', …)` to answer with as many warnings as you need
(`application/x-ndjson`, one `{"result": …}` line). Then read `clientHeight`/`scrollHeight`.

For a demo with many real warnings: `github.com/JetBrains` has 50 (549 repositories); the first
scan takes minutes, later ones use the cache.

**Why it matters:** otherwise a layout limit looks untestable, or gets "verified" only in jsdom.

**Where it applies:** `src/web-page.ts`, `tests/web.test.ts`, the record-demo skill.

Learned in #36, 2026-11-27.
