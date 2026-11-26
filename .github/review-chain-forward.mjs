// Forwards one `air-chain/review` commit status of the review chain (.agents/review-chain.md) to
// an Air webhook. Run by .github/workflows/review-chain.yml with the status in the environment:
// CONTEXT, STATE, DESCRIPTION, TARGET_URL, SHA, REPOSITORY, SENDER, and the webhooks
// REVIEW_URL/REVIEW_TOKEN and ADDRESS_URL/ADDRESS_TOKEN. DRY_RUN=1 prints the request instead.
import { pathToFileURL } from 'node:url';

export const CONTEXT = 'air-chain/review';

/** Which automation a status starts: `verdict` → address-review, `ready` → review-pr, or none. */
export function route(context, state, description = '') {
  if (context !== CONTEXT) return null;
  if (state === 'success' && /^verdict: approve\b/i.test(description)) return 'verdict';
  if (state === 'failure' && /^verdict: need changes\b/i.test(description)) return 'verdict';
  if (state === 'pending' && /^ready for review\b/i.test(description)) return 'ready';
  return null;
}

const WEBHOOKS = {
  verdict: { url: 'ADDRESS_URL', token: 'ADDRESS_TOKEN', secret: 'AIR_ADDRESS_WEBHOOK' },
  ready: { url: 'REVIEW_URL', token: 'REVIEW_TOKEN', secret: 'AIR_REVIEW_WEBHOOK' },
};

/** Forwards the status in `env`; returns the line to log. */
export async function forward(env, fetchImpl = fetch) {
  const description = (env.DESCRIPTION ?? '').trim();
  const kind = route(env.CONTEXT, env.STATE, description);
  if (!kind) return 'Not a review chain trigger; nothing to forward.';
  const payload = {
    kind,
    repository: env.REPOSITORY,
    sha: env.SHA,
    state: env.STATE,
    description,
    target_url: env.TARGET_URL || null,
    sender: env.SENDER,
  };
  const hook = WEBHOOKS[kind];
  const url = env[hook.url];
  const token = env[hook.token];
  if (!url || !token) {
    return `::notice::${hook.secret}_URL or ${hook.secret}_TOKEN is not set; not forwarding ${kind}: ${JSON.stringify(payload)}`;
  }
  const short = (payload.sha ?? '').slice(0, 7);
  if (env.DRY_RUN === '1') return `POST ${url} ${JSON.stringify(payload)}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => ({ ok: false, status: String(error) }));
    if (response.ok) return `Forwarded ${kind} for ${short} to the automation.`;
    if (attempt === 3) throw new Error(`Air webhook for ${kind} failed: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await forward(process.env));
}
