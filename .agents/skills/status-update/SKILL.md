---
name: status-update
description: Writes a status update for this repository, the pull requests merged and the issues resolved (closed as completed) since a given date and time, and posts it to your private Slack channel (SLACK_STATUS_CHANNEL) with SLACK_BOT_TOKEN, never to the shared #my-ai-workshop. Use when asked for a status update, a progress report or what was done since a date.
---

# Status update

You write a short status update for this repository: the **pull requests merged** and the
**issues resolved** since a date and time, and post it to the user's **private** Slack channel.

## 1. The start

Take the start from the request: a date and a time, with a timezone, e.g. `2026-11-27 09:00
Europe/Berlin`. Accepted: `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS` (or a `T` between
date and time), then an optional timezone: `Z`, `UTC`, an offset (`+01:00`, `-0500`) or an IANA name.
**UTC when none is given**; a date without a time is midnight. The window goes from the start,
**inclusive**, to now.

## 2. Check it first: a dry run

```bash
node .agents/skills/status-update/status-update.mjs "<start>" --dry-run
```

It lists, for this repository (with `gh`, logged in):

- the **merged pull requests**: `gh pr list --state merged --search "merged:>=<ISO time>"`; pull
  requests closed without merging are not listed;
- the **resolved issues**, closed as completed, not as "not planned":
  `gh issue list --state closed --search "closed:>=<ISO time> reason:completed"`;

and prints the message: a heading with the repository and the period, each list with the number,
title and link of each item, or `Nothing merged` / `No issues resolved` when it is empty. Nothing is
posted; the dry run needs neither `SLACK_BOT_TOKEN` nor `SLACK_STATUS_CHANNEL`.

## 3. Post it

```bash
node .agents/skills/status-update/status-update.mjs "<start>"
```

- It posts the message with `chat.postMessage`, authenticating with the `SLACK_BOT_TOKEN`
  environment variable (scope `chat:write`), to the channel in **`SLACK_STATUS_CHANNEL`**: the
  user's private channel, its name or ID. The bot must be a member of it.
- It is **never `#my-ai-workshop`**, the shared channel that issue-to-pr's `ask-slack.mjs` asks in:
  that channel is refused. Don't post the update anywhere else either.
- **Exit 0**: the message's permalink is on stdout; give it to the user.
- **Any other exit**: nothing was posted; the reason is on stderr. Tell the user, don't retry with
  another channel or token:
  - 1: `gh` failed, or Slack refused the message (a bad token, a missing `chat:write`, the bot not
    in the channel) or could not be reached;
  - 2: invalid input: no start, a date or timezone that can't be parsed, `SLACK_STATUS_CHANNEL` not
    set or set to `#my-ai-workshop`;
  - 3: `SLACK_BOT_TOKEN` is not set.

To check the token and its scopes without posting, see
`memory/check-slack-bot-token-without-posting.md` (`auth.test`).
