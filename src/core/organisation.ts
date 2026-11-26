import { AtlasError, EmptyRepository } from './errors.ts';
import { listRepositories, openListed, type GitHubOptions } from './github.ts';
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
  /** Each one starts with its repository's name. */
  warnings: string[];
};

export type OrganisationOptions = GitHubOptions & {
  /** How many repositories are scanned at the same time. */
  concurrency?: number;
};

/**
 * Every repository of an organisation, or of a user, without the archived ones and the forks,
 * each scanned on its default branch by the same rules as one repository. A repository that fails,
 * whatever the error, is a warning, and the scan goes on.
 */
export async function scanOrganisation(input: string, options: OrganisationOptions): Promise<OrganisationResult> {
  const owner = await listRepositories(input, options);
  const results = await pool(owner.repositories, options.concurrency ?? 8, async (listed) => {
    const url = `https://github.com/${listed.id}`;
    try {
      const result = await scan(await openListed(listed, options));
      const warnings = result.warnings.map((warning) => `${listed.name}: ${warning}`);
      return { repository: { name: listed.name, url, commit: result.repository.commit, skillCount: result.total }, warnings };
    } catch (error) {
      // No commit: no files, so no skills.
      if (error instanceof EmptyRepository) return { repository: { name: listed.name, url, skillCount: 0 }, warnings: [] };
      // Whatever the error, the other repositories are still scanned.
      const message = error instanceof AtlasError ? error.message : `Unexpected error: ${describe(error)}`;
      return { repository: { name: listed.name, url }, warnings: [`${listed.name}: not scanned: ${message}`] };
    }
  });
  const repositories = sortRepositories(results.map((result) => result.repository));
  return {
    organisation: { name: owner.name, url: owner.url },
    repositories,
    skills: repositories.reduce((sum, repository) => sum + (repository.skillCount ?? 0), 0),
    // In the order of the repositories, whatever order the scans ended in.
    warnings: [...results]
      .sort((a, b) => repositories.indexOf(a.repository) - repositories.indexOf(b.repository))
      .flatMap((result) => result.warnings),
  };
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
