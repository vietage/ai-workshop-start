# Review chain

Two agents take every pull request to a merge, talking through PR comments:

```text
PR opened ──────────────┐
"ready for review" ─────┴─▶ review-pr ──▶ inline comments + "Verdict: approve" or "Verdict: need changes"
                                                                │
                         address-review ◀───────────────────────┘
                           approve      → merge the PR
                           need changes → fix, reply, push, comment "ready for review" ─▶ review-pr …
```

- [review-pr](skills/review-pr/SKILL.md) reviews the PR's head commit and posts a verdict.
- [address-review](skills/address-review/SKILL.md) acts on the verdict: merges, or addresses the
  comments and asks for another review.

## The comments

Each comment both agents post ends with a hidden marker. The agents may post as the same GitHub
account as a person, so the marker, not the login, says who wrote a comment and what it means.

| Comment | Posted by | First line | Marker |
| --- | --- | --- | --- |
| Review request | address-review, or a person | `Ready for review` | `<!-- air-chain ready head=<sha> -->` (a person can leave it out) |
| Verdict | review-pr | `**Verdict: approve**` or `**Verdict: need changes**` | `<!-- air-chain verdict=approve head=<sha> -->` or `verdict=need-changes` |
| Hand-off to a person | either | `Needs a person` | `<!-- air-chain stop -->` |

- `head=<sha>` is the full SHA of the commit the comment is about: the one reviewed, or the one
  pushed. A verdict counts only for that commit.
- Every other comment and reply the agents post ends with `<!-- air-chain note -->`: it triggers
  nothing, and marks the comment as an agent's.
- `Needs a person` ends the chain on that PR: neither agent acts until a person comments
  `Ready for review` again.
- Only comments from `jetbrains-air[bot]` or from people who may change the repository
  (`author_association` `OWNER`, `MEMBER` or `COLLABORATOR`) count. On a public repository anyone
  can comment.

## Wiring

Air's GitHub triggers don't fire on comments, so
[.github/workflows/review-chain.yml](../.github/workflows/review-chain.yml) forwards them to each
automation's webhook trigger, with the JSON payload
`{"kind": "ready" | "verdict", "repository", "pr", "comment_id", "comment_url", "author"}`.

| Automation | Instructions | Triggers | Changes |
| --- | --- | --- | --- |
| Review PR | `Use the review-pr skill on the pull request from the trigger.` | `GitHub \| Pull request \| Opened`; Webhook | No code changes |
| Address review | `Use the address-review skill on the pull request from the trigger.` | Webhook | As the instructions say |

Repository secrets for the workflow, from each webhook trigger's **Copy Webhook URL** and
**Copy Token**: `AIR_REVIEW_WEBHOOK_URL`, `AIR_REVIEW_WEBHOOK_TOKEN`, `AIR_ADDRESS_WEBHOOK_URL`,
`AIR_ADDRESS_WEBHOOK_TOKEN`. A missing secret skips that hop with a notice in the workflow log.

## Loops

- address-review hands the PR to a person (`Needs a person`) after 5 `Ready for review` comments
  of its own on the PR, or when the reviewer repeats a point it declined with a reason.
- Both skills are idempotent: a stale trigger (a verdict for an older commit, a request already
  answered) ends the run with one line and no comment.
