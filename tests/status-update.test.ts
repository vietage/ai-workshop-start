// The cases in spec/status-update.md: status-update.mjs, run as the agent runs it, against a stub
// `gh` that logs its calls and a local server that stands in for the Slack Web API (nothing is
// posted to real Slack); and the skill's text, as agents read it.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, beforeEach, test } from 'node:test';
import { parseSkill } from '../src/core/parse.ts';
import { atlas } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, '.agents/skills/status-update/status-update.mjs');
const skill = readFileSync(join(ROOT, '.agents/skills/status-update/SKILL.md'), 'utf8');

const CHANNEL_ID = 'G0PRIVATE';
const TS = '1764237000.000100';
const PERMALINK = `https://workshop.slack.com/archives/${CHANNEL_ID}/p1764237000000100`;

// The Slack Web API stand-in.
type Request = { method: string; authorization?: string; query: URLSearchParams; body: any };
const received: Request[] = [];
let postAnswer: unknown = {};
const server = createServer(async (request: IncomingMessage, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const url = new URL(request.url ?? '', 'http://localhost');
  const method = url.pathname.replace(/^\/api\//, '');
  received.push({ method, authorization: request.headers.authorization, query: url.searchParams, body: body ? JSON.parse(body) : null });
  const json = (value: unknown) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  if (method === 'chat.postMessage') return json({ ok: true, channel: CHANNEL_ID, ts: TS, ...(postAnswer as object) });
  if (method === 'chat.getPermalink') return json({ ok: true, permalink: PERMALINK });
  json({ ok: false, error: 'unknown_method' });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
after(() => server.close());

beforeEach(() => {
  received.length = 0;
  postAnswer = {};
});

// A `gh` first in PATH: logs each call's arguments, one JSON array per line, and answers
// `pr list` with GH_STUB_PRS and `issue list` with GH_STUB_ISSUES, as gh does: what its search
// returned, whatever the window. GH_STUB_FAIL → every call fails.
const GH_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + '\\n');
if (process.env.GH_STUB_FAIL) { console.error('HTTP 401: Bad credentials'); process.exit(1); }
const cmd = args.slice(0, 2).join(' ');
if (cmd === 'repo view') console.log('{"nameWithOwner":"owner/repo"}');
else if (cmd === 'pr list') console.log(process.env.GH_STUB_PRS);
else if (cmd === 'issue list') console.log(process.env.GH_STUB_ISSUES);
else process.exit(1);
`;

const pr = (number: number, title: string, mergedAt: string | null) => ({ number, title, url: `https://github.com/owner/repo/pull/${number}`, mergedAt });
const issue = (number: number, title: string, closedAt: string, stateReason = 'COMPLETED') =>
  ({ number, title, url: `https://github.com/owner/repo/issues/${number}`, closedAt, stateReason });

type Run = { code: number; stdout: string; stderr: string; calls: string[][]; call: (cmd: string) => string[][] };

/** `node .agents/skills/status-update/status-update.mjs <args>`, `gh` the stub; never rejects. */
async function run(
  t: { after: (fn: () => void) => void },
  args: string[],
  { prs = [] as object[], issues = [] as object[], env = {} as Record<string, string> } = {},
): Promise<Run> {
  const bin = mkdtempSync(join(tmpdir(), 'status-update-test-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'gh'), GH_STUB);
  chmodSync(join(bin, 'gh'), 0o755);
  const log = join(bin, 'calls.jsonl');
  writeFileSync(log, '');
  const out = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      {
        env: {
          PATH: `${bin}${delimiter}${process.env.PATH}`, GH_STUB_LOG: log, GH_STUB_PRS: JSON.stringify(prs), GH_STUB_ISSUES: JSON.stringify(issues),
          SLACK_API_URL: api, SLACK_BOT_TOKEN: 'xoxb-test', SLACK_STATUS_CHANNEL: '#my-status', ...env,
        },
      },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
    );
  });
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { ...out, calls, call: (cmd) => calls.filter((a) => a.slice(0, 2).join(' ') === cmd) };
}

/** The value after `flag` in a gh call. */
const flag = (call: string[], name: string) => call[call.indexOf(name) + 1];

const PRS = [pr(41, 'Web view: the Scan button goes back to Scan', '2026-11-27T11:26:44Z'), pr(40, 'Repository tabs', '2026-11-27T11:39:04Z')];
const ISSUES = [issue(42, 'A TypeError in the organisation view', '2026-11-27T11:28:44Z'), issue(34, 'The "Scanning…" button', '2026-11-27T11:26:46Z')];

test('status-update is a project skill: front matter with its name and a description, listed by ./skill-atlas scan .', async () => {
  const parsed = parseSkill(skill);
  assert.equal(parsed.warning, undefined);
  assert.equal(parsed.name, 'status-update');
  assert.match(parsed.description, /^Writes a status update for this repository, the pull requests merged and the issues resolved/);
  assert.match(parsed.description, /SLACK_STATUS_CHANNEL/);
  const { code, stdout, stderr } = await atlas(['scan', ROOT]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^status-update — Writes a status update/m);
});

test('--dry-run: the message on stdout, its heading, both lists by number with title and link; nothing posted', async (t) => {
  const { code, stdout, stderr, call } = await run(t, ['2026-11-27 09:00', '--dry-run'], { prs: PRS, issues: ISSUES });
  assert.equal(code, 0, stderr);
  assert.match(stderr, /Dry run: nothing posted\./);
  const lines = stdout.trimEnd().split('\n');
  assert.match(lines[0], /^\*Status update: owner\/repo, 2026-11-27 09:00 UTC – \d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})? UTC\*$/);
  assert.deepEqual(lines.slice(1), [
    '',
    '*Merged pull requests (2)*',
    '• <https://github.com/owner/repo/pull/40|#40> Repository tabs',
    '• <https://github.com/owner/repo/pull/41|#41> Web view: the Scan button goes back to Scan',
    '',
    '*Resolved issues (2)*',
    '• <https://github.com/owner/repo/issues/34|#34> The "Scanning…" button',
    '• <https://github.com/owner/repo/issues/42|#42> A TypeError in the organisation view',
  ]);
  assert.equal(received.length, 0, 'Slack not called');
  const [prList] = call('pr list');
  assert.equal(flag(prList, '--state'), 'merged');
  assert.equal(flag(prList, '--search'), 'merged:>=2026-11-27T09:00:00+00:00');
  const [issueList] = call('issue list');
  assert.equal(flag(issueList, '--state'), 'closed');
  assert.equal(flag(issueList, '--search'), 'closed:>=2026-11-27T09:00:00+00:00 reason:completed');
});

test('--dry-run needs neither SLACK_BOT_TOKEN nor SLACK_STATUS_CHANNEL', async (t) => {
  const { code, stdout, stderr } = await run(t, ['2026-11-27', '--dry-run'], { env: { SLACK_BOT_TOKEN: '', SLACK_STATUS_CHANNEL: '' } });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^\*Status update: owner\/repo, 2026-11-27 00:00 UTC – /);
  assert.equal(received.length, 0);
});

test('empty lists: "Nothing merged" and "No issues resolved"', async (t) => {
  const { code, stdout, stderr } = await run(t, ['2026-11-27 09:00', '--dry-run']);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /\*Merged pull requests \(0\)\*\nNothing merged\n\n\*Resolved issues \(0\)\*\nNo issues resolved\n$/);
});

test('the window includes the start; earlier, unmerged pull requests and issues closed as not planned are not listed', async (t) => {
  const prs = [pr(1, 'merged at the start', '2026-11-27T09:00:00Z'), pr(2, 'merged a second before', '2026-11-27T08:59:59Z'), pr(3, 'closed without merging', null)];
  const issues = [
    issue(4, 'completed at the start', '2026-11-27T09:00:00Z'),
    issue(5, 'completed a second before', '2026-11-27T08:59:59Z'),
    issue(6, 'not planned', '2026-11-27T10:00:00Z', 'NOT_PLANNED'),
  ];
  const { code, stdout, stderr } = await run(t, ['2026-11-27 09:00', '--dry-run'], { prs, issues });
  assert.equal(code, 0, stderr);
  assert.match(stdout, /\*Merged pull requests \(1\)\*\n• <[^|]+\/pull\/1\|#1> merged at the start\n\n/);
  assert.match(stdout, /\*Resolved issues \(1\)\*\n• <[^|]+\/issues\/4\|#4> completed at the start\n$/);
  assert.doesNotMatch(stdout, /second before|without merging|not planned/);
});

test('the start: a timezone (an IANA name, an offset, Z, UTC), UTC when none, midnight without a time, seconds kept', async (t) => {
  for (const [start, iso] of [
    ['2026-11-27 10:00 Europe/Berlin', '2026-11-27T09:00:00'],
    ['2026-07-01 09:00 Europe/Berlin', '2026-07-01T07:00:00'], // summer time
    ['2026-11-27T09:00+05:30', '2026-11-27T03:30:00'],
    ['2026-11-27 09:00 -0500', '2026-11-27T14:00:00'],
    ['2026-11-27T09:00:30Z', '2026-11-27T09:00:30'],
    ['2026-11-27 09:00 UTC', '2026-11-27T09:00:00'],
    ['2026-11-27 09:00', '2026-11-27T09:00:00'],
    ['2026-11-27', '2026-11-27T00:00:00'],
  ]) {
    const { code, stderr, call } = await run(t, [start, '--dry-run']);
    assert.equal(code, 0, `${start}: ${stderr}`);
    assert.equal(flag(call('pr list')[0], '--search'), `merged:>=${iso}+00:00`, start);
  }
  // Unquoted, as several arguments.
  const { code, stdout, call } = await run(t, ['2026-11-27', '10:00:15', 'Europe/Berlin', '--dry-run']);
  assert.equal(code, 0);
  assert.equal(flag(call('issue list')[0], '--search'), 'closed:>=2026-11-27T09:00:15+00:00 reason:completed');
  assert.match(stdout, /^\*Status update: owner\/repo, 2026-11-27 09:00:15 UTC – /);
});

test('posts to SLACK_STATUS_CHANNEL with SLACK_BOT_TOKEN and chat.postMessage, prints the permalink', async (t) => {
  const dry = await run(t, ['2026-11-27 09:00', '--dry-run'], { prs: PRS, issues: ISSUES });
  const { code, stdout, stderr } = await run(t, ['2026-11-27 09:00'], { prs: PRS, issues: ISSUES });
  assert.equal(code, 0, stderr);
  assert.equal(stdout, `${PERMALINK}\n`);
  assert.match(stderr, /Posted to #my-status\./);
  const posts = received.filter((r) => r.method === 'chat.postMessage');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].authorization, 'Bearer xoxb-test');
  assert.equal(posts[0].body.channel, '#my-status');
  assert.equal(posts[0].body.unfurl_links, false);
  assert.equal(posts[0].body.text.replace(/ – .*\*\n/, ''), dry.stdout.trimEnd().replace(/ – .*\*\n/, ''), 'the dry run shows what is posted');
  const link = received.find((r) => r.method === 'chat.getPermalink')!;
  assert.equal(link.query.get('channel'), CHANNEL_ID);
  assert.equal(link.query.get('message_ts'), TS);
});

test("a channel ID works too; titles' &, < and > are escaped for Slack", async (t) => {
  const { code, stderr } = await run(t, ['2026-11-27'], { prs: [pr(7, 'Escape <b> & </b>', '2026-11-27T10:00:00Z')], env: { SLACK_STATUS_CHANNEL: CHANNEL_ID } });
  assert.equal(code, 0, stderr);
  const post = received.find((r) => r.method === 'chat.postMessage')!;
  assert.equal(post.body.channel, CHANNEL_ID);
  assert.match(post.body.text, /• <https:\/\/github\.com\/owner\/repo\/pull\/7\|#7> Escape &lt;b&gt; &amp; &lt;\/b&gt;\n/);
});

test('never the shared #my-ai-workshop: refused, exit 2, nothing posted', async (t) => {
  for (const channel of ['#my-ai-workshop', 'my-ai-workshop', ' #My-AI-Workshop ']) {
    const { code, stdout, stderr, calls } = await run(t, ['2026-11-27 09:00'], { env: { SLACK_STATUS_CHANNEL: channel } });
    assert.equal(code, 2, channel);
    assert.equal(stdout, '');
    assert.match(stderr, /SLACK_STATUS_CHANNEL is #my-ai-workshop, the shared channel: status updates go to your private channel\. Nothing posted\./);
    assert.equal(calls.length, 0);
  }
  assert.equal(received.length, 0);
});

test('no SLACK_STATUS_CHANNEL: exit 2, nothing posted', async (t) => {
  const { code, stderr, calls } = await run(t, ['2026-11-27 09:00'], { env: { SLACK_STATUS_CHANNEL: '' } });
  assert.equal(code, 2);
  assert.match(stderr, /SLACK_STATUS_CHANNEL is not set: set it to your private Slack channel\. Nothing posted\./);
  assert.equal(calls.length, 0);
  assert.equal(received.length, 0);
});

test('no SLACK_BOT_TOKEN: exit 3, nothing posted', async (t) => {
  const { code, stdout, stderr, calls } = await run(t, ['2026-11-27 09:00'], { env: { SLACK_BOT_TOKEN: '' } });
  assert.equal(code, 3);
  assert.equal(stdout, '');
  assert.match(stderr, /SLACK_BOT_TOKEN is not set\. Nothing posted\./);
  assert.equal(calls.length, 0);
  assert.equal(received.length, 0);
});

test("a start that can't be parsed, no start, an unknown option: exit 2, nothing posted", async (t) => {
  for (const start of ['yesterday', '2026-02-30', '2026-11-27 24:00', '27.11.2026 09:00', '2026-11-27 09:00 +25:00']) {
    const { code, stderr, calls } = await run(t, [start]);
    assert.equal(code, 2, start);
    assert.match(stderr, /^Can't parse the start "[^"]+": use YYYY-MM-DD HH:MM, then an optional timezone .* Nothing posted\.$/m, start);
    assert.equal(calls.length, 0);
  }
  const zone = await run(t, ['2026-11-27 09:00 Mars/Base']);
  assert.equal(zone.code, 2);
  assert.match(zone.stderr, /Unknown timezone "Mars\/Base"/);
  const none = await run(t, []);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /No start given/);
  const option = await run(t, ['2026-11-27', '--channel', 'x']);
  assert.equal(option.code, 2);
  assert.match(option.stderr, /Unknown option --channel/);
  assert.equal(received.length, 0);
});

test('Slack refuses (a bad token, no chat:write, the bot not in the channel): its reason and what it means, exit 1', async (t) => {
  for (const [error, meaning] of [
    ['invalid_auth', /SLACK_BOT_TOKEN is not a valid token/],
    ['missing_scope', /the token lacks the chat:write scope/],
    ['not_in_channel', /the bot is not in the channel: invite it there/],
    ['channel_not_found', /or it is private and the bot is not in it/],
  ] as const) {
    received.length = 0;
    postAnswer = { ok: false, error };
    const { code, stdout, stderr } = await run(t, ['2026-11-27 09:00']);
    assert.equal(code, 1, error);
    assert.equal(stdout, '');
    assert.match(stderr, new RegExp(`Slack refused the status update for #my-status: ${error} \\(`));
    assert.match(stderr, meaning);
    assert.match(stderr, /Nothing posted\./);
    assert.deepEqual(received.map((r) => r.method), ['chat.postMessage'], 'no permalink asked');
  }
});

test("Slack can't be reached: exit 1", async (t) => {
  const { code, stderr } = await run(t, ['2026-11-27 09:00'], { env: { SLACK_API_URL: 'http://127.0.0.1:1/api' } });
  assert.equal(code, 1);
  assert.match(stderr, /Slack could not be reached: .* Nothing posted\./);
});

test('gh fails: its message, exit 1, Slack not called', async (t) => {
  const { code, stdout, stderr } = await run(t, ['2026-11-27 09:00'], { env: { GH_STUB_FAIL: '1' } });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /gh failed: HTTP 401: Bad credentials\. Nothing posted\./);
  assert.equal(received.length, 0);
});

test('the skill: a dry run first, then post to SLACK_STATUS_CHANNEL, never #my-ai-workshop; on failure, tell the user', () => {
  assert.match(skill, /node \.agents\/skills\/status-update\/status-update\.mjs "<start>" --dry-run/);
  assert.match(skill, /\*\*UTC when none is given\*\*/);
  assert.match(skill, /\*\*inclusive\*\*/);
  assert.match(skill, /gh pr list --state merged --search "merged:>=<ISO time>"/);
  assert.match(skill, /gh issue list --state closed --search "closed:>=<ISO time> reason:completed"/);
  assert.match(skill, /`Nothing merged` \/ `No issues resolved`/);
  assert.match(skill, /`chat\.postMessage`, authenticating with the `SLACK_BOT_TOKEN`/);
  assert.match(skill, /\*\*`SLACK_STATUS_CHANNEL`\*\*: the\s+user's private channel/);
  assert.match(skill, /\*\*never `#my-ai-workshop`\*\*/);
  assert.match(skill, /\*\*Exit 0\*\*: the message's permalink is on stdout/);
  assert.match(skill, /\*\*Any other exit\*\*: nothing was posted[^]*don't retry with\s+another channel or token/);
});
