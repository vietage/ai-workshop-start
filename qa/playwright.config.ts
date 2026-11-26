// Manual QA: the scenarios in qa/scenarios, each driven by its script in qa/scripts, in a real
// browser against `./skill-atlas serve`. Every run is recorded: a video, a trace and a screenshot
// per scenario, under qa/results/<run>/. See qa/README.md.
import { defineConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.QA_PORT ?? 4174);
// One id for the whole run; set here once, the workers inherit it.
process.env.QA_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, '-');
const RESULTS = `${ROOT}qa/results/${process.env.QA_RUN_ID}`;
// The commit under test, kept in report.json (config.metadata) so that its issues name it even if
// HEAD moves before `npm run qa:issues`.
const COMMIT = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
})();

export default defineConfig({
  testDir: './scripts',
  outputDir: `${RESULTS}/artifacts`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  metadata: COMMIT ? { commit: COMMIT } : {},
  reporter: [['list'], ['json', { outputFile: `${RESULTS}/report.json` }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // QA_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's Chromium.
    channel: process.env.QA_CHANNEL || undefined,
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `./skill-atlas serve --port ${PORT}`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
