// Forwards one PR comment of the review chain (.agents/review-chain.md) to an Air webhook.
// Run by .github/workflows/review-chain.yml with the comment in the environment: BODY,
// REPOSITORY, PR, COMMENT_ID, COMMENT_URL, AUTHOR, and the webhooks REVIEW_URL/REVIEW_TOKEN and
// ADDRESS_URL/ADDRESS_TOKEN. DRY_RUN=1 prints the request instead of sending it.
import { pathToFileURL } from 'node:url';

/** Which automation a comment starts: `verdict` → address-review, `ready` → review-pr, or none. */
export function route(body) {
  if (/<!-- air-chain verdict=(approve|need-changes) /.test(body)) return 'verdict';
  const firstLine = body.split('\n', 1)[0].trim();
  if (/^ready for review[.!]?$/i.test(firstLine)) return 'ready';
  return null;
}

const WEBHOOKS = {
  verdict: { url: 'ADDRESS_URL', token: 'ADDRESS_TOKEN', secret: 'AIR_ADDRESS_WEBHOOK' },
  ready: { url: 'REVIEW_URL', token: 'REVIEW_TOKEN', secret: 'AIR_REVIEW_WEBHOOK' },
};

/** Forwards the comment in `env`; returns the line to log. */
export async function forward(env, fetchImpl = fetch) {
  const kind = route(env.BODY ?? '');
  if (!kind) return 'Not a review chain trigger; nothing to forward.';
  const payload = {
    kind,
    repository: env.REPOSITORY,
    pr: Number(env.PR),
    comment_id: Number(env.COMMENT_ID),
    comment_url: env.COMMENT_URL,
    author: env.AUTHOR,
  };
  const hook = WEBHOOKS[kind];
  const url = env[hook.url];
  const token = env[hook.token];
  if (!url || !token) {
    return `::notice::${hook.secret}_URL or ${hook.secret}_TOKEN is not set; not forwarding ${kind}: ${JSON.stringify(payload)}`;
  }
  if (env.DRY_RUN === '1') return `POST ${url} ${JSON.stringify(payload)}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => ({ ok: false, status: String(error) }));
    if (response.ok) return `Forwarded ${kind} for #${payload.pr} to the automation.`;
    if (attempt === 3) throw new Error(`Air webhook for ${kind} failed: ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await forward(process.env));
}
