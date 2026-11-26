# Review chain

Two agents take every pull request to a merge, talking through one GitHub commit status on the
PR's head commit, the `air-chain/review` context:

```text
PR opened ───────────────────────┐
status pending "Ready for review" ┴─▶ review-pr ──▶ review "Verdict: …" + status success "Verdict: approve"
                                                                       or failure "Verdict: need changes"
                                                                │
                         address-review ◀───────────────────────┘  (the status, or the review submitted)
                           approve      → merge the PR
                           need changes → fix, reply, push ─▶ review-pr on the new commit (same run)
                                            ▲                    │ approve → merge the PR
                                            └── need changes ────┘ (at most 5 rounds, then a person)
```

- [review-pr](skills/review-pr/SKILL.md) reviews the PR's head commit, posts a review whose body
  says `Verdict: approve` or `Verdict: need changes`, and sets the verdict status.
- [address-review](skills/address-review/SKILL.md) acts on the verdict: merges, or addresses the
  findings, pushes, **re-reviews the new commit with review-pr in the same run**, and repeats
  until it merges or hands the PR to a person. A reviewed PR whose comments are addressed is
  always re-reviewed and, when approved, merged; it never waits on a trigger that may not come.

## The status

A status belongs to a commit, so it says which commit it is about by itself: a verdict counts only
for the commit it is set on, and a push leaves the new head without one. Only the latest
`air-chain/review` status of a commit counts. Only people and apps with write access to the
repository can set statuses, so every status is trusted. Besides the statuses, only a review's
`Verdict:` line counts, and only from `jetbrains-air[bot]` or people with write access (`OWNER`,
`MEMBER`, `COLLABORATOR`); no comments drive the chain.

| State | Description starts with | Set by | `target_url` | Means |
| --- | --- | --- | --- | --- |
| `pending` | `Ready for review` | address-review, or a person | the commit | review this commit |
| `success` | `Verdict: approve` | review-pr | the review, or the PR | approved; merge it |
| `failure` | `Verdict: need changes` | review-pr | the review | address the review |
| `pending` | `Addressing review — <run>` | address-review | the PR | one run owns the PR; others stop |
| `error` | `Needs a person: <why>` | address-review | what blocks it | the chain stops |

```bash
gh api "repos/$repo/statuses/<sha>" -f context=air-chain/review -f state=<state> \
  -f description="<at most 140 characters>" -f target_url="<url>"
# the latest air-chain/review status of a commit
gh api "repos/$repo/commits/<sha>/statuses" --jq '[.[] | select(.context == "air-chain/review")][0]'
```

- `Needs a person` ends the chain on that commit: neither agent acts until a person sets
  `Ready for review` again (the command above, `state=pending`).
- `air-chain/review` can be a required status check in branch protection: it is green only when
  review-pr approved the head commit.
- The review itself is a PR review (`event: COMMENT`) with inline comments; its body holds the
  summary and the findings outside the diff. Replies the agents post in its threads end with
  `<!-- air-chain note -->`: the agents may post as the same GitHub account as a person, so the
  marker, not the login, says which replies are an agent's. They trigger nothing.

## Wiring

Air's GitHub triggers don't fire on commit statuses, so
[.github/workflows/review-chain.yml](../.github/workflows/review-chain.yml) forwards each
`air-chain/review` status to an automation's webhook trigger, with the JSON payload
`{"kind": "ready" | "verdict", "repository", "sha", "state", "description", "target_url", "sender"}`.
The skills find the pull request from `sha`: the open PR whose head it is.

| Automation | Instructions | Triggers | Changes |
| --- | --- | --- | --- |
| Review PR | `Use the review-pr skill on the pull request from the trigger.` | `GitHub \| Pull request \| Opened`; Webhook | No code changes |
| Address review | `Use the address-review skill on the pull request from the trigger.` | Webhook; `GitHub \| Pull request review \| Submitted` | As the instructions say |

The reviewer automation must use the review-pr skill: a reviewer that posts a review without a
`Verdict:` line or status leaves address-review nothing to act on.

Repository secrets for the workflow, from each webhook trigger's **Copy Webhook URL** and
**Copy Token**: `AIR_REVIEW_WEBHOOK_URL`, `AIR_REVIEW_WEBHOOK_TOKEN`, `AIR_ADDRESS_WEBHOOK_URL`,
`AIR_ADDRESS_WEBHOOK_TOKEN`. A missing secret skips that hop with a notice in the workflow log.
The GitHub app the agents run as needs the `statuses: write` permission. Statuses set with a
workflow's `GITHUB_TOKEN` start no workflow, so set them as the app or as a person.

## Loops

- address-review pushes its fix itself, before the run ends, and re-reviews it in the same run:
  statuses and reviews can only be set on a commit that is on GitHub. If an earlier run ended
  after a fix but before its re-review, the next address-review run sees a head without a verdict
  after an earlier verdict and re-reviews it.

- address-review hands the PR to a person (`Needs a person`) after 5 `Verdict: need changes`
  statuses on the PR's commits, or when the reviewer repeats a point it declined with a reason.
- Both skills are idempotent: a stale trigger (a status on a commit that is no longer the head, or
  one a newer status replaced) ends the run with one line and nothing set or posted.
