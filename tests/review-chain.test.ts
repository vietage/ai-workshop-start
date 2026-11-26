// The review chain's forwarder (.agents/review-chain.md, "Wiring"): which commit status starts which
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

const SHA = '6136092a1b2c3d4e5f60718293a4b5c6d7e8f901';

/** `node .github/review-chain-forward.mjs` with a commit status, as the workflow runs it. */
async function forward(state: string, description: string, env: Record<string, string> = WEBHOOKS, context = 'air-chain/review') {
  received.length = 0;
  const { stdout } = await promisify(execFile)(process.execPath, [FORWARD], {
    env: {
      PATH: process.env.PATH,
      CONTEXT: context,
      STATE: state,
      DESCRIPTION: description,
      TARGET_URL: 'https://github.com/vietage/ai-workshop-start/pull/9#pullrequestreview-1',
      SHA,
      REPOSITORY: 'vietage/ai-workshop-start',
      SENDER: 'jetbrains-air[bot]',
      ...env,
    },
  });
  return stdout.trim();
}

const payload = (kind: string, state: string, description: string) => ({
  kind,
  repository: 'vietage/ai-workshop-start',
  sha: SHA,
  state,
  description,
  target_url: 'https://github.com/vietage/ai-workshop-start/pull/9#pullrequestreview-1',
  sender: 'jetbrains-air[bot]',
});

test('a verdict status, success "Verdict: approve" or failure "Verdict: need changes" → the address-review webhook, with its token', async () => {
  for (const [state, description] of [
    ['success', 'Verdict: approve'],
    ['failure', 'Verdict: need changes — 2 bug, 1 test'],
  ]) {
    assert.equal(await forward(state, description), 'Forwarded verdict for 6136092 to the automation.');
    assert.deepEqual(received, [{ path: '/address', authorization: 'ApiKey address-token', body: payload('verdict', state, description) }]);
  }
});

test('a pending "Ready for review" status, any case, from a person or the agent → the review-pr webhook', async () => {
  for (const description of ['Ready for review', 'ready for review — 3 fixed, 1 declined']) {
    assert.equal(await forward('pending', description), 'Forwarded ready for 6136092 to the automation.');
    assert.deepEqual(received, [{ path: '/review', authorization: 'ApiKey review-token', body: payload('ready', 'pending', description) }]);
  }
});

test('any other status → nothing is forwarded', async () => {
  for (const [state, description, context] of [
    ['error', 'Needs a person: the loop guard'],
    ['pending', 'Reviewing'],
    ['success', 'Ready for review'], // the description and the state must agree
    ['failure', 'Verdict: approve'],
    ['success', 'Verdict: approve', 'ci/test'], // another context
    ['pending', 'Ready for review', 'air-chain/other'],
  ]) {
    assert.equal(await forward(state, description, WEBHOOKS, context), 'Not a review chain trigger; nothing to forward.');
    assert.deepEqual(received, []);
  }
});

test('a missing webhook secret → a notice in the log, nothing sent, success', async () => {
  const out = await forward('pending', 'Ready for review', { ADDRESS_URL: WEBHOOKS.ADDRESS_URL, ADDRESS_TOKEN: 'x' });
  assert.match(out, /^::notice::AIR_REVIEW_WEBHOOK_URL or AIR_REVIEW_WEBHOOK_TOKEN is not set; not forwarding ready: /);
  assert.deepEqual(received, []);
});

test('the webhook keeps failing → 3 attempts, then the workflow fails', async () => {
  status = 500;
  try {
    await assert.rejects(forward('pending', 'Ready for review'), /Air webhook for ready failed: 500/);
    assert.equal(received.length, 3);
  } finally {
    status = 200;
  }
});

/** The `air-chain/review` statuses a skill's SKILL.md sets, as `[state, description]`. */
function statuses(name: string) {
  const found = [...skill(name).matchAll(/-f context=air-chain\/review -f state=(\w+) \\\n\s*-f description="([^"]*)"/g)];
  return found.map((m) => [m[1], m[2]] as const);
}

test('the statuses the skills set, as their SKILL.md shows them, start the automation the chain says', async () => {
  assert.deepEqual(statuses('review-pr'), [
    ['success', 'Verdict: approve'],
    ['failure', 'Verdict: need changes'],
  ]);
  for (const [state, description] of statuses('review-pr')) {
    assert.equal(await forward(state, description), 'Forwarded verdict for 6136092 to the automation.');
    assert.deepEqual(received.map((r) => r.path), ['/address']);
  }
  assert.deepEqual(statuses('address-review').map(([state]) => state), ['pending', 'error']);
  const [ready, stop] = statuses('address-review');
  assert.equal(await forward(...ready), 'Forwarded ready for 6136092 to the automation.');
  assert.deepEqual(received.map((r) => r.path), ['/review']);
  assert.equal(await forward(...stop), 'Not a review chain trigger; nothing to forward.');
  assert.deepEqual(received, []);
});
