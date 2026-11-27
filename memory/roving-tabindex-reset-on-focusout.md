# Roving tabindex: reset the Tab stop to the selected item on focusout, jsdom fires it

Moving the focus with the arrows moves `tabIndex=0` too (`focusItem()` in `src/web-page.ts`).
Without a reset, Tab returns to the last-focused item, not the selected one, which breaks the
spec ("Tab reaches each list once, on its selected item"). Each list has a `focusout` listener
that calls `rove(list)` when `event.relatedTarget` is outside the list.

jsdom fires `focusout` with `relatedTarget` on `element.focus()`, so a test can do: arrows, then
`view.$('filter').focus()`, then check `tabOrder(view)`.

**Why it matters:** the review of #56 caught this; it is easy to miss when every test only
checks Tab order right after a selection.

**Where it applies:** `src/web-page.ts` lists, `tests/web.test.ts`; see
`test-keyboard-in-the-web-page-with-jsdom.md`.

Learned in #56, 2026-11-27.
