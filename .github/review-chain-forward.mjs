// Moves the review chain (.agents/review-chain.md) one step on a GitHub event, so that no step waits
// for a person. Run by .github/workflows/review-chain.yml with the event in the environment:
//   EVENT=status               an `air-chain/review` status was set: CONTEXT, STATE, DESCRIPTION, TARGET_URL
//   EVENT=pull_request_target  a commit was pushed to a pull request: PR, HEAD_REPOSITORY
//   EVENT=pull_request_review  a review was submitted: PR, HEAD_SHA, REVIEW_BODY, REVIEW_AUTHOR,
//                              REVIEW_ASSOCIATION, REVIEW_COMMIT, REVIEW_HTML_URL
// and SHA, REPOSITORY, SENDER, GITHUB_TOKEN, the webhooks REVIEW_URL/REVIEW_TOKEN and
// ADDRESS_URL/ADDRESS_TOKEN. DRY_RUN=1 prints the requests instead of sending them.
import { pathToFileURL } from 'node:url';

export const CONTEXT = 'air-chain/review';
/** Ends the review that asks address-review to re-review a commit itself. */
export const READY_MARKER = '<!-- air-chain ready -->';
/** The agents' GitHub app: its reviews carry verdicts, as those of people with write access do. */
const AGENT = 'jetbrains-air[bot]';

/** Which automation a status starts: `verdict` → address-review, `ready` → review-pr, or none. */
export function route(context, state, description = '') {
  if (context !== CONTEXT) return null;
  if (state === 'success' && /^verdict: approve\b/i.test(description)) return 'verdict';
  if (state === 'failure' && /^verdict: need changes\b/i.test(description)) return 'verdict';
  if (state === 'pending' && /^ready for review\b/i.test(description)) return 'ready';
  return null;
}

/** The verdict a review's body states, as the status that says the same; null if it has none. */
export function verdict(body = '') {
  const found = /^\W*Verdict: (approve|need changes)\b[^\n]*/im.exec(body);
  if (!found) return null;
  const approve = found[1].toLowerCase() === 'approve';
  const tail = found[0].replace(/^\W*Verdict: (approve|need changes)\W*/i, '').replace(/\W+$/, '');
  const description = `Verdict: ${approve ? 'approve' : 'need changes'}${tail ? ` — ${tail}` : ''}`;
  return { state: approve ? 'success' : 'failure', description: description.slice(0, 140) };
}

const WEBHOOKS = {
  verdict: { url: 'ADDRESS_URL', token: 'ADDRESS_TOKEN', secret: 'AIR_ADDRESS_WEBHOOK' },
  ready: { url: 'REVIEW_URL', token: 'REVIEW_TOKEN', secret: 'AIR_REVIEW_WEBHOOK' },
};

const short = (sha) => (sha ?? '').slice(0, 7);

/** One GitHub API call on the repository, with the workflow's token. */
async function github(env, fetchImpl, method, path, body) {
  const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.REPOSITORY}/${path}`;
  if (env.DRY_RUN === '1' && method !== 'GET') {
    console.log(`${method} ${url} ${JSON.stringify(body)}`);
    return {};
  }
  const response = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'review-chain',
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path} failed: ${response.status}`);
  return response.json();
}

/** Sets the chain's status on a commit; the line to log. A failure is a warning, not the end. */
async function setStatus(env, fetchImpl, sha, status) {
  try {
    await github(env, fetchImpl, 'POST', `statuses/${sha}`, { context: CONTEXT, ...status });
    return `Set ${status.state} "${status.description}" on ${short(sha)}.`;
  } catch (error) {
    return `::warning::The ${CONTEXT} status of ${short(sha)} is not set: ${error.message}`;
  }
}

/** A review with a verdict on the PR's head → the same verdict as the commit's status. */
async function mirror(env, fetchImpl) {
  const status = verdict(env.REVIEW_BODY);
  if (!status) return 'The review has no verdict; nothing to set.';
  const trusted = env.REVIEW_AUTHOR === AGENT || ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(env.REVIEW_ASSOCIATION);
  if (!trusted) return `A verdict from ${env.REVIEW_AUTHOR} doesn't count; nothing to set.`;
  if (env.REVIEW_COMMIT !== env.HEAD_SHA) {
    return `The verdict is on ${short(env.REVIEW_COMMIT)}, not on the head ${short(env.HEAD_SHA)}; nothing to set.`;
  }
  return setStatus(env, fetchImpl, env.HEAD_SHA, { ...status, target_url: env.REVIEW_HTML_URL });
}

/** The open pull request whose head is `sha`, or undefined. */
async function pullRequestOf(env, fetchImpl, sha) {
  const pulls = await github(env, fetchImpl, 'GET', `commits/${sha}/pulls`);
  return pulls.find((pull) => pull.state === 'open' && pull.head?.sha === sha)?.number;
}

/** Handles the event in `env`; returns the lines to log. */
export async function forward(env, fetchImpl = fetch) {
  const event = env.EVENT || 'status';
  if (event === 'pull_request_review') return mirror(env, fetchImpl);

  const lines = [];
  const sha = env.SHA;
  let status = { state: env.STATE, description: (env.DESCRIPTION ?? '').trim(), target_url: env.TARGET_URL || null };
  let kind;
  if (event === 'pull_request_target') {
    // A push to a pull request: its new head is ready for review, whoever pushed it.
    if (env.HEAD_REPOSITORY && env.HEAD_REPOSITORY !== env.REPOSITORY) {
      return `#${env.PR} comes from a fork (${env.HEAD_REPOSITORY}); nothing to forward.`;
    }
    const server = env.GITHUB_SERVER_URL || 'https://github.com';
    status = { state: 'pending', description: 'Ready for review', target_url: `${server}/${env.REPOSITORY}/commit/${sha}` };
    kind = 'ready';
    lines.push(await setStatus(env, fetchImpl, sha, status));
  } else {
    kind = route(env.CONTEXT, status.state, status.description);
    if (!kind) return 'Not a review chain trigger; nothing to forward.';
  }

  const payload = { kind, repository: env.REPOSITORY, sha, ...status, sender: env.SENDER };
  const hook = WEBHOOKS[kind];
  const url = env[hook.url];
  const token = env[hook.token];
  if (url && token) {
    lines.push(await post(env, fetchImpl, url, token, payload));
  } else if (kind === 'ready' && env.GITHUB_TOKEN) {
    // No reviewer automation to reach: ask address-review, which a submitted review starts.
    const pr = env.PR || (await pullRequestOf(env, fetchImpl, sha));
    if (!pr) return [...lines, `No open pull request has ${short(sha)} as its head; nothing to review.`].join('\n');
    await github(env, fetchImpl, 'POST', `pulls/${pr}/reviews`, {
      commit_id: sha,
      event: 'COMMENT',
      body: `Ready for review: ${short(sha)}. No reviewer automation is wired (${hook.secret}_URL, ${hook.secret}_TOKEN), so address-review reviews this commit with review-pr and goes on from there.\n\n${READY_MARKER}`,
    });
    lines.push(`Asked address-review to review ${short(sha)} on #${pr}: ${hook.secret}_URL or ${hook.secret}_TOKEN is not set.`);
  } else {
    lines.push(`::notice::${hook.secret}_URL or ${hook.secret}_TOKEN is not set; not forwarding ${kind}: ${JSON.stringify(payload)}`);
  }
  return lines.join('\n');
}

/** Posts the payload to an Air webhook, three attempts; the line to log. */
async function post(env, fetchImpl, url, token, payload) {
  if (env.DRY_RUN === '1') return `POST ${url} ${JSON.stringify(payload)}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => ({ ok: false, status: String(error) }));
    if (response.ok) return `Forwarded ${payload.kind} for ${short(payload.sha)} to the automation.`;
    if (attempt === 3) throw new Error(`Air webhook for ${payload.kind} failed: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await forward(process.env));
}
