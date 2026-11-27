# Restyling the web page: what jsdom's CSS can check, and four traps

In `tests/web.test.ts`, jsdom 31's `getComputedStyle` also resolves `backdropFilter`, `:disabled`,
`:focus` (after `node.focus()`), `fill` on inline SVG, `zIndex`, and rgba colours with their alpha:
a WCAG contrast ratio can be computed (composite the translucent card over white, the worst case).
`@media` and `@keyframes` rules are in `styleSheets[0].cssRules` (`media.mediaText`, `name`).

- `rule.style.outlineColor` is `''` when the shorthand has a variable (`outline: 2px solid
  var(--cyan)`): read `rule.style.outline` and resolve the `var()` from `:root` yourself.
- `element.hidden = true` does nothing on an SVG element: use `setAttribute('hidden', '')`.
- The parser drops the `::-moz-progress-bar` rule, keeps `::-webkit-progress-value`.
- In Chromium, a screenshot right after `button.disabled = true` is mid-transition (still pink):
  wait 500 ms.

**Why it matters:** a look can be tested without a browser; each trap costs a failed run.

**Where it applies:** `src/web-page.ts`, `tests/web.test.ts`; extends
`jsdom-style-assertions-that-can-fail.md`.

Learned in #59, 2026-11-27.
