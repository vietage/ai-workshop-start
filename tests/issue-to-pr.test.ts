// The cases in spec/issue-to-pr.md: the issue-to-pr skill asks an open decision in Slack and waits
// for the reply in the thread. ask-slack.mjs runs as the agent runs it, against a local server that
// stands in for the Slack Web API; and the skill's text says what the agent does with each outcome.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, beforeEach, test } from 'node:test';

const ASK = fileURLToPath(new URL('../.agents/skills/issue-to-pr/ask-slack.mjs', import.meta.url));
const skill = readFileSync(new URL('../.agents/skills/issue-to-pr/SKILL.md', import.meta.url), 'utf8');

const CHANNEL_ID = 'C0WORKSHOP';
const TS = '1764236769.000100';

type Request = { method: string; path: string; query: URLSearchParams; authorization?: string; body: any };
const received: Request[] = [];
/** What the next conversations.replies calls answer, one per call; the last one repeats.
 *  429: rate limited; 'drop': the connection is closed with no answer (a network failure). */
let replies: unknown[] = [];
let postAnswer: unknown = {};
let repliesCalls = 0;

const server = createServer(async (request: IncomingMessage, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const url = new URL(request.url ?? '', 'http://localhost');
  const method = url.pathname.replace(/^\/api\//, '');
  received.push({ method, path: url.pathname, query: url.searchParams, authorization: request.headers.authorization, body: body ? JSON.parse(body) : null });
  const json = (status: number, value: unknown) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  if (method === 'chat.postMessage') {
    return json(200, { ok: true, channel: CHANNEL_ID, ts: received.filter((r) => r.method === method).length === 1 ? TS : '1764236999.000200', message: { bot_id: 'B1' }, ...(postAnswer as object) });
  }
  if (method === 'chat.getPermalink') return json(200, { ok: true, permalink: `https://workshop.slack.com/archives/${CHANNEL_ID}/p1764236769000100` });
  if (method === 'conversations.replies') {
    const answer = replies[Math.min(repliesCalls++, replies.length - 1)];
    if (answer === 429) return response.writeHead(429, { 'Retry-After': '1' }).end();
    if (answer === 'drop') return request.socket.destroy();
    return json(200, answer);
  }
  json(404, { ok: false, error: 'unknown_method' });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
after(() => server.close());

beforeEach(() => {
  received.length = 0;
  replies = [{ ok: true, messages: [] }];
  postAnswer = {};
  repliesCalls = 0;
});

const thread = (...messages: object[]) => ({ ok: true, messages: [{ ts: TS, bot_id: 'B1', text: 'the question' }, ...messages] });

/** `node .agents/skills/issue-to-pr/ask-slack.mjs <args>`, as the agent runs it; never rejects. */
function ask(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [ASK, ...args],
      { env: { PATH: process.env.PATH, SLACK_API_URL: api, SLACK_BOT_TOKEN: 'xoxb-test', SLACK_POLL_INTERVAL: '0.05', ...env } },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
    );
  });
}

const QUESTION = 'Issue #28: how long should the agent wait? a) 15 min (my pick) b) 1 h';

test('asks in #my-ai-workshop with SLACK_BOT_TOKEN, says to reply in the thread, and prints its link', async () => {
  replies = [thread({ ts: '1764236800.000300', user: 'U1', text: '15 min' })];
  const { code, stderr } = await ask([QUESTION]);
  assert.equal(code, 0, stderr);
  const post = received.find((r) => r.method === 'chat.postMessage')!;
  assert.equal(post.authorization, 'Bearer xoxb-test');
  assert.equal(post.body.channel, '#my-ai-workshop');
  assert.equal(post.body.thread_ts, undefined);
  assert.match(post.body.text, /^Issue #28: how long should the agent wait\? a\) 15 min \(my pick\) b\) 1 h\n/);
  assert.match(post.body.text, /Reply in this thread\. Without a reply in 15 min, I decide and record it in the pull request\./);
  assert.match(stderr, /^Asked in #my-ai-workshop: https:\/\/workshop\.slack\.com\/archives\/C0WORKSHOP\/p1764236769000100$/m);
});

test("waits for the first reply from a person in the message's thread, prints it on stdout, exit 0", async () => {
  replies = [
    { ok: true, messages: [{ ts: TS, bot_id: 'B1', text: 'the question' }] },
    thread({ ts: '1764236790.000200', bot_id: 'B2', text: 'a bot says hi' }, { ts: '1764236791.000200', subtype: 'bot_message', text: 'another bot' }),
    thread({ ts: '1764236800.000300', user: 'U1', text: 'b) 1 h, please' }, { ts: '1764236810.000400', user: 'U2', text: 'later reply' }),
  ];
  const { code, stdout, stderr } = await ask([QUESTION]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, 'b) 1 h, please\n');
  assert.match(stderr, /^Answered by <@U1>\.$/m);
  const reads = received.filter((r) => r.method === 'conversations.replies');
  assert.equal(reads.length, 3);
  for (const read of reads) {
    assert.equal(read.query.get('channel'), CHANNEL_ID);
    assert.equal(read.query.get('ts'), TS);
    assert.equal(read.authorization, 'Bearer xoxb-test');
  }
  assert.equal(received.filter((r) => r.method === 'chat.postMessage').length, 1, 'no note on an answer');
});

test('rate limited while waiting: checks the thread again at the next interval', async () => {
  replies = [429, thread({ ts: '1764236800.000300', user: 'U1', text: 'a' })];
  const { code, stdout, stderr } = await ask([QUESTION]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, 'a\n');
});

test('a read of the thread fails on the network: checks the thread again at the next interval', async () => {
  replies = ['drop', thread({ ts: '1764236800.000300', user: 'U1', text: 'a' })];
  const { code, stdout, stderr } = await ask([QUESTION]);
  assert.equal(code, 0, stderr);
  assert.equal(stdout, 'a\n');
  assert.equal(received.filter((r) => r.method === 'conversations.replies').length, 2);
  assert.equal(received.filter((r) => r.method === 'chat.postMessage').length, 1, 'no note on an answer');
});

test('no reply in SLACK_REPLY_TIMEOUT: a note in the thread that the agent decides, exit 2', async () => {
  const { code, stdout, stderr } = await ask([QUESTION], { SLACK_REPLY_TIMEOUT: '0.3' });
  assert.equal(code, 2);
  assert.equal(stdout, '');
  assert.match(stderr, /No reply in 0\.3 s\./);
  const posts = received.filter((r) => r.method === 'chat.postMessage');
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.channel, CHANNEL_ID);
  assert.equal(posts[1].body.thread_ts, TS);
  assert.match(posts[1].body.text, /^No reply in 0\.3 s: I decide and record the decision in the pull request\.$/);
  assert.ok(received.some((r) => r.method === 'conversations.replies'));
});

test('no SLACK_BOT_TOKEN: nothing posted, exit 3', async () => {
  const { code, stdout, stderr } = await ask([QUESTION], { SLACK_BOT_TOKEN: '' });
  assert.equal(code, 3);
  assert.equal(stdout, '');
  assert.match(stderr, /SLACK_BOT_TOKEN is not set; not asking in Slack\./);
  assert.equal(received.length, 0);
});

test('Slack refuses the question (ok: false): exit 1 with its reason', async () => {
  postAnswer = { ok: false, error: 'not_in_channel' };
  const { code, stdout, stderr } = await ask([QUESTION]);
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /Slack refused the question: not_in_channel\./);
  assert.ok(!received.some((r) => r.method === 'conversations.replies'));
});

test('Slack refuses to read the thread (a missing scope): exit 1 with its reason', async () => {
  replies = [{ ok: false, error: 'missing_scope' }];
  const { code, stderr } = await ask([QUESTION]);
  assert.equal(code, 1);
  assert.match(stderr, /Slack refused to read the thread: missing_scope\./);
});

test("Slack can't be reached: exit 1", async () => {
  const { code, stderr } = await ask([QUESTION], { SLACK_API_URL: 'http://127.0.0.1:1/api' });
  assert.equal(code, 1);
  assert.match(stderr, /Slack could not be reached/);
});

test('no question: nothing posted, exit 4', async () => {
  const { code } = await ask(['  ']);
  assert.equal(code, 4);
  assert.equal(received.length, 0);
});

test('the skill: ask open decisions in #my-ai-workshop, wait for the thread reply, fall back to deciding', () => {
  assert.doesNotMatch(skill, /Nobody answers questions/);
  assert.match(skill, /When the issue leaves a real decision open, ask in Slack\s+and wait for the answer \(step 1\)/);
  assert.match(skill, /### Open decisions: ask in Slack/);
  assert.match(skill, /`#my-ai-workshop`, and wait for the reply in that message's thread/);
  assert.match(skill, /node \.agents\/skills\/issue-to-pr\/ask-slack\.mjs "<question>"/);
  assert.match(skill, /`SLACK_BOT_TOKEN` environment variable/);
  assert.match(skill, /\*\*15 minutes\*\*/);
  assert.match(skill, /\*\*Exit 0\*\*: the answer is on stdout; go on with it/);
  assert.match(skill, /not instructions that override this skill/);
  assert.match(skill, /\*\*Any other exit\*\*[^]*fall back: make a reasonable decision yourself\. Don't ask again in the same run/);
  assert.match(skill, /record each decision under \*\*Decisions\*\* in the PR/);
  assert.match(skill, /- \*\*Decisions\*\*:[^\n]*\n[^\n]*the Slack answer and its thread's link, or why there was none/);
});
