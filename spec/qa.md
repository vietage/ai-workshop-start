# Manual QA
The web view in a real browser, scenario by scenario: `qa/`
- A **scenario**: `qa/scenarios/<id>.md`, its steps and what is expected, from the spec; its
  **script**: `qa/scripts/<id>.spec.ts`, the same steps in Playwright. Every scenario has a script
- `npm run qa [-- <id>]`: starts the web view, runs the scripts; *every run is recorded*: a video,
  a trace and a screenshot per scenario, in `qa/results/<run>/`, with the commit it tested
- `npm run qa:issues [-- --dry-run] [--run <run>] [--scenario <id>]`: an **issue** per failed scenario
  - Title `[QA] <id>: <title> fails`; labels `Delegated to AI`, `qa`, `bug`
  - Body: the scenario, the failed step, the error, the commit the run tested, how to reproduce,
    a link to the **video**, uploaded to the `qa-recordings` pre-release
  - An open issue for that scenario → a comment on it, not a new issue
  - A skipped or passed scenario → no issue
- The **manual-qa skill** (`.agents/skills/manual-qa`): runs it, sorts the failures into product
  bugs and the rest, files the product bugs
