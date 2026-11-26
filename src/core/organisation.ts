import { AtlasError, EmptyRepository } from './errors.ts';
import { listRepositories, openListed, type GitHubOptions, type ListedRepository } from './github.ts';
import { scan } from './scan.ts';

/** One repository of a scanned organisation: no commit or count when its scan failed. */
export type OrganisationRepository = {
  name: string;
  /** `https://github.com/<owner>/<repo>`. */
  url: string;
  /** The scanned commit, on the default branch. */
  commit?: string;
  skillCount?: number;
};

export type OrganisationResult = {
  organisation: { name: string; url: string };
  /** By skill count, the most first, then by name; the ones that failed last. */
  repositories: OrganisationRepository[];
  /** The skills of every repository counted. */
  skills: number;
  /** Each one starts with its repository's name; the cache's own, last, with `cache: `. */
  warnings: string[];
};

/** What scanning one repository gave, at a commit: what the cache keeps of it. */
export type CachedRepository = { commit: string; skillCount: number; warnings: string[] };

/**
 * The repositories already scanned, kept between scans: `src/cache.ts` keeps them in a SQLite
 * file. It never throws: what goes wrong is a warning, and the scan goes on without it.
 */
export type RepositoryCache = {
  /** What is kept of the repository, `<owner>/<repo>`, if anything. */
  get(id: string): CachedRepository | undefined;
  /** Keeps it, in place of what was kept of the repository. */
  set(id: string, entry: CachedRepository): void;
  /** Forgets the owner's repositories that are not among `ids`: deleted, archived, moved, now a fork. */
  prune(owner: string, ids: string[]): void;
  /** Ends its use; what went wrong with it, if anything, each a warning. */
  close(): string[];
};

/** How far a scan of an organisation has gone: `scanned` of its `total` repositories. */
export type Progress = (scanned: number, total: number) => void;

export type OrganisationOptions = GitHubOptions & {
  /** How many repositories are scanned at the same time. */
  concurrency?: number;
  /** Called with 0 once the repositories are listed, then each time one is done, whatever its outcome. */
  progress?: Progress;
  /**
   * Opens the cache of the repositories already scanned; called once the repositories are listed.
   * Without it, nothing is kept and every repository is scanned.
   */
  cache?: () => Promise<RepositoryCache>;
  /** Scans every repository again, whatever the cache has, and keeps the new results. */
  refresh?: boolean;
};

/**
 * Every repository of an organisation, or of a user, without the archived ones and the forks,
 * each scanned on its default branch by the same rules as one repository. A repository that fails,
 * whatever the error, is a warning, and the scan goes on.
 *
 * With a cache, a repository whose default branch is still at the commit it was scanned at is not
 * scanned again: its count and warnings come from the cache, after the one request for its commit.
 * The result is the same either way.
 */
export async function scanOrganisation(input: string, options: OrganisationOptions): Promise<OrganisationResult> {
  const owner = await listRepositories(input, options);
  const total = owner.repositories.length;
  let scanned = 0;
  options.progress?.(0, total);
  const cache = await options.cache?.();
  let results: Listed[];
  let cacheWarnings: string[] = [];
  try {
    results = await pool(owner.repositories, options.concurrency ?? 8, async (listed) => {
      const result = await scanListed(listed, options, cache);
      options.progress?.(++scanned, total);
      return result;
    });
    cache?.prune(owner.name, owner.repositories.map((repository) => repository.id));
  } finally {
    cacheWarnings = cache?.close() ?? [];
  }
  const repositories = sortRepositories(results.map((result) => result.repository));
  return {
    organisation: { name: owner.name, url: owner.url },
    repositories,
    skills: repositories.reduce((sum, repository) => sum + (repository.skillCount ?? 0), 0),
    // In the order of the repositories, whatever order the scans ended in; then the cache's own.
    warnings: [
      ...[...results]
        .sort((a, b) => repositories.indexOf(a.repository) - repositories.indexOf(b.repository))
        .flatMap((result) => result.warnings),
      ...cacheWarnings.map((warning) => `cache: ${warning}`),
    ],
  };
}

type Listed = { repository: OrganisationRepository; warnings: string[] };

/**
 * One repository of the organisation, on its default branch; never throws: a failure is a warning.
 * Its commit is always asked for; the rest only when the cache has nothing for that commit. Only a
 * repository scanned to the end is kept: a failed one is tried again by the next scan.
 */
async function scanListed(listed: ListedRepository, options: OrganisationOptions, cache?: RepositoryCache): Promise<Listed> {
  const url = `https://github.com/${listed.id}`;
  try {
    const { commit, source } = await openListed(listed, options);
    const kept = options.refresh ? undefined : cache?.get(listed.id);
    let entry = kept?.commit === commit ? kept : undefined;
    if (!entry) {
      const result = await scan(await source());
      entry = { commit, skillCount: result.total, warnings: result.warnings };
      cache?.set(listed.id, entry);
    }
    const warnings = entry.warnings.map((warning) => `${listed.name}: ${warning}`);
    return { repository: { name: listed.name, url, commit, skillCount: entry.skillCount }, warnings };
  } catch (error) {
    // No commit: no files, so no skills.
    if (error instanceof EmptyRepository) return { repository: { name: listed.name, url, skillCount: 0 }, warnings: [] };
    // Whatever the error, the other repositories are still scanned.
    const message = error instanceof AtlasError ? error.message : `Unexpected error: ${describe(error)}`;
    return { repository: { name: listed.name, url }, warnings: [`${listed.name}: not scanned: ${message}`] };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** By skill count, the most first, then by name in any case; the ones without a count last. */
export function sortRepositories(repositories: OrganisationRepository[]): OrganisationRepository[] {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const count = (repository: OrganisationRepository) => repository.skillCount ?? -1;
  return [...repositories].sort(
    (a, b) => count(b) - count(a) || compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name),
  );
}

/** `work` for every item, at most `limit` at the same time; the results in the items' order. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
