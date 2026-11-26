// The decisions in spec/qa.md: every scenario has its script, and which failures become issues and
// what they say, checked with `qa/file-issues.ts --dry-run` on a report shaped like Playwright's.
// The scripts themselves run in a browser: `npm run qa`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
