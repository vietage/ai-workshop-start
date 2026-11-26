---
name: review-pr
description: Reviews a pull request's head commit, leaves inline comments that say where each problem is and how to reproduce it, posts a review whose body states the verdict, then sets the "air-chain/review" commit status to "Verdict - approve" or "Verdict - need changes". Run by an automation when a PR is opened or the status is set to "Ready for review", and by address-review to re-review its fixes.
---

# Review PR

The reviewer in the [review chain](../../review-chain.md); read it for the status protocol.
An automation starts you with a pull request: from a `Pull request | Opened` event, or from a
webhook whose payload has the `sha` of a commit whose `air-chain/review` status was set to
`pending` `Ready for review`, or by [address-review](../address-review/SKILL.md), which re-reviews
the commit it just pushed (step 7 there) and then merges on your approve.

Every review you post states its verdict and sets the status. Both are needed: the author's side
may be started by the review itself (a `pull_request_review` event) and read the verdict from the
review, or by the forwarded status. A verdict nobody can read stops the PR short of a merge.

You run **unattended**: don't ask questions, don't wait for input, and don't edit, commit or push
code. If something is unclear, say so in the review and go on.

## 1. Check there is something to review

```bash
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
# from the PR event: its number; from the webhook: the open PR whose head is the payload's sha
pr=$(gh api "repos/$repo/commits/<sha>/pulls" --jq '[.[] | select(.state == "open" and .head.sha == "<sha>")][0].number')
gh pr view $pr --json number,title,body,state,isDraft,baseRefName,headRefOid,author
head=$(gh pr view $pr --json headRefOid -q .headRefOid)
# the latest air-chain/review status of the head commit (null if none)
gh api "repos/$repo/commits/$head/statuses" --jq '[.[] | select(.context == "air-chain/review")][0]
  | {state, description, target_url, creator: .creator.login, created_at}'
```

Stop with one line, setting and posting nothing, when:

- there is no open PR for the payload's `sha`, or the PR is not `OPEN`;
- you were started by the webhook and its `sha` is not `$head`: a newer commit gets its own request;
- the latest status on `$head` is `success` or `failure`, or a review on `$head` (`commit_id`) already
  has a `Verdict:` line: this commit is already reviewed (by you, or by another run started for
  the same commit) and nobody asked again since;
- the latest status on `$head` is `error` (`Needs a person`): only a person's `Ready for review`
  restarts the chain.

## 2. Collect the change

- `gh pr diff $pr`, and the files it touches at `$head`: `gh pr checkout $pr`.
- **A re-review** (the PR's commits have an earlier verdict status): also read your earlier reviews
  (`gh api "repos/$repo/pulls/$pr/reviews?per_page=100" --paginate`), the inline threads and the
  replies to them since (`gh api "repos/$repo/pulls/$pr/comments?per_page=100" --paginate`). The
  commit messages since (`gh pr view $pr --json commits`) and the PR body's `Review decisions`
  section say what was changed and what was declined, and why.

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

### The review

One PR review on `$head`, with an inline comment per finding anchored to the changed line it
concerns:

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
  outside the diff goes into the review body with its `path:line`.
- **How to reproduce**: commands someone can paste as is; no "run it and see".
- One problem per comment; the same problem in several places → one comment that lists them.

The review body:

```markdown
**Verdict: approve** | **Verdict: need changes**
<at most 5 lines: what the change does, why this verdict, the number of findings by severity>
Checks: typecheck ✅/❌ · tests ✅/❌ · smoke ✅/❌ — at <short $head>

<findings outside the diff, each with path:line and how to reproduce; on a re-review, which
earlier findings are fixed, accepted or kept>

<!-- air-chain note -->
```

```bash
gh api "repos/$repo/pulls/$pr/reviews" --input review.json --jq .html_url
# review.json: {"commit_id": "<$head>", "event": "COMMENT", "body": "<the review body>",
#               "comments": [{"path": "...", "line": 12, "side": "RIGHT", "body": "..."}]}
```

If an inline anchor is rejected, move that finding into the review body. On a re-review, also
reply in each earlier thread (fixed / reason accepted / kept), each reply ending with
`<!-- air-chain note -->`. Always post the review, an approve with no findings too (its body is
the verdict line and the checks): the review is what says this commit was reviewed. The verdict
line uses exactly these words, `Verdict: approve` or `Verdict: need changes`, never synonyms
such as "request changes".

### The verdict status

Always, as the last thing you do, set the `air-chain/review` status on `$head`. Before setting it,
check the head is still `$head` (`gh pr view $pr --json headRefOid`). If it moved, set nothing and
stop: a new commit gets reviewed when someone (the agent or a person) sets `Ready for review` on it.

```bash
# approve: target_url is the review's html_url
gh api "repos/$repo/statuses/$head" -f context=air-chain/review -f state=success \
  -f description="Verdict: approve" -f target_url="<review or PR url>"
# need changes
gh api "repos/$repo/statuses/$head" -f context=air-chain/review -f state=failure \
  -f description="Verdict: need changes" -f target_url="<review url>"
```

If GitHub refuses the status with `403` (the token has no `statuses: write`), the review's
`Verdict:` line still carries the verdict: say so when you finish, and don't retry.

The description may add a short tail after the verdict, such as `Verdict: need changes — 2 bug,
1 test`, within 140 characters. Finish by printing the PR URL and the verdict.
