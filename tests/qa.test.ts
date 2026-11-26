// The decisions in spec/qa.md: every scenario has its script, and which failures become issues and
// what they say, checked with `qa/file-issues.ts` on a report shaped like Playwright's: with
// `--dry-run`, and for real against a stub `gh` that logs its calls.
// The scripts themselves run in a browser: `npm run qa`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { failures, issueBody, issueTitle, readScenario, type Report } from '../qa/file-issues.ts';

const QA = fileURLToPath(new URL('../qa/', import.meta.url));
const ids = (dir: string, suffix: string) =>
  readdirSync(join(QA, dir)).filter((file) => file.endsWith(suffix)).map((file) => file.slice(0, -suffix.length)).sort();

const result = (status: string, extra: object = {}) => ({ status, attachments: [], steps: [], ...extra });
const REPORT: Report = {
  suites: [{
    specs: [{ title: 'scan-local-directory: Scan a local directory', file: 'scan-local-directory.spec.ts', tests: [{ results: [result('passed')] }] }],
    suites: [{
      specs: [
        {
          title: 'failed-scan: A failed scan shows its message and nothing else',
          file: 'failed-scan.spec.ts',
          tests: [{
            results: [result('failed', {
              errors: [{ message: '\u001b[31mError: expect(locator).toBeHidden() failed\u001b[39m' }],
              attachments: [
                { name: 'screenshot', contentType: 'image/png', path: '/tmp/run/failed-scan/test-failed-1.png' },
                { name: 'video', contentType: 'video/webm', path: '/tmp/run/failed-scan/video.webm' },
              ],
              steps: [{ title: 'Scan fixture/' }, { title: 'Scan a directory that does not exist', error: {}, steps: [{ title: 'expect' }] }],
            })],
          }],
        },
        { title: 'filter-skills: Filter the skills as you type', file: 'filter-skills.spec.ts', tests: [{ results: [result('timedOut')] }] },
        { title: 'github-repository: Scan a GitHub repository at a commit', file: 'github-repository.spec.ts', tests: [{ results: [result('skipped')] }] },
      ],
    }],
  }],
};

test('every scenario has a script, and every script a scenario', () => {
  assert.deepEqual(ids('scenarios', '.md'), ids('scripts', '.spec.ts'));
});

test('every scenario: front matter with its id, a title, the spec it checks, steps and what is expected', () => {
  for (const id of ids('scenarios', '.md')) {
    const scenario = readScenario(id);
    assert.notEqual(scenario.title, id, id);
    assert.match(scenario.spec ?? '', /^spec\/\w+\.md/, id);
    assert.match(scenario.text, /^## Steps$/m, id);
    assert.match(scenario.text, /^## Expected$/m, id);
  }
});

test('failed and timed-out scenarios are failures; passed and skipped ones are not', () => {
  const found = failures(REPORT);
  assert.deepEqual(found.map((f) => [f.scenario, f.status]), [['failed-scan', 'failed'], ['filter-skills', 'timedOut']]);
  assert.equal(found[0].error, 'Error: expect(locator).toBeHidden() failed');
  assert.equal(found[0].step, 'Scan a directory that does not exist');
  assert.equal(found[0].video, '/tmp/run/failed-scan/video.webm');
});

test('the issue: one title per scenario; the scenario, the failed step, the error, the video and how to reproduce', () => {
  const scenario = readScenario('failed-scan');
  const [failure] = failures(REPORT);
  assert.equal(issueTitle(scenario), '[QA] failed-scan: A failed scan shows its message and nothing else fails');
  const body = issueBody(scenario, failure, { id: 'run-1', commit: 'abc123', repo: 'owner/repo', video: 'https://example.com/v.webm' });
  assert.match(body, /Run: `run-1`, commit `abc123`/);
  assert.match(body, /https:\/\/github\.com\/owner\/repo\/blob\/abc123\/qa\/scenarios\/failed-scan\.md/);
  assert.match(body, /Failed at the step: \*\*Scan a directory that does not exist\*\*/);
  assert.match(body, /Video of the failure: https:\/\/example\.com\/v\.webm/);
  assert.match(body, /^### Steps$/m);
  assert.match(body, /Error: expect\(locator\)\.toBeHidden\(\) failed/);
  assert.match(body, /npm run qa -- failed-scan/);
  assert.match(body, /<!-- qa-scenario: failed-scan -->/);
});

test('qa:issues --dry-run: an issue per failure of the run, only the scenarios asked for', (t) => {
  const run = `test-${process.pid}`;
  const dir = join(QA, 'results', run);
  mkdirSync(dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(REPORT));
  const issues = (...args: string[]) => {
    const out = spawnSync(process.execPath, [join(QA, 'file-issues.ts'), '--dry-run', '--run', run, ...args], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    return out.stdout.split('\n').filter((line) => line.startsWith('would file: '));
  };
  assert.deepEqual(issues(), [
    'would file: [QA] failed-scan: A failed scan shows its message and nothing else fails',
    'would file: [QA] filter-skills: Filter the skills as you type fails',
  ]);
  assert.deepEqual(issues('--scenario', 'filter-skills'), ['would file: [QA] filter-skills: Filter the skills as you type fails']);
  assert.deepEqual(issues('--scenario', 'scan-local-directory'), []);
});

/** A run directory under qa/results with this report, removed after the test. */
function sampleRun(t: { after: (fn: () => void) => void }, report: Report | ((dir: string) => Report)) {
  const run = `test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(QA, 'results', run);
  mkdirSync(dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'report.json'), JSON.stringify(typeof report === 'function' ? report(dir) : report));
  return { run, dir };
}

test('qa:issues: the issue names the commit the run tested, not the one checked out', (t) => {
  const tested = 'c0ffee0000000000000000000000000000000000';
  const { run } = sampleRun(t, { ...REPORT, config: { metadata: { commit: tested } } });
  const out = spawnSync(process.execPath, [join(QA, 'file-issues.ts'), '--dry-run', '--run', run, '--scenario', 'failed-scan'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, new RegExp(`Run: \`${run}\`, commit \`${tested}\``));
  assert.match(out.stdout, new RegExp(`/blob/${tested}/qa/scenarios/failed-scan\\.md`));
});

// A `gh` first in PATH: logs each call's arguments, one JSON array per line, and answers
// `issue list` with GH_STUB_ISSUES. The release does not exist yet, and neither do the labels.
const GH_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + '\\n');
const cmd = args.slice(0, 2).join(' ');
if (cmd === 'repo view') console.log('owner/repo');
else if (cmd === 'label list') console.log('[]');
else if (cmd === 'release view') process.exit(1);
else if (cmd === 'issue list') console.log(process.env.GH_STUB_ISSUES);
else if (cmd === 'issue create') console.log('https://github.com/owner/repo/issues/7');
`;

/** Runs `qa:issues` for failed-scan of a sample run, for real against the stub `gh`; its calls. */
function fileIssues(t: { after: (fn: () => void) => void }, openIssues: object[]) {
  const { run, dir } = sampleRun(t, (dir) => ({
    config: { metadata: { commit: 'c0ffee0000000000000000000000000000000000' } },
    suites: [{
      specs: [{
        title: 'failed-scan: A failed scan shows its message and nothing else',
        file: 'failed-scan.spec.ts',
        tests: [{
          results: [result('failed', {
            errors: [{ message: 'Error: expect(locator).toBeHidden() failed' }],
            attachments: [{ name: 'video', contentType: 'video/webm', path: join(dir, 'artifacts/video.webm') }],
          })],
        }],
      }],
    }],
  }));
  mkdirSync(join(dir, 'artifacts'));
  writeFileSync(join(dir, 'artifacts/video.webm'), 'webm');
  const bin = mkdtempSync(join(tmpdir(), 'gh-stub-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  writeFileSync(join(bin, 'gh'), GH_STUB);
  chmodSync(join(bin, 'gh'), 0o755);
  const log = join(bin, 'calls.jsonl');
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, GH_STUB_LOG: log, GH_STUB_ISSUES: JSON.stringify(openIssues) };
  delete env.QA_ISSUE_LABEL;
  const out = spawnSync(process.execPath, [join(QA, 'file-issues.ts'), '--run', run, '--scenario', 'failed-scan'], { encoding: 'utf8', env });
  assert.equal(out.status, 0, out.stderr);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]);
  return { run, dir, out: out.stdout, calls, call: (cmd: string) => calls.filter((args) => args.slice(0, 2).join(' ') === cmd) };
}

const TITLE = '[QA] failed-scan: A failed scan shows its message and nothing else fails';

test('qa:issues: a new issue with the labels and a link to the video uploaded to the qa-recordings pre-release', (t) => {
  const { run, dir, out, call } = fileIssues(t, []);
  // The labels exist before the issue uses them.
  assert.deepEqual(call('label create').map((args) => args[2]), ['Delegated to AI', 'qa', 'bug']);
  // The video, under the run's and the scenario's name, goes to the pre-release.
  assert.equal(call('release create')[0][2], 'qa-recordings');
  assert.ok(call('release create')[0].includes('--prerelease'));
  const video = `${run}-failed-scan.webm`;
  assert.ok(existsSync(join(dir, video)));
  assert.deepEqual(call('release upload'), [['release', 'upload', 'qa-recordings', `${join(dir, video)}#failed-scan (${run})`, '--clobber']]);
  // Looks for an open issue for the scenario, finds none, files one.
  assert.equal(call('issue list').length, 1);
  assert.deepEqual(call('issue comment'), []);
  const [create] = call('issue create');
  assert.ok(create, 'no issue create');
  const flag = (name: string) => create.flatMap((arg, i) => (create[i - 1] === name ? [arg] : []));
  assert.deepEqual(flag('--title'), [TITLE]);
  assert.deepEqual(flag('--label'), ['Delegated to AI', 'qa', 'bug']);
  const [body] = flag('--body');
  assert.match(body, new RegExp(`Video of the failure: https://github\\.com/owner/repo/releases/download/qa-recordings/${video}`));
  assert.match(body, /commit `c0ffee0{34}`/);
  assert.match(out, /filed: https:\/\/github\.com\/owner\/repo\/issues\/7/);
});

test('qa:issues: an open issue for the scenario gets a comment, not a new issue', (t) => {
  const { out, call } = fileIssues(t, [
    // The search is fuzzy: only the same title is the scenario's issue.
    { number: 3, title: '[QA] failed-scan-2: Another scenario fails', url: 'https://github.com/owner/repo/issues/3' },
    { number: 12, title: TITLE, url: 'https://github.com/owner/repo/issues/12' },
  ]);
  assert.deepEqual(call('issue create'), []);
  const comments = call('issue comment');
  assert.equal(comments.length, 1);
  assert.deepEqual(comments[0].slice(0, 4), ['issue', 'comment', '12', '--body']);
  assert.match(comments[0][4], /^Still failing\.\n\nThe manual QA scenario \*\*failed-scan\*\* failed/);
  assert.match(comments[0][4], /releases\/download\/qa-recordings\//);
  assert.match(out, /commented: https:\/\/github\.com\/owner\/repo\/issues\/12/);
});
