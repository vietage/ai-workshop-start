#!/usr/bin/env node
// Records a demo video from a JSON script: node record.mjs <script.json> <out.mp4>
// See SKILL.md for the script format. Needs setup.sh first (Playwright in $DEMO_TOOLS, ffmpeg).
import { createRequire } from 'node:module';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

const [scriptPath, outPath] = process.argv.slice(2);
if (!scriptPath || !outPath) {
  console.error('usage: node record.mjs <script.json> <out.mp4>');
  process.exit(1);
}
const tools = process.env.DEMO_TOOLS ?? '/tmp/demo-tools';
const { chromium } = createRequire(join(tools, 'package.json'))('playwright');
const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const viewport = { width: 1280, height: 760, ...script.viewport };
const typingDelay = script.typingDelay ?? 120;

const freePort = () => new Promise((ok) => {
  const s = createServer().listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); });
});

// `serve`: start ./skill-atlas serve on a free port and wait until it answers.
let server;
let base = script.url ?? '';
if (script.serve) {
  const port = await freePort();
  server = spawn('./skill-atlas', ['serve', '--port', String(port)], { cwd: root, stdio: 'ignore' });
  base = `http://localhost:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (i > 100) throw new Error('the server did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const browserPath = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: browserPath });
}
const videoDir = mkdtempSync(join(tmpdir(), 'demo-'));
const context = await browser.newContext({ viewport, recordVideo: { dir: videoDir, size: viewport } });
const page = await context.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const cuts = []; // [start, end] seconds of waiting to cut from the video
const pause = (ms) => page.waitForTimeout(ms);
let caption = '';
let onTerminal = false;

const showCaption = () => page.evaluate((text) => {
  let el = document.getElementById('__demo-caption');
  if (!text) return el?.remove();
  if (!el) {
    el = document.createElement('div');
    el.id = '__demo-caption';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;'
      + 'background:rgba(20,20,30,.88);color:#fff;font:600 20px/1.4 system-ui,sans-serif;'
      + 'padding:10px 20px;border-radius:10px;max-width:80%;text-align:center;pointer-events:none';
    document.body.append(el);
  }
  el.textContent = text;
}, caption);

const TERMINAL = `<!doctype html><style>
  html,body{margin:0;height:100%;background:#1e1f26;color:#e6e6e6}
  #t{padding:24px 28px;font:16px/1.5 ui-monospace,'DejaVu Sans Mono',monospace;white-space:pre-wrap;word-break:break-all}
  .p{color:#7ee787}.err{color:#f0b454}.code{color:#ff7b72}</style><div id="t"></div>`;

async function run(command) {
  if (!onTerminal) { await page.setContent(TERMINAL); onTerminal = true; await showCaption(); }
  await page.evaluate(() => {
    const line = document.createElement('div');
    line.innerHTML = '<span class="p">$ </span><span class="cmd"></span>';
    document.getElementById('t').append(line);
  });
  for (const ch of command) {
    await page.evaluate((c) => { document.querySelectorAll('.cmd').item(document.querySelectorAll('.cmd').length - 1).textContent += c; }, ch);
    await pause(typingDelay * 0.3);
  }
  await pause(400);
  const start = now();
  const r = spawnSync('bash', ['-c', command], { cwd: root, encoding: 'utf8', env: process.env });
  if (now() - start > 1.5) cuts.push([start + 0.5, now()]);
  const lines = [
    ...r.stdout.split('\n').filter((l, i, a) => i < a.length - 1 || l).map((text) => ({ text, cls: '' })),
    ...r.stderr.split('\n').filter((l, i, a) => i < a.length - 1 || l).map((text) => ({ text, cls: 'err' })),
    ...(r.status ? [{ text: `exit code ${r.status}`, cls: 'code' }] : []),
  ];
  for (const { text, cls } of lines) {
    await page.evaluate(({ text, cls }) => {
      const el = document.createElement('div');
      el.className = cls;
      el.textContent = text || ' ';
      document.getElementById('t').append(el);
      window.scrollTo(0, document.body.scrollHeight);
    }, { text, cls });
    await pause(60);
  }
}

try {
  for (const step of script.steps) {
    if ('goto' in step) {
      await page.goto(new URL(step.goto, base || undefined).href);
      onTerminal = false;
      await showCaption();
    } else if ('type' in step) {
      // types at the end of the field, as a person would
      await page.locator(step.type).focus();
      await page.keyboard.press('End');
      await page.locator(step.type).pressSequentially(step.text, { delay: typingDelay });
    } else if ('fill' in step) {
      await page.fill(step.fill, step.text ?? '');
    } else if ('click' in step) {
      await page.locator(step.click).first().click();
    } else if ('press' in step) {
      await page.keyboard.press(step.press);
    } else if ('waitFor' in step) {
      const start = now();
      await page.locator(step.waitFor).first().waitFor({ timeout: step.timeout ?? 120000 });
      if (now() - start > 1.5) cuts.push([start + 0.7, now()]);
    } else if ('reload' in step) {
      await page.reload();
      await showCaption();
    } else if ('run' in step) {
      await run(step.run);
    } else if ('caption' in step) {
      caption = step.caption;
      await showCaption();
    } else if (!('pause' in step)) {
      throw new Error(`unknown step: ${JSON.stringify(step)}`);
    }
    await pause(step.pause ?? 0);
  }
  await pause(1000);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  server?.kill();
  if (video) {
    // waiting longer than 1.5 s (a scan, a slow command) is cut down to under a second
    const keep = cuts.length ? `select='${cuts.map(([a, b]) => `not(between(t,${a.toFixed(2)},${b.toFixed(2)}))`).join('*')}',setpts=N/25/TB,` : '';
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', await video.path(), '-r', '25',
      '-vf', `${keep}format=yuv420p`, '-c:v', 'libx264', '-crf', '26', '-preset', 'slow',
      '-movflags', '+faststart', '-an', resolve(outPath)], { stdio: 'inherit' });
    rmSync(videoDir, { recursive: true, force: true });
    if (r.status) process.exit(r.status);
    const duration = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath], { encoding: 'utf8' }).stdout.trim();
    console.log(`${outPath}: ${Math.round(Number(duration))} s`);
  }
}
