// The local web view: one page and one JSON endpoint, over the same scan as the CLI. Each request
// scans again; only an organisation's scan stores anything, in the cache the CLI uses too.
import { createServer, type Server } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { parseGitHubOwner } from './core/github.ts';
import { firstSentence, skillLink } from './core/model.ts';
import type { OrganisationRepository, OrganisationResult, Progress } from './core/organisation.ts';
import { scan, type Source } from './core/scan.ts';
import { PAGE } from './web-page.ts';

export type WebOptions = {
  /** Opens what the user asked to scan, as the CLI does; `signal` stops its requests. */
  open(input: string, signal?: AbortSignal): Promise<Source>;
  /**
   * Scans every repository of a GitHub organisation, as the CLI does; `progress` as each one is
   * done; with `refresh`, every repository again, whatever the cache has; `signal` stops it.
   */
  scanOrganisation(input: string, progress?: Progress, refresh?: boolean, signal?: AbortSignal): Promise<OrganisationResult>;
};

/**
 * The scan as JSON: each skill with its first sentence, its link and its SKILL.md text; with a
 * filter, only the skills that match every word of it, and `total`, the count before the filter.
 */
export async function scanJson(input: string, { open, scanOrganisation }: WebOptions, filter?: string, progress?: Progress, refresh?: boolean, signal?: AbortSignal) {
  if (parseGitHubOwner(input)) {
    if (filter) throw new AtlasError('filter works on one repository, not on an organisation');
    return organisationJson(await scanOrganisation(input, progress, refresh, signal));
  }
  const source = await open(input, signal);
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
    repositories: repositories.map(repositoryJson),
    skills,
    warnings,
  };
}

/** One repository of an organisation: `null` for its commit and count until it is scanned, or when it failed. */
function repositoryJson({ name, url, commit, skillCount }: OrganisationRepository) {
  return { name, url, commit: commit ?? null, skillCount: skillCount ?? null };
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
    // cache=0: an organisation's repositories are all scanned again, as with --no-cache.
    const refresh = url.searchParams.get('cache') === '0';
    // The page gone, or its scan stopped: the scan stops too, and nothing more is written.
    const stop = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) stop.abort(new AtlasError('The scan was stopped'));
    });
    // stream=1: one JSON object a line, `{ progress }` as an organisation's repositories are done,
    // then `{ result }`, or `{ error }` once the lines have started; before that, as without it.
    let started = false;
    const line = (body: unknown) => {
      if (stop.signal.aborted) return;
      if (!started) response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
      started = true;
      response.write(JSON.stringify(body) + '\n');
    };
    const stream = url.searchParams.get('stream') === '1';
    // With 0, the organisation and its repositories, none scanned yet; then each repository done:
    // what the page keeps when its scan is stopped.
    const progress: Progress | undefined = stream
      ? (scanned, total, update) => {
          const found = !update ? {} : 'repository' in update ? { ...update, repository: repositoryJson(update.repository) } : { ...update, repositories: update.repositories.map(repositoryJson) };
          line({ progress: { scanned, total }, ...found });
        }
      : undefined;
    try {
      const result = await scanJson(repo, options, filter, progress, refresh, stop.signal);
      if (stop.signal.aborted) return;
      if (!stream) return json(200, result);
      line({ result });
      response.end();
    } catch (error) {
      if (stop.signal.aborted) return;
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
