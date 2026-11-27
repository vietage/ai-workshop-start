# Replying in a review thread: `pulls/<pr>/comments/<id>/replies`, with the PR number

The address-review skill shows `gh api "repos/$repo/pulls/comments/<id>/replies"`. That path
returns `404 Not Found`. The working endpoint has the PR number in it:

```bash
gh api "repos/$repo/pulls/$pr/comments/<first comment databaseId>/replies" -f body="…"
```

**Why it matters:** with the 404 the reply is lost. The resolve mutation still works, so a thread
can end up resolved with no reply.

**Where it applies:** address-review, step 6, and any reply to an inline PR review comment.

Learned in #52, 2026-11-27.
