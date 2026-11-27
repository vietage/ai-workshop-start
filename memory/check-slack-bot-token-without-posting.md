# Check SLACK_BOT_TOKEN and its scopes without posting to Slack

`auth.test` is read-only; its response header lists the token's scopes:

```bash
curl -s -D - -o /dev/null -H "Authorization: Bearer $SLACK_BOT_TOKEN" https://slack.com/api/auth.test | grep -i x-oauth-scopes
```

`ask-slack.mjs` (issue-to-pr) needs `chat:write` (plus `chat:write.public` to post to a channel
the bot hasn't joined) and `channels:history` for `conversations.replies`. On 2026-11-27 the token
in the Air environment had all three.

**Why it matters:** a real `ask-slack.mjs` run posts a question to `#my-ai-workshop` that people
see; `tests/issue-to-pr.test.ts` uses a local stand-in for the Slack API instead.

**Where it applies:** `.agents/skills/issue-to-pr/ask-slack.mjs`, any task that touches Slack.

Learned in #28, 2026-11-27.
