// Files a GitHub issue for each failed scenario of a QA run, with the video of the failure, and the
// label that hands it to an AI agent. A scenario that already has an open issue gets a comment
// with the new run instead. See qa/README.md.
//
//   node qa/file-issues.ts [--run <run id>] [--scenario <id>]... [--dry-run]
//
// The videos are uploaded as assets of one pre-release, `qa-recordings`: GitHub has no API to
// attach a file to an issue, and a release asset gets a stable download link.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LABEL = process.env.QA_ISSUE_LABEL ?? 'Delegated to AI';
export const QA_LABEL = 'qa';
export const RELEASE = 'qa-recordings';

export type Scenario = { id: string; title: string; spec?: string; text: string };

export type Failure = {
  scenario: string;
  test: string;
  file: string;
  status: string;
  error: string;
  step?: string;
  video?: string;
  screenshot?: string;
  trace?: string;
};

// The parts of Playwright's JSON report that are read here.
type ReportResult = {
  status: string;
  errors?: { message?: string }[];
  error?: { message?: string };
  attachments?: { name: string; path?: string; contentType: string }[];
  steps?: ReportStep[];
};
type ReportStep = { title: string; error?: unknown; steps?: ReportStep[] };
type ReportSpec = { title: string; file: string; tests: { results: ReportResult[] }[] };
type ReportSuite = { specs?: ReportSpec[]; suites?: ReportSuite[] };
export type Report = { config?: { metadata?: { commit?: string } }; suites: ReportSuite[] };

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

/** The deepest step that failed: where in the scenario it went wrong. */
function failedStep(steps: ReportStep[] = []): string | undefined {
  const step = steps.find((step) => step.error);
  return step && (failedStep(step.steps) ?? step.title);
}

/** Every scenario whose last result failed or timed out; a skipped scenario is not a failure. */
export function failures(report: Report): Failure[] {
  const found: Failure[] = [];
  const visit = (suite: ReportSuite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const result = test.results.at(-1);
        if (!result || !['failed', 'timedOut', 'interrupted'].includes(result.status)) continue;
        const attachment = (name: string) => result.attachments?.find((a) => a.name === name && a.path)?.path;
        const messages = result.errors?.map((e) => e.message ?? '') ?? [result.error?.message ?? ''];
        found.push({
          scenario: basename(spec.file).replace(/\.spec\.ts$/, ''),
          test: spec.title,
          file: spec.file,
          status: result.status,
          error: stripAnsi(messages.filter(Boolean).join('\n\n')).trim(),
          step: failedStep(result.steps),
          video: attachment('video'),
          screenshot: attachment('screenshot'),
          trace: attachment('trace'),
        });
      }
    }
    suite.suites?.forEach(visit);
  };
  report.suites.forEach(visit);
  return found;
}

/** qa/scenarios/<id>.md: its front matter, and its text. */
export function readScenario(id: string, dir = join(ROOT, 'qa/scenarios')): Scenario {
  const text = readFileSync(join(dir, `${id}.md`), 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const meta = (match ? parseYaml(match[1]) : {}) as Partial<Scenario>;
  return { id, title: meta.title ?? id, spec: meta.spec, text: match ? text.slice(match[0].length).trim() : text.trim() };
}

/** The issue's title: one per scenario, so that a new run finds the open one. */
export const issueTitle = (scenario: Scenario) => `[QA] ${scenario.id}: ${scenario.title} fails`;

/** The issue's body: what was tested, what went wrong, the video, and how to run it again. */
export function issueBody(scenario: Scenario, failure: Failure, run: { id: string; commit: string; repo: string; video?: string }) {
  const blob = `https://github.com/${run.repo}/blob/${run.commit}`;
  const lines = [
    `The manual QA scenario **${scenario.id}** failed in the web view.`,
    '',
    `- Run: \`${run.id}\`, commit \`${run.commit}\``,
    `- Script: [\`${failure.file}\`](${blob}/qa/scripts/${failure.file})`,
    `- Scenario: [\`qa/scenarios/${scenario.id}.md\`](${blob}/qa/scenarios/${scenario.id}.md)`,
    ...(scenario.spec ? [`- Spec: [\`${scenario.spec}\`](${blob}/${scenario.spec})`] : []),
    ...(failure.step ? [`- Failed at the step: **${failure.step}**`] : []),
    `- Video of the failure: ${run.video ?? '_not recorded_'}`,
    '',
    '## Scenario',
    '',
    // Its title is the issue's; its sections go one level down.
    scenario.text.replace(/^#\s.*\n+/, '').replace(/^## /gm, '### '),
    '',
    '## What happened',
    '',
    '```',
    failure.error || failure.status,
    '```',
    '',
    '## Reproduce',
    '',
    '```bash',
    'npm ci && npx playwright install chromium',
    `npm run qa -- ${scenario.id}`,
    '```',
    '',
    `Fix the product so that the scenario passes, as [spec/](https://github.com/${run.repo}/tree/main/spec) describes it. Change`,
    'the scenario or its script only if they contradict the spec.',
    '',
    `<!-- qa-scenario: ${scenario.id} -->`,
  ];
  return lines.join('\n');
}

const gh = (args: string[]) => execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function ensureLabel(name: string, color: string, description: string) {
  const labels = JSON.parse(gh(['label', 'list', '--limit', '500', '--json', 'name'])) as { name: string }[];
  if (!labels.some((label) => label.name.toLowerCase() === name.toLowerCase()))
    gh(['label', 'create', name, '--color', color, '--description', description]);
}

function ensureRelease() {
  try {
    gh(['release', 'view', RELEASE, '--json', 'tagName']);
  } catch {
    gh(['release', 'create', RELEASE, '--prerelease', '--title', 'QA recordings',
      '--notes', 'Videos of failed manual QA scenarios (qa/), linked from their issues. Not a release.']);
  }
}

function uploadVideo(repo: string, path: string, name: string) {
  ensureRelease();
  gh(['release', 'upload', RELEASE, `${path}#${name}`, '--clobber']);
  // The asset's name is the file's base name; the `#` part is only its display label.
  return `https://github.com/${repo}/releases/download/${RELEASE}/${encodeURIComponent(basename(path))}`;
}

/** The newest run under qa/results, or the one asked for. */
function runDir(run?: string) {
  const results = join(ROOT, 'qa/results');
  if (run) return join(results, run);
  const runs = existsSync(results) ? readdirSync(results).filter((dir) => existsSync(join(results, dir, 'report.json'))).sort() : [];
  if (!runs.length) throw new Error('No QA run in qa/results: run `npm run qa` first');
  return join(results, runs.at(-1)!);
}

function main() {
  const { values } = parseArgs({
    options: { run: { type: 'string' }, scenario: { type: 'string', multiple: true }, 'dry-run': { type: 'boolean' } },
  });
  const dir = runDir(values.run);
  const runId = basename(dir);
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as Report;
  const chosen = failures(report).filter((f) => !values.scenario?.length || values.scenario.includes(f.scenario));
  if (!chosen.length) return console.log(`QA run ${runId}: no failed scenarios to file`);

  const dry = values['dry-run'];
  const repo = dry ? process.env.QA_REPO ?? '<owner>/<repo>' : gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  // The commit the run tested; HEAD only for a run recorded before the report kept it.
  const commit = report.config?.metadata?.commit || git(['rev-parse', 'HEAD']);
  if (!dry) {
    ensureLabel(LABEL, '8b03eb', 'An AI agent picks this up');
    ensureLabel(QA_LABEL, 'fbca04', 'Found by manual QA (qa/)');
    ensureLabel('bug', 'd73a4a', "Something isn't working");
  }
  for (const failure of chosen) {
    const scenario = readScenario(failure.scenario);
    const title = issueTitle(scenario);
    const videoName = `${runId}-${scenario.id}.webm`;
    if (dry) {
      console.log(`would file: ${title}\n  video: ${failure.video ? relative(ROOT, failure.video) : 'none'} → ${videoName}\n`);
      console.log(issueBody(scenario, failure, { id: runId, commit, repo, video: `<${videoName}>` }) + '\n');
      continue;
    }
    // Asset names must be unique in the release: copy the video under the run's and scenario's name.
    let video: string | undefined;
    if (failure.video && existsSync(failure.video)) {
      const named = join(dir, videoName);
      execFileSync('cp', [failure.video, named]);
      video = uploadVideo(repo, named, `${scenario.id} (${runId})`);
    }
    const body = issueBody(scenario, failure, { id: runId, commit, repo, video });
    const open = JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', QA_LABEL, '--search', `"${title}" in:title`,
      '--json', 'number,title,url'])) as { number: number; title: string; url: string }[];
    const existing = open.find((issue) => issue.title === title);
    if (existing) {
      gh(['issue', 'comment', String(existing.number), '--body', `Still failing.\n\n${body}`]);
      console.log(`commented: ${existing.url}`);
    } else {
      const url = gh(['issue', 'create', '--title', title, '--body', body, '--label', LABEL, '--label', QA_LABEL, '--label', 'bug']);
      console.log(`filed: ${url}`);
    }
  }
}

if (import.meta.main) main();
