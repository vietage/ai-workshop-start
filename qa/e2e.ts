// The QA scenarios as end-to-end tests, with their screenshots compared against the baselines in
// qa/screenshots: in the official Playwright Docker image, the same on CI and on any machine, so
// that the pixels are the same. See qa/README.md.
//
//   node qa/e2e.ts [--dry-run] [<playwright test arguments>...]
//   node qa/e2e.ts --update-snapshots      # new baselines; only for the Update screenshots workflow
//
// The image's tag is the @playwright/test version in package-lock.json. The checkout is copied to
// /work in the container, so the fixture's path, shown on the page, is the same everywhere; only
// qa/results and qa/screenshots are copied back.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
/** Where the checkout is in the container: the fixture's path on the page, in every screenshot. */
export const WORKDIR = '/work';

/** The Playwright version installed by `npm ci`, from package-lock.json. */
export function playwrightVersion(lock = JSON.parse(readFileSync(`${ROOT}/package-lock.json`, 'utf8'))): string {
  const version = lock.packages?.['node_modules/@playwright/test']?.version;
  if (!version) throw new Error('No @playwright/test in package-lock.json');
  return version;
}

/** The official image for that version, on Ubuntu 24.04, amd64 as on GitHub's runners. */
export const image = (version = playwrightVersion()) => `mcr.microsoft.com/playwright:v${version}-noble`;

// Passed on to the container when set.
const PASSED = ['GITHUB_TOKEN', 'QA_OFFLINE', 'QA_RUN_ID', 'CI'];

/** The `docker run` arguments that run the scenarios with `args`, for the user `owner` (uid:gid). */
export function dockerArgs(args: string[], { commit, owner, env = process.env }: { commit?: string; owner: string; env?: NodeJS.ProcessEnv }) {
  const script = [
    'set -e',
    // Everything but node_modules and earlier results, so that the host's stay as they are.
    `mkdir -p ${WORKDIR}`,
    `tar -C /src --exclude=./node_modules --exclude=./qa/results -cf - . | tar -C ${WORKDIR} -xf -`,
    `cd ${WORKDIR}`,
    'npm ci --no-audit --no-fund --loglevel=error',
    'status=0',
    'npx playwright test -c qa/playwright.config.ts "$@" || status=$?',
    // Back to the host, owned by its user: the run, and the baselines (written by --update-snapshots).
    'mkdir -p /src/qa/results && cp -R qa/results/. /src/qa/results/',
    'rm -rf /src/qa/screenshots && cp -R qa/screenshots /src/qa/screenshots',
    `chown -R ${owner} /src/qa/results /src/qa/screenshots`,
    'exit $status',
  ].join('\n');
  return [
    'run', '--rm', '--init', '--ipc=host', '--platform', 'linux/amd64',
    '-v', `${ROOT}:/src`,
    '-e', 'QA_SCREENSHOTS=1', '-e', 'NPM_CONFIG_UPDATE_NOTIFIER=false',
    ...(commit ? ['-e', `QA_COMMIT=${commit}`] : []),
    // By name only: the value comes from this process's environment, never onto the command line.
    ...PASSED.filter((name) => env[name] !== undefined).flatMap((name) => ['-e', name]),
    image(),
    'sh', '-c', script, 'sh', ...args,
  ];
}

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const rest = args.filter((arg) => arg !== '--dry-run');
  let commit: string | undefined;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {}
  const owner = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  const docker = dockerArgs(rest, { commit, owner });
  if (dry) return console.log(['docker', ...docker].map((arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(' '));
  const run = spawnSync(process.env.QA_DOCKER ?? 'docker', docker, { stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exit(run.status ?? 1);
}

if (import.meta.main) main();
