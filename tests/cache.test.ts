// The cache of an organisation's scan (spec/analysis.md, Cache): the core's scan with the real
// SQLite store, GitHub answered from the recordings in helpers.ts, every request counted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { CACHE_VERSION, cachePath, openCache } from '../src/cache.ts';
import type { Fetch } from '../src/core/github.ts';
import { scanOrganisation, type Progress } from '../src/core/organisation.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { RULES_VERSION, scan } from '../src/core/scan.ts';
import { serve } from '../src/web.ts';
import { atlas, CLI, FIXTURE, github, open, ORGANISATION_COMMIT, TERMINAL } from './helpers.ts';

const ORG = 'github.com/skillatlas';
const API = 'https://api.github.com';
/** The repositories of the recorded organisation that are scanned to the end: the ones kept. */
const KEPT = ['SkillAtlas/Beta', 'SkillAtlas/Docs', 'SkillAtlas/alpha', 'SkillAtlas/example-tools', 'SkillAtlas/huge'];

/** A directory of its own for a test's cache, removed after it. */
function directory(t: TestContext): string {
  const path = mkdtempSync(join(tmpdir(), 'skill-atlas-cache-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/** GitHub from the recordings, `changes` first, with every URL asked for in `urls`. */
function counted(changes: Recording = {}) {
  const urls: string[] = [];
  const answer = replay(changes, github);
  const fetch: Fetch = (url, init) => {
    urls.push(url);
    return answer(url, init);
  };
  return {
    fetch,
    urls,
    /** The repositories whose tree was asked for: the ones scanned, not taken from the cache. */
    trees: () => [...new Set(urls.flatMap((url) => /\/repos\/([^/]+\/[^/]+)\/git\/trees\//.exec(url)?.[1] ?? []))].sort(),
    /** The SKILL.md files read. */
    files: () => urls.filter((url) => url.startsWith('https://raw.githubusercontent.com/')),
    /** The repositories whose commit was asked for. */
    commits: () => urls.filter((url) => /\/commits\//.test(url)).length,
  };
}

/** The organisation's scan as the CLI and the web view run it, with the cache in `file`. */
const scanner = (file: string, fetch: Fetch) => (input: string, progress?: Progress, refresh?: boolean) =>
  scanOrganisation(input, { fetch, token: 'test', progress, refresh, cache: () => openCache(file) });

/** What the file keeps: each repository with its commit and count. */
function entries(file: string): Record<string, { commit: string; count: number }> {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = database.prepare('SELECT id, commit_sha, skill_count FROM repositories ORDER BY id').all();
    return Object.fromEntries(rows.map((row) => [String(row.id), { commit: String(row.commit_sha), count: Number(row.skill_count) }]));
  } finally {
    database.close();
  }
}

/** Runs SQL on the cache, as another program would. */
function sql(file: string, statements: string) {
  const database = new DatabaseSync(file);
  try {
    database.exec(statements);
  } finally {
    database.close();
  }
}

/** alpha with a new commit on its default branch, and a third skill in it. */
const NEW_COMMIT = '9f1c2d3e4b5a69788796a5b4c3d2e1f00f1e2d3c';
const skill = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n`;
const ALPHA_CHANGED: Recording = {
  [`${API}/repos/SkillAtlas/alpha/commits/main`]: { status: 200, body: { sha: NEW_COMMIT } },
  [`${API}/repos/SkillAtlas/alpha/git/trees/${NEW_COMMIT}?recursive=1`]: {
    status: 200,
    body: {
      truncated: false,
      tree: ['one', 'two', 'three'].map((name) => ({ path: `.claude/skills/${name}/SKILL.md`, mode: '100644', type: 'blob', sha: name })),
    },
  },
  ...Object.fromEntries(
    ['one', 'two', 'three'].map((name) => [
      `https://raw.githubusercontent.com/SkillAtlas/alpha/${NEW_COMMIT}/.claude/skills/${name}/SKILL.md`,
      { status: 200, body: skill(name) },
    ]),
  ),
};

/** broken, rate limited in the recording, answering: one skill. */
const BROKEN_WORKS: Recording = {
  [`${API}/repos/SkillAtlas/broken/commits/main`]: { status: 200, body: { sha: ORGANISATION_COMMIT } },
  [`${API}/repos/SkillAtlas/broken/git/trees/${ORGANISATION_COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: '.agents/skills/fix/SKILL.md', mode: '100644', type: 'blob', sha: 'fix' }] },
  },
  [`https://raw.githubusercontent.com/SkillAtlas/broken/${ORGANISATION_COMMIT}/.agents/skills/fix/SKILL.md`]: { status: 200, body: skill('fix') },
};

const uncached = await atlas(['scan', ORG]);

test('cache: a second scan with nothing changed → no tree, no file, only the commits; the same output', async (t) => {
  const file = join(directory(t), 'cache.db');
  const cold = counted();
  const first = await atlas(['scan', ORG], { scan: scanner(file, cold.fetch), terminal: true });
  assert.deepEqual(cold.trees(), KEPT);
  assert.ok(cold.files().length > 0);

  const warm = counted();
  const second = await atlas(['scan', ORG], { scan: scanner(file, warm.fetch), terminal: true });
  assert.deepEqual(warm.trees(), []);
  assert.deepEqual(warm.files(), []);
  // The owner, the two pages of its list, and one small request a repository, the failed and the empty one too.
  assert.equal(warm.commits(), 7);
  assert.equal(warm.urls.length, 3 + 7);
  // stdout, stderr (the warnings, in the same order), the exit code and the progress bar.
  assert.deepEqual(second, first);
  assert.equal(second.progress?.at(-2), '[####################] 7/7 repositories');
  // And the same as without a cache at all.
  assert.deepEqual({ ...second, progress: undefined }, { ...uncached, progress: undefined });
});

test('cache: the core result is the same with a cold or a warm cache: repositories, commits, counts, warnings, progress', async (t) => {
  const file = join(directory(t), 'cache.db');
  const none = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const seen: [number, number][][] = [[], []];
  const cold = await scanner(file, github)(ORG, (scanned, total) => seen[0].push([scanned, total]));
  const warm = await scanner(file, github)(ORG, (scanned, total) => seen[1].push([scanned, total]));
  assert.deepEqual(cold, none);
  assert.deepEqual(warm, none);
  // A repository from the cache is one more done.
  assert.deepEqual(seen[1], [0, 1, 2, 3, 4, 5, 6, 7].map((scanned) => [scanned, 7]));
  assert.deepEqual(seen[0], seen[1]);
});

test('cache: what is kept → the commit, the skill count and the warnings of each repository scanned to the end', async (t) => {
  const file = join(directory(t), 'cache.db');
  await scanner(file, github)(ORG);
  assert.deepEqual(entries(file), {
    'SkillAtlas/Beta': { commit: ORGANISATION_COMMIT, count: 2 },
    'SkillAtlas/Docs': { commit: ORGANISATION_COMMIT, count: 0 },
    'SkillAtlas/alpha': { commit: ORGANISATION_COMMIT, count: 2 },
    'SkillAtlas/example-tools': { commit: ORGANISATION_COMMIT, count: 2 },
    'SkillAtlas/huge': { commit: ORGANISATION_COMMIT, count: 0 },
  });
  // The warnings as the scan gave them, without the repository's name; no skills, no file contents.
  const database = new DatabaseSync(file, { readOnly: true });
  t.after(() => database.close());
  const huge = database.prepare('SELECT * FROM repositories WHERE id = ?').get('SkillAtlas/huge')!;
  assert.deepEqual(Object.keys(huge).sort(), ['commit_sha', 'id', 'owner', 'scanned_at', 'skill_count', 'warnings']);
  assert.deepEqual(JSON.parse(String(huge.warnings)), [
    'the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills',
  ]);
  assert.equal(database.prepare('PRAGMA user_version').get()!.user_version, CACHE_VERSION);
  assert.ok(!readFileSync(file).includes('The one skill.'));
});

test('cache: a repository with a new commit → scanned again, its entry replaced; the others from the cache', async (t) => {
  const file = join(directory(t), 'cache.db');
  await scanner(file, github)(ORG);
  const changed = counted(ALPHA_CHANGED);
  const result = await scanner(file, changed.fetch)(ORG);
  assert.deepEqual(changed.trees(), ['SkillAtlas/alpha']);
  assert.equal(changed.files().length, 3);
  assert.deepEqual(result.repositories[0], {
    name: 'alpha',
    url: 'https://github.com/SkillAtlas/alpha',
    commit: NEW_COMMIT,
    skillCount: 3,
    warnings: [],
  });
  assert.equal(result.skills, 7);
  assert.deepEqual(entries(file)['SkillAtlas/alpha'], { commit: NEW_COMMIT, count: 3 });
  assert.equal(Object.keys(entries(file)).length, 5);
  // The new entry is the one used from now on.
  const again = counted(ALPHA_CHANGED);
  assert.deepEqual(await scanner(file, again.fetch)(ORG), result);
  assert.deepEqual(again.trees(), []);
  // Back at the commit before: not the one kept, so scanned again.
  const back = counted();
  assert.equal((await scanner(file, back.fetch)(ORG)).skills, 6);
  assert.deepEqual(back.trees(), ['SkillAtlas/alpha']);
});

test('cache: a failed repository is not kept; the next scan tries it again', async (t) => {
  const file = join(directory(t), 'cache.db');
  const first = await scanner(file, github)(ORG);
  assert.deepEqual(first.repositories.at(-1), { name: 'broken', url: 'https://github.com/SkillAtlas/broken', warnings: ['not scanned: GitHub rate limit reached; try again in a minute'] });
  assert.ok(!('SkillAtlas/broken' in entries(file)));
  // Still failing with a warm cache: asked again, the same warning.
  const still = counted();
  const second = await scanner(file, still.fetch)(ORG);
  assert.ok(still.urls.includes(`${API}/repos/SkillAtlas/broken/commits/main`));
  assert.deepEqual(second.warnings.at(-1), 'broken: not scanned: GitHub rate limit reached; try again in a minute');
  // It answers: scanned, the only one, and kept.
  const works = counted(BROKEN_WORKS);
  const third = await scanner(file, works.fetch)(ORG);
  assert.deepEqual(works.trees(), ['SkillAtlas/broken']);
  assert.deepEqual(third.repositories.find((repository) => repository.name === 'broken'), {
    name: 'broken',
    url: 'https://github.com/SkillAtlas/broken',
    commit: ORGANISATION_COMMIT,
    skillCount: 1,
    warnings: [],
  });
  assert.deepEqual(entries(file)['SkillAtlas/broken'], { commit: ORGANISATION_COMMIT, count: 1 });
});

test('cache: a repository that fails after its commit (its tree, a file) is not kept either', async (t) => {
  const file = join(directory(t), 'cache.db');
  const tree = `${API}/repos/SkillAtlas/alpha/git/trees/${ORGANISATION_COMMIT}?recursive=1`;
  const raw = `https://raw.githubusercontent.com/SkillAtlas/Beta/${ORGANISATION_COMMIT}/.agents/skills/four/SKILL.md`;
  const failing = await scanner(file, replay({ [tree]: { status: 502, body: '<html>Bad Gateway</html>' }, [raw]: { status: 500, body: 'oops' } }, github))(ORG);
  assert.deepEqual(failing.repositories.slice(-3).map(({ name, skillCount }) => [name, skillCount]), [
    ['alpha', undefined],
    ['Beta', undefined],
    ['broken', undefined],
  ]);
  assert.deepEqual(Object.keys(entries(file)), ['SkillAtlas/Docs', 'SkillAtlas/example-tools', 'SkillAtlas/huge']);
  const next = counted();
  assert.deepEqual(await scanner(file, next.fetch)(ORG), await scanOrganisation(ORG, { fetch: github, token: 'test' }));
  assert.deepEqual(next.trees(), ['SkillAtlas/Beta', 'SkillAtlas/alpha']);
});

test('cache: a kept repository that GitHub no longer answers for → not scanned, not taken from the cache; its entry stays', async (t) => {
  const file = join(directory(t), 'cache.db');
  await scanner(file, github)(ORG);
  // As without a token that sees it: the entry is used only after GitHub answered for its commit.
  const hidden = { [`${API}/repos/SkillAtlas/alpha/commits/main`]: { status: 404, body: { message: 'Not Found' } } };
  const result = await scanner(file, replay(hidden, github))(ORG);
  assert.deepEqual(result.repositories.find((repository) => repository.name === 'alpha'), {
    name: 'alpha',
    url: 'https://github.com/SkillAtlas/alpha',
    warnings: ['not scanned: Not found in https://github.com/SkillAtlas/alpha: main'],
  });
  assert.ok(result.warnings.includes('alpha: not scanned: Not found in https://github.com/SkillAtlas/alpha: main'));
  assert.deepEqual(entries(file)['SkillAtlas/alpha'], { commit: ORGANISATION_COMMIT, count: 2 });
  // It answers again, at the same commit: from the cache.
  const back = counted();
  assert.equal((await scanner(file, back.fetch)(ORG)).skills, 6);
  assert.deepEqual(back.trees(), []);
});

test('cache: an empty repository, without a commit → 0 skills each time, not kept', async (t) => {
  const file = join(directory(t), 'cache.db');
  for (const _ of [1, 2]) {
    const result = await scanner(file, github)(ORG);
    assert.deepEqual(result.repositories.find((repository) => repository.name === 'empty'), {
      name: 'empty',
      url: 'https://github.com/SkillAtlas/empty',
      skillCount: 0,
      warnings: [],
    });
    assert.ok(!('SkillAtlas/empty' in entries(file)));
  }
});

test('cache: --no-cache → every repository scanned again, whatever is kept, and the entries replaced', async (t) => {
  const file = join(directory(t), 'cache.db');
  await scanner(file, github)(ORG);
  // What is kept is what a scan shows: a count changed in the file shows up.
  sql(file, "UPDATE repositories SET skill_count = 40, warnings = '[\"kept\"]' WHERE id = 'SkillAtlas/Docs'");
  const warm = await atlas(['scan', ORG], { scan: scanner(file, github) });
  assert.equal(warm.stdout.split('\n')[1], 'Docs — 40 skills');
  assert.ok(warm.stderr.split('\n').includes('warning: Docs: kept'));

  for (const args of [['scan', ORG, '--no-cache'], ['scan', '--no-cache', ORG]]) {
    sql(file, "UPDATE repositories SET skill_count = 40 WHERE id = 'SkillAtlas/Docs'");
    const bypass = counted();
    assert.deepEqual(await atlas(args, { scan: scanner(file, bypass.fetch) }), uncached, args.join(' '));
    assert.deepEqual(bypass.trees(), KEPT);
    assert.deepEqual(entries(file)['SkillAtlas/Docs'], { commit: ORGANISATION_COMMIT, count: 0 });
  }
  // The entries it stored are used by the next scan.
  const next = counted();
  assert.deepEqual(await atlas(['scan', ORG], { scan: scanner(file, next.fetch) }), uncached);
  assert.deepEqual(next.trees(), []);
});

test('cache: --no-cache with one repository or a directory → accepted, the same output; the usage names it', async () => {
  assert.deepEqual(await atlas(['scan', FIXTURE, '--no-cache']), await atlas(['scan', FIXTURE]));
  assert.deepEqual(await atlas(['scan', '--no-cache', 'github.com/JetBrains/example', '--filter', 'commit']), await atlas(['scan', 'github.com/JetBrains/example', '--filter', 'commit']));
  assert.deepEqual(await atlas(['scan', '--no-cache']), { code: 1, stdout: '', stderr: 'Usage: skill-atlas scan <GitHub URL | directory> [--filter <words>] [--no-cache]' });
  assert.match((await atlas(['help'])).stdout, /^ {4}--no-cache +scan every repository again/m);
  // On an organisation, --filter is still refused.
  assert.equal((await atlas(['scan', ORG, '--no-cache', '--filter', 'x'])).stderr, '--filter works on one repository, not on an organisation');
});

test('cache: kept as each repository is done, not at the end of the scan', async (t) => {
  const file = join(directory(t), 'cache.db');
  const kept: number[] = [];
  await scanOrganisation(ORG, {
    fetch: github,
    concurrency: 1,
    cache: () => openCache(file),
    progress: (scanned) => scanned > 0 && kept.push(Object.keys(entries(file)).length),
  });
  // One at a time, in the list's order: example-tools, Docs, alpha, huge, then Beta, broken and empty.
  assert.deepEqual(kept, [1, 2, 3, 4, 5, 5, 5]);
});

test('cache: after a scan, the entries of the organisation\'s repositories no longer listed are removed; others stay', async (t) => {
  const file = join(directory(t), 'cache.db');
  await scanner(file, github)(ORG);
  const insert = (id: string) =>
    sql(file, `INSERT INTO repositories VALUES ('${id}', '${id.split('/')[0]}', '${ORGANISATION_COMMIT}', 5, '[]', '2026-01-01T00:00:00.000Z')`);
  // Deleted, archived or a fork now; one of another owner, and one whose owner is spelled another way.
  for (const id of ['SkillAtlas/gone', 'skillatlas/renamed', 'SkillAtlas/old-1', 'someone/dotfiles', 'SkillAtlasX/near']) insert(id);
  const result = await scanner(file, github)(ORG);
  assert.equal(result.repositories.length, 7);
  assert.deepEqual(Object.keys(entries(file)), [...KEPT, 'SkillAtlasX/near', 'someone/dotfiles']);
  // A scan that fails before the list removes nothing.
  insert('no-such-organisation/kept');
  await assert.rejects(scanner(file, github)('github.com/no-such-organisation'));
  assert.ok('no-such-organisation/kept' in entries(file));
});

test('cache: a user\'s repositories are kept the same way', async (t) => {
  const file = join(directory(t), 'cache.db');
  const first = await scanner(file, github)('github.com/someone');
  const warm = counted();
  assert.deepEqual(await scanner(file, warm.fetch)('github.com/someone'), first);
  assert.deepEqual(warm.trees(), []);
  assert.deepEqual(entries(file), { 'someone/dotfiles': { commit: ORGANISATION_COMMIT, count: 1 } });
});

test('cache: a missing file, and its directories → created on first use, for the user only', async (t) => {
  const root = directory(t);
  const file = join(root, 'not', 'yet', 'cache.db');
  const result = await scanner(file, github)(ORG);
  assert.deepEqual(result, await scanOrganisation(ORG, { fetch: github, token: 'test' }));
  assert.equal(Object.keys(entries(file)).length, 5);
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, 'not', 'yet')).mode & 0o777, 0o700);
  }
  // Removed between two scans: created again, everything scanned.
  rmSync(file);
  const again = counted();
  assert.deepEqual(await scanner(file, again.fetch)(ORG), result);
  assert.deepEqual(again.trees(), KEPT);
});

test('cache: not a database, or a damaged one → moved to <file>.corrupt, a new one created, one warning; the scan is the same', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const root = directory(t);
  const cases: Record<string, (file: string) => void> = {
    text: (file) => writeFileSync(file, 'not a database\n'.repeat(400)),
    // A real cache, cut in the middle of a page and overwritten.
    damaged: (file) => {
      const bytes = readFileSync(file);
      writeFileSync(file, Buffer.concat([bytes.subarray(0, 100), Buffer.alloc(bytes.length - 100, 0x5a)]));
    },
  };
  for (const [name, damage] of Object.entries(cases)) {
    const file = join(root, `${name}.db`);
    await scanner(file, github)(ORG);
    damage(file);
    const before = readFileSync(file);
    const scanned = counted();
    const result = await scanner(file, scanned.fetch)(ORG);
    const warning = `cache: ${file} was not a readable database: moved to ${file}.corrupt, and a new cache created`;
    assert.deepEqual(result, { ...plain, warnings: [...plain.warnings, warning] }, name);
    assert.deepEqual(scanned.trees(), KEPT, name);
    assert.deepEqual(readFileSync(`${file}.corrupt`), before, name);
    // The new one works: the next scan is warm, without a warning.
    const next = counted();
    assert.deepEqual(await scanner(file, next.fetch)(ORG), plain, name);
    assert.deepEqual(next.trees(), [], name);
  }
  // The CLI: exit code 0, the warning last on stderr.
  const file = join(root, 'cli.db');
  writeFileSync(file, 'x'.repeat(5000));
  const cli = await atlas(['scan', ORG], { scan: scanner(file, github) });
  assert.equal(cli.code, 0);
  assert.equal(cli.stdout, uncached.stdout);
  assert.equal(cli.stderr, `${uncached.stderr}\nwarning: cache: ${file} was not a readable database: moved to ${file}.corrupt, and a new cache created`);
});

test('cache: another schema version, older or newer → emptied, no warning; the scan is the same', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const root = directory(t);
  for (const version of [0, CACHE_VERSION + 1]) {
    const file = join(root, `v${version}.db`);
    // Another shape of the same table, with an entry that must not be used, and a table of its own.
    sql(file, `CREATE TABLE repositories (id TEXT PRIMARY KEY, sha TEXT, skills TEXT);
      INSERT INTO repositories VALUES ('SkillAtlas/alpha', '${ORGANISATION_COMMIT}', '[]');
      CREATE TABLE other (x); PRAGMA user_version = ${version}`);
    const scanned = counted();
    assert.deepEqual(await scanner(file, scanned.fetch)(ORG), plain, `version ${version}`);
    assert.deepEqual(scanned.trees(), KEPT);
    assert.equal(Object.keys(entries(file)).length, 5);
    assert.ok(!existsSync(`${file}.corrupt`));
    const next = counted();
    assert.deepEqual(await scanner(file, next.fetch)(ORG), plain);
    assert.deepEqual(next.trees(), []);
  }
});

test('cache: an entry kept under other analysis rules, same schema and same commit → never used: emptied, no warning, scanned again', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const root = directory(t);
  // The version says which rules, not only which schema.
  assert.equal(CACHE_VERSION % 1000, RULES_VERSION);
  for (const version of [CACHE_VERSION - 1, CACHE_VERSION + 1]) {
    const file = join(root, `rules-${version}.db`);
    await scanner(file, github)(ORG);
    // What a skill-atlas with other rules kept for the same commits, in the same table.
    sql(file, `UPDATE repositories SET skill_count = 7, warnings = '["a warning the current rules do not give"]';
      PRAGMA user_version = ${version}`);
    const scanned = counted();
    assert.deepEqual(await scanner(file, scanned.fetch)(ORG), plain, `version ${version}`);
    assert.deepEqual(scanned.trees(), KEPT);
    assert.deepEqual(Object.values(entries(file)).map((entry) => entry.count), [2, 0, 2, 2, 0]);
    assert.ok(!existsSync(`${file}.corrupt`));
    // Kept again, by the current rules.
    const next = counted();
    assert.deepEqual(await scanner(file, next.fetch)(ORG), plain);
    assert.deepEqual(next.trees(), []);
  }
});

test('cache: the rules\' version is raised when the rules change: the fixture\'s count and warnings belong to this version', async () => {
  const result = await scan(await open(FIXTURE));
  // A difference here means the analysis rules changed: raise RULES_VERSION (src/core/scan.ts), so
  // that no cache answers with the old rules' counts and warnings, then update what is expected.
  assert.deepEqual(
    { version: RULES_VERSION, total: result.total, warnings: result.warnings },
    {
      version: 1,
      total: 4,
      warnings: [
        '.agents/skills/release-checklist/SKILL.md: malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
        '.claude/skills/commits/SKILL.md: its copies differ: .github/skills/commits/SKILL.md',
      ],
    },
    'the analysis rules changed: raise RULES_VERSION in src/core/scan.ts, then update this test',
  );
});

test('cache: cannot be opened (a directory, a file where its directory should be) → the scan without it, one warning', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const root = directory(t);
  mkdirSync(join(root, 'is-a-directory'));
  writeFileSync(join(root, 'is-a-file'), '');
  for (const file of [join(root, 'is-a-directory'), join(root, 'is-a-file', 'cache.db')]) {
    for (const refresh of [false, true]) {
      const scanned = counted();
      const result = await scanner(file, scanned.fetch)(ORG, undefined, refresh);
      assert.deepEqual(scanned.trees(), KEPT);
      assert.deepEqual({ ...result, warnings: result.warnings.slice(0, -1) }, plain, file);
      assert.match(result.warnings.at(-1)!, /^cache: not used: \S/, file);
      // The cache's own, after the repositories': none of theirs.
      const theirs = result.repositories.flatMap((repository) => repository.warnings.map((warning) => `${repository.name}: ${warning}`));
      assert.deepEqual(theirs, result.warnings.slice(0, -1), file);
    }
  }
  assert.deepEqual(readdirSync(join(root, 'is-a-directory')), []);
  const cli = await atlas(['scan', ORG], { scan: scanner(join(root, 'is-a-directory'), github) });
  assert.equal(cli.code, 0);
  assert.equal(cli.stdout, uncached.stdout);
  assert.match(cli.stderr.split('\n').at(-1)!, /^warning: cache: not used: \S/);
});

test('cache: cannot be read or written while a scan runs → the scan goes on without it, one warning', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const file = join(directory(t), 'cache.db');
  await scanner(file, github)(ORG);
  // Its table is gone once the scan has opened it: nothing can be read, nothing saved.
  const scanned = counted();
  const result = await scanOrganisation(ORG, {
    fetch: scanned.fetch,
    token: 'test',
    concurrency: 1,
    cache: () => openCache(file),
    progress: (done) => done === 1 && sql(file, 'DROP TABLE repositories'),
  });
  // The first one, example-tools, came from the cache; the others could not.
  assert.deepEqual(scanned.trees(), KEPT.filter((id) => id !== 'SkillAtlas/example-tools'));
  assert.deepEqual(result.warnings.slice(0, -1), plain.warnings);
  assert.match(result.warnings.at(-1)!, /^cache: not read: .*repositories/);
  assert.deepEqual({ ...result, warnings: plain.warnings }, plain);
});

test('cache: a database another program keeps locked → waited for once, then left alone: nothing more read or saved, one warning', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const root = directory(t);
  /** Another connection, as another program's, that takes the lock once the scan has opened the cache. */
  const locked = (file: string) => {
    const holder = new DatabaseSync(file);
    t.after(() => holder.isOpen && holder.close());
    return {
      holder,
      cache: async () => {
        const cache = await openCache(file);
        holder.exec('BEGIN EXCLUSIVE');
        return cache;
      },
    };
  };

  // Locked for the whole scan: one wait of the busy timeout, not two for every repository.
  const whole = locked(join(root, 'whole.db'));
  const scanned = counted();
  const start = Date.now();
  const result = await scanOrganisation(ORG, { fetch: scanned.fetch, token: 'test', cache: whole.cache });
  const elapsed = Date.now() - start;
  whole.holder.exec('ROLLBACK');
  assert.deepEqual(scanned.trees(), KEPT);
  assert.deepEqual({ ...result, warnings: result.warnings.slice(0, -1) }, plain);
  assert.equal(result.warnings.at(-1), 'cache: not read: database is locked');
  // 2 s for the one wait; 5 repositories read and saved would be 20 s.
  assert.ok(elapsed < 8000, `${elapsed} ms`);
  assert.deepEqual(entries(join(root, 'whole.db')), {});

  // Unlocked after the first repository: the cache has failed, the rest of the scan does not use it.
  const first = locked(join(root, 'first.db'));
  const result2 = await scanOrganisation(ORG, {
    fetch: github,
    token: 'test',
    concurrency: 1,
    cache: first.cache,
    progress: (done) => done === 1 && first.holder.exec('ROLLBACK'),
  });
  assert.deepEqual({ ...result2, warnings: result2.warnings.slice(0, -1) }, plain);
  assert.equal(result2.warnings.at(-1), 'cache: not read: database is locked');
  assert.deepEqual(entries(join(root, 'first.db')), {});
  // The next scan, with the lock gone, uses it again.
  first.holder.close();
  assert.deepEqual(await scanner(join(root, 'first.db'), github)(ORG), plain);
  assert.deepEqual(Object.keys(entries(join(root, 'first.db'))), KEPT);
});

test('cache: an entry that is not what a scan wrote → as if not kept: scanned again, and replaced', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const file = join(directory(t), 'cache.db');
  await scanner(file, github)(ORG);
  sql(file, `UPDATE repositories SET warnings = 'not JSON' WHERE id = 'SkillAtlas/alpha';
    UPDATE repositories SET warnings = '{"a":1}' WHERE id = 'SkillAtlas/Beta';
    UPDATE repositories SET skill_count = -2 WHERE id = 'SkillAtlas/Docs'`);
  const scanned = counted();
  assert.deepEqual(await scanner(file, scanned.fetch)(ORG), plain);
  assert.deepEqual(scanned.trees(), ['SkillAtlas/Beta', 'SkillAtlas/Docs', 'SkillAtlas/alpha']);
  const next = counted();
  assert.deepEqual(await scanner(file, next.fetch)(ORG), plain);
  assert.deepEqual(next.trees(), []);
});

test('cache: two scans at the same time on one database → both the same result, no warning, every entry kept', async (t) => {
  const plain = await scanOrganisation(ORG, { fetch: github, token: 'test' });
  const file = join(directory(t), 'cache.db');
  const slow: Fetch = async (url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return github(url, init);
  };
  const results = await Promise.all([scanner(file, slow)(ORG), scanner(file, slow)(ORG, undefined, true), scanner(file, slow)('github.com/someone')]);
  assert.deepEqual(results[0], plain);
  assert.deepEqual(results[1], plain);
  assert.deepEqual(results[2].warnings, []);
  assert.deepEqual(Object.keys(entries(file)), [...KEPT, 'someone/dotfiles']);
});

test('cache: two caches opened at the same time → process.emitWarning is what it was: other warnings are still given', async (t) => {
  const root = directory(t);
  const original = process.emitWarning;
  const caches = await Promise.all([openCache(join(root, 'a.db')), openCache(join(root, 'b.db')), openCache(join(root, 'c.db'))]);
  for (const cache of caches) assert.deepEqual(cache.close(), []);
  assert.equal(process.emitWarning, original);
});

test('cache: where → SKILL_ATLAS_CACHE, else skill-atlas/cache.db in XDG_CACHE_HOME, else in ~/.cache', () => {
  assert.equal(cachePath({}), join(homedir(), '.cache', 'skill-atlas', 'cache.db'));
  assert.equal(cachePath({ XDG_CACHE_HOME: '/var/cache/me' }), join('/var/cache/me', 'skill-atlas', 'cache.db'));
  // Not an absolute path: ignored, as the XDG specification asks; so is an empty one.
  assert.equal(cachePath({ XDG_CACHE_HOME: 'relative/cache' }), join(homedir(), '.cache', 'skill-atlas', 'cache.db'));
  assert.equal(cachePath({ XDG_CACHE_HOME: '', SKILL_ATLAS_CACHE: '' }), join(homedir(), '.cache', 'skill-atlas', 'cache.db'));
  assert.equal(cachePath({ SKILL_ATLAS_CACHE: '/tmp/elsewhere.db', XDG_CACHE_HOME: '/var/cache/me' }), resolve('/tmp/elsewhere.db'));
  assert.equal(cachePath({ SKILL_ATLAS_CACHE: 'here.db' }), resolve('here.db'));
});

/** The real CLI in `cwd`, GitHub answered from the recordings, as with a token, with only the given cache variables. */
function cli(args: string[], cwd: string, env: Record<string, string>) {
  const { SKILL_ATLAS_CACHE: _, XDG_CACHE_HOME: __, ...rest } = process.env;
  return spawnSync(process.execPath, ['--import', TERMINAL, CLI, ...args], { cwd, encoding: 'utf8', env: { ...rest, TERMINAL: '', GITHUB_TOKEN: 'test', ...env } });
}

test('./skill-atlas scan github.com/<org>: the cache where SKILL_ATLAS_CACHE says; a second run prints the same; nothing in the current directory', (t) => {
  const root = directory(t);
  const cwd = join(root, 'cwd');
  mkdirSync(cwd);
  const file = join(root, 'elsewhere', 'atlas.db');
  const first = cli(['scan', ORG], cwd, { SKILL_ATLAS_CACHE: file });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, `${uncached.stdout}\n`);
  assert.equal(first.stderr, `${uncached.stderr}\n`);
  assert.equal(Object.keys(entries(file)).length, 5);
  // A count changed in the file shows that the second run reads it.
  sql(file, "UPDATE repositories SET skill_count = 40 WHERE id = 'SkillAtlas/Docs'");
  const marked = cli(['scan', ORG], cwd, { SKILL_ATLAS_CACHE: file });
  assert.equal(marked.stdout.split('\n')[1], 'Docs — 40 skills');
  const bypass = cli(['scan', ORG, '--no-cache'], cwd, { SKILL_ATLAS_CACHE: file });
  assert.deepEqual([bypass.status, bypass.stdout, bypass.stderr], [0, first.stdout, first.stderr]);
  const second = cli(['scan', ORG], cwd, { SKILL_ATLAS_CACHE: file });
  assert.deepEqual([second.status, second.stdout, second.stderr], [0, first.stdout, first.stderr]);
  assert.deepEqual(readdirSync(cwd), []);
  assert.deepEqual(readdirSync(join(root, 'elsewhere')), ['atlas.db']);
});

test('./skill-atlas scan github.com/<org>: by default in XDG_CACHE_HOME, else in ~/.cache; on a terminal, the same bar with a warm cache', (t) => {
  const root = directory(t);
  const cwd = join(root, 'cwd');
  mkdirSync(cwd);
  const xdg = cli(['scan', ORG], cwd, { XDG_CACHE_HOME: join(root, 'xdg') });
  assert.equal(xdg.status, 0, xdg.stderr);
  assert.equal(Object.keys(entries(join(root, 'xdg', 'skill-atlas', 'cache.db'))).length, 5);
  // A home of its own, so the test leaves the real one alone.
  const home = { HOME: join(root, 'home'), USERPROFILE: join(root, 'home') };
  mkdirSync(home.HOME);
  const cold = cli(['scan', ORG], cwd, { ...home, TERMINAL: '1' });
  assert.equal(cold.status, 0, cold.stderr);
  assert.equal(Object.keys(entries(join(root, 'home', '.cache', 'skill-atlas', 'cache.db'))).length, 5);
  const warm = cli(['scan', ORG], cwd, { ...home, TERMINAL: '1' });
  assert.deepEqual([warm.status, warm.stdout, warm.stderr], [0, cold.stdout, cold.stderr]);
  assert.ok(warm.stderr.includes('[####################] 7/7 repositories'));
  assert.deepEqual(readdirSync(cwd), []);
});

test('./skill-atlas scan: a cache that is not a database, or cannot be used → exit code 0, the same stdout, a warning on stderr', (t) => {
  const root = directory(t);
  const file = join(root, 'cache.db');
  writeFileSync(file, 'garbage '.repeat(1000));
  const corrupt = cli(['scan', ORG], root, { SKILL_ATLAS_CACHE: file });
  assert.equal(corrupt.status, 0, corrupt.stderr);
  assert.equal(corrupt.stdout, `${uncached.stdout}\n`);
  assert.equal(corrupt.stderr, `${uncached.stderr}\nwarning: cache: ${file} was not a readable database: moved to ${file}.corrupt, and a new cache created\n`);
  const unusable = cli(['scan', ORG], root, { SKILL_ATLAS_CACHE: root });
  assert.equal(unusable.status, 0, unusable.stderr);
  assert.equal(unusable.stdout, `${uncached.stdout}\n`);
  assert.match(unusable.stderr, new RegExp(`^${uncached.stderr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\nwarning: cache: not used: [^\n]+\n$`));
});

test('./skill-atlas scan <one repository | directory>: no cache, nothing read or stored, with --no-cache too', (t) => {
  const root = directory(t);
  const file = join(root, 'cache.db');
  for (const args of [['scan', FIXTURE], ['scan', FIXTURE, '--no-cache'], ['scan', 'github.com/JetBrains/example'], ['scan', `github.com/SkillAtlas/alpha/tree/${ORGANISATION_COMMIT}`], ['help']]) {
    const scanned = cli(args, root, { SKILL_ATLAS_CACHE: file, XDG_CACHE_HOME: join(root, 'xdg'), HOME: join(root, 'home') });
    assert.equal(scanned.status, 0, scanned.stderr);
    assert.deepEqual(readdirSync(root), [], args.join(' '));
  }
});

test('a scan stopped halfway → the repositories done by then are kept; the next scan fetches only the rest', async (t) => {
  const file = join(directory(t), 'cache.db');
  const stop = new AbortController();
  const first = counted();
  await assert.rejects(
    scanOrganisation(ORG, {
      fetch: first.fetch,
      token: 'test',
      concurrency: 1,
      signal: stop.signal,
      cache: () => openCache(file),
      // Stopped once 3 repositories are done, in the order listed: example-tools, Docs, alpha.
      progress: (scanned) => scanned === 3 && stop.abort(),
    }),
  );
  assert.deepEqual(first.trees(), ['SkillAtlas/Docs', 'SkillAtlas/alpha', 'SkillAtlas/example-tools']);
  assert.deepEqual(Object.keys(entries(file)), ['SkillAtlas/Docs', 'SkillAtlas/alpha', 'SkillAtlas/example-tools']);
  const next = counted();
  const result = await scanner(file, next.fetch)(ORG);
  assert.deepEqual(next.trees(), ['SkillAtlas/Beta', 'SkillAtlas/huge']);
  assert.equal(result.skills, 6);
});

test('API: an organisation with a cold or a warm cache → the same JSON and stream; cache=0 scans everything again; one cache with the CLI', async (t) => {
  const file = join(directory(t), 'cache.db');
  const requests = counted();
  const { server, url } = await serve({ open, scanOrganisation: scanner(file, requests.fetch), port: 0 });
  t.after(() => server.close());
  const get = async (query: string) => {
    requests.urls.length = 0;
    const response = await fetch(`${url.replace('localhost', '127.0.0.1')}/api/scan?repo=${ORG}${query}`);
    return { status: response.status, text: await response.text(), trees: requests.trees() };
  };
  const cold = await get('');
  assert.equal(cold.status, 200);
  assert.deepEqual(cold.trees, KEPT);
  const warm = await get('');
  assert.deepEqual(warm, { ...cold, trees: [] });
  assert.equal(JSON.parse(warm.text).skills, 6);
  // The same lines: progress for every repository, then the result.
  const stream = await get('&stream=1');
  assert.deepEqual(stream.trees, []);
  const lines = stream.text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.progress ?? line), [...[0, 1, 2, 3, 4, 5, 6, 7].map((scanned) => ({ scanned, total: 7 })), { result: JSON.parse(cold.text) }]);
  // Each repository done, from the cache as when scanned: the same as in the result, whatever order they end in.
  const byName = (entries: { name: string }[]) => [...entries].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(byName(lines.slice(1, -1).map((line) => line.repository)), byName(JSON.parse(cold.text).repositories));
  // cache=0, as --no-cache; anything else is not a bypass.
  assert.deepEqual(await get('&cache=0'), { ...cold, trees: KEPT });
  assert.deepEqual(await get('&cache=1'), { ...cold, trees: [] });
  assert.deepEqual((await get('&stream=1&cache=0')).trees, KEPT);
  // What the CLI scanned is not fetched again by the web view, and the other way round.
  const changed = counted(ALPHA_CHANGED);
  const byCli = await atlas(['scan', ORG], { scan: scanner(file, changed.fetch) });
  assert.equal(byCli.stdout.split('\n')[1], 'alpha — 3 skills');
  assert.deepEqual(changed.trees(), ['SkillAtlas/alpha']);
  assert.equal(entries(file)['SkillAtlas/alpha'].commit, NEW_COMMIT);
  // A cache that cannot be used: status 200, one more warning.
  const broken = await serve({ open, scanOrganisation: scanner(join(file, 'under-a-file'), github), port: 0 });
  t.after(() => broken.server.close());
  const answer = await fetch(`${broken.url.replace('localhost', '127.0.0.1')}/api/scan?repo=${ORG}`);
  assert.equal(answer.status, 200);
  const body = await answer.json();
  assert.deepEqual({ ...body, warnings: body.warnings.slice(0, -1) }, JSON.parse(cold.text));
  assert.match(body.warnings.at(-1), /^cache: not used: \S/);
});

test('API: one repository → nothing read or stored, with cache=0 too', async (t) => {
  const file = join(directory(t), 'cache.db');
  const { server, url } = await serve({ open, scanOrganisation: scanner(file, github), port: 0 });
  t.after(() => server.close());
  const base = `${url.replace('localhost', '127.0.0.1')}/api/scan?repo=https://github.com/JetBrains/example`;
  const plain = await (await fetch(base)).json();
  assert.equal(plain.total, 1);
  assert.deepEqual(await (await fetch(`${base}&cache=0`)).json(), plain);
  assert.ok(!existsSync(file));
});
