# Status update
The status-update skill (`.agents/skills/status-update`): what this repository did since a date and
time, posted to the user's private Slack channel:
`node .agents/skills/status-update/status-update.mjs "<start>" [--dry-run]`
- **Start**: `YYYY-MM-DD[ HH:MM[:SS]]` (or `T` between them), then an optional timezone: `Z`, `UTC`,
  an offset (`+01:00`, `-0500`) or an IANA name (`Europe/Berlin`); none → UTC; no time → midnight
  - The window: from the start, *inclusive*, to now
- **Lists**, with `gh`, for this repository, each item its number, title and link, by number:
  - *Merged pull requests*: `gh pr list --state merged --search "merged:>=<start>"`, merged at or
    after the start; closed without merging → not listed
  - *Resolved issues*: `gh issue list --state closed --search "closed:>=<start> reason:completed"`,
    closed as completed at or after the start; closed as not planned → not listed
- **Message** (Slack mrkdwn): a heading `Status update: <owner/repo>, <start> – <now>` (in UTC), then
  `Merged pull requests (<n>)` and `Resolved issues (<n>)`, an item a line `• <link|#n> <title>`;
  an empty list → `Nothing merged` / `No issues resolved`. `&`, `<`, `>` in titles escaped
- **Post**: `chat.postMessage` with `SLACK_BOT_TOKEN` (scope `chat:write`) to
  `SLACK_STATUS_CHANNEL` (a name or ID), link previews off; the message's permalink → stdout, exit 0
- `--dry-run`: the message → stdout, exit 0; nothing posted, neither `SLACK_BOT_TOKEN` nor
  `SLACK_STATUS_CHANNEL` needed
- **Errors**: a clear message on stderr, *nothing posted*, Slack not called
  - No start, a date or timezone that can't be parsed (`2026-02-30`, `Mars/Base`), an unknown option
    → exit 2
  - `SLACK_STATUS_CHANNEL` not set, or `#my-ai-workshop` (with or without `#`, any case), the shared
    channel of `spec/issue-to-pr.md` → exit 2
  - No `SLACK_BOT_TOKEN` → exit 3
  - `gh` fails → its message, exit 1
- Slack refuses (`ok: false`: a bad token, `missing_scope` for `chat:write`, `not_in_channel`,
  `channel_not_found`) → its reason and what it means, exit 1; can't be reached → exit 1
