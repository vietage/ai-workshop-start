// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture, for temporary directories, and for GitHub repositories answered from recordings.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { progressBar, run } from '../src/commands.ts';
import { GITHUB_TIMEOUT, TIMER_LIMIT, openGitHub, parseGitHubOwner, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { AtlasError } from '../src/core/errors.ts';
import { scanOrganisation } from '../src/core/organisation.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { openDirectory } from '../src/local.ts';
import { atlas, CLI, TERMINAL, EXAMPLE_COMMIT, FIXTURE, github, ORGANISATION_COMMIT, scanOrganisation as scanRecorded, silentGitHub } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every project skill, sorted by name, linked to its file, with its copies and warnings', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 4 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.claude/skills/code-style/SKILL.md`,
      '  also in .github/skills/code-style/SKILL.md',
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      '  also in .github/skills/commits/SKILL.md',
      'invoices — Create invoices the way the billing module does.',
      `  ${root}/modules/billing/.claude/skills/invoices/SKILL.md`,
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
    ].join('\n'),
  );
  const warnings = fixture.stderr.split('\n');
  assert.equal(warnings.length, 2, fixture.stderr);
  assert.match(warnings[0], /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
  assert.equal(warnings[1], 'warning: .claude/skills/commits/SKILL.md: its copies differ: .github/skills/commits/SKILL.md');
});

test('--filter: only the skills whose name contains the word; the header counts both', async () => {
  const root = pathToFileURL(FIXTURE).href;
  const filtered = await atlas(['scan', FIXTURE, '--filter', 'release']);
  assert.equal(filtered.code, 0);
  assert.equal(
    filtered.stdout,
    ['fixture · 1 of 4 skills', 'release-checklist', `  ${root}/.agents/skills/release-checklist/SKILL.md`].join('\n'),
  );
  // The warnings are the whole scan's.
  assert.equal(filtered.stderr, fixture.stderr);
});

test('--filter: the whole description, a substring, in any case, trimmed; before or after the URL', async () => {
  const root = pathToFileURL(FIXTURE).href;
  // "Kotlin" is only in code-style's second sentence, which is not printed.
  const kotlin = await atlas(['scan', '--filter', 'KOTLIN', FIXTURE]);
  assert.equal(
    kotlin.stdout,
    [
      'fixture · 1 of 4 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.claude/skills/code-style/SKILL.md`,
      '  also in .github/skills/code-style/SKILL.md',
    ].join('\n'),
  );
  // "commit" is in "committing" and in "commit messages": a substring, not a whole word.
  const commit = await atlas(['scan', FIXTURE, '--filter', 'Commit']);
  assert.deepEqual(commit.stdout.split('\n').filter((line) => !line.startsWith('  ')), [
    'fixture · 2 of 4 skills',
    "code-style — Follow the project's code style.",
    'commits — Write commit messages the way this repository does.',
  ]);
  const billing = await atlas(['scan', '--filter', 'billing module', FIXTURE]);
  assert.match(billing.stdout, /^fixture · 1 of 4 skills\ninvoices — /);
  // The word is trimmed, as in the web view and the API.
  const padded = await atlas(['scan', FIXTURE, '--filter', ' release ']);
  assert.match(padded.stdout, /^fixture · 1 of 4 skills\nrelease-checklist\n/);
  const paddedNone = await atlas(['scan', FIXTURE, '--filter', ' zzz ']);
  assert.equal(paddedNone.stdout, 'fixture · 0 of 4 skills\nno skills match "zzz"');

  const github = await atlas(['scan', 'github.com/JetBrains/example', '--filter', 'COMMITS']);
  assert.equal(github.stdout, example.stdout.replace('· 1 skill', '· 1 of 1 skill'));
});

test('--filter with no match → the header, 0 of N skills, and a clear message; not an error', async () => {
  const none = await atlas(['scan', FIXTURE, '--filter', 'zzz']);
  assert.deepEqual(none, { code: 0, stdout: 'fixture · 0 of 4 skills\nno skills match "zzz"', stderr: fixture.stderr });
  const github = await atlas(['scan', 'github.com/JetBrains/example', '--filter', 'kotlin']);
  assert.deepEqual(github, { code: 0, stdout: 'JetBrains/example · 0 of 1 skill\nno skills match "kotlin"', stderr: '' });
});

test('--filter <words>: every word, in the name or the description, in any order', async () => {
  const names = async (filter: string) => {
    const result = await atlas(['scan', FIXTURE, '--filter', filter]);
    assert.equal(result.code, 0, filter);
    assert.equal(result.stderr, fixture.stderr, filter);
    return result.stdout.split('\n').filter((line) => !line.startsWith('  '));
  };
  // Not the substring "module billing": each word on its own, in any order.
  assert.deepEqual(await names('module billing'), ['fixture · 1 of 4 skills', 'invoices — Create invoices the way the billing module does.']);
  // "style" only in the name, "kotlin" only in the description: one in each is enough.
  assert.deepEqual(await names('kotlin STYLE'), ['fixture · 1 of 4 skills', "code-style — Follow the project's code style."]);
  // Every word (AND), not any (OR): commits has "commit", but not "kotlin".
  assert.deepEqual(await names('commit kotlin'), ['fixture · 1 of 4 skills', "code-style — Follow the project's code style."]);
  assert.deepEqual(await names('commit'), [
    'fixture · 2 of 4 skills',
    "code-style — Follow the project's code style.",
    'commits — Write commit messages the way this repository does.',
  ]);
  // Any whitespace between the words, around them, tabs and new lines too.
  assert.deepEqual(await names(' \tbilling \n  module  '), await names('billing module'));
  // Quotes are characters like any other: no phrases.
  assert.deepEqual(await names('"billing module"'), ['fixture · 0 of 4 skills', 'no skills match ""billing module""']);
});

test('--filter <words> with no match → the words in the message, joined by one space; not an error', async () => {
  const none = await atlas(['scan', FIXTURE, '--filter', '  commit \t zzz ']);
  assert.deepEqual(none, { code: 0, stdout: 'fixture · 0 of 4 skills\nno skills match "commit zzz"', stderr: fixture.stderr });
  const github = await atlas(['scan', '--filter', 'commits kotlin', 'github.com/JetBrains/example']);
  assert.deepEqual(github, { code: 0, stdout: 'JetBrains/example · 0 of 1 skill\nno skills match "commits kotlin"', stderr: '' });
  const githubBoth = await atlas(['scan', 'github.com/JetBrains/example', '--filter', 'COMMITS commits']);
  assert.equal(githubBoth.stdout, example.stdout.replace('· 1 skill', '· 1 of 1 skill'));
});

test('--filter without words, an empty or blank one, twice, or followed by --filter → the usage, exit code 1', async () => {
  const usage = 'Usage: skill-atlas scan <GitHub URL | directory> [--filter <words>] [--no-cache]';
  for (const args of [
    [FIXTURE, '--filter'],
    [FIXTURE, '--filter', ''],
    [FIXTURE, '--filter', ' '],
    [FIXTURE, '--filter', ' \t\n '],
    [FIXTURE, '--filter', 'a', '--filter', 'b'],
    ['--filter', '--filter', FIXTURE],
    [FIXTURE, FIXTURE, '--filter', 'a'],
  ]) {
    assert.deepEqual(await atlas(['scan', ...args]), { code: 1, stdout: '', stderr: usage }, args.join(' '));
  }
});

test('the core: the filter after the scan, and the count before it', async () => {
  const all = await scan(await openDirectory(FIXTURE));
  assert.equal(all.total, 4);
  assert.equal(all.skills.length, 4);
  const filtered = await scan(await openDirectory(FIXTURE), { filter: 'INVOICES' });
  assert.equal(filtered.total, 4);
  assert.deepEqual(filtered.skills.map((skill) => skill.name), ['invoices']);
  assert.deepEqual(filtered.warnings, all.warnings);
  const words = await scan(await openDirectory(FIXTURE), { filter: ' module  INVOICES ' });
  assert.equal(words.total, 4);
  assert.deepEqual(words.skills.map((skill) => skill.name), ['invoices']);
  // No words: no filter.
  assert.deepEqual((await scan(await openDirectory(FIXTURE), { filter: ' \t ' })).skills, all.skills);
});

test('the first agent folder in .agents, .claude, .github, agent order is the skill; copies are per project', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const text = '---\nname: lint\ndescription: Run the linter.\n---\n';
  for (const path of ['agent/skills/lint', '.github/skills/lint', '.agents/skills/lint', 'web/.claude/skills/lint']) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, 'SKILL.md'), text);
  }
  const scanned = await atlas(['scan', root]);
  assert.equal(scanned.stderr, '');
  const href = pathToFileURL(root).href;
  assert.equal(
    scanned.stdout,
    [
      `${basename(root)} · 2 skills`,
      'lint — Run the linter.',
      `  ${href}/.agents/skills/lint/SKILL.md`,
      '  also in .github/skills/lint/SKILL.md, agent/skills/lint/SKILL.md',
      'lint — Run the linter.',
      `  ${href}/web/.claude/skills/lint/SKILL.md`,
    ].join('\n'),
  );
});

test('a local directory: nothing under node_modules or .git is a skill', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['node_modules/tool/.claude/skills/vendored', '.git/.claude/skills/internal']) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, 'SKILL.md'), '---\nname: no\n---\n');
  }
  const scanned = await atlas(['scan', root]);
  assert.equal(scanned.stdout, `${basename(root)} · 0 skills`);
});

/** GitHub without a token: the repository's tree, with `entries` as its blobs and links. */
function githubTree(entries: { path: string; mode?: string; text?: string }[], truncated = false) {
  const sha = EXAMPLE_COMMIT;
  const recording: Recording = {
    'https://api.github.com/repos/JetBrains/layout': { status: 200, body: { full_name: 'JetBrains/layout', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/layout/commits/main': { status: 200, body: { sha } },
    [`https://api.github.com/repos/JetBrains/layout/git/trees/${sha}?recursive=1`]: {
      status: 200,
      body: { truncated, tree: entries.map(({ path, mode = '100644' }) => ({ path, mode, type: 'blob', sha: path })) },
    },
  };
  for (const { path, text } of entries) {
    recording[`https://raw.githubusercontent.com/JetBrains/layout/${sha}/${path}`] = {
      status: 200,
      body: text ?? `---\nname: ${path}\ndescription: The skill at ${path}.\n---\n`,
    };
  }
  return recording;
}

test('GitHub: the same model as a local directory, for every place a SKILL.md can be', async () => {
  const skill = (name: string) => `---\nname: ${name}\ndescription: ${name}.\n---\n`;
  const recording = githubTree([
    { path: '.claude/skills/commits/SKILL.md', text: skill('commits') },
    { path: '.agents/skills/commits/SKILL.md', text: skill('commits') },
    { path: 'plugins/kotlin/.github/skills/k2/SKILL.md', text: skill('k2') },
    { path: 'SKILL.md' },
    { path: 'skills/publish/SKILL.md' },
    { path: '.claude/skills/SKILL.md' },
    { path: '.claude/skills/commits/examples/SKILL.md' },
    { path: '.claude/skills/lower/skill.md' },
    { path: '.claude/skills/upper/Skill.md' },
    { path: 'docs/claude/skills/near/SKILL.md' },
    { path: 'node_modules/tool/.claude/skills/vendored/SKILL.md' },
    { path: '.claude/skills/linked/SKILL.md', mode: '120000' },
  ]);
  const result = await scan(await openGitHub('https://github.com/JetBrains/layout', { fetch: replay(recording) }));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.skills.map(({ id, name, description, copies }) => ({ id, name, description, copies })),
    [
      { id: 'JetBrains/layout:.agents/skills/commits/SKILL.md', name: 'commits', description: 'commits.', copies: ['.claude/skills/commits/SKILL.md'] },
      { id: 'JetBrains/layout:plugins/kotlin/.github/skills/k2/SKILL.md', name: 'k2', description: 'k2.', copies: [] },
    ],
  );
});

test('GitHub: code search finds SKILL.md in any case; only the exact name is a skill', async () => {
  const search = 'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/layout&per_page=100&page=1';
  const recording = githubTree([{ path: '.claude/skills/commits/SKILL.md' }, { path: '.claude/skills/lower/skill.md' }]);
  recording[search] = {
    status: 200,
    body: { total_count: 2, items: [{ path: '.claude/skills/commits/SKILL.md' }, { path: '.claude/skills/lower/skill.md' }] },
  };
  const result = await scan(await openGitHub('https://github.com/JetBrains/layout', { fetch: replay(recording), token: 'test' }));
  assert.deepEqual(result.skills.map((skill) => skill.path), ['.claude/skills/commits/SKILL.md']);
});

test('GitHub: a tree too large to list at once → only the agent folders at the root, and a warning', async () => {
  const sha = EXAMPLE_COMMIT;
  const recording = githubTree([], true);
  const tree = (entries: { path: string; type?: string; mode?: string }[]) => ({
    status: 200,
    body: { truncated: false, tree: entries.map(({ path, type = 'tree', mode = '040000' }) => ({ path, type, mode, sha: `${path}-sha` })) },
  });
  recording[`https://api.github.com/repos/JetBrains/layout/git/trees/${sha}`] = tree([{ path: '.claude' }, { path: 'modules' }]);
  recording['https://api.github.com/repos/JetBrains/layout/git/trees/.claude-sha'] = tree([{ path: 'skills' }]);
  recording['https://api.github.com/repos/JetBrains/layout/git/trees/skills-sha?recursive=1'] = tree([
    { path: 'commits', type: 'tree' },
    { path: 'commits/SKILL.md', type: 'blob', mode: '100644' },
  ]);
  recording[`https://raw.githubusercontent.com/JetBrains/layout/${sha}/.claude/skills/commits/SKILL.md`] = {
    status: 200,
    body: '---\nname: commits\n---\n',
  };
  const result = await scan(await openGitHub('https://github.com/JetBrains/layout', { fetch: replay(recording) }));
  assert.deepEqual(result.skills.map((skill) => skill.path), ['.claude/skills/commits/SKILL.md']);
  assert.deepEqual(result.warnings, [
    'the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills (GITHUB_TOKEN searches everywhere)',
  ]);
});

test('GitHub URL: …/tree/<commit or branch> pins what is scanned', () => {
  assert.deepEqual(parseGitHubUrl('github.com/JetBrains/MPS'), { owner: 'JetBrains', repo: 'MPS' });
  assert.deepEqual(parseGitHubUrl(`https://github.com/JetBrains/MPS/tree/${EXAMPLE_COMMIT}/`), {
    owner: 'JetBrains',
    repo: 'MPS',
    ref: EXAMPLE_COMMIT,
  });
  assert.deepEqual(parseGitHubUrl('github.com/JetBrains/MPS/tree/release/2025.3'), { owner: 'JetBrains', repo: 'MPS', ref: 'release/2025.3' });
});

test('GitHub at a commit: its tree, even with a token; the links pin that commit', async () => {
  const pinned = '1cbf7f783dbc5c74c8e5231d31f61b02829143de';
  const recording = githubTree([{ path: '.claude/skills/commits/SKILL.md' }]);
  recording[`https://api.github.com/repos/JetBrains/layout/commits/${pinned}`] = { status: 200, body: { sha: pinned } };
  const tree = recording[`https://api.github.com/repos/JetBrains/layout/git/trees/${EXAMPLE_COMMIT}?recursive=1`];
  recording[`https://api.github.com/repos/JetBrains/layout/git/trees/${pinned}?recursive=1`] = tree;
  recording[`https://raw.githubusercontent.com/JetBrains/layout/${pinned}/.claude/skills/commits/SKILL.md`] = {
    status: 200,
    body: '---\nname: commits\ndescription: Commits.\n---\n',
  };
  // No code search is recorded: asking for it fails the scan.
  const source = await openGitHub(`github.com/JetBrains/layout/tree/${pinned}`, { fetch: replay(recording), token: 'test' });
  const result = await scan(source);
  assert.equal(result.repository.commit, pinned);
  assert.deepEqual(result.skills.map((skill) => skill.id), ['JetBrains/layout:.claude/skills/commits/SKILL.md']);

  recording['https://api.github.com/repos/JetBrains/layout/commits/no-such-branch'] = { status: 404, body: { message: 'Not Found' } };
  await assert.rejects(openGitHub('github.com/JetBrains/layout/tree/no-such-branch', { fetch: replay(recording) }), {
    message: 'Not found in https://github.com/JetBrains/layout: no-such-branch',
  });
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});

/** A fetch that answers as `github`, but never for the URLs that `silent` matches: no answer, no error, the signal ignored. */
const unanswered = (silent: (url: string) => boolean, how: 'no answer' | 'no body' = 'no answer'): Fetch => async (url, init) => {
  if (!silent(url)) return github(url, init);
  if (how === 'no answer') return new Promise<Response>(() => {});
  // The status and the headers, then the body stops: never closed.
  return new Response(new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode('{"sha":')) }), { status: 200 });
};

test('GitHub does not answer → given up after 30 s by default, a clear message', async () => {
  assert.equal(GITHUB_TIMEOUT, 30_000);
  const repository = 'https://api.github.com/repos/JetBrains/example';
  const started = Date.now();
  await assert.rejects(openGitHub('github.com/JetBrains/example', { fetch: unanswered((url) => url === repository), timeout: 200 }), {
    message: `Cannot reach GitHub: no answer in 0.2 s for ${repository}`,
  });
  assert.ok(Date.now() - started < 2_000);
  // An answer whose body stops halfway: the same limit, the answer and its body together.
  const commit = `${repository}/commits/main`;
  await assert.rejects(openGitHub('github.com/JetBrains/example', { fetch: unanswered((url) => url === commit, 'no body'), timeout: 200 }), {
    message: `Cannot reach GitHub: no answer in 0.2 s for ${commit}`,
  });
  // A SKILL.md that never comes.
  const file = `https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`;
  const source = await openGitHub('github.com/JetBrains/example', { fetch: unanswered((url) => url === file), token: 'test', timeout: 200 });
  await assert.rejects(scan(source), { message: `Cannot reach GitHub: no answer in 0.2 s for ${file}` });
  // An answer in time is not given up on.
  const slow: Fetch = async (url, init) => (await new Promise((resolve) => setTimeout(resolve, 50)), github(url, init));
  const scanned = await scan(await openGitHub('github.com/JetBrains/example', { fetch: slow, token: 'test', timeout: 1_000 }));
  assert.equal(scanned.skills.length, 1);
});

test('a limit too long for a timer, or Infinity → no limit: an answer that comes is used, no 1 ms limit', async () => {
  assert.equal(TIMER_LIMIT, 2 ** 31 - 1);
  const warnings: Error[] = [];
  const warn = (warning: Error) => warnings.push(warning);
  process.on('warning', warn);
  try {
    const slow: Fetch = async (url, init) => (await new Promise((resolve) => setTimeout(resolve, 20)), github(url, init));
    for (const timeout of [Infinity, TIMER_LIMIT + 1, 3_000_000_000, TIMER_LIMIT]) {
      const scanned = await scan(await openGitHub('github.com/JetBrains/example', { fetch: slow, token: 'test', timeout }));
      assert.equal(scanned.skills.length, 1, String(timeout));
    }
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('warning', warn);
  }
  assert.deepEqual(warnings.filter((warning) => warning.name === 'TimeoutOverflowWarning'), []);
});

test('organisation: a repository GitHub does not answer for → not scanned, a warning; the others are listed', async () => {
  const result = await scanOrganisation('github.com/skillatlas', {
    fetch: unanswered((url) => url.includes('/SkillAtlas/alpha/')),
    token: 'test',
    timeout: 200,
  });
  // Listed last, with the other one that failed, without a count.
  assert.deepEqual(result.repositories.slice(-2), [
    { name: 'alpha', url: 'https://github.com/SkillAtlas/alpha' },
    { name: 'broken', url: 'https://github.com/SkillAtlas/broken' },
  ]);
  assert.ok(
    result.warnings.includes('alpha: not scanned: Cannot reach GitHub: no answer in 0.2 s for https://api.github.com/repos/SkillAtlas/alpha/commits/main'),
    result.warnings.join('\n'),
  );
  assert.equal(result.repositories.length, 7);
});

test('CLI: GitHub accepts the connection and never answers → a clear message, exit code 1, no hang', { timeout: 20_000 }, async () => {
  const silent = await silentGitHub();
  try {
    for (const link of ['https://github.com/vietage/lang17', 'github.com/vietage']) {
      const started = Date.now();
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [CLI, 'scan', link], { env: silent.env(1) });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (text) => (stdout += text));
        child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      });
      const asked = link.endsWith('lang17') ? 'repos/vietage/lang17' : 'users/vietage';
      assert.deepEqual(result, { code: 1, stdout: '', stderr: `Cannot reach GitHub: no answer in 1 s for https://api.github.com/${asked}\n` }, link);
      // It exits, though the connection it gave up on is still held open.
      assert.ok(Date.now() - started < 8_000, `${link}: ${Date.now() - started} ms`);
    }
    assert.ok(silent.connections() >= 2);
  } finally {
    silent.close();
  }
});

test('CLI: SKILL_ATLAS_GITHUB_TIMEOUT=Infinity, or more than a timer holds → no limit: it waits, no message', { timeout: 20_000 }, async () => {
  const silent = await silentGitHub();
  try {
    for (const seconds of ['Infinity', '3000000']) {
      const child = spawn(process.execPath, [CLI, 'scan', 'https://github.com/vietage/lang17'], { env: silent.env(seconds) });
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (text) => (output += text));
      child.stderr.setEncoding('utf8').on('data', (text) => (output += text));
      const exited = new Promise<number | null>((resolve) => child.on('close', resolve));
      // Still waiting for GitHub after 1.5 s: not given up after 1 ms.
      const early = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve('waiting'), 1_500))]);
      child.kill();
      await exited;
      assert.equal(early, 'waiting', `${seconds}: ${output}`);
      assert.equal(output, '', seconds);
    }
  } finally {
    silent.close();
  }
});

// An organisation: github.com/skillatlas, answered from the recording in tests/helpers.ts.
const organisation = await atlas(['scan', 'github.com/skillatlas']);

test('organisation: github.com/<org>, with or without the scheme or a trailing slash; a repository is not one', () => {
  for (const input of ['github.com/JetBrains', 'https://github.com/JetBrains/', ' http://www.github.com/JetBrains ']) {
    assert.deepEqual(parseGitHubOwner(input), { owner: 'JetBrains' }, input);
  }
  for (const input of ['github.com/JetBrains/kotlin', 'github.com/', 'gitlab.com/JetBrains', './fixture']) {
    assert.equal(parseGitHubOwner(input), undefined, input);
  }
});

test('organisation: its repositories with their skill counts, by count, then by name in any case; none with 0 skills', () => {
  assert.equal(organisation.code, 0, organisation.stderr);
  // Docs, empty (no commit) and huge have 0 skills: not listed, but counted in the header; broken,
  // not scanned, stays.
  assert.equal(
    organisation.stdout,
    [
      'SkillAtlas · 7 repositories · 6 skills',
      'alpha — 2 skills',
      'Beta — 2 skills',
      'example-tools — 2 skills',
      'broken — not scanned',
    ].join('\n'),
  );
});

test('organisation: repositories with 0 skills not listed; every one with 0 skills → only the header, exit code 0', async () => {
  // A user whose repositories each have no skill, one of them failing: it alone is listed.
  const repositories = ['a', 'b', 'c'];
  const scanEmpty = (failing: string[]) => (input: string) =>
    scanOrganisation(input, {
      fetch: async (url) => {
        if (url.endsWith('/users/quiet')) return Response.json({ login: 'quiet', type: 'User' });
        if (url.includes('/users/quiet/repos')) {
          return Response.json(repositories.map((name) => ({ name, full_name: `quiet/${name}`, default_branch: 'main', archived: false, fork: false })));
        }
        if (failing.some((name) => url.includes(`/repos/quiet/${name}/`))) throw new Error('connection refused');
        if (url.includes('/commits/main')) return Response.json({ sha: EXAMPLE_COMMIT });
        return Response.json({ truncated: false, tree: [{ path: 'README.md', type: 'blob' }] });
      },
    });
  assert.deepEqual(await atlas(['scan', 'github.com/quiet'], { scan: scanEmpty([]) }), {
    code: 0,
    stdout: 'quiet · 3 repositories · 0 skills',
    stderr: '',
  });
  assert.deepEqual(await atlas(['scan', 'github.com/quiet'], { scan: scanEmpty(['b']) }), {
    code: 0,
    stdout: 'quiet · 3 repositories · 0 skills\nb — not scanned',
    stderr: 'warning: b: not scanned: Cannot reach GitHub: connection refused',
  });
  // The core keeps every repository, with its count: only the output leaves them out.
  assert.deepEqual((await scanEmpty([])('github.com/quiet')).repositories.map((repository) => repository.skillCount), [0, 0, 0]);
});

test('organisation: each repository by the same rules as one repository; its warnings start with its name', async () => {
  // A SKILL.md outside the agent folders (Docs: skills/guide) is not a skill; malformed front matter is
  // still a skill, with a warning; a tree too large to list at once, without the GITHUB_TOKEN hint:
  // an organisation is never searched.
  assert.deepEqual(organisation.stderr.split('\n'), [
    'warning: example-tools: .agents/skills/release/SKILL.md: malformed front matter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 15; using the directory name',
    'warning: huge: the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills',
    'warning: broken: not scanned: GitHub rate limit reached; try again in a minute',
  ]);
  // The same count as scanning the repository on its own, at the commit scanned.
  const result = await scanRecorded('github.com/skillatlas');
  assert.deepEqual(result.repositories[0], {
    name: 'alpha',
    url: 'https://github.com/SkillAtlas/alpha',
    commit: ORGANISATION_COMMIT,
    skillCount: 2,
  });
  for (const { name, skillCount } of result.repositories.filter((repository) => repository.commit)) {
    const alone = await atlas(['scan', `github.com/SkillAtlas/${name}/tree/${ORGANISATION_COMMIT}`]);
    assert.match(alone.stdout, new RegExp(`^SkillAtlas/${name} · ${skillCount} skills?(\\n|$)`), name);
  }
});

test('organisation: a repository that fails → a warning, the scan goes on; it is listed with no count', async () => {
  const result = await scanRecorded('https://github.com/skillatlas/');
  assert.deepEqual(result.repositories.at(-1), { name: 'broken', url: 'https://github.com/SkillAtlas/broken' });
  assert.equal(result.repositories.length, 7);
  assert.equal(result.skills, 6);
  // Unreachable: the same.
  const offline = await scanOrganisation('github.com/skillatlas', {
    fetch: async (url) => {
      if (url.endsWith('/users/skillatlas')) return Response.json({ login: 'SkillAtlas', type: 'Organization' });
      if (url.includes('/orgs/SkillAtlas/repos')) return Response.json([{ name: 'a', full_name: 'SkillAtlas/a', default_branch: 'main', archived: false, fork: false }]);
      throw new Error('connection refused');
    },
  });
  assert.deepEqual(offline.repositories, [{ name: 'a', url: 'https://github.com/SkillAtlas/a' }]);
  assert.deepEqual(offline.warnings, ['a: not scanned: Cannot reach GitHub: connection refused']);
});

test('organisation: an answer cut off, one that is not JSON, or an unexpected error → a warning each; the others are listed', async () => {
  const names = ['cut', 'html', 'odd', ...Array.from({ length: 12 }, (_, index) => `r${String(index).padStart(2, '0')}`)];
  let requests = 0;
  const result = await scanOrganisation('github.com/acme', {
    fetch: async (url) => {
      requests++;
      if (url.endsWith('/users/acme')) return Response.json({ login: 'acme', type: 'Organization' });
      if (url.includes('/orgs/acme/repos')) {
        return Response.json(names.map((name) => ({ name, full_name: `acme/${name}`, default_branch: 'main', archived: false, fork: false })));
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (url.includes('/commits/main')) return Response.json({ sha: EXAMPLE_COMMIT });
      // The connection cut in the middle of the body.
      if (url.includes('/acme/cut/git/trees')) {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"truncated":'));
            controller.error(new TypeError('terminated'));
          },
        });
        return new Response(stream, { status: 200 });
      }
      // A proxy's error page, with a 200.
      if (url.includes('/acme/html/git/trees')) return new Response('<html>502 Bad Gateway</html>', { status: 200 });
      // JSON, but not a tree: the scan itself fails.
      if (url.includes('/acme/odd/git/trees')) return Response.json({ truncated: false });
      return Response.json({ truncated: false, tree: [] });
    },
  });
  assert.deepEqual(result.repositories.map((repository) => repository.name), [...names.slice(3), 'cut', 'html', 'odd']);
  assert.deepEqual(result.repositories.slice(-3), ['cut', 'html', 'odd'].map((name) => ({ name, url: `https://github.com/acme/${name}` })));
  const tree = (name: string) => `https://api.github.com/repos/acme/${name}/git/trees/${EXAMPLE_COMMIT}?recursive=1`;
  assert.deepEqual(result.warnings, [
    `cut: not scanned: Cannot read GitHub's answer for ${tree('cut')}: terminated`,
    `html: not scanned: GitHub answered 200 for ${tree('html')}, but not with JSON`,
    `odd: not scanned: Unexpected error: Cannot read properties of undefined (reading 'filter')`,
  ]);
  // Nothing is still fetching once the scan is done.
  const done = requests;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(requests, done);
});

test('an answer that is not JSON, or cut off → a clear message, exit code 1', async () => {
  const html = async () => new Response('<html>502 Bad Gateway</html>', { status: 200 });
  await assert.rejects(openGitHub('https://github.com/JetBrains/example', { fetch: html }), {
    message: 'GitHub answered 200 for https://api.github.com/repos/JetBrains/example, but not with JSON',
  });
  const cut = async () =>
    new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('terminated')) }), { status: 200 });
  await assert.rejects(openGitHub('https://github.com/JetBrains/example', { fetch: cut }), {
    message: "Cannot read GitHub's answer for https://api.github.com/repos/JetBrains/example: terminated",
  });
  // The CLI: the message, exit code 1, no stack trace.
  const errors: string[] = [];
  const scanned = await run(['scan', 'https://github.com/JetBrains/example'], {
    open: (input) => openGitHub(input, { fetch: html }),
    scanOrganisation: (input) => scanOrganisation(input, { fetch: html }),
    print: () => {},
    error: (text) => errors.push(text),
  });
  assert.equal(scanned, 1);
  assert.deepEqual(errors, ['GitHub answered 200 for https://api.github.com/repos/JetBrains/example, but not with JSON']);
});

test('organisation: archived repositories and forks are skipped; every page of the list is read', async () => {
  const result = await scanRecorded('github.com/skillatlas');
  const names = result.repositories.map((repository) => repository.name);
  assert.ok(!names.some((name) => name.startsWith('old-')), names.join(', '));
  // Beta and broken are on the second page.
  assert.ok(names.includes('Beta') && names.includes('broken'));
});

test('organisation: a user works the same way', async () => {
  assert.deepEqual(await atlas(['scan', 'https://github.com/someone/']), {
    code: 0,
    stdout: 'someone · 1 repository · 1 skill\ndotfiles — 1 skill',
    stderr: '',
  });
});

test('organisation: unknown → a clear message, exit code 1', async () => {
  assert.deepEqual(await atlas(['scan', 'github.com/no-such-organisation']), {
    code: 1,
    stdout: '',
    stderr: 'Organisation not found: https://github.com/no-such-organisation',
  });
});

test('organisation: --filter works on one repository only → a clear message, exit code 1', async () => {
  assert.deepEqual(await atlas(['scan', 'github.com/skillatlas', '--filter', 'review']), {
    code: 1,
    stdout: '',
    stderr: '--filter works on one repository, not on an organisation',
  });
});

test('organisation: at most `concurrency` repositories are scanned at the same time, 8 by default', async () => {
  const names = Array.from({ length: 20 }, (_, index) => `r${String(index).padStart(2, '0')}`);
  const most = async (concurrency?: number) => {
    let running = 0;
    let highest = 0;
    const result = await scanOrganisation('github.com/many', {
      concurrency,
      fetch: async (url) => {
        if (url.endsWith('/users/many')) return Response.json({ login: 'many', type: 'User' });
        if (url.includes('/users/many/repos')) {
          return Response.json(names.map((name) => ({ name, full_name: `many/${name}`, default_branch: 'main', archived: false, fork: false })));
        }
        if (url.includes('/commits/main')) {
          running++;
          highest = Math.max(highest, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return Response.json({ sha: EXAMPLE_COMMIT });
        }
        running--;
        return Response.json({ truncated: false, tree: [] });
      },
    });
    assert.equal(result.repositories.length, 20);
    // Ties: by name.
    assert.deepEqual(result.repositories.map((repository) => repository.name), names);
    return highest;
  };
  assert.equal(await most(3), 3);
  assert.equal(await most(), 8);
});

test('organisation: an empty repository, without a commit → 0 skills, no warning', async () => {
  const result = await scanRecorded('github.com/skillatlas');
  assert.deepEqual(result.repositories.find((repository) => repository.name === 'empty'), {
    name: 'empty',
    url: 'https://github.com/SkillAtlas/empty',
    skillCount: 0,
  });
  assert.ok(!result.warnings.some((warning) => warning.startsWith('empty:')));
  // On its own: a clear message, exit code 1.
  assert.deepEqual(await atlas(['scan', 'github.com/SkillAtlas/empty']), {
    code: 1,
    stdout: '',
    stderr: 'Repository is empty: https://github.com/SkillAtlas/empty',
  });
});

test('organisation: progress → 0 of the total once listed, then one more as each repository is done, the failed ones too', async () => {
  const seen: [number, number][] = [];
  const result = await scanRecorded('github.com/skillatlas', (scanned, total) => seen.push([scanned, total]));
  assert.equal(result.repositories.length, 7);
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6, 7].map((scanned) => [scanned, 7]));
  // No repositories: 0 of 0.
  const none: [number, number][] = [];
  await scanOrganisation('github.com/nobody', {
    fetch: async (url) => (url.endsWith('/users/nobody') ? Response.json({ login: 'nobody', type: 'User' }) : Response.json([])),
    progress: (scanned, total) => none.push([scanned, total]),
  });
  assert.deepEqual(none, [[0, 0]]);
});

test('organisation on a terminal: a progress bar, scanned/total repositories, hidden before the result is printed', async () => {
  const scanned = await atlas(['scan', 'github.com/skillatlas'], { terminal: true });
  assert.equal(scanned.code, 0);
  assert.deepEqual(scanned.progress, [
    '[--------------------] 0/7 repositories',
    '[##------------------] 1/7 repositories',
    '[#####---------------] 2/7 repositories',
    '[########------------] 3/7 repositories',
    '[###########---------] 4/7 repositories',
    '[##############------] 5/7 repositories',
    '[#################---] 6/7 repositories',
    '[####################] 7/7 repositories',
    'hidden',
  ]);
  // The output itself is the same as without a terminal.
  const piped = await atlas(['scan', 'github.com/skillatlas']);
  assert.deepEqual({ ...scanned, progress: undefined }, { ...piped, progress: undefined });
  assert.equal(piped.progress, undefined);
});

test('organisation on a terminal: the progress bar is hidden when the scan fails', async () => {
  // Unknown: it fails before the repositories are listed.
  const unknown = await atlas(['scan', 'github.com/no-such-organisation'], { terminal: true });
  assert.equal(unknown.code, 1);
  assert.deepEqual(unknown.progress, ['hidden']);
  // Fails while it runs, after some progress.
  const failing = await atlas(['scan', 'github.com/skillatlas'], {
    terminal: true,
    scan: async (_input, progress) => {
      progress?.(0, 3);
      progress?.(1, 3);
      throw new AtlasError('Cannot reach GitHub: connection reset');
    },
  });
  assert.deepEqual(failing, {
    code: 1,
    stdout: '',
    stderr: 'Cannot reach GitHub: connection reset',
    progress: ['[--------------------] 0/3 repositories', '[######--------------] 1/3 repositories', 'hidden'],
  });
});

test('progress bar: filled in proportion, 1 repository, and full for 0 of 0', () => {
  assert.equal(progressBar(0, 549), '[--------------------] 0/549 repositories');
  assert.equal(progressBar(275, 549), '[##########----------] 275/549 repositories');
  assert.equal(progressBar(1, 1), '[####################] 1/1 repository');
  assert.equal(progressBar(0, 0), '[####################] 0/0 repositories');
});

test('./skill-atlas scan github.com/<org>: on a terminal, the bar redrawn on one line on stderr, then erased; piped, none', (t) => {
  // The real CLI, GitHub answered from the recordings; `TERMINAL=1`: stderr is a terminal. Its
  // cache in a directory of the test's own, not in the user's.
  const cache = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const cli = (terminal: boolean) =>
    spawnSync(process.execPath, ['--import', TERMINAL, CLI, 'scan', 'github.com/skillatlas'], {
      encoding: 'utf8',
      env: { ...process.env, TERMINAL: terminal ? '1' : '', SKILL_ATLAS_CACHE: join(cache, 'cache.db') },
    });
  const piped = cli(false);
  assert.equal(piped.status, 0, piped.stderr);
  assert.ok(!piped.stderr.includes('\r'));
  assert.ok(!piped.stderr.includes('/7 repositories'));
  const terminal = cli(true);
  assert.equal(terminal.status, 0, terminal.stderr);
  assert.equal(terminal.stdout, piped.stdout);
  const erase = '\r\x1b[K';
  assert.ok(terminal.stderr.startsWith(`${erase}[--------------------] 0/7 repositories${erase}`), JSON.stringify(terminal.stderr));
  assert.ok(terminal.stderr.includes(`${erase}[####################] 7/7 repositories${erase}warning: `), JSON.stringify(terminal.stderr));
  // Once erased, the warnings as without a terminal.
  assert.equal(terminal.stderr.slice(terminal.stderr.lastIndexOf(erase) + erase.length), piped.stderr);
});

/** The real CLI, GitHub answered from the recordings; `STDOUT_TERMINAL=1`: stdout is a terminal. */
function cliOnTerminal(args: string[], env: Record<string, string>, cache: string) {
  const { NO_COLOR, ...rest } = process.env;
  return spawnSync(process.execPath, ['--import', TERMINAL, CLI, ...args], {
    encoding: 'utf8',
    env: { ...rest, TERMINAL: '', SKILL_ATLAS_CACHE: join(cache, 'cache.db'), ...env },
  });
}

const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
const unstyled = (text: string) => text.replace(/\x1b\[\d+m/g, '');

test('./skill-atlas scan on a terminal: the names bold, the links and also in dim; the same text as piped', (t) => {
  const cache = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const piped = cliOnTerminal(['scan', FIXTURE], { STDOUT_TERMINAL: '' }, cache);
  assert.equal(piped.status, 0, piped.stderr);
  assert.ok(!piped.stdout.includes('\x1b'), JSON.stringify(piped.stdout));
  const terminal = cliOnTerminal(['scan', FIXTURE], { STDOUT_TERMINAL: '1' }, cache);
  assert.equal(terminal.status, 0, terminal.stderr);
  assert.equal(unstyled(terminal.stdout), piped.stdout);
  assert.equal(terminal.stderr, piped.stderr);
  const lines = terminal.stdout.split('\n');
  assert.equal(lines[0], `${bold('fixture')} · 4 skills`);
  assert.equal(lines[1], `${bold('code-style')} — Follow the project's code style.`);
  assert.equal(lines[2], `  ${dim(`${pathToFileURL(FIXTURE).href}/.claude/skills/code-style/SKILL.md`)}`);
  assert.equal(lines[3], `  ${dim('also in .github/skills/code-style/SKILL.md')}`);
  // No description: the name alone, bold.
  assert.ok(lines.includes(bold('release-checklist')), JSON.stringify(lines));
  // With --filter: the same styling, the header and the message as plain.
  const filtered = cliOnTerminal(['scan', FIXTURE, '--filter', 'zzz'], { STDOUT_TERMINAL: '1' }, cache);
  assert.equal(filtered.stdout, `${bold('fixture')} · 0 of 4 skills\nno skills match "zzz"\n`);
});

test('./skill-atlas scan on a terminal with NO_COLOR → plain text', (t) => {
  const cache = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const plain = cliOnTerminal(['scan', FIXTURE], { STDOUT_TERMINAL: '1', NO_COLOR: '1' }, cache);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, `${fixture.stdout}\n`);
});

test('./skill-atlas scan github.com/<org> on a terminal: the organisation and its repositories bold, not scanned dim', (t) => {
  const cache = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const piped = cliOnTerminal(['scan', 'github.com/skillatlas', '--no-cache'], { STDOUT_TERMINAL: '' }, cache);
  assert.equal(piped.status, 0, piped.stderr);
  const terminal = cliOnTerminal(['scan', 'github.com/skillatlas', '--no-cache'], { STDOUT_TERMINAL: '1' }, cache);
  assert.equal(terminal.status, 0, terminal.stderr);
  assert.equal(unstyled(terminal.stdout), piped.stdout);
  const lines = terminal.stdout.trimEnd().split('\n');
  assert.equal(lines[0], `${bold('SkillAtlas')} · 7 repositories · 6 skills`);
  assert.equal(lines[1], `${bold('alpha')} — 2 skills`);
  assert.equal(lines.at(-1), `${bold('broken')} — ${dim('not scanned')}`);
});
