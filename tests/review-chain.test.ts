// The review chain's workflow script (.agents/review-chain.md, "Wiring"): which GitHub event sets
// which status and starts which Air automation, run as the workflow runs it, against a local
// server that stands in for the Air webhooks and the GitHub API.
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

/** What the local server received, the status it answers with, and the open PRs GitHub knows. */
const received: { path: string; authorization?: string; body: unknown }[] = [];
let status = 200;
let statusesRefused = false;
let pulls: unknown[] = [];
const server = createServer(async (request: IncomingMessage, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const path = request.url ?? '';
  received.push({ path, authorization: request.headers.authorization, body: body ? JSON.parse(body) : null });
  if (statusesRefused && path.includes('/statuses/')) return response.writeHead(403).end('{}');
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(path.endsWith('/pulls') ? pulls : {}));
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
      GITHUB_API_URL: `${base}/api`,
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

test('a verdict status and no address-review webhook → a notice in the log, nothing sent, success', async () => {
  const out = await forward('success', 'Verdict: approve', { REVIEW_URL: WEBHOOKS.REVIEW_URL, REVIEW_TOKEN: 'x', GITHUB_TOKEN: 'gh' });
  assert.match(out, /^::notice::AIR_ADDRESS_WEBHOOK_URL or AIR_ADDRESS_WEBHOOK_TOKEN is not set; not forwarding verdict: /);
  assert.deepEqual(received, []);
});

const REPO = '/api/repos/vietage/ai-workshop-start';
const READY = { context: 'air-chain/review', state: 'pending', description: 'Ready for review', target_url: `https://github.com/vietage/ai-workshop-start/commit/${SHA}` };
/** A push to pull request #23: the `pull_request_target` `synchronize` event. */
const PUSH = { EVENT: 'pull_request_target', PR: '23', HEAD_REPOSITORY: 'vietage/ai-workshop-start', GITHUB_TOKEN: 'gh', CONTEXT: '', STATE: '', DESCRIPTION: '', TARGET_URL: '' };
/** The review that asks address-review to review the commit itself. */
const readyReview = (path: string) => {
  const [review] = received.filter((r) => r.path === path);
  const body = review.body as { commit_id: string; event: string; body: string };
  assert.equal(review.authorization, 'Bearer gh');
  assert.equal(body.commit_id, SHA);
  assert.equal(body.event, 'COMMENT');
  assert.match(body.body, /^Ready for review: 6136092\. .*\n\n<!-- air-chain ready -->$/s);
  assert.doesNotMatch(body.body, /Verdict:/); // a request to review is never read as a verdict
};

test('a push to a pull request → status pending "Ready for review" on the new head, and the review-pr webhook', async () => {
  const out = await forward('', '', { ...WEBHOOKS, ...PUSH });
  assert.equal(out, 'Set pending "Ready for review" on 6136092.\nForwarded ready for 6136092 to the automation.');
  assert.deepEqual(received, [
    { path: `${REPO}/statuses/${SHA}`, authorization: 'Bearer gh', body: READY },
    { path: '/review', authorization: 'ApiKey review-token', body: { kind: 'ready', repository: 'vietage/ai-workshop-start', sha: SHA, state: 'pending', description: 'Ready for review', target_url: READY.target_url, sender: 'jetbrains-air[bot]' } },
  ]);
});

test('a push to a pull request, no review-pr webhook → the status, and a review that asks address-review to review the commit', async () => {
  const out = await forward('', '', PUSH);
  assert.equal(out, 'Set pending "Ready for review" on 6136092.\nAsked address-review to review 6136092 on #23: AIR_REVIEW_WEBHOOK_URL or AIR_REVIEW_WEBHOOK_TOKEN is not set.');
  assert.deepEqual(received.map((r) => r.path), [`${REPO}/statuses/${SHA}`, `${REPO}/pulls/23/reviews`]);
  readyReview(`${REPO}/pulls/23/reviews`);
});

test('a push to a pull request, the status refused → a warning, and the review still starts', async () => {
  statusesRefused = true;
  try {
    const out = await forward('', '', PUSH);
    assert.match(out, /^::warning::The air-chain\/review status of 6136092 is not set: .* 403\nAsked address-review to review 6136092 on #23: /);
    readyReview(`${REPO}/pulls/23/reviews`);
  } finally {
    statusesRefused = false;
  }
});

test('a push to a pull request from a fork → nothing set, nothing forwarded', async () => {
  const out = await forward('', '', { ...WEBHOOKS, ...PUSH, HEAD_REPOSITORY: 'someone/ai-workshop-start' });
  assert.equal(out, '#23 comes from a fork (someone/ai-workshop-start); nothing to forward.');
  assert.deepEqual(received, []);
});

test('a "Ready for review" status set by hand, no review-pr webhook → the review on the open PR whose head the commit is', async () => {
  pulls = [
    { number: 7, state: 'closed', head: { sha: SHA } },
    { number: 8, state: 'open', head: { sha: 'another' } },
    { number: 9, state: 'open', head: { sha: SHA } },
  ];
  try {
    const out = await forward('pending', 'Ready for review', { GITHUB_TOKEN: 'gh' });
    assert.equal(out, 'Asked address-review to review 6136092 on #9: AIR_REVIEW_WEBHOOK_URL or AIR_REVIEW_WEBHOOK_TOKEN is not set.');
    assert.deepEqual(received.map((r) => r.path), [`${REPO}/commits/${SHA}/pulls`, `${REPO}/pulls/9/reviews`]);
    readyReview(`${REPO}/pulls/9/reviews`);

    pulls = [{ number: 7, state: 'closed', head: { sha: SHA } }];
    assert.equal(await forward('pending', 'Ready for review', { GITHUB_TOKEN: 'gh' }), 'No open pull request has 6136092 as its head; nothing to review.');
    assert.deepEqual(received.map((r) => r.path), [`${REPO}/commits/${SHA}/pulls`]);
  } finally {
    pulls = [];
  }
});

/** A review submitted on pull request #23: the `pull_request_review` `submitted` event. */
const review = (body: string, env: Record<string, string> = {}) =>
  forward('', '', {
    ...WEBHOOKS,
    EVENT: 'pull_request_review',
    PR: '23',
    HEAD_SHA: SHA,
    REVIEW_BODY: body,
    REVIEW_AUTHOR: 'jetbrains-air[bot]',
    REVIEW_ASSOCIATION: 'NONE',
    REVIEW_COMMIT: SHA,
    REVIEW_HTML_URL: 'https://github.com/vietage/ai-workshop-start/pull/23#pullrequestreview-2',
    GITHUB_TOKEN: 'gh',
    ...env,
  });

test('a review with a verdict on the head, from the agent or a person with write access → the same verdict as the status, nothing forwarded', async () => {
  for (const [body, env, state, description] of [
    ['**Verdict: approve**\nAdds a cache.\nChecks: typecheck ✅', {}, 'success', 'Verdict: approve'],
    ['**Verdict: need changes** — 2 bug, 1 test\nThe cache is never read.', {}, 'failure', 'Verdict: need changes — 2 bug, 1 test'],
    ['Looks right.\n\nVerdict: approve', { REVIEW_AUTHOR: 'vietage', REVIEW_ASSOCIATION: 'OWNER' }, 'success', 'Verdict: approve'],
  ] as const) {
    assert.equal(await review(body, env), `Set ${state} "${description}" on 6136092.`);
    assert.deepEqual(received, [
      { path: `${REPO}/statuses/${SHA}`, authorization: 'Bearer gh', body: { context: 'air-chain/review', state, description, target_url: 'https://github.com/vietage/ai-workshop-start/pull/23#pullrequestreview-2' } },
    ]);
  }
});

test('any other review → no status: no verdict, an author without write access, a commit that is not the head', async () => {
  for (const [body, env, line] of [
    ['', {}, 'The review has no verdict; nothing to set.'], // a reply in a thread
    ['Ready for review: 6136092.\n\n<!-- air-chain ready -->', { REVIEW_AUTHOR: 'github-actions[bot]' }, 'The review has no verdict; nothing to set.'],
    ['Verdict: approve', { REVIEW_AUTHOR: 'someone', REVIEW_ASSOCIATION: 'CONTRIBUTOR' }, "A verdict from someone doesn't count; nothing to set."],
    ['Verdict: approve', { REVIEW_COMMIT: 'e17f3a222330c9b595fc9909569430e360f6be3c' }, 'The verdict is on e17f3a2, not on the head 6136092; nothing to set.'],
  ] as const) {
    assert.equal(await review(body, env), line);
    assert.deepEqual(received, []);
  }
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
  // The only status address-review sets hands a PR to a person. "Ready for review" on its fix is
  // the workflow's to set, on the push, which may come only after the run ended.
  assert.deepEqual(statuses('address-review').map(([state]) => state), ['error']);
  const [stop] = statuses('address-review');
  assert.match(stop[1], /^Needs a person: /);
  assert.equal(await forward(...stop), 'Not a review chain trigger; nothing to forward.');
  assert.deepEqual(received, []);
});

test('the claim: a PR comment both skills read the same way, live for 2 hours', () => {
  const live = 'select((.body | contains("<!-- air-chain claim -->")) and (.updated_at | fromdateiso8601) > now - 7200)';
  for (const name of ['address-review', 'review-pr']) assert.ok(skill(name).includes(live), `${name} reads claims as live`);
  // address-review posts its claim as a comment with the marker, not as a commit status.
  assert.match(skill('address-review'), /issues\/\$pr\/comments" -f body="Addressing review at [^"]*\n\n<!-- air-chain claim -->"/);
  assert.doesNotMatch(skill('address-review'), /description="Addressing review/);
});

test('the hand-over: no skill ends by asking a person to set a status; the push and the review carry it', () => {
  const address = skill('address-review');
  // The request to review a pushed commit: the marker the workflow posts is the one the skill reads.
  assert.ok(readFileSync(FORWARD, 'utf8').includes("READY_MARKER = '<!-- air-chain ready -->'"));
  assert.ok(address.includes('whose body ends with `<!-- air-chain ready -->`'));
  // address-review releases its claim with what it addressed, then pushes, as the last thing it does.
  const release = address.indexOf('-f body="Done: addressed ${head::7} in ${sha::7}, its push starts the re-review');
  assert.ok(release > 0 && address.indexOf('\ngit push', release) > release, 'the claim is released before the push');
  assert.equal(address.match(/^git push/gm)?.length, 1);
  assert.ok(address.includes('a note `Done: addressed <short $head> in …` exists'));
  // A round with nothing to change still ends with a commit to push.
  assert.ok(address.includes('git commit --allow-empty -m "Address review: no change"'));
  // Neither skill waits in its run for a verdict on a commit it pushed.
  for (const name of ['address-review', 'review-pr']) {
    assert.doesNotMatch(skill(name), /poll for|No verdict after|in the same run, by one/i, name);
  }
});
