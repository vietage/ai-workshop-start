// The review chain's forwarder (.agents/review-chain.md, "Wiring"): which PR comment starts which
// Air automation, run as the workflow runs it, against a local webhook.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, test } from 'node:test';

const FORWARD = fileURLToPath(new URL('../.github/review-chain-forward.mjs', import.meta.url));
const skill = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../.agents/skills/${name}/SKILL.md`, import.meta.url)), 'utf8');

/** What the local webhook received, and the status it answers with. */
const received: { path: string; authorization?: string; body: unknown }[] = [];
let status = 200;
const server = createServer(async (request: IncomingMessage, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  received.push({ path: request.url ?? '', authorization: request.headers.authorization, body: JSON.parse(body) });
  response.writeHead(status).end();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const WEBHOOKS = {
  REVIEW_URL: `${base}/review`,
  REVIEW_TOKEN: 'review-token',
  ADDRESS_URL: `${base}/address`,
  ADDRESS_TOKEN: 'address-token',
};

/** `node .github/review-chain-forward.mjs` with a comment `body` on PR #9, as the workflow runs it. */
async function forward(body: string, env: Record<string, string> = WEBHOOKS) {
  received.length = 0;
  const { stdout } = await promisify(execFile)(process.execPath, [FORWARD], {
    env: {
      PATH: process.env.PATH,
      BODY: body,
      REPOSITORY: 'vietage/ai-workshop-start',
      PR: '9',
      COMMENT_ID: '123',
      COMMENT_URL: 'https://github.com/vietage/ai-workshop-start/pull/9#issuecomment-123',
      AUTHOR: 'jetbrains-air[bot]',
      ...env,
    },
  });
  return stdout.trim();
}

const payload = (kind: string) => ({
  kind,
  repository: 'vietage/ai-workshop-start',
  pr: 9,
  comment_id: 123,
  comment_url: 'https://github.com/vietage/ai-workshop-start/pull/9#issuecomment-123',
  author: 'jetbrains-air[bot]',
});

test('a verdict comment, approve or need changes → the address-review webhook, with its token', async () => {
  for (const verdict of ['approve', 'need-changes']) {
    const out = await forward(`**Verdict: ${verdict}**\n\nSummary.\n\n<!-- air-chain verdict=${verdict} head=6136092 -->`);
    assert.equal(out, 'Forwarded verdict for #9 to the automation.');
    assert.deepEqual(received, [{ path: '/address', authorization: 'ApiKey address-token', body: payload('verdict') }]);
  }
});

test('"Ready for review" as the first line, any case, from a person or the agent → the review-pr webhook', async () => {
  for (const body of ['Ready for review', '  ready for review.  \r\nplease', 'READY FOR REVIEW\n\n<!-- air-chain ready head=abc -->']) {
    assert.equal(await forward(body), 'Forwarded ready for #9 to the automation.');
    assert.deepEqual(received, [{ path: '/review', authorization: 'ApiKey review-token', body: payload('ready') }]);
  }
});

test('any other comment → nothing is forwarded', async () => {
  for (const body of [
    'Looks good, ready for review soon',
    'LGTM\nReady for review',
    'Needs a person\n\nThe loop guard.\n\n<!-- air-chain stop -->',
    'Fixed in abc1234.\n\n<!-- air-chain note -->',
    '**Verdict: approve**', // the visible line alone, without the marker
  ]) {
    assert.equal(await forward(body), 'Not a review chain trigger; nothing to forward.');
    assert.deepEqual(received, []);
  }
});

test('a missing webhook secret → a notice in the log, nothing sent, success', async () => {
  const out = await forward('Ready for review', { ADDRESS_URL: WEBHOOKS.ADDRESS_URL, ADDRESS_TOKEN: 'x' });
  assert.match(out, /^::notice::AIR_REVIEW_WEBHOOK_URL or AIR_REVIEW_WEBHOOK_TOKEN is not set; not forwarding ready: /);
  assert.deepEqual(received, []);
});

test('the webhook keeps failing → 3 attempts, then the workflow fails', async () => {
  status = 500;
  try {
    await assert.rejects(forward('Ready for review'), /Air webhook for ready failed: 500/);
    assert.equal(received.length, 3);
  } finally {
    status = 200;
  }
});

/** The comment template in a skill's SKILL.md that starts with `firstLine`. */
function template(name: string, firstLine: string) {
  const block = skill(name).match(new RegExp('```markdown\\n(' + firstLine.replace(/[*]/g, '\\*') + '\\n[\\s\\S]*?)```'));
  assert.ok(block, `${name} shows its "${firstLine}" comment`);
  return block[1];
}

test('the comments the skills post, as their SKILL.md shows them, start the automation the chain says', async () => {
  assert.equal(await forward(template('review-pr', '**Verdict: approve**')), 'Forwarded verdict for #9 to the automation.');
  assert.deepEqual(received.map((r) => r.path), ['/address']);
  assert.equal(await forward(template('address-review', 'Ready for review')), 'Forwarded ready for #9 to the automation.');
  assert.deepEqual(received.map((r) => r.path), ['/review']);
  assert.equal(await forward(template('address-review', 'Needs a person')), 'Not a review chain trigger; nothing to forward.');
  assert.deepEqual(received, []);
});
