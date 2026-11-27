// Asks a person a question the issue leaves open, in Slack, and waits for the answer: posts it to
// #my-ai-workshop, then waits for the first reply from a person in that message's thread.
//   node .agents/skills/issue-to-pr/ask-slack.mjs "<question>"
// The answer → stdout, exit 0. Everything else → stderr, and an exit code that says what happened:
//   1  Slack refused or could not be reached (bad token, not in the channel, a missing scope, ...)
//   2  no reply in time; a note in the thread says the agent decides
//   3  SLACK_BOT_TOKEN is not set; nothing is posted
//   4  no question given
// Environment: SLACK_BOT_TOKEN (scopes chat:write, channels:history), SLACK_REPLY_TIMEOUT (seconds,
// default 900), SLACK_POLL_INTERVAL (seconds, default 15), SLACK_API_URL (for the tests).
import { pathToFileURL } from 'node:url';

export const CHANNEL = '#my-ai-workshop';
export const TIMEOUT = 900;
export const POLL_INTERVAL = 15;

const minutes = (seconds) => (seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`);

/** One Slack Web API call; its JSON, or an error with Slack's own reason. Also used by status-update. */
export async function slack(env, fetchImpl, method, params, body) {
  const url = new URL(`${env.SLACK_API_URL || 'https://slack.com/api'}/${method}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const response = await fetchImpl(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      ...(body && { 'Content-Type': 'application/json; charset=utf-8' }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 429) return { ok: false, error: 'ratelimited', retry: true };
  const json = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  return json;
}

/** The first reply in the thread from a person: not the question, not a bot. */
export function firstReply(messages, parentTs) {
  return messages.find((message) => message.ts !== parentTs && !message.bot_id && message.subtype !== 'bot_message' && message.text);
}

/** Asks `question`; returns { code, answer?, log } and never throws. */
export async function ask(question, env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const log = [];
  if (!question?.trim()) return { code: 4, log: ['No question given: ask-slack.mjs "<question>".'] };
  if (!env.SLACK_BOT_TOKEN) return { code: 3, log: ['SLACK_BOT_TOKEN is not set; not asking in Slack.'] };
  const timeout = Number(env.SLACK_REPLY_TIMEOUT) > 0 ? Number(env.SLACK_REPLY_TIMEOUT) : TIMEOUT;
  const interval = Number(env.SLACK_POLL_INTERVAL) > 0 ? Number(env.SLACK_POLL_INTERVAL) : POLL_INTERVAL;
  try {
    const posted = await slack(env, fetchImpl, 'chat.postMessage', null, {
      channel: CHANNEL,
      text: `${question.trim()}\n\n_Reply in this thread. Without a reply in ${minutes(timeout)}, I decide and record it in the pull request._`,
      unfurl_links: false,
    });
    if (!posted.ok) return { code: 1, log: [`Slack refused the question: ${posted.error}.`] };
    const { channel, ts } = posted;
    const link = await slack(env, fetchImpl, 'chat.getPermalink', { channel, message_ts: ts }).catch(() => ({}));
    log.push(`Asked in ${CHANNEL}: ${link.ok ? link.permalink : `${channel} ${ts}`}`);

    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      await sleep(Math.min(interval * 1000, Math.max(0, deadline - Date.now())));
      const replies = await slack(env, fetchImpl, 'conversations.replies', { channel, ts, limit: '100' }).catch(
        (error) => ({ ok: false, error: String(error), retry: true }),
      );
      if (!replies.ok) {
        if (replies.retry) continue;
        return { code: 1, log: [...log, `Slack refused to read the thread: ${replies.error}.`] };
      }
      const reply = firstReply(replies.messages ?? [], ts);
      if (reply) {
        log.push(`Answered by <@${reply.user}>.`);
        return { code: 0, answer: reply.text, log };
      }
    }
    await slack(env, fetchImpl, 'chat.postMessage', null, {
      channel,
      thread_ts: ts,
      text: `No reply in ${minutes(timeout)}: I decide and record the decision in the pull request.`,
    }).catch(() => {});
    return { code: 2, log: [...log, `No reply in ${minutes(timeout)}.`] };
  } catch (error) {
    return { code: 1, log: [...log, `Slack could not be reached: ${error.message}.`] };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, answer, log } = await ask(process.argv.slice(2).join(' '));
  for (const line of log) console.error(line);
  if (answer !== undefined) console.log(answer);
  process.exitCode = code;
}
