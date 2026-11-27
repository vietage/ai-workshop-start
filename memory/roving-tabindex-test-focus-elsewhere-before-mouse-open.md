# Roving tabindex test passes without the fix: the focusout reset masks a missing rove()

In `tests/web.test.ts`, a list item focused by the arrows keeps the focus after Enter opens a
repository (the item is hidden, jsdom doesn't move the focus), and later a `focusout` on it
calls `rove(list)`. That reset moves the Tab stop to the marked item by itself, so a test that
checks Tab order after opening a repository with the keyboard passes even when `showTabs()`
does not call `rove($('repositories'))`.

To test a code path that should re-rove (a selection changed by the mouse, a tab switched),
first put the focus outside the list (`view.$('repo').focus()`), then click, then check
`tabOrder(view)`. Check with the `rove` line removed that the test fails.

**Why it matters:** a mutation check on #56 showed the first version of the test caught nothing.

**Where it applies:** `src/web-page.ts` (`rove`, `showTabs`, `select`), `tests/web.test.ts`; see
`roving-tabindex-reset-on-focusout.md` and `test-keyboard-in-the-web-page-with-jsdom.md`.

Learned in #56, 2026-11-27.
