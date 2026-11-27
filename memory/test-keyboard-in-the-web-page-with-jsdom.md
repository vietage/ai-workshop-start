# Test the web page's keyboard use in jsdom: tabIndex for Tab, dispatched keydown, no :focus-visible

jsdom does not move the focus on Tab and matches no `:focus-visible`. In `tests/web.test.ts`:

- **Tab order**: `tabOrder(view)` lists what is shown and focusable (`input, button, a[href],
  [tabindex]` with `tabIndex >= 0`), in document order: that is the browser's Tab order.
- **Keys**: `press(view, key)` dispatches a `KeyboardEvent('keydown', { key, bubbles, cancelable })`
  on `document.activeElement` and returns `defaultPrevented`; `element.focus()` works.
- **Focus style**: read the `:focus-visible` rule from `document.styleSheets[0].cssRules` and
  check `item.matches(<selector without :focus-visible>)`.

The lists (`#skills`, `#repositories`) use a roving tabindex (`rove()` in `src/web-page.ts`):
re-run it whenever `aria-selected` changes or a list is rebuilt.

**Why it matters:** otherwise a keyboard bug looks untestable without Playwright.

**Where it applies:** `src/web-page.ts`, `tests/web.test.ts`, any accessibility issue of the page.

Learned in #47, 2026-11-27.
