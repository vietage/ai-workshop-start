// The local web view: one page and one JSON endpoint, over the same scan as the CLI. Nothing is
// stored; each request scans again.
import { createServer, type Server } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { parseGitHubOwner } from './core/github.ts';
import { firstSentence, skillLink } from './core/model.ts';
import type { OrganisationResult, Progress } from './core/organisation.ts';
import { scan, type Source } from './core/scan.ts';
import { PAGE } from './web-page.ts';

export type WebOptions = {
  /** Opens what the user asked to scan, as the CLI does. */
  open(input: string): Promise<Source>;
  /** Scans every repository of a GitHub organisation, as the CLI does; `progress` as each one is done. */
  scanOrganisation(input: string, progress?: Progress): Promise<OrganisationResult>;
};

/**
 * The scan as JSON: each skill with its first sentence, its link and its SKILL.md text; with a
 * filter, only the skills that match every word of it, and `total`, the count before the filter.
 */
export async function scanJson(input: string, { open, scanOrganisation }: WebOptions, filter?: string, progress?: Progress) {
  if (parseGitHubOwner(input)) {
    if (filter) throw new AtlasError('filter works on one repository, not on an organisation');
    return organisationJson(await scanOrganisation(input, progress));
  }
  const source = await open(input);
  // Each file is read once: the text shown is the text the scan parsed.
  const texts = new Map<string, Promise<Uint8Array | undefined>>();
  const read = (path: string) => {
    if (!texts.has(path)) texts.set(path, source.read(path));
    return texts.get(path)!;
  };
  const result = await scan({ ...source, read }, { filter });
  const decoder = new TextDecoder();
  const skills = await Promise.all(
    result.skills.map(async (skill) => ({
      ...skill,
      summary: firstSentence(skill.description),
      link: skillLink(result.repository, skill),
      content: decoder.decode((await read(skill.path)) ?? new Uint8Array()),
    })),
  );
  return { repository: result.repository, skills, total: result.total, warnings: result.warnings };
}

/** An organisation: its repositories, each with its commit and its skill count; null for the ones that failed. */
function organisationJson({ organisation, repositories, skills, warnings }: OrganisationResult) {
  return {
    organisation,
    repositories: repositories.map(({ name, url, commit, skillCount }) => ({ name, url, commit: commit ?? null, skillCount: skillCount ?? null })),
    skills,
    warnings,
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createWebServer(options: WebOptions): Server {
  return createServer(async (request, response) => {
    const send = (status: number, type: string, body: string) => {
      response.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(body);
    };
    const json = (status: number, body: unknown) => send(status, 'application/json', JSON.stringify(body));
    // Only pages opened as localhost: another host name pointed at this machine reads nothing.
    const host = (request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!LOCAL_HOSTS.has(host)) return json(403, { error: 'Only http://localhost is served' });
    if (request.method !== 'GET') return json(405, { error: 'Only GET' });
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      return json(400, { error: 'Not a valid request target' });
    }
    if (url.pathname === '/') return send(200, 'text/html', PAGE);
    if (url.pathname !== '/api/scan') return json(404, { error: `Not found: ${url.pathname}` });
    const repo = url.searchParams.get('repo')?.trim();
    if (!repo) return json(400, { error: 'Enter a GitHub URL or a directory' });
    const filter = url.searchParams.get('filter')?.trim() || undefined;
    // stream=1: one JSON object a line, `{ progress }` as an organisation's repositories are done,
    // then `{ result }`, or `{ error }` once the lines have started; before that, as without it.
    let started = false;
    const line = (body: unknown) => {
      if (!started) response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
      started = true;
      response.write(JSON.stringify(body) + '\n');
    };
    const stream = url.searchParams.get('stream') === '1';
    const progress = stream ? (scanned: number, total: number) => line({ progress: { scanned, total } }) : undefined;
    try {
      const result = await scanJson(repo, options, filter, progress);
      if (!stream) return json(200, result);
      line({ result });
      response.end();
    } catch (error) {
      const message = error instanceof AtlasError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
      if (started) {
        line({ error: message });
        return response.end();
      }
      json(error instanceof AtlasError ? 400 : 500, { error: message });
    }
  });
}

/** Listens on localhost; resolves with the page's address. */
export function serve(options: WebOptions & { port: number }): Promise<{ server: Server; url: string }> {
  const server = createWebServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'EADDRINUSE' ? new AtlasError(`Port ${options.port} is in use; try --port <port>`) : error),
    );
    server.listen(options.port, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({ server, url: `http://localhost:${port}` });
    });
  });
}
