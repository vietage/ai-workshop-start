// Writes a status update: this repository's pull requests merged and issues resolved since a date
// and time, and posts it to your private Slack channel.
//   node .agents/skills/status-update/status-update.mjs "<start>" [--dry-run]
// <start>: `YYYY-MM-DD[ HH:MM[:SS]]` (or `T` between them), then an optional timezone: `Z`, `UTC`,
// an offset (`+01:00`, `-0500`) or an IANA name (`Europe/Berlin`); UTC when none is given.
// The window is inclusive: from <start>, to now.
// Posted → the message's permalink on stdout; --dry-run → the message on stdout, nothing posted.
// Everything else → stderr, and an exit code that says what happened:
//   1  gh failed, or Slack refused the message or could not be reached; nothing posted
//   2  invalid input: no start, a date that can't be parsed, an unknown option, SLACK_STATUS_CHANNEL
//      not set or set to the shared #my-ai-workshop; nothing posted
//   3  SLACK_BOT_TOKEN is not set; nothing posted
// Environment: SLACK_BOT_TOKEN (scope chat:write), SLACK_STATUS_CHANNEL (your private channel, its
// name or ID; never #my-ai-workshop), SLACK_API_URL (for the tests). --dry-run needs neither.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CHANNEL as SHARED_CHANNEL, slack } from '../issue-to-pr/ask-slack.mjs';

const pad = (n) => String(n).padStart(2, '0');

/** The offset of `timeZone` from UTC at `epochMs`, in ms. */
function zoneOffset(timeZone, epochMs) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(epochMs / 1000) * 1000;
}

/** `<start>` → a Date, or an error message (a string). */
export function parseStart(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(.*)$/.exec(text.trim());
  const invalid = `Can't parse the start "${text.trim()}": use YYYY-MM-DD HH:MM, then an optional timezone (Z, UTC, +01:00, Europe/Berlin).`;
  if (!match) return invalid;
  const [y, mo, d, h = 0, mi = 0, s = 0] = match.slice(1, 7).map((v) => (v === undefined ? undefined : Number(v)));
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return invalid;
  const zone = match[7].trim();
  if (zone === '' || /^(Z|UTC|GMT)$/i.test(zone)) return new Date(wall);
  const offset = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
  if (offset) {
    const [, sign, oh, om = '00'] = offset;
    if (+oh > 23 || +om > 59) return invalid;
    return new Date(wall - (sign === '-' ? -1 : 1) * (+oh * 60 + +om) * 60_000);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    return `Unknown timezone "${zone}" in the start "${text.trim()}": use Z, UTC, an offset (+01:00) or an IANA name (Europe/Berlin).`;
  }
  const guess = wall - zoneOffset(zone, wall);
  return new Date(wall - zoneOffset(zone, guess));
}

/** For GitHub's search: `2026-11-27T09:00:00+00:00`. */
export const searchTime = (date) => `${date.toISOString().slice(0, 19)}+00:00`;

/** For people: `2026-11-27 09:00 UTC`, with seconds when there are any. */
export function humanTime(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, date.getUTCSeconds() ? 19 : 16)} UTC`;
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The message: a heading with the period, the merged pull requests, the resolved issues. */
export function message({ repo, start, end, pulls, issues }) {
  const list = (items, none) => (items.length ? items.map((i) => `• <${i.url}|#${i.number}> ${escape(i.title)}`).join('\n') : none);
  return [
    `*Status update: ${repo}, ${humanTime(start)} – ${humanTime(end)}*`,
    '',
    `*Merged pull requests (${pulls.length})*`,
    list(pulls, 'Nothing merged'),
    '',
    `*Resolved issues (${issues.length})*`,
    list(issues, 'No issues resolved'),
  ].join('\n');
}

const REFUSALS = {
  invalid_auth: 'SLACK_BOT_TOKEN is not a valid token',
  not_authed: 'SLACK_BOT_TOKEN is not a valid token',
  token_revoked: 'SLACK_BOT_TOKEN has been revoked',
  token_expired: 'SLACK_BOT_TOKEN has expired',
  account_inactive: "SLACK_BOT_TOKEN's bot or workspace is inactive",
  missing_scope: 'the token lacks the chat:write scope',
  not_in_channel: 'the bot is not in the channel: invite it there',
  channel_not_found: "the channel doesn't exist, or it is private and the bot is not in it: invite it there",
  is_archived: 'the channel is archived',
};

const isShared = (channel) => channel.trim().replace(/^#/, '').toLowerCase() === SHARED_CHANNEL.replace(/^#/, '');

/** `gh <args>`'s JSON. */
const ghJson = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

/** Runs it; returns { code, stdout?, log } and never throws. */
export async function statusUpdate(argv, env = process.env, fetchImpl = fetch, now = () => new Date()) {
  const dryRun = argv.includes('--dry-run');
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--dry-run');
  if (unknown.length) return { code: 2, log: [`Unknown option ${unknown.join(', ')}: status-update.mjs "<start>" [--dry-run].`] };
  const text = argv.filter((a) => a !== '--dry-run').join(' ');
  if (!text.trim()) return { code: 2, log: ['No start given: status-update.mjs "<start>" [--dry-run], e.g. "2026-11-27 09:00 Europe/Berlin".'] };
  const start = parseStart(text);
  if (typeof start === 'string') return { code: 2, log: [`${start} Nothing posted.`] };

  const channel = env.SLACK_STATUS_CHANNEL?.trim();
  if (!dryRun) {
    if (!channel) return { code: 2, log: ['SLACK_STATUS_CHANNEL is not set: set it to your private Slack channel. Nothing posted.'] };
    if (isShared(channel)) {
      return { code: 2, log: [`SLACK_STATUS_CHANNEL is ${SHARED_CHANNEL}, the shared channel: status updates go to your private channel. Nothing posted.`] };
    }
    if (!env.SLACK_BOT_TOKEN) return { code: 3, log: ['SLACK_BOT_TOKEN is not set. Nothing posted.'] };
  }

  const end = now();
  let repo, pulls, issues;
  try {
    repo = ghJson(['repo', 'view', '--json', 'nameWithOwner']).nameWithOwner;
    const since = searchTime(start);
    const inWindow = (at) => at && Date.parse(at) >= start.getTime();
    const byNumber = (a, b) => a.number - b.number;
    pulls = ghJson(['pr', 'list', '--state', 'merged', '--search', `merged:>=${since}`, '--limit', '1000', '--json', 'number,title,url,mergedAt'])
      .filter((pr) => inWindow(pr.mergedAt)).sort(byNumber);
    issues = ghJson(['issue', 'list', '--state', 'closed', '--search', `closed:>=${since} reason:completed`, '--limit', '1000',
      '--json', 'number,title,url,closedAt,stateReason'])
      .filter((issue) => issue.stateReason === 'COMPLETED' && inWindow(issue.closedAt)).sort(byNumber);
  } catch (error) {
    return { code: 1, log: [`gh failed: ${(error.stderr || error.message).toString().trim()}. Nothing posted.`] };
  }
  const body = message({ repo, start, end, pulls, issues });
  if (dryRun) return { code: 0, stdout: body, log: ['Dry run: nothing posted.'] };

  try {
    const posted = await slack(env, fetchImpl, 'chat.postMessage', null, { channel, text: body, unfurl_links: false, unfurl_media: false });
    if (!posted.ok) {
      const why = REFUSALS[posted.error];
      return { code: 1, log: [`Slack refused the status update for ${channel}: ${posted.error}${why ? ` (${why})` : ''}. Nothing posted.`] };
    }
    const link = await slack(env, fetchImpl, 'chat.getPermalink', { channel: posted.channel, message_ts: posted.ts }).catch(() => ({}));
    return { code: 0, stdout: link.ok ? link.permalink : `${posted.channel} ${posted.ts}`, log: [`Posted to ${channel}.`] };
  } catch (error) {
    return { code: 1, log: [`Slack could not be reached: ${error.message}. Nothing posted.`] };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, stdout, log } = await statusUpdate(process.argv.slice(2));
  for (const line of log) console.error(line);
  if (stdout !== undefined) console.log(stdout);
  process.exitCode = code;
}
