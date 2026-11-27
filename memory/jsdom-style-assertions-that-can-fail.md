# jsdom style assertions: compare against jsdom's defaults, and read media queries from the sheet

`getComputedStyle` in jsdom never gives `''` for an unset property: `borderRadius` is `0px`,
`boxShadow` is `currentcolor none`, `backgroundImage` is `none`, `backgroundColor` is
`rgba(0, 0, 0, 0)`. So `assert.notEqual(style.borderRadius, '')` always passes; assert the value
(`/^[1-9]\d*px$/`, `/\binset\b/`) and check an unselected element doesn't have it.

jsdom evaluates no `@media` queries. To test dark colours, read the page's style sheet:
`document.styleSheets[0].cssRules`, find the rule whose `media.mediaText` is
`(prefers-color-scheme: dark)`, and its `:root` rule's `style.getPropertyValue('--page')`.

Check a style test by breaking the CSS (`sed` on `src/web-page.ts`, run
`node --test tests/web.test.ts`, `git checkout src/web-page.ts`): it must fail.

**Why it matters:** a style test that can't fail passes review only until a reviewer mutates the CSS.

**Where it applies:** `tests/web.test.ts`, `src/web-page.ts`; extends
`test-web-page-styles-with-jsdom-computed-style.md`.

Learned in #31, 2026-11-27.
