# Review chain

Two agents take every pull request to a merge. The chain's state is one GitHub commit status on
the PR's head commit, the `air-chain/review` context, and no step waits for a person to set it:

```text
PR opened ──────────────────────────┐
push to the PR ─▶ workflow: status  │
        pending "Ready for review" ─┴▶ review-pr ─▶ review "Verdict: …" ─▶ workflow: status
            ▲                                         │        success "Verdict: approve"
            │                                         │     or failure "Verdict: need changes"
            │                                         ▼
            │                 address-review (the review submitted, or the status)
            │                   claim the PR (one run at a time)
            │                   approve      → merge the PR
            └── the fix's push ◀─ need changes → fix, reply, commit    (at most 5 rounds, then a person)
```

- [review-pr](skills/review-pr/SKILL.md) reviews the PR's head commit and posts a review whose
  body says `Verdict: approve` or `Verdict: need changes`.
- [address-review](skills/address-review/SKILL.md) acts on the verdict: merges, or addresses the
  findings and commits. The push of that commit starts the next review.
- Notes in [memory/](../memory/README.md), added by the
  [update-memory](skills/update-memory/SKILL.md) skill, are not part of the chain: they are never
  reviewed, and both skills skip `memory/`.
- [The workflow](../.github/workflows/review-chain.yml) makes the hand-overs the agents can't:
  it sets the status on every push to a PR and from every review with a verdict, and starts the
  review of a pushed commit.

**Why a workflow.** Two things an agent's run may be unable to do, both seen in this repository:
set a commit status (`403 Resource not accessible by integration`: the app has no `statuses:
write`), and push (Air pushes the run's commit only after the run ends, so the run can't set or
start anything on it). The workflow's `GITHUB_TOKEN` can set statuses, and the workflow runs on
the push itself, whoever makes it and whenever. So a skill never ends with "set `Ready for
review` to continue": that is always done for it.

## The status

A status belongs to a commit, so it says which commit it is about by itself: a verdict counts only
for the commit it is set on, and a push leaves the new head without one. Only the latest
`air-chain/review` status of a commit counts. Only people and apps with write access to the
repository can set statuses, so every status is trusted. Besides the statuses, only a review's
`Verdict:` line counts, and only from `jetbrains-air[bot]` or people with write access (`OWNER`,
`MEMBER`, `COLLABORATOR`); no comments drive the chain. A `pending` status is not a verdict: a
review with a verdict on the same commit wins over it.

| State | Description starts with | Set by | `target_url` | Means |
| --- | --- | --- | --- | --- |
| `pending` | `Ready for review` | the workflow, on a push to the PR; or a person | the commit | review this commit |
| `success` | `Verdict: approve` | the workflow, from the review; review-pr when it can | the review | approved; merge it |
| `failure` | `Verdict: need changes` | the workflow, from the review; review-pr when it can | the review | address the review |
| `error` | `Needs a person: <why>` | address-review, when it can | what blocks it | the chain stops |

```bash
gh api "repos/$repo/statuses/<sha>" -f context=air-chain/review -f state=<state> \
  -f description="<at most 140 characters>" -f target_url="<url>"
# the latest air-chain/review status of a commit
gh api "repos/$repo/commits/<sha>/statuses" --jq '[.[] | select(.context == "air-chain/review")][0]'
```

- `Needs a person` ends the chain on that commit, and only for what an agent can't decide or
  do: the loop guard, a person's change request, a blocked merge, checks it can't get green, a
  fork. The person's next push restarts the chain, as does `Ready for review` set by hand (the
  command above, `state=pending`). Without `statuses: write` it is a PR comment with the
  `air-chain` note marker.
- `air-chain/review` can be a required status check in branch protection: it is green only when
  review-pr approved the head commit.
- The review itself is a PR review (`event: COMMENT`) with inline comments; its body holds the
  summary and the findings outside the diff. Replies the agents post in its threads end with
  `<!-- air-chain note -->`: the agents may post as the same GitHub account as a person, so the
  marker, not the login, says which replies are an agent's. They trigger nothing.

## The claim

One verdict starts several address-review runs: the forwarded verdict status and the review's
`submitted` event (and every reply in a review thread fires another `submitted` event). Only one may act, so address-review claims the PR with a PR
comment ending with `<!-- air-chain claim -->`:

- A run that finds a **live** claim stops with one line. Live: the comment still has the claim
  marker and was edited in the last 2 hours. review-pr also stops on a live claim of a run that
  didn't start it.
- Otherwise the run posts its claim and reads the claims again: two runs can pass the first check
  at once, and the oldest live claim (the lowest comment id) wins; the other edits its own to
  `Stood down` and stops.
- The owner keeps its claim live while it works, and at the end turns the claim marker into
  `<!-- air-chain note -->` with the outcome: `Done: merged …`, `Done: addressed <head> in
  <fix> …` or `Done: Needs a person …`. It releases the claim **before** its fix is pushed, so
  the review that push starts finds no live claim; the `Done: addressed <head>` note keeps a
  late run from addressing the same verdict twice.
- A run that died leaves a claim that goes **stale** after 2 hours; the next trigger takes the PR
  over and says so in its claim.

The claim is a comment, not a status: it works without `statuses: write`, and a verdict status
set on the owner's commit doesn't replace it.

## Wiring

[.github/workflows/review-chain.yml](../.github/workflows/review-chain.yml) runs
[review-chain-forward.mjs](../.github/review-chain-forward.mjs) from the default branch on three
events:

| Event | What the workflow does |
| --- | --- |
| A push to a PR (`pull_request_target` `synchronize`; not from a fork) | Sets `pending` `Ready for review` on the new head, and starts its review (below) |
| A review with a `Verdict:` line on the PR's head, from `jetbrains-air[bot]` or a person with write access (`pull_request_review` `submitted`) | Sets `success` `Verdict: approve` or `failure` `Verdict: need changes` on the head, with the review as `target_url` |
| An `air-chain/review` status set by a person or an app (`status`) | `Ready for review`: starts the review (below). A verdict: posts it to the Address review webhook, if set |

**Starting the review of a commit** takes one of two routes, never both:

- The Review PR automation's webhook is set (`AIR_REVIEW_WEBHOOK_URL`, `AIR_REVIEW_WEBHOOK_TOKEN`):
  the workflow posts `{"kind": "ready", "repository", "sha", "state", "description",
  "target_url", "sender"}` to it. review-pr finds the pull request from `sha`: the open PR whose
  head it is.
- It is not set: the workflow posts a review on the commit, as `github-actions[bot]`, that ends
  with `<!-- air-chain ready -->`. Its `submitted` event starts address-review, which reviews
  the commit with review-pr (as a separate agent) and then merges or addresses it in the same
  run. The chain needs no secrets and no webhooks this way.

Statuses the workflow sets with its `GITHUB_TOKEN` start no workflow, so nothing is forwarded
twice. The `pull_request_review` event runs the workflow file of the PR merged into its base, so a
PR opened before this workflow gets no status from its reviews; the script always comes from the
default branch.

| Automation | Instructions | Triggers | Changes |
| --- | --- | --- | --- |
| Review PR | `Use the review-pr skill on the pull request from the trigger.` | `GitHub \| Pull request \| Opened`; Webhook (optional) | No code changes |
| Address review | `Use the address-review skill on the pull request from the trigger.` | `GitHub \| Pull request review \| Submitted`; Webhook (optional) | As the instructions say |

The reviewer automation must use the review-pr skill: a reviewer that posts a review without a
`Verdict:` line leaves address-review nothing to act on.

Optional repository secrets, from each webhook trigger's **Copy Webhook URL** and **Copy Token**:
`AIR_REVIEW_WEBHOOK_URL`, `AIR_REVIEW_WEBHOOK_TOKEN` (re-reviews run in the Review PR automation,
apart from the author's run), `AIR_ADDRESS_WEBHOOK_URL`, `AIR_ADDRESS_WEBHOOK_TOKEN` (verdict
statuses set by hand reach address-review). The GitHub app the agents run as needs neither
`statuses: write` nor the right to push during a run.

## Loops

- address-review hands the PR to a person (`Needs a person`) after 5 `Verdict: need changes`
  verdicts on the PR's commits, or when the reviewer repeats a point it declined with a reason.
- address-review always ends a round with a new commit, an empty one when it declined every
  finding: the push is what gets the reviewer to read its reasons.
- Both skills are idempotent: a stale trigger (a status or a review on a commit that is no longer
  the head, or a verdict already addressed) ends the run with one line and nothing set or posted.
- One verdict per commit: review-pr checks right before it posts that no other review on the
  commit has a `Verdict:` line, and a run that holds no claim doesn't act on a verdict.
- A push by a person to a PR in the chain is reviewed like any other: every head gets a verdict.
