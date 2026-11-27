// The cases in spec/red-agent.md: the red-agent skill, checked on its text as agents read it, and
// file-bug.mjs, run as the agent runs it: invalid input, `--dry-run`, and for real against a stub
// `gh` that logs its calls.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseSkill } from '../src/core/parse.ts';
import { atlas } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE_BUG = join(ROOT, '.agents/skills/red-agent/file-bug.mjs');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const skill = read('.agents/skills/red-agent/SKILL.md');
const COMMIT = 'c0ffee0000000000000000000000000000000000';

const BODY = `## Steps to reproduce
1. \`./skill-atlas serve\`, open http://localhost:4173
2. Type \`(\` in the filter

## Expected
spec/web.md, *The page*: "No match → no skills, and \`no skills match "<words>"\`".

## Actual
The page shows nothing and the console has \`SyntaxError: Invalid regular expression\`.
`;

test('red-agent is a project skill: front matter with its name and a description, listed by ./skill-atlas scan .', async () => {
  const parsed = parseSkill(skill);
  assert.equal(parsed.warning, undefined);
  assert.equal(parsed.name, 'red-agent');
  assert.match(parsed.description, /^Tries to break the web view/);
  assert.match(parsed.description, /"Delegated to AI" and "bug"/);
  const { code, stdout, stderr } = await atlas(['scan', ROOT]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /^red-agent — Tries to break the web view/m);
  assert.match(stdout, /^  file:\/\/.*\/\.agents\/skills\/red-agent\/SKILL\.md$/m);
});

test('the skill explores beyond the scenarios: it reads the spec and the scenarios, and goes after every area', () => {
  assert.match(skill, /\[spec\/web\.md\]\([^)]*\) and \[spec\/analysis\.md\]\([^)]*\)/);
  assert.match(skill, /read every scenario in `qa\/scenarios`: what they already cover is\s+not your target/);
  for (const area of ['Links', 'Repositories', 'Skill files', 'Input', 'The filter', 'The organisation view', 'Errors',
    'The network', 'The localhost-only rule', 'The API', 'Accessibility']) {
    assert.match(skill, new RegExp(`^- \\*\\*${area}\\*\\*`, 'm'), area);
  }
});

test('scope: only files, never fixes; the web view only, the CLI as a reference; only localhost', () => {
  assert.match(skill, /\*\*Only files issues, never fixes\.\*\* Don't change `src\/`, `spec\/`, `tests\/` or `qa\/`\. Don't\s+commit, push or open a pull request/);
  assert.match(skill, /\*\*Only the web view\*\*: the page in a browser, and its HTTP API/);
  assert.match(skill, /The CLI is out of\s+scope\. You may run `\.\/skill-atlas scan` as a reference/);
  assert.match(skill, /but don't file CLI bugs/);
  assert.match(skill, /\*\*Only your own machine\.\*\* Attack the server you started on `localhost`\. Never attack GitHub/);
  assert.match(skill, /build them as local directories/);
});

test('a bug: contradicts the spec, or where the spec is silent a crash, a hang, a 500, an injection; taste is reported, not filed', () => {
  assert.match(skill, /A \*\*bug\*\* is anything that contradicts the spec/);
  for (const what of ['a\\s+crash', 'a hang', 'a 500', 'uncaught error', 'script or HTML from a skill', 'answering another host', "can't use from the keyboard"]) {
    assert.match(skill, new RegExp(what), what);
  }
  assert.match(skill, /only taste or a gap in the spec is not a bug\. List it in your report/);
});

test('each bug confirmed: twice on a fresh server, the fewest steps, not a duplicate, not the environment', () => {
  assert.match(skill, /Reproduce it \*\*twice\*\*, against a freshly started server/);
  assert.match(skill, /Cut it down to the \*\*fewest steps\*\*/);
  assert.match(skill, /it isn't the environment/);
});

test('no duplicates: the open issues listed first, the [QA] ones too; a duplicate gets at most a comment', () => {
  assert.match(skill, /Before you file anything, list the open issues\. Check the bugs from manual QA \(`\[QA\] …`\) too/);
  assert.match(skill, /gh issue list --state open --limit 200/);
  assert.match(skill, /A bug that already has an open issue is not filed again, whatever its title/);
  assert.match(skill, /gh issue comment <n> --body \.\.\.`\. That's all you do for a duplicate/);
});

test('a video of each bug with record-demo, its frames checked, not committed', () => {
  assert.match(skill, /\[record-demo\]\(\.\.\/record-demo\/SKILL\.md\)'s\s+\[record\.mjs\]\(\.\.\/record-demo\/record\.mjs\)/);
  assert.match(skill, /node \.agents\/skills\/record-demo\/record\.mjs \/tmp\/red-agent\/<key>\.json \/tmp\/red-agent\/<key>\.mp4/);
  assert.match(skill, /Look at the frames\. The video must show the bug happening/);
  assert.match(skill, /Never commit the videos/);
});

test('filing: one issue per bug with file-bug.mjs, dry run first; at most 5 a run; the report and the artifacts', () => {
  assert.match(skill, /^## Steps to reproduce$/m);
  assert.match(skill, /^## Expected$/m);
  assert.match(skill, /^## Actual$/m);
  assert.match(skill, /node \.agents\/skills\/red-agent\/file-bug\.mjs --key <key> --title "<what goes wrong>" \\\n\s+--body \/tmp\/red-agent\/<key>\.md --video \/tmp\/red-agent\/<key>\.mp4 --dry-run/);
  assert.match(skill, /labelled `Delegated to AI`, `bug` and `red-agent`/);
  assert.match(skill, /\*\*At most 5 issues a run\*\*, the worst first/);
  assert.match(skill, /AIR_ARTIFACTS_DIR/);
  for (const part of ['what you tried, one row per area', 'the issues filed or commented on', 'the bugs not filed', 'the gaps in the spec']) {
    assert.match(skill, new RegExp(part), part);
  }
});

test('every link in the skill resolves to a file in the repository; README.md and spec/qa.md lead to it', () => {
  for (const [, target] of skill.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    if (/^https?:/.test(target)) continue;
    assert.ok(existsSync(join(ROOT, '.agents/skills/red-agent', target)), target);
  }
  assert.match(read('README.md'), /\[red-agent\]\(\.agents\/skills\/red-agent\/SKILL\.md\)/);
  assert.match(read('spec/qa.md'), /spec\/red-agent\.md/);
});

// file-bug.mjs, as the agent runs it.

/** A temporary directory with the body and the video; removed after the test. */
function inputs(t: { after: (fn: () => void) => void }, body = BODY, video = 'mp4 bytes') {
  const dir = mkdtempSync(join(tmpdir(), 'red-agent-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'bug.md'), body);
  writeFileSync(join(dir, 'bug.mp4'), video);
  return { dir, body: join(dir, 'bug.md'), video: join(dir, 'bug.mp4') };
}

// A `gh` first in PATH: logs each call's arguments, one JSON array per line, and answers
// `issue list` with GH_STUB_ISSUES. The release does not exist yet, and neither do the labels but `bug`.
const GH_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + '\\n');
const cmd = args.slice(0, 2).join(' ');
if (cmd === 'repo view') console.log('owner/repo');
else if (cmd === 'label list') console.log('[{"name":"Bug"}]');
else if (cmd === 'release view') process.exit(1);
else if (cmd === 'release upload' && !fs.existsSync(args[3])) process.exit(1);
else if (cmd === 'issue list') console.log(process.env.GH_STUB_ISSUES);
else if (cmd === 'issue create') console.log('https://github.com/owner/repo/issues/40');
else if (cmd === 'issue comment' && process.env.GH_STUB_FAIL) { console.error('HTTP 502: Bad Gateway'); process.exit(1); }
`;

/** Runs file-bug.mjs with these arguments, `gh` the stub; its exit code, output and the stub's calls. */
function fileBug(t: { after: (fn: () => void) => void }, args: string[], openIssues: object[] = [], env: NodeJS.ProcessEnv = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'gh-stub-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'gh'), GH_STUB);
  chmodSync(join(bin, 'gh'), 0o755);
  const log = join(bin, 'calls.jsonl');
  writeFileSync(log, '');
  const out = spawnSync(process.execPath, [FILE_BUG, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, GH_STUB_LOG: log, GH_STUB_ISSUES: JSON.stringify(openIssues), ...env },
  });
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { ...out, calls, call: (cmd: string) => calls.filter((a) => a.slice(0, 2).join(' ') === cmd) };
}

const args = (files: { body: string; video: string }, ...extra: string[]) =>
  ['--key', 'filter-regex-characters', '--title', 'A ( in the filter blanks the page', '--body', files.body, '--video', files.video, '--commit', COMMIT, ...extra];

test('file-bug: invalid input → every problem on stderr, exit 2, nothing filed', (t) => {
  const noSections = inputs(t, 'It broke.\n');
  const bad = fileBug(t, ['--key', 'Filter Regex', '--body', noSections.body, '--video', join(noSections.dir, 'missing.mp4')]);
  assert.equal(bad.status, 2);
  for (const problem of ['--key: lowercase words', '--title:', 'no "## Steps to reproduce" section', 'no "## Expected" section',
    'no "## Actual" section', '"## Expected" cites no spec/ file', '--video: .*missing\\.mp4 is not a file']) {
    assert.match(bad.stderr, new RegExp(problem), problem);
  }
  assert.deepEqual(bad.calls, []);

  // The spec cited elsewhere than under Expected is not enough; an empty video is no video.
  const noSpec = inputs(t, BODY.replace('spec/web.md, *The page*', 'The page').replace('## Actual\n', '## Actual\nSee spec/web.md.\n'), '');
  const out = fileBug(t, args(noSpec));
  assert.equal(out.status, 2);
  assert.match(out.stderr, /"## Expected" cites no spec\/ file/);
  assert.match(out.stderr, /is not a file, or is empty/);
  assert.doesNotMatch(out.stderr, /section/);
  assert.deepEqual(out.calls, []);

  const noBody = fileBug(t, ['--key', 'k', '--title', 't', '--video', noSpec.video]);
  assert.equal(noBody.status, 2);
  assert.match(noBody.stderr, /--body: a Markdown file/);
});

test('file-bug: an unknown option, an option without its value or an argument → one line on stderr, exit 2, nothing filed', (t) => {
  const files = inputs(t);
  const cases: [string[], RegExp][] = [
    [['--key', 'k', '--title', 't', '--body', files.body, '--vidoe', files.video, '--dry-run'], /^Unknown option '--vidoe'/],
    [['--title', 't', '--body', files.body, '--video', files.video, '--dry-run', '--key'], /^Option '--key <value>' argument missing/],
    [['--key', '--title', 't', '--body', files.body, '--video', files.video], /^Option '--key' argument is ambiguous/],
    [[...args(files), 'extra'], /^Unexpected argument 'extra'/],
  ];
  for (const [argv, message] of cases) {
    const out = fileBug(t, argv);
    assert.equal(out.status, 2, argv.join(' '));
    assert.match(out.stderr, message);
    assert.equal(out.stderr.trim().split('\n').length, 1, out.stderr);
    assert.doesNotMatch(out.stderr, /node:internal|ERR_PARSE_ARGS|    at /);
    assert.equal(out.stdout, '');
    assert.deepEqual(out.calls, []);
  }
});

test('file-bug --dry-run: the title, labels, video name and body; nothing uploaded or filed', (t) => {
  const files = inputs(t);
  const out = fileBug(t, args(files, '--dry-run'), [], { RED_AGENT_REPO: 'owner/repo' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^would file: \[Red agent\] A \( in the filter blanks the page$/m);
  assert.match(out.stdout, /labels: Delegated to AI, bug, red-agent/);
  assert.match(out.stdout, /→ filter-regex-characters-c0ffee0\.mp4/);
  assert.match(out.stdout, new RegExp(`- Commit: \`${COMMIT}\``));
  assert.match(out.stdout, /^## Steps to reproduce$/m);
  assert.match(out.stdout, /<!-- red-agent: filter-regex-characters -->/);
  assert.deepEqual(out.calls, []);
});

test('file-bug: a new issue with the three labels, created if missing, and the video uploaded to the red-agent-recordings pre-release', (t) => {
  const files = inputs(t);
  const out = fileBug(t, args(files));
  assert.equal(out.status, 0, out.stderr);
  // Looks for an open issue with the key first.
  const [list] = out.call('issue list');
  assert.ok(list.includes('"red-agent: filter-regex-characters" in:body'));
  assert.ok(list.includes('open'));
  // Only the missing labels are created; `bug` exists, as `Bug`.
  assert.deepEqual(out.call('label create').map((a) => a[2]), ['Delegated to AI', 'red-agent']);
  // The pre-release is created, and the video uploaded under the key's and the commit's name.
  assert.equal(out.call('release create')[0][2], 'red-agent-recordings');
  assert.ok(out.call('release create')[0].includes('--prerelease'));
  const [upload] = out.call('release upload');
  assert.equal(upload[2], 'red-agent-recordings');
  assert.match(upload[3], /\/filter-regex-characters-c0ffee0\.mp4$/);
  assert.ok(upload.includes('--clobber'));
  assert.ok(!existsSync(upload[3]), 'the named copy is removed');
  // The issue.
  const [create] = out.call('issue create');
  const flag = (name: string) => create.flatMap((arg, i) => (create[i - 1] === name ? [arg] : []));
  assert.deepEqual(flag('--title'), ['[Red agent] A ( in the filter blanks the page']);
  assert.deepEqual(flag('--label'), ['Delegated to AI', 'bug', 'red-agent']);
  const [body] = flag('--body');
  assert.match(body, new RegExp(`- Commit: \`${COMMIT}\``));
  assert.match(body, /- Video: https:\/\/github\.com\/owner\/repo\/releases\/download\/red-agent-recordings\/filter-regex-characters-c0ffee0\.mp4/);
  assert.ok(body.includes(BODY.trim()));
  assert.match(body, /<!-- red-agent: filter-regex-characters -->$/);
  assert.deepEqual(out.call('issue comment'), []);
  assert.match(out.stdout, /^filed: https:\/\/github\.com\/owner\/repo\/issues\/40$/m);
});

test('file-bug: an open issue with the key\'s marker gets a comment, not a new issue; another key or a similar title does not', (t) => {
  const files = inputs(t);
  const out = fileBug(t, args(files), [
    // The search is fuzzy: only the marker is the bug's issue.
    { number: 3, url: 'https://github.com/owner/repo/issues/3', body: 'red-agent: filter-regex-characters-2\n<!-- red-agent: filter-regex-characters-2 -->' },
    { number: 12, url: 'https://github.com/owner/repo/issues/12', body: 'earlier\n\n<!-- red-agent: filter-regex-characters -->' },
  ]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.call('issue create'), []);
  const comments = out.call('issue comment');
  assert.equal(comments.length, 1);
  assert.deepEqual(comments[0].slice(0, 4), ['issue', 'comment', '12', '--body']);
  assert.match(comments[0][4], /^Still happens\.\n\nThe \[red agent\]/);
  assert.match(comments[0][4], /releases\/download\/red-agent-recordings\/filter-regex-characters-c0ffee0\.mp4/);
  assert.match(out.stdout, /^commented: https:\/\/github\.com\/owner\/repo\/issues\/12$/m);

  const other = fileBug(t, args(files), [
    { number: 3, url: 'https://github.com/owner/repo/issues/3', body: '<!-- red-agent: filter-regex-characters-2 -->' },
  ]);
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.call('issue create').length, 1);
  assert.deepEqual(other.call('issue comment'), []);
});

test('file-bug: gh fails → its message, exit 1', (t) => {
  const files = inputs(t);
  const out = fileBug(t, args(files), [{ number: 12, url: 'u', body: '<!-- red-agent: filter-regex-characters -->' }], { GH_STUB_FAIL: '1' });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /HTTP 502: Bad Gateway/);
});

test('file-bug: without --commit, the commit checked out', (t) => {
  const files = inputs(t);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const out = fileBug(t, args(files, '--dry-run').filter((a, i, all) => a !== '--commit' && all[i - 1] !== '--commit'));
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, new RegExp(`- Commit: \`${head}\``));
});
