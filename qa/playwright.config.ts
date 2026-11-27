// The QA scenarios in qa/scenarios, each driven by its script in qa/scripts, in a real browser
// against `./skill-atlas serve`. Every run is recorded: a video, a trace and a screenshot per
// scenario, and an HTML report, under qa/results/<run>/. The scripts' named screenshots are
// compared against qa/screenshots only with QA_SCREENSHOTS=1, as `npm run e2e` sets it in the
// Playwright Docker image: elsewhere the rendering differs. See qa/README.md.
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
// QA_COMMIT: given by `npm run e2e`, where the copy in the container is not a git checkout.
const COMMIT = process.env.QA_COMMIT || (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
})();
const SCREENSHOTS = process.env.QA_SCREENSHOTS === '1';
// The fixture's absolute path is on the page: the baselines were made with the checkout at /work.
if (SCREENSHOTS && ROOT !== '/work/')
  throw new Error(`QA_SCREENSHOTS=1 compares the screenshots only in the Docker image, at /work, not at ${ROOT}: run \`npm run e2e\``);

export default defineConfig({
  testDir: './scripts',
  outputDir: `${RESULTS}/artifacts`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  metadata: COMMIT ? { commit: COMMIT } : {},
  reporter: [
    ['list'],
    ['json', { outputFile: `${RESULTS}/report.json` }],
    // With the expected, actual and diff images of a screenshot that differs.
    ['html', { outputFolder: `${RESULTS}/report`, open: 'never' }],
  ],
  // qa/screenshots/<id>-<moment>.png: one set of baselines, made on Linux in the Docker image.
  snapshotPathTemplate: '{testDir}/../screenshots/{arg}{ext}',
  ignoreSnapshots: !SCREENSHOTS,
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // QA_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's Chromium.
    channel: process.env.QA_CHANNEL || undefined,
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    // The same page on every run: its size, light colours, the language and the time zone.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: `./skill-atlas serve --port ${PORT}`,
    cwd: ROOT,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
