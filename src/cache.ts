// The cache of an organisation's repositories already scanned: one SQLite file on the user's
// machine, outside the repository. The core decides what is kept and when it is used
// (core/organisation.ts); this is only where it is kept.
import { closeSync, mkdirSync, openSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { CachedRepository, RepositoryCache } from './core/organisation.ts';

/** The schema's version, in the file's `user_version`: a file of another version is emptied. */
export const CACHE_VERSION = 1;

const SCHEMA = `CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  skill_count INTEGER NOT NULL,
  warnings TEXT NOT NULL,
  scanned_at TEXT NOT NULL
)`;

/**
 * Where the cache is: `SKILL_ATLAS_CACHE`, a file, when set; else `skill-atlas/cache.db` in
 * `XDG_CACHE_HOME` (an absolute path, as its specification asks), else in `~/.cache`.
 */
export function cachePath(env: Record<string, string | undefined> = process.env): string {
  if (env.SKILL_ATLAS_CACHE) return resolve(env.SKILL_ATLAS_CACHE);
  const base = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(homedir(), '.cache');
  return join(base, 'skill-atlas', 'cache.db');
}

/**
 * Opens the cache, creating the file and its directory on first use. It never throws, and neither
 * does what it returns: a cache that cannot be opened, read or written keeps nothing, and says why
 * once, when closed. A file that is not a database, or a damaged one, is moved to `<file>.corrupt`
 * and a new one created; one of another schema version is emptied.
 */
export async function openCache(file: string = cachePath()): Promise<RepositoryCache> {
  const warnings: string[] = [];
  let database: DatabaseSync | undefined;
  try {
    database = await open(file, warnings);
  } catch (error) {
    warnings.push(`not used: ${describe(error)}`);
  }
  let failed = false;
  /** What `work` gives, or undefined when there is no database or it fails; the first failure is a warning. */
  const attempt = <T>(what: string, work: (database: DatabaseSync) => T): T | undefined => {
    if (!database) return undefined;
    try {
      return work(database);
    } catch (error) {
      if (!failed) warnings.push(`not ${what}: ${describe(error)}`);
      failed = true;
      return undefined;
    }
  };
  return {
    get: (id) =>
      attempt('read', (database) => {
        const row = database.prepare('SELECT commit_sha, skill_count, warnings FROM repositories WHERE id = ?').get(id);
        return row && entry(row);
      }),
    set: (id, { commit, skillCount, warnings }) => {
      attempt('saved', (database) =>
        database
          .prepare('INSERT OR REPLACE INTO repositories (id, owner, commit_sha, skill_count, warnings, scanned_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, id.split('/')[0], commit, skillCount, JSON.stringify(warnings), new Date().toISOString()),
      );
    },
    prune: (owner, ids) => {
      attempt('saved', (database) =>
        database
          .prepare('DELETE FROM repositories WHERE owner = ? COLLATE NOCASE AND id NOT IN (SELECT value FROM json_each(?))')
          .run(owner, JSON.stringify(ids)),
      );
    },
    close: () => {
      try {
        database?.close();
      } catch {
        // Nothing to keep from a cache that does not close.
      }
      database = undefined;
      return warnings;
    },
  };
}

/** A row as an entry; undefined, as if not kept, for one that does not look like what `set` wrote. */
function entry(row: Record<string, unknown>): CachedRepository | undefined {
  let warnings: unknown;
  try {
    warnings = JSON.parse(String(row.warnings));
  } catch {
    return undefined;
  }
  if (typeof row.commit_sha !== 'string' || !row.commit_sha || !Number.isInteger(row.skill_count) || Number(row.skill_count) < 0) return undefined;
  if (!Array.isArray(warnings) || !warnings.every((warning) => typeof warning === 'string')) return undefined;
  return { commit: row.commit_sha, skillCount: Number(row.skill_count), warnings };
}

async function open(file: string, warnings: string[]): Promise<DatabaseSync> {
  const sqlite = await loadSqlite();
  // Two scans at the same time, the CLI and the web view: one waits for the other's write.
  const connect = () => {
    create(file);
    return prepare(new sqlite.DatabaseSync(file, { timeout: 2000 }));
  };
  try {
    return connect();
  } catch (error) {
    if (!isCorrupt(error)) throw error;
    // Moved, not deleted: `SKILL_ATLAS_CACHE` may point at a file that was never a cache.
    renameSync(file, `${file}.corrupt`);
    warnings.push(`${file} was not a readable database: moved to ${file}.corrupt, and a new cache created`);
    return connect();
  }
}

/** The file and its directory, for the user only: the results of private repositories may be in it. */
function create(file: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  closeSync(openSync(file, 'a', 0o600));
}

/** The database with the schema of this version; closed again if it cannot be read. */
function prepare(database: DatabaseSync): DatabaseSync {
  try {
    const check = database.prepare('PRAGMA quick_check').get();
    if (check?.quick_check !== 'ok') throw new CorruptCache(String(check?.quick_check));
    // One transaction: another scan starting at the same time sees the old schema or the new one.
    database.exec('BEGIN IMMEDIATE');
    try {
      const version = database.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== CACHE_VERSION) database.exec(`DROP TABLE IF EXISTS repositories; PRAGMA user_version = ${CACHE_VERSION}`);
      database.exec(SCHEMA);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

class CorruptCache extends Error {}

/** SQLite's "file is not a database" (26) and "database disk image is malformed" (11). */
function isCorrupt(error: unknown): boolean {
  if (error instanceof CorruptCache) return true;
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return code === 26 || code === 11;
}

/**
 * Node's built-in SQLite, loaded on first use. The first Node 24 releases announce it as
 * experimental on stderr; that one warning is dropped, the output stays the same.
 */
async function loadSqlite(): Promise<typeof import('node:sqlite')> {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning.message;
    if (/SQLite/i.test(text) && /experimental/i.test(`${text} ${JSON.stringify(rest)}`)) return;
    return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
  }) as typeof process.emitWarning;
  try {
    return await import('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
