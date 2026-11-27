# AGENTS.md
## Specs
Read [./spec](spec/) first. Update it with the code.
## Tests
Integration tests for every case in the spec.
## Memory
- Notes from earlier tasks are in [./memory](memory/): search them when needed (`grep -ril "<words>" memory/`).
- At the end of a task, use the [update-memory](.agents/skills/update-memory/SKILL.md) skill.
- The notes are never reviewed.
## Definition of done
- All tests pass locally

## Commands
- `npm ci`: first, in a fresh checkout
- `npm test`: the tests
