# Rewording a SKILL.md, AGENTS.md or review-chain.md can fail npm test

`tests/review-chain.test.ts` and `tests/memory.test.ts` read `.agents/skills/*/SKILL.md`,
`.agents/review-chain.md`, `AGENTS.md` and `memory/README.md` and match exact phrases in them
(status commands, the claim marker, "never reviewed", the update-memory links).

**Why it matters:** a wording change that keeps the meaning can still turn `npm test` red; the
failure names the test, not the sentence.

**Where it applies:** any edit to the agent docs. Run `node --test tests/review-chain.test.ts
tests/memory.test.ts` after it, and change the test with the text when the spec changes too.

Learned in #26, 2026-11-27.
