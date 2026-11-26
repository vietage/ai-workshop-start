---
name: code-review
description: Reviews a change to Skill Atlas and leaves a short summary plus inline comments, each saying where the problem is and how to reproduce it. Runs unattended in cloud automation.
---

# Code review

Review one change: a pull request, a branch or the working tree against `main`.
This skill runs **unattended**: do not ask questions, do not wait for input and do not edit,
commit or push code. If something is unclear, say so in the review and go on.

## 1. Collect the change
- Pull request: `gh pr view <n> --json title,body,baseRefName,headRefOid` and `gh pr diff <n>`
- Otherwise: `git diff main...HEAD`, plus `git diff` for uncommitted work
- No change at all: report `Nothing to review` and stop

## 2. Read the context
- [spec/](../../../spec/) is the contract. A change in behaviour must change the spec too,
  and the other way round
- [AGENTS.md](../../../AGENTS.md): each case in the spec needs an integration test;
  the change is done only when `npm test` passes
- Read the changed files fully, not just the diff hunks, and what calls them

## 3. Check
1. Run `npm ci` (if `node_modules` is missing), `npm run typecheck`, `npm test`
   and `./skill-atlas scan ./fixture`. A failure is a finding: quote the failing lines
2. Look for real defects, most severe first:
   - **Correctness**: wrong output, a crash, a wrong exit code, a skill found where the spec
     says it is not a skill (or missed where it is), a broken link or commit pin
   - **Spec drift**: behaviour that contradicts `spec/`, or a spec change without code
   - **Missing tests**: a new or changed case in the spec with no integration test
   - **Robustness**: GitHub API errors, rate limits, large trees, malformed front matter,
     symbolic links, `node_modules`/`.git`
   - **Security**: tokens in logs or output, untrusted paths or input used unsafely
3. **Reproduce every finding** before reporting it: run the command, write a throwaway
   fixture in a temporary directory or point at the exact test. Do not keep those files.
   Not reproducible, and not obvious from the code → drop it
4. Skip style, naming and taste unless `AGENTS.md` or the spec asks for it.
   No findings is a valid result

## 4. Report
### Summary
At most 5 lines: what the change does, the verdict (`approve` / `request changes`),
the check results (typecheck, tests, smoke) and the number of findings.

### Inline comments
One per finding, anchored to the changed line it concerns:

````markdown
**<severity>: <one-line problem>**
`<path>:<line>`
<why it is wrong, one or two sentences; cite the spec line if relevant>

Reproduce:
```console
$ <exact commands, from a fresh checkout of the change>
<actual output, trimmed>
```
Expected: <what the spec or the user expects instead>
````

- **Severity**: `bug`, `spec`, `test`, `security` or `nit`
- **Where**: a path relative to the repository root and a line in the change's new version;
  a problem outside the diff goes into the summary with its `path:line`
- **How to reproduce**: commands someone can paste as is; no "run it and see"
- One problem per comment; the same problem in several places → one comment that lists them

### Delivery
- Pull request: post one review with the summary as the body and the findings as inline comments:
  `gh api repos/{owner}/{repo}/pulls/<n>/reviews` with `commit_id` = the head commit,
  `event` = `COMMENT`, and `comments[]` of `{path, line, side: "RIGHT", body}`.
  If an inline anchor is rejected, move that finding into the body
- No pull request: print the summary, then each comment, to stdout
