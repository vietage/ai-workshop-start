---
name: review-pr
description: Reviews a pull request's head commit, leaves inline comments that say where each problem is and how to reproduce it, then posts a "Verdict - approve" or "Verdict - need changes" comment. Run by an automation when a PR is opened or someone comments "ready for review".
---

# Review PR

The reviewer in the [review chain](../../review-chain.md); read it for the comment protocol.
An automation starts you with a pull request: from a `Pull request | Opened` event, or from a
webhook whose payload has `pr` and `comment_id` of a `Ready for review` comment.

You run **unattended**: don't ask questions, don't wait for input, and don't edit, commit or push
code. If something is unclear, say so in the review and go on.

## 1. Check there is something to review

```bash
pr=<pr number>
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh pr view $pr --json number,title,body,state,isDraft,baseRefName,headRefOid,author
head=$(gh pr view $pr --json headRefOid -q .headRefOid)
# the review chain's comments, oldest first
gh api "repos/$repo/issues/$pr/comments?per_page=100" --paginate \
  --jq '.[] | select(.body | test("<!-- air-chain (ready|verdict|stop)|^\\s*ready for review"; "i"))
        | {id, user: .user.login, author_association, created_at, body}'
```

Stop with one line, posting nothing, when:

- the PR is not `OPEN`;
- you were started by a comment that is not from `jetbrains-air[bot]` or an `OWNER`, `MEMBER` or
  `COLLABORATOR` (check it: `gh api repos/$repo/issues/comments/<comment_id>`);
- the latest chain comment is a verdict with `head=$head`: this commit is already reviewed and
  nobody asked again since;
- the latest chain comment is `Needs a person` and nobody (a person, not an agent) asked
  `Ready for review` after it.

## 2. Collect the change

- `gh pr diff $pr`, and the files it touches at `$head`: `gh pr checkout $pr`.
- **A re-review** (there are earlier verdicts): also read your earlier findings, the inline
  threads and the replies to them since
  (`gh api "repos/$repo/pulls/$pr/comments?per_page=100" --paginate`). The `Ready for review`
  comment lists what was changed and what was declined, and why.

## 3. Read the context

- [spec/](../../../spec/) is the contract. A change in behaviour must change the spec too, and the
  other way round.
- [AGENTS.md](../../../AGENTS.md): each case in the spec needs an integration test; the change is
  done only when `npm test` passes.
- Read the changed files fully, not just the diff hunks, and what calls them.

## 4. Check

1. Run `npm ci`, `npm run typecheck`, `npm test` and `./skill-atlas scan ./fixture`. A failure is a
   finding: quote the failing lines.
2. Look for real defects, most severe first:
   - **Correctness**: wrong output, a crash, a wrong exit code, a skill found where the spec says
     it is not a skill (or missed where it is), a broken link or commit pin
   - **Spec drift**: behaviour that contradicts `spec/`, or a spec change without code
   - **Missing tests**: a new or changed case in the spec with no integration test
   - **Robustness**: GitHub API errors, rate limits, large trees, malformed front matter, symbolic
     links, `node_modules`/`.git`
   - **Security**: tokens in logs or output, untrusted paths or input used unsafely
3. **Reproduce every finding** before reporting it: run the command, write a throwaway fixture in a
   temporary directory, or point at the exact test. Don't keep those files. Not reproducible and
   not obvious from the code → drop it.
4. Skip style, naming and taste unless `AGENTS.md` or the spec asks for it. No findings is a valid
   result.
5. **On a re-review**: check each earlier finding against `$head`. A fixed one is done; say so in
   its thread. A declined one: accept the reason if it holds (say so), or keep it, explaining why
   the reason doesn't hold. Don't raise new nits on code that didn't change.

## 5. Decide the verdict

- **need changes**: at least one finding of severity `bug`, `spec`, `test` or `security`, or a
  failing check.
- **approve**: no findings, or only `nit`s. Nits stay as non-blocking inline comments.

## 6. Post

### Inline comments

One per finding, anchored to the changed line it concerns, as one review:

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

<!-- air-chain note -->
````

- **Severity**: `bug`, `spec`, `test`, `security` or `nit`.
- **Where**: a path from the repository root and a line in the change's new version. A problem
  outside the diff goes into the verdict comment with its `path:line`.
- **How to reproduce**: commands someone can paste as is; no "run it and see".
- One problem per comment; the same problem in several places → one comment that lists them.

```bash
gh api "repos/$repo/pulls/$pr/reviews" --input review.json
# review.json: {"commit_id": "<$head>", "event": "COMMENT", "body": "<one line> <!-- air-chain note -->",
#               "comments": [{"path": "...", "line": 12, "side": "RIGHT", "body": "..."}]}
```

If an inline anchor is rejected, move that finding into the verdict comment. No findings → no
review; on a re-review, reply in each earlier thread instead (fixed / reason accepted / kept), each
reply ending with `<!-- air-chain note -->`.

### The verdict comment

Always, as the last thing you post, one PR comment:

```markdown
**Verdict: approve**

<at most 5 lines: what the change does, why this verdict, the number of findings by severity>
Checks: typecheck ✅/❌ · tests ✅/❌ · smoke ✅/❌ — at <short $head>

<findings outside the diff, each with path:line and how to reproduce; on a re-review, which
earlier findings are fixed, accepted or kept>

<!-- air-chain verdict=approve head=<$head> -->
```

For need changes, the first line is `**Verdict: need changes**` and the marker
`<!-- air-chain verdict=need-changes head=<$head> -->`, with the full SHA.

```bash
gh pr comment $pr --body-file verdict.md
```

Before posting, check the head is still `$head` (`gh pr view $pr --json headRefOid`). If it moved,
post nothing and stop: a new commit gets reviewed when someone (the agent or a person) comments
`Ready for review`. Finish by printing the
PR URL and the verdict.
