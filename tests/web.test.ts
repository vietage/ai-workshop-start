// The decisions in spec/web.md, checked on a real local server: GitHub answered from recordings,
// ./fixture from the disk.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE, open } from './helpers.ts';
import { serve } from '../src/web.ts';

const { server, url } = await serve({ open, port: 0 });
after(() => server.close());
const port = new URL(url).port;

async function get(path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}
const scan = async (repo: string) => {
  const response = await get(`/api/scan?repo=${encodeURIComponent(repo)}`);
  return { status: response.status, body: JSON.parse(response.text) };
};

test('serve: a page with a field for the repository link, on localhost', async () => {
  assert.match(url, /^http:\/\/localhost:\d+$/);
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.equal(page.type, 'text/html; charset=utf-8');
  assert.match(page.text, /<input id="repo"/);
  assert.match(page.text, /<button id="scan" type="submit">Scan<\/button>/);
  // What a scan returns is never put in as HTML.
  assert.doesNotMatch(page.text, /innerHTML/);
});

test('serve: another host name is refused', async () => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/', headers: { host: `attacker.example:${port}` } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject).end();
  });
  assert.equal(status, 403);
});

test('API: a GitHub repository → its skills, each with its first sentence, pinned link and SKILL.md', async () => {
  const { status, body } = await scan('https://github.com/JetBrains/example');
  assert.equal(status, 200);
  assert.equal(body.repository.id, 'JetBrains/example');
  assert.equal(body.repository.commit, EXAMPLE_COMMIT);
  assert.deepEqual(body.warnings, []);
  assert.equal(body.skills.length, 1);
  const [skill] = body.skills;
  assert.equal(skill.name, 'commits');
  assert.equal(skill.summary, 'Write commit messages the way this repository does.');
  assert.equal(skill.link, `https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`);
  assert.equal(
    skill.content,
    '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  );
});

test('API: a local directory → the same skills as the CLI, sorted by name, with copies, SKILL.md and warnings', async () => {
  const { status, body } = await scan(FIXTURE);
  const cli = await atlas(['scan', FIXTURE]);
  assert.equal(status, 200);
  assert.deepEqual(
    body.skills.map((skill: { name: string }) => skill.name),
    ['code-style', 'commits', 'invoices', 'release-checklist'],
  );
  const codeStyle = body.skills[0];
  assert.deepEqual(codeStyle.copies, ['.github/skills/code-style/SKILL.md']);
  assert.equal(codeStyle.link, `${pathToFileURL(FIXTURE).href}/.claude/skills/code-style/SKILL.md`);
  for (const skill of body.skills) {
    assert.equal(skill.content, readFileSync(join(FIXTURE, skill.path), 'utf8'), skill.path);
  }
  assert.deepEqual(body.warnings.map((warning: string) => `warning: ${warning}`), cli.stderr.split('\n'));
});

test('API: no link, or a scan that fails → 400 and its message', async () => {
  assert.deepEqual(await scan(''), { status: 400, body: { error: 'Enter a GitHub URL or a directory' } });
  assert.deepEqual(await scan('/no/such/directory'), {
    status: 400,
    body: { error: 'Not a GitHub URL or a readable directory: /no/such/directory' },
  });
  const missing = await scan('https://github.com/JetBrains/missing');
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /JetBrains\/missing/);
});

test('API: anything else → 404', async () => {
  assert.equal((await get('/api/nothing')).status, 404);
});

test('./skill-atlas serve prints the address and serves the page', { timeout: 10_000 }, async () => {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      child.stdout.setEncoding('utf8').on('data', (text: string) => {
        const match = /^Skill Atlas: (http:\/\/localhost:\d+) \(Ctrl\+C to stop\)$/m.exec(text);
        if (match) resolve(match[1]);
      });
      child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
    });
    const page = await fetch(address.replace('localhost', '127.0.0.1'));
    assert.equal(page.status, 200);
  } finally {
    child.kill();
  }
});

test('serve where there is no web view, as in the browser terminal → a clear message, exit code 1', async () => {
  assert.deepEqual(await atlas(['serve']), { code: 1, stdout: '', stderr: 'serve runs only from the command line' });
});

test('serve: a port in use, or not a port → a clear message, exit code 1', async () => {
  const busy = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, 'serve', '--port', port], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
    child.on('close', (code) => resolve({ code, stderr }));
  });
  assert.deepEqual(busy, { code: 1, stderr: `Port ${port} is in use; try --port <port>\n` });
  const wrong = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [CLI, 'serve', '--port', 'x'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (text) => (stderr += text));
    child.on('close', (code) => resolve({ code, stderr }));
  });
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /^Not a port: x\nUsage: skill-atlas serve \[--port <port>\]/);
});

test('serve: a malformed request target → 400, and the server keeps running', { timeout: 5_000 }, async () => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: 'http://[', headers: { host: `localhost:${port}` } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject).end();
  });
  assert.equal(status, 400);
  assert.equal((await get('/')).status, 200);
});

test('./skill-atlas serve stops with Ctrl+C', { timeout: 10_000 }, async () => {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve) => child.stdout.setEncoding('utf8').on('data', (text: string) => text.includes('Ctrl+C') && resolve()));
  const exit = new Promise<string | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)));
  child.kill('SIGINT');
  assert.equal(await exit, 'SIGINT');
});

// The page, its own script run in jsdom against the server above.
async function page(path: string) {
  const { JSDOM } = await import('jsdom');
  let scans = 0;
  const dom = new JSDOM((await get('/')).text, {
    url: `http://localhost:${port}${path}`,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = ((input: string) => {
        scans++;
        return fetch(new URL(input, `http://127.0.0.1:${port}`));
      }) as typeof fetch;
    },
  });
  const document = dom.window.document;
  const $ = (id: string) => document.getElementById(id)!;
  /** Waits for the scans started so far to be shown. */
  const settled = async (count: number) => {
    while (scans < count || ($('scan') as HTMLButtonElement).disabled) await new Promise((r) => setTimeout(r, 10));
  };
  const enter = async (repo: string) => {
    const before = scans;
    ($('repo') as HTMLInputElement).value = repo;
    $('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await settled(before + 1);
  };
  const items = () => [...$('skills').children] as HTMLElement[];
  const text = (node: Element, selector: string) => node.querySelector(selector)?.textContent;
  const search = () => Object.fromEntries(new URLSearchParams(dom.window.location.search));
  return { dom, $, settled, enter, items, text, search, close: () => dom.window.close() };
}

test('page: a GitHub repository → <owner>/<repo> · N skills and its commit', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('https://github.com/JetBrains/example');
    assert.equal(view.$('main').hidden, false);
    assert.equal(view.$('summary').textContent, `JetBrains/example · 1 skill · ${EXAMPLE_COMMIT.slice(0, 12)}`);
  } finally {
    view.close();
  }
});

test('page: the skills, sorted by name, with first sentence, path and also in', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const { body } = await scan(FIXTURE);
    assert.match(view.$('summary').textContent!, / · 4 skills$/);
    assert.deepEqual(
      view.items().map((item) => [
        view.text(item, '.name'),
        view.text(item, '.description'),
        view.text(item, '.path'),
        view.text(item, '.copies'),
      ]),
      body.skills.map((skill: { name: string; summary: string; path: string; copies: string[] }) => [
        skill.name,
        skill.summary || undefined,
        skill.path,
        skill.copies.length ? `also in ${skill.copies.join(', ')}` : undefined,
      ]),
    );
    assert.deepEqual(view.items().map((item) => view.text(item, '.name')), ['code-style', 'commits', 'invoices', 'release-checklist']);
    assert.equal(view.text(view.items()[0], '.copies'), 'also in .github/skills/code-style/SKILL.md');
  } finally {
    view.close();
  }
});

test('page: a skill selected → its SKILL.md as it is, and its link', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    // The first skill is selected at first.
    assert.equal(view.items()[0].getAttribute('aria-selected'), 'true');
    const commits = view.items()[1];
    commits.dispatchEvent(new view.dom.window.Event('click'));
    assert.deepEqual(view.items().map((item) => item.getAttribute('aria-selected')), ['false', 'true', 'false', 'false']);
    const path = commits.dataset.path!;
    assert.equal(view.$('skill').querySelector('h2')!.textContent, 'commits');
    assert.equal(view.$('content').textContent, readFileSync(join(FIXTURE, path), 'utf8'));
    const link = view.$('skill').querySelector('a')!;
    assert.equal(link.href, `${pathToFileURL(FIXTURE).href}/${path}`);
    assert.equal(link.textContent, link.href);
  } finally {
    view.close();
  }
});

test('page: warnings, under the skills; a failed scan → its message, nothing else', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const cli = await atlas(['scan', FIXTURE]);
    const warnings = [...view.$('warnings').children].map((item) => `warning: ${item.textContent}`);
    assert.deepEqual(warnings, cli.stderr.split('\n'));
    assert.equal(view.$('skills').nextElementSibling, view.$('warnings'));
    assert.equal(view.$('error').textContent, '');
    await view.enter('/no/such/directory');
    assert.equal(view.$('error').textContent, 'Not a GitHub URL or a readable directory: /no/such/directory');
    assert.equal(view.$('main').hidden, true);
  } finally {
    view.close();
  }
});

test('page: the URL keeps the link and the skill; reload shows the same', { timeout: 5_000 }, async () => {
  const first = await page('/');
  let href: string;
  try {
    await first.enter(FIXTURE);
    first.items()[2].dispatchEvent(new first.dom.window.Event('click'));
    assert.deepEqual(first.search(), { repo: FIXTURE, skill: first.items()[2].dataset.path });
    href = first.dom.window.location.href;
  } finally {
    first.close();
  }
  const reloaded = await page(new URL(href).pathname + new URL(href).search);
  try {
    await reloaded.settled(1);
    assert.equal((reloaded.$('repo') as HTMLInputElement).value, FIXTURE);
    assert.equal(reloaded.items()[2].getAttribute('aria-selected'), 'true');
    assert.equal(reloaded.$('skill').querySelector('h2')!.textContent, 'invoices');
    // A failed scan: the URL points at the link that failed, and a reload shows its message.
    await reloaded.enter('/no/such/directory');
    assert.deepEqual(reloaded.search(), { repo: '/no/such/directory' });
    href = reloaded.dom.window.location.href;
  } finally {
    reloaded.close();
  }
  const failed = await page(new URL(href).pathname + new URL(href).search);
  try {
    await failed.settled(1);
    assert.equal(failed.$('error').textContent, 'Not a GitHub URL or a readable directory: /no/such/directory');
    assert.equal(failed.$('main').hidden, true);
  } finally {
    failed.close();
  }
});
