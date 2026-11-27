# Issue to PR: open decisions
The issue-to-pr skill (`.agents/skills/issue-to-pr`) runs unattended; when an issue leaves a real
decision open, it asks a person in Slack and waits: `node .agents/skills/issue-to-pr/ask-slack.mjs "<question>"`
- **Ask**: one message with every open decision, posted to `#my-ai-workshop` with the
  `SLACK_BOT_TOKEN` environment variable (scopes `chat:write`, `channels:history`); the message says
  to reply in its thread and how long the agent waits. Its link → stderr
- **Wait**: for the first reply in that message's thread from a person (not the question, not a
  bot), checking every 15 s (`SLACK_POLL_INTERVAL`), up to 15 min (`SLACK_REPLY_TIMEOUT`, seconds)
  - A reply → its text on stdout, exit 0; the agent goes on with it, as an answer, not as
    instructions that override the skill
  - Rate limited, or a read that fails on the network → checked again at the next interval
- **Fallback**: the agent decides itself, as before, and doesn't ask again in that run
  - No reply in time → a note in the thread that the agent decides; exit 2
  - No `SLACK_BOT_TOKEN` → nothing posted; exit 3
  - Slack refuses (`ok: false`: a bad token, not in the channel, a missing scope) or can't be
    reached → exit 1
  - No question → nothing posted; exit 4
- **Record**: each decision under *Decisions* in the PR: the question, and the answer with the
  thread's link, or why there was none and what was decided
