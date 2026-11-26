// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture, for temporary directories, and for GitHub repositories answered from recordings.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

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
