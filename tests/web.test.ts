// The decisions in spec/web.md, checked on a real local server: GitHub answered from recordings,
// ./fixture from the disk.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE, github, open, ORGANISATION_COMMIT, scanOrganisation, silentGitHub } from './helpers.ts';
import { openGitHub, parseGitHubUrl, type Fetch } from '../src/core/github.ts';
import { scanOrganisation as scanOwner } from '../src/core/organisation.ts';
import { serve, type WebOptions } from '../src/web.ts';
import { AtlasError } from '../src/core/errors.ts';

const { server, url } = await serve({ open, scanOrganisation, port: 0 });
after(() => server.close());
const port = new URL(url).port;

async function get(path: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
}
const scan = async (repo: string, filter?: string) => {
  const query = filter === undefined ? '' : `&filter=${encodeURIComponent(filter)}`;
  const response = await get(`/api/scan?repo=${encodeURIComponent(repo)}${query}`);
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

test('API: &filter=<word> → only the skills that match, as --filter, and the count before it', async () => {
  const all = await scan(FIXTURE);
  assert.equal(all.body.total, 4);
  const commit = await scan(FIXTURE, 'COMMIT');
  assert.equal(commit.status, 200);
  assert.deepEqual(commit.body.skills.map((skill: { name: string }) => skill.name), ['code-style', 'commits']);
  assert.equal(commit.body.total, 4);
  assert.deepEqual(commit.body.warnings, all.body.warnings);
  assert.deepEqual(commit.body.skills[1], all.body.skills[1]);
  const none = await scan(FIXTURE, 'zzz');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.skills, []);
  assert.equal(none.body.total, 4);
  // An empty word: no filter.
  assert.deepEqual((await scan(FIXTURE, ' ')).body, all.body);
});

test('API: &filter=<words> → the skills with every word, in any order, as --filter', async () => {
  const all = await scan(FIXTURE);
  const words = await scan(FIXTURE, ' module  billing ');
  assert.equal(words.status, 200);
  assert.deepEqual(words.body.skills.map((skill: { name: string }) => skill.name), ['invoices']);
  assert.equal(words.body.total, 4);
  assert.deepEqual(words.body.warnings, all.body.warnings);
  // Every word: commits has "commit", but not "kotlin".
  const and = await scan(FIXTURE, 'commit kotlin');
  assert.deepEqual(and.body.skills.map((skill: { name: string }) => skill.name), ['code-style']);
  const none = await scan(FIXTURE, 'commit zzz');
  assert.deepEqual({ status: none.status, skills: none.body.skills, total: none.body.total }, { status: 200, skills: [], total: 4 });
  // Blank, with tabs and new lines: no filter.
  assert.deepEqual((await scan(FIXTURE, ' \t\n ')).body, all.body);
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

test('serve: a malformed header → 400 and "Not a valid request" as JSON, and the server keeps running', { timeout: 5_000 }, async () => {
  // A raw socket: node:http's client refuses to send a header line without a colon.
  const answer = await new Promise<string>((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port) }, () =>
      socket.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nBad Header\r\n\r\n`),
    );
    let text = '';
    socket.setEncoding('utf8').on('data', (chunk) => (text += chunk));
    socket.on('end', () => resolve(text)).on('error', reject);
  });
  const [head, body] = answer.split('\r\n\r\n');
  const lines = head.split('\r\n');
  assert.equal(lines[0], 'HTTP/1.1 400 Bad Request');
  assert.ok(lines.includes('content-type: application/json; charset=utf-8'), head);
  assert.ok(lines.includes(`content-length: ${Buffer.byteLength(body)}`), head);
  assert.deepEqual(JSON.parse(body), { error: 'Not a valid request' });
  assert.equal((await get('/')).status, 200);
});

// Longer than Node's default 16 KB for a request's URL and headers: the issue's link.
const LONG_LINK = `https://github.com/${'a'.repeat(20_000)}`;
const LONG_PATH = `/no/such/${'a'.repeat(20_000)}`;

test('API: a link over 16 KB → 400 and its scan\'s message as JSON, not a 431; with stream=1 too', async () => {
  const github = await scan(LONG_LINK);
  assert.equal(github.status, 400);
  assert.match(github.body.error, new RegExp(`${'a'.repeat(20_000)}$`));
  assert.deepEqual(await scan(LONG_PATH), { status: 400, body: { error: `Not a GitHub URL or a readable directory: ${LONG_PATH}` } });
  const streamed = await get(`/api/scan?stream=1&repo=${encodeURIComponent(LONG_PATH)}`);
  assert.deepEqual(
    { status: streamed.status, type: streamed.type, body: JSON.parse(streamed.text) },
    { status: 400, type: 'application/json; charset=utf-8', body: { error: `Not a GitHub URL or a readable directory: ${LONG_PATH}` } },
  );
});

test('serve: the page\'s own URL with a link over 16 KB → the page', async () => {
  const reload = await get(`/?repo=${encodeURIComponent(LONG_LINK)}&filter=commit`);
  assert.equal(reload.status, 200);
  assert.equal(reload.type, 'text/html; charset=utf-8');
  assert.equal(reload.text, (await get('/')).text);
});

test('serve: a request over 4 MB → 400 and a message as JSON, and the server keeps running', { timeout: 10_000 }, async () => {
  const answer = await new Promise<{ status?: number; type?: string; text: string }>((resolve, reject) => {
    const path = `/api/scan?repo=${'a'.repeat(4 * 1024 * 1024 + 1)}`;
    request({ host: '127.0.0.1', port, path, headers: { host: `localhost:${port}` } }, (response) => {
      let text = '';
      response.setEncoding('utf8').on('data', (chunk) => (text += chunk));
      response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], text }));
    }).on('error', reject).end();
  });
  assert.deepEqual(
    { ...answer, text: JSON.parse(answer.text) },
    { status: 400, type: 'application/json; charset=utf-8', text: { error: 'The request is too long: at most 4 MB' } },
  );
  assert.equal((await get('/')).status, 200);
});

test('./skill-atlas serve stops with Ctrl+C', { timeout: 10_000 }, async () => {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve) => child.stdout.setEncoding('utf8').on('data', (text: string) => text.includes('Ctrl+C') && resolve()));
  const exit = new Promise<string | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)));
  child.kill('SIGINT');
  assert.equal(await exit, 'SIGINT');
});

// The page, its own script run in jsdom against the server above, or the one on `at`.
async function page(path: string, at = port) {
  const { JSDOM } = await import('jsdom');
  let scans = 0;
  const requests: string[] = [];
  const dom = new JSDOM((await get('/')).text, {
    url: `http://localhost:${at}${path}`,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = ((input: string, init?: RequestInit) => {
        scans++;
        requests.push(String(input));
        return fetch(new URL(input, `http://127.0.0.1:${at}`), init);
      }) as typeof fetch;
      // As in a browser: jsdom has no TextDecoder of its own, and its AbortSignal is not the one
      // this fetch takes.
      Object.assign(window, { TextDecoder, AbortController });
    },
  });
  const document = dom.window.document;
  const $ = (id: string) => document.getElementById(id)!;
  /** Waits for the scans started so far to be shown: the button is Scan again. */
  const settled = async (count: number) => {
    while (scans < count || $('scan').textContent !== 'Scan') await new Promise((r) => setTimeout(r, 10));
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
  /** Types into the filter field, as a user does. */
  const filter = (word: string) => {
    ($('filter') as HTMLInputElement).value = word;
    $('filter').dispatchEvent(new dom.window.Event('input'));
  };
  const names = () => items().map((item) => text(item, '.name'));
  /** Whether the page's style shows the element: it and every parent not `display: none`. */
  const shown = (id: string) => {
    for (let node: Element | null = $(id); node; node = node.parentElement) {
      if (dom.window.getComputedStyle(node).display === 'none') return false;
    }
    return true;
  };
  const selected = () => items().find((item) => item.getAttribute('aria-selected') === 'true')?.dataset.path;
  return { dom, $, settled, enter, items, text, search, filter, names, selected, shown, scans: () => scans, requests, close: () => dom.window.close() };
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

test('page: warnings in their own area, above the skills; a failed scan → its message, nothing else', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const cli = await atlas(['scan', FIXTURE]);
    const warnings = [...view.$('warnings').children].map((item) => `warning: ${item.textContent}`);
    assert.deepEqual(warnings, cli.stderr.split('\n'));
    assert.equal(view.$('problems-title').textContent, '2 warnings');
    assert.equal(view.shown('problems'), true);
    // Apart from the skills: not in them, and above them.
    assert.equal(view.$('main').contains(view.$('problems')), false);
    assert.equal(view.$('problems').nextElementSibling, view.$('main'));
    assert.equal(view.$('error').textContent, '');
    await view.enter('/no/such/directory');
    assert.equal(view.$('error').textContent, 'Not a GitHub URL or a readable directory: /no/such/directory');
    assert.equal(view.$('main').hidden, true);
    // Hidden as the page's style shows it, too: no rule for main may show it again.
    assert.equal(view.shown('main'), false);
    assert.equal(view.shown('error'), true);
    assert.equal(view.shown('organisation'), false);
    assert.equal(view.shown('progress'), false);
    assert.equal(view.shown('problems'), false);
  } finally {
    view.close();
  }
});

/** A server whose organisation scan has `count` warnings: the recorded ones, then made-up ones. */
async function warningServer(count: number) {
  const { server, url } = await serve({
    open,
    port: 0,
    async scanOrganisation(input, progress) {
      const result = await scanOrganisation(input, progress);
      const extra = Array.from({ length: count - result.warnings.length }, (_, index) => `repository-${index}: GitHub rate limit reached; try again in a minute`);
      return { ...result, warnings: [...result.warnings, ...extra] };
    },
  });
  return { port: new URL(url).port, close: () => server.close() };
}

/** The warnings' list: at most 160px high, scrolled when its warnings don't fit. */
function assertLimited(view: Awaited<ReturnType<typeof page>>) {
  const style = view.dom.window.getComputedStyle(view.$('warnings'));
  assert.equal(style.maxHeight, '160px');
  assert.equal(style.overflowY, 'auto');
  // Only the list scrolls: the area itself and its title don't grow with it.
  const area = view.dom.window.getComputedStyle(view.$('problems'));
  assert.equal(area.height, 'auto');
  assert.equal(area.maxHeight, 'none');
  assert.equal(view.$('problems').children.length, 2);
}

test('page: a few warnings → all in the area, which has a limited height', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    assert.equal(view.shown('problems'), true);
    assert.equal(view.$('problems-title').textContent, '3 warnings');
    assert.equal(view.$('warnings').children.length, 3);
    assertLimited(view);
    // The area is apart from the organisation's repositories, under them.
    assert.equal(view.$('organisation').contains(view.$('problems')), false);
    assert.equal(view.$('organisation').compareDocumentPosition(view.$('problems')) & view.dom.window.Node.DOCUMENT_POSITION_FOLLOWING, view.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  } finally {
    view.close();
  }
});

test('page: many warnings → all in the area, which does not grow past its limit and scrolls', { timeout: 5_000 }, async () => {
  const stand = await warningServer(200);
  const view = await page('/', stand.port);
  try {
    await view.enter('github.com/skillatlas');
    assert.equal(view.$('problems-title').textContent, '200 warnings');
    const items = [...view.$('warnings').children];
    assert.equal(items.length, 200);
    assert.equal(items.at(-1)!.textContent, 'repository-196: GitHub rate limit reached; try again in a minute');
    assertLimited(view);
    // 200 lines of 20px are far past the limit: the list is focusable, to scroll it with the keys.
    assert.equal(view.dom.window.getComputedStyle(view.$('warnings')).lineHeight, '20px');
    assert.equal(view.$('warnings').tabIndex, 0);
    // The repositories and, once one is selected, its skills are still shown, the warnings with them.
    assert.equal(view.shown('repositories'), true);
    const scans = view.scans();
    ([...view.$('repositories').children][0] as HTMLElement).dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    assert.equal(view.shown('main'), true);
    assert.deepEqual(view.names(), ['one', 'two']);
    assert.equal(view.$('warnings').children.length, 200);
    assertLimited(view);
  } finally {
    view.close();
    stand.close();
  }
});

test('page: whatever is hidden is not shown, whatever its own style', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    for (const element of view.dom.window.document.querySelectorAll('body *')) {
      // The attribute, as `hidden = true` sets it: the scenery's SVG elements have no such property.
      element.setAttribute('hidden', '');
      assert.equal(view.dom.window.getComputedStyle(element).display, 'none', element.outerHTML.slice(0, 60));
      element.removeAttribute('hidden');
    }
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
    assert.equal(failed.shown('main'), false);
  } finally {
    failed.close();
  }
});

test('serve: GitHub accepts the connection and never answers → the scan fails with a clear message, the page shows it', { timeout: 20_000 }, async () => {
  const silent = await silentGitHub();
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { env: silent.env(1), stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const at = await new Promise<string>((resolve, reject) => {
      child.stdout.setEncoding('utf8').on('data', (text: string) => {
        const match = /localhost:(\d+)/.exec(text);
        if (match) resolve(match[1]);
      });
      child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
    });
    const link = 'https://github.com/vietage/lang17';
    const message = 'Cannot reach GitHub: no answer in 1 s for https://api.github.com/repos/vietage/lang17';
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${at}/api/scan?repo=${encodeURIComponent(link)}`);
    assert.deepEqual({ status: response.status, body: await response.json() }, { status: 400, body: { error: message } });
    assert.ok(Date.now() - started < 8_000, `${Date.now() - started} ms`);
    // An organisation, streamed: the error before any line, as without stream=1.
    const owner = await fetch(`http://127.0.0.1:${at}/api/scan?repo=github.com/vietage&stream=1`);
    assert.deepEqual(
      { status: owner.status, body: await owner.json() },
      { status: 400, body: { error: 'Cannot reach GitHub: no answer in 1 s for https://api.github.com/users/vietage' } },
    );
    // The page: its message, nothing else, and the button back to Scan.
    const view = await page('/', at);
    try {
      await view.enter(link);
      assert.equal(view.$('error').textContent, message);
      assert.equal(view.shown('main'), false);
      assert.deepEqual(button(view), ['Scan', true]);
      // The server still answers: another scan gives up the same way.
      await view.enter(link);
      assert.equal(view.$('error').textContent, message);
    } finally {
      view.close();
    }
  } finally {
    child.kill();
    silent.close();
  }
});

test('page: a link over 16 KB → its scan\'s message, nothing else; reload shows the same', { timeout: 5_000 }, async () => {
  const first = await page('/');
  let href: string;
  try {
    await first.enter(LONG_PATH);
    assert.equal(first.$('error').textContent, `Not a GitHub URL or a readable directory: ${LONG_PATH}`);
    assert.equal(first.shown('main'), false);
    assert.deepEqual(first.search(), { repo: LONG_PATH });
    // Wrapped inside its box, not past the page's edge.
    assert.equal(first.dom.window.getComputedStyle(first.$('error')).overflowWrap, 'anywhere');
    href = first.dom.window.location.href;
  } finally {
    first.close();
  }
  const path = new URL(href).pathname + new URL(href).search;
  // The server serves the page at that URL, as a browser's reload asks for it.
  assert.equal((await get(path)).status, 200);
  const reloaded = await page(path);
  try {
    await reloaded.settled(1);
    assert.equal((reloaded.$('repo') as HTMLInputElement).value, LONG_PATH);
    assert.equal(reloaded.$('error').textContent, `Not a GitHub URL or a readable directory: ${LONG_PATH}`);
    assert.equal(reloaded.shown('main'), false);
  } finally {
    reloaded.close();
  }
});

test('page: an answer that is not the API\'s JSON → The server answered <status>, not a parser\'s error', { timeout: 5_000 }, async () => {
  // A stand-in server answering as Node does to a request it cannot read: a status, no body.
  const { createServer } = await import('node:http');
  const standIn = createServer((_request, response) => {
    response.writeHead(431);
    response.end();
  });
  await new Promise<void>((resolve) => standIn.listen(0, '127.0.0.1', resolve));
  const at = String((standIn.address() as { port: number }).port);
  const view = await page('/', at);
  try {
    await view.enter(FIXTURE);
    assert.equal(view.$('error').textContent, 'The server answered 431 Request Header Fields Too Large');
    assert.equal(view.shown('main'), false);
    assert.equal(view.shown('progress'), false);
  } finally {
    view.close();
    standIn.close();
  }
});

test('page: a filter field above the skills; typing narrows them, without scanning again', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const filter = view.$('filter') as HTMLInputElement;
    assert.equal(filter.closest('#list'), view.$('list'));
    assert.ok(filter.compareDocumentPosition(view.$('skills')) & view.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    view.filter('COMMIT');
    assert.deepEqual(view.names(), ['code-style', 'commits']);
    assert.equal(view.$('summary').textContent, 'fixture · 2 of 4 skills');
    view.filter('c');
    view.filter('co');
    view.filter('release');
    assert.deepEqual(view.names(), ['release-checklist']);
    assert.equal(view.$('summary').textContent, 'fixture · 1 of 4 skills');
    assert.equal(view.$('no-match').textContent, '');
    view.filter('');
    assert.deepEqual(view.names(), ['code-style', 'commits', 'invoices', 'release-checklist']);
    assert.equal(view.$('summary').textContent, 'fixture · 4 skills');
    // The one scan above, and no other.
    assert.equal(view.scans(), 1);
  } finally {
    view.close();
  }
});

test('page: the filter matches what --filter does, word by word', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    for (const word of [
      'commit', 'KOTLIN', 'Billing Module', 'release', 'e', "project's", 'zzz',
      'module billing', 'kotlin STYLE', 'commit kotlin', 'commit zzz', ' \tcode   style ', '"billing module"', ' \t ',
    ]) {
      view.filter(word);
      const { body } = await scan(FIXTURE, word);
      assert.deepEqual(view.names(), body.skills.map((skill: { name: string }) => skill.name), word);
    }
  } finally {
    view.close();
  }
});

test('page: no match → no skills and a clear message, not an error', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    view.filter('zzz');
    assert.deepEqual(view.items(), []);
    assert.equal(view.$('no-match').textContent, 'no skills match "zzz"');
    assert.equal(view.$('summary').textContent, 'fixture · 0 of 4 skills');
    assert.equal(view.$('error').textContent, '');
    assert.equal(view.$('main').hidden, false);
    assert.equal(view.$('skill').querySelector('h2'), null);
    assert.equal(view.search().skill, undefined);
    // The warnings stay: they are the whole scan's.
    assert.equal(view.$('warnings').children.length, 2);
    view.filter('commits');
    assert.equal(view.$('no-match').textContent, '');
    assert.deepEqual(view.names(), ['commits']);
  } finally {
    view.close();
  }
});

test('page: the selected skill filtered out → the first one that matches is selected', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    view.items()[1].dispatchEvent(new view.dom.window.Event('click'));
    const commits = view.selected();
    // Still shown: still selected.
    view.filter('commit');
    assert.equal(view.selected(), commits);
    view.filter('billing');
    assert.deepEqual(view.names(), ['invoices']);
    assert.equal(view.selected(), view.items()[0].dataset.path);
    assert.equal(view.$('skill').querySelector('h2')!.textContent, 'invoices');
    assert.equal(view.search().skill, view.selected());
  } finally {
    view.close();
  }
});

test('page: the URL keeps the filter; reload shows the same', { timeout: 5_000 }, async () => {
  const first = await page('/');
  let href: string;
  try {
    await first.enter(FIXTURE);
    first.filter('commit');
    first.items()[1].dispatchEvent(new first.dom.window.Event('click'));
    const path = first.items()[1].dataset.path!;
    assert.deepEqual(first.search(), { repo: FIXTURE, skill: path, filter: 'commit' });
    href = first.dom.window.location.href;
    assert.match(href, /\?repo=[^&]+&skill=[^&]+&filter=commit$/);
  } finally {
    first.close();
  }
  const reloaded = await page(new URL(href).pathname + new URL(href).search);
  try {
    await reloaded.settled(1);
    assert.equal((reloaded.$('filter') as HTMLInputElement).value, 'commit');
    assert.deepEqual(reloaded.names(), ['code-style', 'commits']);
    assert.equal(reloaded.$('summary').textContent, 'fixture · 2 of 4 skills');
    assert.equal(reloaded.$('skill').querySelector('h2')!.textContent, 'commits');
    // Cleared: the filter leaves the URL.
    reloaded.filter('');
    assert.equal(reloaded.search().filter, undefined);
    // A failed scan keeps the filter for the reload too.
    reloaded.filter('zzz');
    await reloaded.enter('/no/such/directory');
    assert.deepEqual(reloaded.search(), { repo: '/no/such/directory', filter: 'zzz' });
  } finally {
    reloaded.close();
  }
  const none = await page(`/?repo=${encodeURIComponent(FIXTURE)}&filter=zzz`);
  try {
    await none.settled(1);
    assert.equal(none.$('no-match').textContent, 'no skills match "zzz"');
  } finally {
    none.close();
  }
});

test('page: several words narrow as you type, without scanning again; the header counts both', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    view.filter('commit');
    assert.deepEqual(view.names(), ['code-style', 'commits']);
    // Typing the second word narrows it: every word, not any.
    view.filter('commit ');
    assert.deepEqual(view.names(), ['code-style', 'commits']);
    view.filter('commit k');
    assert.deepEqual(view.names(), ['code-style']);
    view.filter('commit kotlin');
    assert.deepEqual(view.names(), ['code-style']);
    assert.equal(view.$('summary').textContent, 'fixture · 1 of 4 skills');
    // In any order, whatever the whitespace; one word in the name, the other in the description.
    view.filter('  module\tbilling ');
    assert.deepEqual(view.names(), ['invoices']);
    view.filter('kotlin STYLE');
    assert.deepEqual(view.names(), ['code-style']);
    assert.equal(view.$('no-match').textContent, '');
    // The one scan above, and no other.
    assert.equal(view.scans(), 1);
  } finally {
    view.close();
  }
});

test('page: several words with no match → no skills and the words in the message, not an error', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    view.filter('  commit \t zzz ');
    assert.deepEqual(view.items(), []);
    assert.equal(view.$('no-match').textContent, 'no skills match "commit zzz"');
    assert.equal(view.$('summary').textContent, 'fixture · 0 of 4 skills');
    assert.equal(view.$('error').textContent, '');
    assert.equal(view.$('main').hidden, false);
  } finally {
    view.close();
  }
});

test('page: the URL keeps the words; reload shows the same', { timeout: 5_000 }, async () => {
  const first = await page('/');
  let href: string;
  try {
    await first.enter(FIXTURE);
    first.filter(' commit   kotlin ');
    const path = first.items()[0].dataset.path!;
    assert.deepEqual(first.search(), { repo: FIXTURE, skill: path, filter: 'commit kotlin' });
    href = first.dom.window.location.href;
    assert.match(href, /\?repo=[^&]+&skill=[^&]+&filter=commit\+kotlin$/);
  } finally {
    first.close();
  }
  const reloaded = await page(new URL(href).pathname + new URL(href).search);
  try {
    await reloaded.settled(1);
    assert.equal((reloaded.$('filter') as HTMLInputElement).value, 'commit kotlin');
    assert.deepEqual(reloaded.names(), ['code-style']);
    assert.equal(reloaded.$('summary').textContent, 'fixture · 1 of 4 skills');
    assert.equal(reloaded.$('skill').querySelector('h2')!.textContent, 'code-style');
  } finally {
    reloaded.close();
  }
  const none = await page(`/?repo=${encodeURIComponent(FIXTURE)}&filter=${encodeURIComponent('commit zzz')}`);
  try {
    await none.settled(1);
    assert.equal(none.$('no-match').textContent, 'no skills match "commit zzz"');
  } finally {
    none.close();
  }
});

test('page: a failed scan keeps filter= in the URL, the filter hidden; a reload restores its words', { timeout: 5_000 }, async () => {
  const view = await page('/');
  let href: string;
  try {
    await view.enter(FIXTURE);
    view.filter('commit');
    await view.enter('/no/such/directory');
    assert.deepEqual(view.search(), { repo: '/no/such/directory', filter: 'commit' });
    // The filter is hidden with the skills: a user can't change it until a scan succeeds.
    assert.equal(view.shown('filter'), false);
    href = view.dom.window.location.href;
  } finally {
    view.close();
  }
  // A reload brings back the words in the field, still hidden, and the failed scan's message.
  const reloaded = await page(new URL(href).pathname + new URL(href).search);
  try {
    await reloaded.settled(1);
    assert.equal((reloaded.$('filter') as HTMLInputElement).value, 'commit');
    assert.equal(reloaded.$('error').textContent, 'Not a GitHub URL or a readable directory: /no/such/directory');
    assert.equal(reloaded.$('main').hidden, true);
    assert.equal(reloaded.shown('filter'), false);
    assert.equal(reloaded.shown('error'), true);
  } finally {
    reloaded.close();
  }
});

test('API: an organisation → its repositories, each with its commit and skill count; warnings', async () => {
  const { status, body } = await scan('github.com/skillatlas');
  assert.equal(status, 200);
  assert.deepEqual(body.organisation, { name: 'SkillAtlas', url: 'https://github.com/SkillAtlas' });
  assert.deepEqual(body.repositories[0], {
    name: 'alpha',
    url: 'https://github.com/SkillAtlas/alpha',
    commit: ORGANISATION_COMMIT,
    skillCount: 2,
  });
  // Every repository, those with 0 skills too (the CLI and the page leave them out): the same
  // order, counts and warnings as the CLI; a repository that failed: no commit, no count.
  assert.equal(body.repositories.length, 7);
  assert.deepEqual(
    body.repositories.filter((repository: { skillCount: number | null }) => repository.skillCount === 0).map((repository: { name: string }) => repository.name),
    ['Docs', 'empty', 'huge'],
  );
  const cli = await atlas(['scan', 'github.com/skillatlas']);
  assert.deepEqual(
    body.repositories.filter((repository: { skillCount: number | null }) => repository.skillCount !== 0).map((repository: { name: string; skillCount: number | null }) =>
      `${repository.name} — ${repository.skillCount === null ? 'not scanned' : `${repository.skillCount} skill${repository.skillCount === 1 ? '' : 's'}`}`),
    cli.stdout.split('\n').slice(1),
  );
  assert.deepEqual(body.repositories.at(-1), { name: 'broken', url: 'https://github.com/SkillAtlas/broken', commit: null, skillCount: null });
  assert.equal(body.skills, 6);
  assert.deepEqual(body.warnings.map((warning: string) => `warning: ${warning}`), cli.stderr.split('\n'));
});

test('API: an unknown organisation, or a filter on one → 400 and its message', async () => {
  assert.deepEqual(await scan('github.com/no-such-organisation'), {
    status: 400,
    body: { error: 'Organisation not found: https://github.com/no-such-organisation' },
  });
  assert.deepEqual(await scan('github.com/skillatlas', 'review'), {
    status: 400,
    body: { error: 'filter works on one repository, not on an organisation' },
  });
  // No words: no filter.
  assert.equal((await scan('github.com/skillatlas', ' ')).status, 200);
});

test('page: an organisation link → its repositories with their counts; selecting one shows its skills', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    assert.equal(view.$('organisation').hidden, false);
    // Docs, empty and huge have 0 skills: not listed, but counted in the header; broken, not scanned,
    // stays.
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 6 skills');
    const repositories = () => [...view.$('repositories').children] as HTMLElement[];
    assert.deepEqual(
      repositories().map((item) => [view.text(item, '.name'), view.text(item, '.count')]),
      [['alpha', '2 skills'], ['Beta', '2 skills'], ['example-tools', '2 skills'], ['broken', 'not scanned']],
    );
    // Their warnings stay: huge's among them.
    assert.equal(view.$('warnings').children.length, 3);
    // No repository selected yet: no skills.
    assert.equal(view.$('main').hidden, true);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });

    const scans = view.scans();
    repositories()[1].dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    assert.equal(repositories()[1].getAttribute('aria-selected'), 'true');
    assert.equal(view.$('main').hidden, false);
    assert.equal(view.$('error').textContent, '');
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    // The organisation's warnings stay: they include each repository's.
    assert.equal(view.$('warnings').children.length, 3);
    assert.deepEqual(view.names(), ['four', 'three']);
    assert.equal(view.$('skill').querySelector('h2')!.textContent, 'four');
    // The filter narrows the selected repository's skills, as today.
    view.filter('three');
    assert.deepEqual(view.names(), ['three']);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'Beta', skill: '.agents/skills/three/SKILL.md', filter: 'three' });
  } finally {
    view.close();
  }
});

test('page: an organisation\'s repositories in a column, one a line, the count next to each name', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    assert.equal(style(view.$('repositories')).display, 'flex');
    assert.equal(style(view.$('repositories')).flexDirection, 'column');
    for (const item of view.$('repositories').children) {
      // The name, then its count right after it, on the same line.
      assert.deepEqual([...item.children].map((child) => child.className), ['name', 'count']);
      assert.equal(style(item).display, 'flex');
      assert.notEqual(style(item).flexDirection, 'column');
    }
  } finally {
    view.close();
  }
});

/** A colour of a computed style, `rgb(…)` or `rgba(…)`, as [r, g, b, alpha]. */
function rgba(colour: string): [number, number, number, number] {
  const parts = /^rgba?\(([^)]+)\)$/.exec(colour.trim())?.[1].split(',').map(Number);
  assert.ok(parts && parts.length >= 3 && parts.every(Number.isFinite), `a colour: ${colour}`);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
/** The colours in a computed gradient or shadow, in order. */
const colours = (value: string) => (value.match(/rgba?\([^)]+\)/g) ?? []).map(rgba);
/** A colour over a ground, by its alpha: what is seen. */
const over = (top: number[], ground: number[]) => [0, 1, 2].map((at) => top[at] * top[3] + ground[at] * (1 - top[3])).concat(1);
/** The WCAG contrast ratio of two opaque colours. */
function contrast(one: number[], other: number[]) {
  const luminance = (colour: number[]) => {
    const [r, g, b] = colour.slice(0, 3).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(other)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
const WHITE = [255, 255, 255, 1];
/** The page's style rules, and those of its `@media` rule for `query`. */
function sheetRules(view: Awaited<ReturnType<typeof page>>, query?: string) {
  const rules = [...view.dom.window.document.styleSheets[0].cssRules];
  if (query === undefined) return rules.filter((rule) => 'selectorText' in rule) as CSSStyleRule[];
  const media = rules.find((rule) => (rule as CSSMediaRule).media?.mediaText === query) as CSSMediaRule | undefined;
  assert.ok(media, `a (${query}) rule`);
  return [...media.cssRules] as CSSStyleRule[];
}
/** The ids of the cards: the scan form, the organisation, the errors and warnings, the skills, the SKILL.md. */
const CARDS = ['scan-card', 'organisation', 'problems', 'list', 'skill'];

test('page: a neon-sunset style: a sunset gradient, deep purple → hot pink → orange, fixed', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    const body = view.dom.window.getComputedStyle(view.dom.window.document.body);
    assert.match(body.backgroundImage, /^linear-gradient\(180deg,/);
    assert.equal(body.backgroundAttachment, 'fixed');
    const stops = colours(body.backgroundImage);
    assert.ok(stops.length >= 3, 'at least three colours');
    const [r0, g0, b0] = stops[0];
    // Deep purple at the top: dark, more blue than red, hardly any green.
    assert.ok(r0 < 80 && g0 < 40 && b0 < 130 && b0 > r0 && r0 > g0, `deep purple first: ${stops[0]}`);
    // Hot pink on the way down: red full, blue well over green.
    assert.ok(stops.slice(1, -1).some(([r, g, b]) => r > 230 && g < 100 && b > 120), 'hot pink in the middle');
    // Orange at the bottom: red full, green in between, little blue.
    const [r1, g1, b1] = stops[stops.length - 1];
    assert.ok(r1 > 230 && g1 > 120 && g1 < 210 && b1 < 110, `orange last: ${stops[stops.length - 1]}`);
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: the scenery of a sun, the ocean and two palms, in CSS and inline SVG, decoration only', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    const document = view.dom.window.document;
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const scenery = view.$('scenery');
    // The sun: an inline SVG circle, filled with a gradient defined in the page itself.
    const sun = scenery.querySelector('svg.sun circle')!;
    assert.ok(sun, 'a sun');
    const fill = /^url\(#([\w-]+)\)$/.exec(sun.getAttribute('fill')!)?.[1];
    assert.equal(document.getElementById(fill!)?.localName, 'linearGradient');
    // The ocean, with the horizon as its upper edge.
    const ocean = scenery.querySelector('.ocean')!;
    assert.match(style(ocean).backgroundImage, /linear-gradient\(/);
    assert.match(style(ocean).borderTopWidth, /^[1-9]\d*px$/);
    assert.equal(style(ocean).bottom, '0px');
    // Two palms, silhouettes: one drawn, the other the same drawing, mirrored.
    const palms = [...scenery.querySelectorAll('svg.palm')];
    assert.equal(palms.length, 2);
    for (const palm of palms) {
      const shape = palm.querySelector('path') ?? document.querySelector(palm.querySelector('use')!.getAttribute('href')!);
      assert.equal(shape?.localName, 'path');
      assert.ok(shape!.getAttribute('d')!.length > 500, 'a drawing, not a placeholder');
      const [r, g, b] = rgba(style(palm).fill);
      assert.ok(r + g + b < 120, `a dark silhouette: ${style(palm).fill}`);
    }
    assert.notEqual(style(palms[0]).transform, style(palms[1]).transform);
    // Decoration only: not for assistive technology, no focus, no clicks, behind everything, fixed.
    assert.equal(scenery.getAttribute('aria-hidden'), 'true');
    assert.equal(scenery.querySelector('a, button, input, select, textarea, [tabindex], [role]'), null);
    assert.equal(scenery.textContent!.trim(), '');
    assert.equal(style(scenery).pointerEvents, 'none');
    assert.equal(style(scenery).position, 'fixed');
    assert.ok(Number(style(scenery).zIndex) < 0, 'behind everything');
    for (const node of document.querySelectorAll('body > :not(#scenery):not(script)')) {
      assert.ok(!(Number(style(node).zIndex) < 0), node.id);
    }
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: the main areas on cards: rounded, translucent glass, a neon border and shadow, brighter under the pointer', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    // The scan form and its progress bar are in a card of their own.
    assert.ok(view.$('scan-card').contains(view.$('form')));
    assert.ok(view.$('scan-card').contains(view.$('progress')));
    const hover = sheetRules(view).filter((rule) => rule.selectorText.includes(':hover'));
    for (const id of CARDS) {
      const card = style(view.$(id));
      // Rounded: jsdom gives `0px` for an element with no radius.
      assert.match(card.borderRadius, /^[1-9]\d*px$/, id);
      // Translucent glass: a ground that lets the sunset through, blurred.
      const alpha = rgba(card.backgroundColor)[3];
      assert.ok(alpha > 0.5 && alpha < 1, `${id}: translucent, ${card.backgroundColor}`);
      assert.match(card.backdropFilter, /\bblur\([1-9]\d*px\)/, id);
      // A soft neon border and shadow: a border in pink or orange, a shadow that glows (no offset).
      assert.match(card.borderTopWidth, /^[1-9]\d*px$/, id);
      assert.equal(card.borderTopStyle, 'solid', id);
      const [r, g, b, a] = rgba(card.borderTopColor);
      assert.ok(r > 230 && b < 200 && g < 170 && a > 0 && a < 1, `${id}: a soft neon border, ${card.borderTopColor}`);
      assert.match(card.boxShadow, /rgba\(255, 46, 151, [\d.]+\) 0px 0px [1-9]\d*px/, id);
      // Under the pointer: another border colour and another shadow.
      const lit = hover.filter((rule) => view.$(id).matches(rule.selectorText.replace(':hover', '')));
      assert.ok(lit.some((rule) => rule.style.boxShadow && rule.style.boxShadow !== 'none'), `${id}: a shadow under the pointer`);
      assert.ok(lit.some((rule) => rule.style.borderColor), `${id}: a border under the pointer`);
    }
    // What is not a card has none of it.
    for (const node of [view.dom.window.document.querySelector('header')!, view.$('main'), view.$('form')]) {
      assert.equal(style(node).borderRadius, '0px');
      assert.equal(style(node).backgroundColor, 'rgba(0, 0, 0, 0)');
    }
    const selected = view.items().find((item) => item.getAttribute('aria-selected') === 'true')!;
    const other = view.items().find((item) => item.getAttribute('aria-selected') === 'false')!;
    // The selected skill: a gradient tint and an accent bar; the others neither.
    assert.match(style(selected).backgroundImage, /^linear-gradient\(/);
    assert.match(style(selected).boxShadow, /\binset\b/);
    assert.doesNotMatch(style(other).backgroundImage, /gradient/);
    assert.doesNotMatch(style(other).boxShadow, /\binset\b/);
    assert.match(style(view.$('skill').querySelector('h2')!).backgroundImage, /^linear-gradient\(/);
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: the title bold and italic, with a neon glow', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    const title = view.dom.window.document.querySelector('h1')!;
    assert.equal(title.textContent, 'Skill Atlas');
    const style = view.dom.window.getComputedStyle(title);
    assert.ok(Number(style.fontWeight) >= 800, style.fontWeight);
    assert.equal(style.fontStyle, 'italic');
    assert.ok(parseFloat(style.fontSize) >= 30, style.fontSize);
    assert.equal(style.textTransform, 'none');
    // The glow: several shadows around the letters, without an offset, in neon pink.
    const glow = style.textShadow.match(/rgba?\([^)]+\) 0px 0px [1-9]\d*px/g) ?? [];
    assert.ok(glow.length >= 3, style.textShadow);
    assert.ok(glow.some((shadow) => shadow.startsWith('rgb(255, 46, 151)')), style.textShadow);
    // Light letters on the top of the sunset, the darkest of it.
    const top = colours(view.dom.window.getComputedStyle(view.dom.window.document.body).backgroundImage)[0];
    assert.ok(contrast(rgba(style.color), top) >= 4.5);
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: the text at WCAG AA contrast on its card, whatever is behind the card', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const AA = 4.5;
    // The worst there can be behind a translucent card is white: brighter than the sun.
    const card = over(rgba(style(view.$('list')).backgroundColor), WHITE);
    for (const id of CARDS) assert.deepEqual(over(rgba(style(view.$(id)).backgroundColor), WHITE), card, id);
    const check = (node: Element, ground: number[], what: string) => {
      const ratio = contrast(rgba(style(node).color), ground);
      assert.ok(ratio >= AA, `${what}: ${ratio.toFixed(2)}:1, ${style(node).color}`);
    };
    const selected = view.items().find((item) => item.getAttribute('aria-selected') === 'true')!;
    const other = view.items().find((item) => item.getAttribute('aria-selected') === 'false')!;
    assert.ok(selected.querySelector('.copies') && selected.querySelector('.description'));
    for (const part of ['.name', '.description', '.path', '.copies']) {
      check(other.querySelector(part) ?? other, card, `a skill's ${part}`);
      // The selected one: on each colour of its tint, over the card.
      for (const tint of colours(style(selected).backgroundImage)) check(selected.querySelector(part)!, over(tint, card), `the selected skill's ${part}`);
    }
    check(view.$('summary'), card, 'the header');
    check(view.$('summary').querySelector('strong')!, card, 'the repository');
    check(view.$('problems-title'), card, 'the warnings\' title');
    check(view.$('warnings').children[0], card, 'a warning');
    check(view.$('progress-text'), card, 'the progress');
    check(view.$('skill').querySelector('a')!, card, 'the link');
    // The skill's name is in a gradient: each of its colours.
    for (const colour of colours(style(view.$('skill').querySelector('h2')!).backgroundImage)) {
      assert.ok(contrast(colour, card) >= AA, `the skill's name: ${colour}`);
    }
    // The SKILL.md and the fields: on their own ground, over the card.
    check(view.$('content'), over(rgba(style(view.$('content')).backgroundColor), card), 'the SKILL.md');
    for (const id of ['repo', 'filter']) check(view.$(id), over(rgba(style(view.$(id)).backgroundColor), card), id);
    const placeholder = sheetRules(view).find((rule) => rule.selectorText === 'input::placeholder')!;
    assert.equal(placeholder.style.color, 'var(--muted)');
    // The placeholders are in the muted colour, as the header is: that colour on the field's ground.
    assert.equal(sheetRules(view).find((rule) => rule.selectorText === '#summary')!.style.color, 'var(--muted)');
    check(view.$('summary'), over(rgba(style(view.$('repo')).backgroundColor), card), 'a placeholder');
    // The button: dark text on each colour of its gradient (Stop's: in its own test).
    const scan = view.$('scan') as HTMLButtonElement;
    const stops = colours(style(scan).backgroundImage);
    assert.ok(stops.length >= 2);
    for (const stop of stops) check(scan, stop, 'Scan');
    // A failed scan's message, and `Scanning <repo>…`: boxes of their own, not on a card.
    await view.enter('/no/such/directory');
    assert.notEqual(view.$('error').textContent, '');
    check(view.$('error'), over(rgba(style(view.$('error')).backgroundColor), WHITE), 'the message');
    check(view.$('loading'), over(rgba(style(view.$('loading')).backgroundColor), WHITE), 'Scanning <repo>…');
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: an organisation\'s text and its tabs at WCAG AA contrast', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'Beta');
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const card = over(rgba(style(view.$('organisation')).backgroundColor), WHITE);
    const check = (node: Element, ground: number[], what: string) => {
      const ratio = contrast(rgba(style(node).color), ground);
      assert.ok(ratio >= 4.5, `${what}: ${ratio.toFixed(2)}:1, ${style(node).color}`);
    };
    check(view.$('org-summary'), card, 'the header');
    for (const item of view.$('repositories').children) {
      const grounds = item.getAttribute('aria-selected') === 'true' ? colours(style(item).backgroundImage).map((tint) => over(tint, card)) : [card];
      assert.ok(grounds.length);
      for (const ground of grounds) {
        check(item.querySelector('.name')!, ground, 'a repository');
        check(item.querySelector('.count')!, over(rgba(style(item.querySelector('.count')!).backgroundColor), ground), 'its count');
      }
    }
    for (const tab of tabsOf(view)) {
      const ground = over(rgba(style(tab).backgroundColor), WHITE);
      const grounds = tab.getAttribute('aria-selected') === 'true' ? colours(style(tab).backgroundImage).map((tint) => over(tint, ground)) : [ground];
      assert.ok(grounds.length);
      for (const each of grounds) {
        check(tab, each, 'a tab');
        if (tab.querySelector('.close')) check(tab.querySelector('.close')!, each, 'its ×');
      }
    }
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: Scan in neon, with a pink glow', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    const scan = view.$('scan') as HTMLButtonElement;
    const style = () => view.dom.window.getComputedStyle(scan);
    // Pink to orange, and a glow around it in neon pink.
    const [from, to] = colours(style().backgroundImage);
    assert.match(style().backgroundImage, /^linear-gradient\(/);
    assert.ok(from[0] > 230 && from[1] < 120 && from[2] > 120, `pink: ${from}`);
    assert.ok(to[0] > 230 && to[1] > 120 && to[2] < 110, `orange: ${to}`);
    assert.match(style().boxShadow, /rgba\(255, 46, 151, [\d.]+\) 0px 0px [1-9]\d*px/);
    assert.equal(style().cursor, 'pointer');
    assert.equal(style().borderTopStyle, 'solid');
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: the fields and the progress bar in neon; a cyan outline on what has the focus', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'Beta');
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const cyan = ([r, g, b]: number[]) => r < 120 && g > 200 && b > 200;
    const root = view.dom.window.document.documentElement;
    const resolved = (value: string) => value.replace(/var\((--[\w-]+)\)/g, (_, name) => style(root).getPropertyValue(name).trim());
    assert.equal(resolved('var(--cyan)'), '#22e3e0');
    /** The colour of a rule's outline, as `2px solid var(--cyan)`. */
    const outlined = (rule: CSSStyleRule) => rgba(hex(/#[0-9a-f]{6}/.exec(resolved(rule.style.outline))?.[0] ?? ''));
    // The fields: a cyan border on a dark, translucent ground.
    for (const id of ['repo', 'filter']) {
      const field = style(view.$(id));
      assert.ok(cyan(rgba(field.borderTopColor)), `${id}: ${field.borderTopColor}`);
      assert.match(field.borderRadius, /^[1-9]\d*px$/, id);
      const [r, g, b, alpha] = rgba(field.backgroundColor);
      assert.ok(r + g + b < 120 && alpha > 0, `${id}: ${field.backgroundColor}`);
    }
    // With the focus: a cyan outline and a glow. jsdom matches `:focus` on the focused element.
    const repo = view.$('repo');
    const before = style(repo).boxShadow;
    repo.focus();
    assert.match(style(repo).outline, /^\d+px solid/);
    assert.ok(cyan(outlined(sheetRules(view).find((rule) => rule.selectorText === 'input:focus')!)));
    assert.notEqual(style(repo).boxShadow, before);
    assert.match(style(repo).boxShadow, /rgba\(34, 227, 224, [\d.]+\) 0px 0px [1-9]\d*px/);
    repo.blur();
    assert.equal(style(repo).boxShadow, before);
    // The progress bar: rounded, a cyan border, its own look instead of the system's; cyan to pink.
    const bar = style(view.$('progress-bar'));
    assert.equal(bar.appearance, 'none');
    assert.match(bar.borderRadius, /^[1-9]\d*px$/);
    assert.ok(cyan(rgba(bar.borderTopColor)), bar.borderTopColor);
    const value = sheetRules(view).filter((rule) => /^#progress-bar::-(webkit-progress-value|moz-progress-bar)$/.test(rule.selectorText));
    assert.ok(value.length, 'the bar\'s value');
    for (const rule of value) assert.match(rule.style.backgroundImage, /^linear-gradient\(90deg, (#22e3e0|rgb\(34, 227, 224\)), (#ff2e97|rgb\(255, 46, 151\))\)$/);
    // From the keyboard: an outline in cyan on each control. jsdom matches no :focus-visible: the sheet.
    const focus = sheetRules(view).filter((rule) => rule.selectorText.includes(':focus-visible') && /^\d+px solid/.test(rule.style.outline));
    const controls = [view.$('scan'), view.$('warnings'), view.$('skill').querySelector('a')!, ...tabsOf(view), tabsOf(view)[1].querySelector('.close')!, view.items()[0], view.$('repositories').children[0]];
    for (const control of controls) {
      const rule = focus.find((each) => each.selectorText.split(',').some((selector) => control.matches(selector.replace(':focus-visible', ''))));
      assert.ok(rule, `a :focus-visible outline: ${control.outerHTML.slice(0, 50)}`);
      assert.ok(cyan(outlined(rule)), rule.style.outline);
    }
  } finally {
    view.close();
  }
});
/** `#rrggbb` as `rgb(r, g, b)`. */
const hex = (colour: string) => /^#[0-9a-f]{6}$/.test(colour) ? `rgb(${[1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16)).join(', ')})` : colour;

test('page: a neon-sunset style: the errors and warnings on their own card, in warm orange, their limited height kept; a failed scan\'s message in its box', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    assert.ok(view.shown('problems'));
    assert.equal(view.$('warnings').children.length, 2);
    assert.ok(view.$('problems').classList.contains('card'));
    const orange = ([r, g, b]: number[]) => r > 230 && g > 120 && g < 220 && b < 170;
    for (const node of [view.$('problems-title'), view.$('warnings'), view.$('warnings').children[0]]) assert.ok(orange(rgba(style(node).color)), style(node).color);
    assert.ok(orange(rgba(style(view.$('problems')).borderTopColor)), style(view.$('problems')).borderTopColor);
    // Its own area, of limited height, with a scrollbar: as before.
    assertLimited(view);
    assert.equal(view.$('warnings').tabIndex, 0);
    // A failed scan: its message in a box of its own, pink on dark, with a border and a glow.
    await view.enter('/no/such/directory');
    const box = style(view.$('error'));
    assert.match(box.borderRadius, /^[1-9]\d*px$/);
    assert.match(box.borderTopWidth, /^[1-9]\d*px$/);
    assert.notEqual(box.boxShadow, 'none');
    const [r, g, b] = rgba(box.color);
    assert.ok(r > 230 && g < 200 && b > g, box.color);
    const ground = rgba(box.backgroundColor);
    assert.ok(ground[0] + ground[1] + ground[2] < 150 && ground[3] > 0.5, box.backgroundColor);
    assert.equal(box.overflowWrap, 'anywhere');
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: the selected repository tinted, with an accent bar; each count in a pill', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const repositories = () => [...view.$('repositories').children] as HTMLElement[];
    const scans = view.scans();
    repositories()[1].dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    const [first, selected] = repositories();
    assert.equal(selected.getAttribute('aria-selected'), 'true');
    assert.match(style(selected).backgroundImage, /^linear-gradient\(/);
    assert.match(style(selected).boxShadow, /\binset\b/);
    assert.doesNotMatch(style(first).backgroundImage, /gradient/);
    assert.doesNotMatch(style(first).boxShadow, /\binset\b/);
    for (const item of repositories()) {
      const count = item.querySelector('.count')!;
      assert.match(style(count).borderRadius, /^[1-9]\d*px$/, item.dataset.name);
      assert.notEqual(style(count).backgroundColor, 'rgba(0, 0, 0, 0)', item.dataset.name);
    }
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: one look, on a dark base, whatever the system\'s colours', { timeout: 5_000 }, async () => {
  // jsdom evaluates no media queries, so this reads the page's style sheet itself.
  const view = await page('/');
  try {
    const rules = [...view.dom.window.document.styleSheets[0].cssRules];
    const root = rules.find((rule) => (rule as CSSStyleRule).selectorText === ':root') as CSSStyleRule;
    assert.equal(root.style.getPropertyValue('color-scheme'), 'dark');
    // No other colours for a light or a dark system.
    for (const rule of rules) assert.doesNotMatch((rule as CSSMediaRule).media?.mediaText ?? '', /prefers-color-scheme/);
    assert.equal(rules.filter((rule) => (rule as CSSStyleRule).selectorText === ':root').length, 1);
    // A dark base: the cards and the page under the sunset; light text.
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const dark = ([r, g, b]: number[]) => r + g + b < 120;
    assert.ok(dark(rgba(style(view.$('list')).backgroundColor)), style(view.$('list')).backgroundColor);
    assert.ok(dark(rgba(style(view.dom.window.document.body).backgroundColor)), style(view.dom.window.document.body).backgroundColor);
    const [r, g, b] = rgba(style(view.dom.window.document.body).color);
    assert.ok(r + g + b > 660, style(view.dom.window.document.body).color);
    // The accents: neon pink, cyan, purple and warm orange.
    const accent = (name: string) => rgba(hex(root.style.getPropertyValue(name).trim()));
    const [pink, cyan, purple, orange] = ['--pink', '--cyan', '--purple', '--orange'].map(accent);
    assert.ok(pink[0] > 230 && pink[1] < 100 && pink[2] > 120, `pink: ${pink}`);
    assert.ok(cyan[0] < 100 && cyan[1] > 200 && cyan[2] > 200, `cyan: ${cyan}`);
    assert.ok(purple[2] > 230 && purple[0] > 130 && purple[1] < purple[0], `purple: ${purple}`);
    assert.ok(orange[0] > 230 && orange[1] > 120 && orange[1] < 200 && orange[2] < 110, `orange: ${orange}`);
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: narrow screens → one column, Scan under the field; wider → the skills beside the SKILL.md', { timeout: 5_000 }, async () => {
  // jsdom evaluates no media queries and has no layout: the rules, from the sheet.
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    // Wide: two columns, the skills first.
    assert.equal(style(view.$('main')).display, 'grid');
    assert.equal(style(view.$('main')).gridTemplateColumns.trim().split(/\s+(?![^(]*\))/).length, 2);
    assert.deepEqual([...view.$('main').children].map((child) => child.id), ['list', 'skill']);
    // The field and Scan on a line that wraps, so that neither is wider than the screen.
    assert.equal(style(view.$('form')).display, 'flex');
    assert.equal(style(view.$('form')).flexWrap, 'wrap');
    assert.equal(style(view.$('repo')).minWidth, '0px');
    const narrow = sheetRules(view, '(max-width: 720px)');
    const rule = (node: Element, property: string) => narrow.find((each) => node.matches(each.selectorText) && each.style.getPropertyValue(property))?.style.getPropertyValue(property);
    assert.equal(rule(view.$('main'), 'grid-template-columns'), '1fr');
    // Scan takes a line of its own, under the field.
    assert.match(rule(view.$('scan'), 'flex') ?? rule(view.$('scan'), 'flex-basis') ?? '', /100%$/);
    // The long texts break instead of widening the page.
    assert.equal(style(view.$('skill')).minWidth, '0px');
    assert.equal(style(view.$('error')).overflowWrap, 'anywhere');
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: animations and transitions only with prefers-reduced-motion: no-preference', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    const moves = (rule: CSSStyleRule) => ['animation', 'animation-name', 'transition', 'transition-property', 'transition-duration', 'scroll-behavior']
      .some((property) => rule.style?.getPropertyValue(property));
    const all = [...view.dom.window.document.styleSheets[0].cssRules];
    // Nothing moves by default, nor in any other @media rule.
    assert.deepEqual(sheetRules(view).filter(moves).map((rule) => rule.selectorText), []);
    for (const media of all.filter((rule) => 'media' in rule) as CSSMediaRule[]) {
      if (media.media.mediaText === '(prefers-reduced-motion: no-preference)') continue;
      assert.deepEqual(([...media.cssRules] as CSSStyleRule[]).filter(moves).map((rule) => rule.selectorText), [], media.media.mediaText);
    }
    // Those who have not asked for less: the glow of the title and of the sun, and soft transitions.
    const motion = sheetRules(view, '(prefers-reduced-motion: no-preference)');
    const keyframes = all.filter((rule) => 'name' in rule && 'cssRules' in rule).map((rule) => (rule as CSSKeyframesRule).name);
    const animated = motion.filter((rule) => rule.style.getPropertyValue('animation'));
    assert.ok(animated.some((rule) => view.dom.window.document.querySelector('h1')!.matches(rule.selectorText)), 'the title');
    for (const rule of animated) assert.ok(keyframes.some((name) => rule.style.getPropertyValue('animation').split(' ').includes(name)), rule.selectorText);
    assert.ok(motion.some((rule) => rule.style.getPropertyValue('transition') && view.$('list').matches(rule.selectorText)), 'the cards');
    // The script moves nothing either.
    const script = view.dom.window.document.querySelector('script')!.textContent!;
    assert.doesNotMatch(script, /\banimate\(|requestAnimationFrame|setInterval|scrollIntoView|behavior:\s*'smooth'/);
  } finally {
    view.close();
  }
});

test('page: no external resources: one document, system fonts, requests only to /api/scan', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    const document = view.dom.window.document;
    // Nothing that loads a file: no style sheet, image, font, frame, media, or script from elsewhere.
    assert.equal(document.querySelector('link, img, picture, source, iframe, frame, embed, object, video, audio, image, feImage, base, meta[http-equiv], [src], [srcset], [background], [poster], [data]'), null);
    assert.equal(document.querySelectorAll('style').length, 1);
    assert.equal(document.querySelectorAll('script').length, 1);
    const css = document.querySelector('style')!.textContent!;
    assert.doesNotMatch(css, /@import|@font-face|@namespace|image-set\(|src\s*:/i);
    // Every url() in the style and every reference in the drawings: to something in the page itself.
    assert.deepEqual((css.match(/url\([^)]*\)/gi) ?? []), []);
    const references = [...document.querySelectorAll('*')].flatMap((node) => [...node.attributes])
      .filter((attribute) => /^(href|xlink:href|style)$/.test(attribute.name) || /url\(/.test(attribute.value));
    assert.ok(references.length >= 3, 'the drawings refer to their gradient, mask and shape');
    for (const { name, value } of references) assert.match(value, /^(#[\w-]+|url\(#[\w-]+\))$/, `${name}="${value}"`);
    for (const { value } of references) assert.ok(document.getElementById(value.replace(/^url\(|\)$/g, '').slice(1)), value);
    // No address of another site anywhere, but the example in the field's placeholder.
    const html = (await get('/')).text;
    const placeholder = view.$('repo').getAttribute('placeholder')!;
    assert.match(placeholder, /^https:\/\/github\.com\/owner\/repo/);
    assert.doesNotMatch(html.replace(placeholder, ''), /(https?:)?\/\/[\w-]+\.[a-z]/i);
    // System fonts only: no font by name, so none to fetch or to take from anyone.
    const generic = ['system-ui', 'sans-serif', 'ui-monospace', 'monospace', 'inherit'];
    const families = sheetRules(view).map((rule) => rule.style.fontFamily).filter(Boolean).flatMap((value) => value.split(',').map((family) => family.trim()));
    assert.ok(families.length);
    for (const family of families) assert.ok(generic.includes(family), family);
    // Original artwork: no name of a game or its maker in the page.
    assert.doesNotMatch(html, /\bGTA\b|Grand Theft|Rockstar|Vice City/i);
    // What the page asks the server for: the scan, nothing else.
    await view.enter(FIXTURE);
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'Beta');
    assert.ok(view.requests.length >= 3);
    for (const request of view.requests) assert.match(request, /^\/api\/scan\?/);
    // And the server has nothing else to give: no file for a font, an image or a style sheet.
    for (const path of ['/favicon.ico', '/style.css', '/fonts/neon.woff2', '/palm.svg']) assert.equal((await get(path)).status, 404, path);
  } finally {
    view.close();
  }
});

test('page: the URL keeps the organisation and the repository; reload shows the same', { timeout: 5_000 }, async () => {
  const view = await page(`/?repo=${encodeURIComponent('github.com/skillatlas')}&repository=alpha&skill=${encodeURIComponent('web/.github/skills/two/SKILL.md')}`);
  try {
    await view.settled(2);
    assert.equal((view.$('repo') as HTMLInputElement).value, 'github.com/skillatlas');
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 6 skills');
    assert.equal(view.$('summary').textContent, `SkillAtlas/alpha · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.equal(view.selected(), 'web/.github/skills/two/SKILL.md');
    assert.equal(view.$('skill').querySelector('h2')!.textContent, 'two');
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'alpha']);
    assert.equal(activeTab(view), 'alpha');
  } finally {
    view.close();
  }
  // Only the organisation: its repositories, none selected.
  const organisation = await page(`/?repo=${encodeURIComponent('github.com/skillatlas')}`);
  try {
    await organisation.settled(1);
    assert.equal(organisation.$('repositories').children.length, 4);
    assert.equal(organisation.$('main').hidden, true);
    assert.equal(organisation.scans(), 1);
  } finally {
    organisation.close();
  }
});

test('page: a repository of the organisation that fails → its message in the repository\'s tab; selected again → scanned again', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const broken = [...view.$('repositories').children].at(-1) as HTMLElement;
    const scans = view.scans();
    broken.dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    assert.equal(view.$('error').textContent, 'GitHub rate limit reached; try again in a minute');
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'broken']);
    assert.equal(activeTab(view), 'broken');
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('main').hidden, true);
    assert.equal(view.shown('problems'), true);
    assert.equal(view.$('warnings').children.length, 3);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'broken' });
    // The organisation's tab: its repositories, no error; back to the failed one: its message again.
    clickTab(view, 'SkillAtlas');
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('error').textContent, '');
    clickTab(view, 'broken');
    assert.equal(view.$('error').textContent, 'GitHub rate limit reached; try again in a minute');
    assert.equal(view.scans(), scans + 1);
    // Selected again in the list: scanned again.
    clickTab(view, 'SkillAtlas');
    await openRepository(view, 'broken');
    assert.equal(view.scans(), scans + 2);
    assert.equal(view.$('error').textContent, 'GitHub rate limit reached; try again in a minute');
    // A repository link after it: no organisation, no tabs.
    await view.enter('https://github.com/JetBrains/example');
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('tabs').hidden, true);
    assert.equal(view.$('error').textContent, '');
    assert.deepEqual(view.search(), { repo: 'https://github.com/JetBrains/example', skill: '.claude/skills/commits/SKILL.md' });
  } finally {
    view.close();
  }
});

test('page: a repository the organisation could not scan, scanned in its tab → its own warnings there, not `not scanned`; the organisation\'s tab as its scan gave them', { timeout: 10_000 }, async () => {
  // The organisation's scan, then a stand-in where example-tools (a malformed SKILL.md) was not scanned.
  const real = await page('/');
  let expected: string[];
  try {
    await real.enter('github.com/skillatlas');
    expected = [...real.$('warnings').children].map((item) => item.textContent!);
    assert.equal(expected.filter((warning) => warning.startsWith('example-tools: ')).length, 1);
    assert.match(expected[0], /^example-tools: .*malformed front matter/);
    // Scanned by the organisation: selected, its warnings are not listed twice.
    const scans = real.scans();
    const tools = [...real.$('repositories').children].find((item) => (item as HTMLElement).dataset.name === 'example-tools') as HTMLElement;
    tools.dispatchEvent(new real.dom.window.Event('click'));
    await real.settled(scans + 1);
    assert.deepEqual([...real.$('warnings').children].map((item) => item.textContent), expected);
  } finally {
    real.close();
  }
  const notScanned = 'example-tools: not scanned: GitHub rate limit reached; try again in a minute';
  const stand = await serve({
    open,
    port: 0,
    async scanOrganisation(input, progress) {
      const result = await scanOrganisation(input, progress);
      return {
        ...result,
        repositories: result.repositories.map((entry) => (entry.name === 'example-tools' ? { ...entry, skillCount: undefined } : entry)),
        warnings: result.warnings.map((warning) => (warning.startsWith('example-tools: ') ? notScanned : warning)),
      };
    },
  });
  const view = await page('/', new URL(stand.url).port);
  try {
    await view.enter('github.com/skillatlas');
    const warnings = () => [...view.$('warnings').children].map((item) => item.textContent);
    assert.deepEqual(warnings(), [notScanned, ...expected.slice(1)]);
    const repositories = () => [...view.$('repositories').children] as HTMLElement[];
    const click = async (name: string) => {
      const scans = view.scans();
      repositories().find((item) => item.dataset.name === name)!.dispatchEvent(new view.dom.window.Event('click'));
      await view.settled(scans + 1);
    };
    await click('example-tools');
    assert.deepEqual(view.names(), ['release', 'review']);
    // Its own scan's warning, where its line was; no `not scanned` for it; the others as they were.
    assert.deepEqual(warnings(), expected);
    assert.equal(view.$('problems-title').textContent, `${expected.length} warnings`);
    // The organisation's tab: its warnings as its scan gave them, as its list still says `not scanned`.
    clickTab(view, 'SkillAtlas');
    assert.equal(view.shown('problems'), true);
    assert.deepEqual(warnings(), [notScanned, ...expected.slice(1)]);
    // Its tab again: its own scan's warnings, not scanned again.
    const scans = view.scans();
    clickTab(view, 'example-tools');
    assert.equal(view.scans(), scans);
    assert.deepEqual(warnings(), expected);
    // Another repository selected: the organisation's warnings as its scan gave them.
    clickTab(view, 'SkillAtlas');
    await click('alpha');
    assert.deepEqual(warnings(), [notScanned, ...expected.slice(1)]);
  } finally {
    view.close();
    stand.server.closeAllConnections();
    stand.server.close();
  }
});

test('page: the filter used while another repository of the organisation scans → the organisation\'s warnings as they were', { timeout: 10_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const warnings = () => [...view.$('warnings').children].map((item) => item.textContent);
    const expected = warnings();
    const click = (name: string) => ([...view.$('repositories').children] as HTMLElement[])
      .find((item) => item.dataset.name === name)!.dispatchEvent(new view.dom.window.Event('click'));
    let scans = view.scans();
    click('example-tools');
    await view.settled(scans + 1);
    assert.deepEqual(warnings(), expected);
    // alpha's scan under way: the previous repository's warnings are not shown again under alpha's name.
    scans = view.scans();
    click('alpha');
    // Its tab says `Scanning alpha…`, and the organisation's warnings stay.
    assert.equal(view.$('loading').textContent, 'Scanning alpha…');
    assert.equal(view.shown('problems'), true);
    view.filter('r');
    assert.deepEqual(warnings(), expected);
    assert.equal(warnings().filter((warning) => warning!.startsWith('alpha: ')).length, 0);
    await view.settled(scans + 1);
    assert.deepEqual(warnings(), expected);
  } finally {
    view.close();
  }
});

type View = Awaited<ReturnType<typeof page>>;
const tabsOf = (view: View) => [...view.$('tabs').children] as HTMLElement[];
const tabNames = (view: View) => tabsOf(view).map((tab) => view.text(tab, '.label'));
const activeTab = (view: View) => tabNames(view)[tabsOf(view).findIndex((tab) => tab.getAttribute('aria-selected') === 'true')];
const tabNamed = (view: View, name: string) => tabsOf(view).find((tab) => view.text(tab, '.label') === name)!;
const clickTab = (view: View, name: string) => tabNamed(view, name).dispatchEvent(new view.dom.window.Event('click', { bubbles: true }));
const closeTab = (view: View, name: string) =>
  tabNamed(view, name).querySelector('.close')!.dispatchEvent(new view.dom.window.Event('click', { bubbles: true }));
/** Clicks a repository in the organisation's list and waits for what it scans. */
async function openRepository(view: View, name: string) {
  const scans = view.scans();
  const item = [...view.$('repositories').children].find((node) => (node as HTMLElement).dataset.name === name)!;
  item.dispatchEvent(new view.dom.window.Event('click'));
  await view.settled(scans);
}
const marked = (view: View) =>
  ([...view.$('repositories').children] as HTMLElement[]).filter((item) => item.getAttribute('aria-selected') === 'true').map((item) => item.dataset.name);

test('page: an organisation → its own tab; a repository selected → its skills in the repository\'s tab, in the page', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    assert.equal(view.$('tabs').hidden, false);
    assert.equal(view.$('tabs').getAttribute('role'), 'tablist');
    assert.deepEqual(tabNames(view), ['SkillAtlas']);
    assert.equal(activeTab(view), 'SkillAtlas');
    // The organisation's tab cannot be closed.
    assert.equal(tabsOf(view)[0].querySelector('.close'), null);
    await openRepository(view, 'Beta');
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'Beta']);
    assert.equal(activeTab(view), 'Beta');
    assert.equal(tabNamed(view, 'Beta').querySelector('.close')!.getAttribute('aria-label'), 'Close Beta');
    // Inside the page: the repository's skills, the organisation's list hidden, not a link elsewhere.
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('main').hidden, false);
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.deepEqual(view.names(), ['four', 'three']);
    assert.equal(view.shown('organisation'), false);
    assert.equal(view.shown('skills'), true);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'Beta', skill: '.agents/skills/four/SKILL.md' });
  } finally {
    view.close();
  }
});

test('page: switching back to the organisation\'s tab, and to the repository\'s, scans nothing again', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'Beta');
    const scans = view.scans();
    clickTab(view, 'SkillAtlas');
    assert.equal(activeTab(view), 'SkillAtlas');
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('main').hidden, true);
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 6 skills');
    assert.equal(view.$('repositories').children.length, 4);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });
    // The repository in its tab: still marked in the list.
    assert.deepEqual(marked(view), ['Beta']);
    clickTab(view, 'Beta');
    assert.equal(view.$('organisation').hidden, true);
    assert.deepEqual(view.names(), ['four', 'three']);
    // Selected again in the list: its tab, not a second one, not scanned again.
    clickTab(view, 'SkillAtlas');
    await openRepository(view, 'Beta');
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'Beta']);
    assert.equal(activeTab(view), 'Beta');
    assert.equal(view.scans(), scans);
  } finally {
    view.close();
  }
});

test('page: one repository\'s tab, its contents changed; each repository opened keeps its skill and filter', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'alpha');
    view.items()[1].dispatchEvent(new view.dom.window.Event('click'));
    view.filter('two');
    assert.deepEqual(view.names(), ['two']);
    clickTab(view, 'SkillAtlas');
    await openRepository(view, 'Beta');
    // One tab, now Beta's; Beta marked in the list, alone.
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'Beta']);
    assert.equal(activeTab(view), 'Beta');
    assert.deepEqual(marked(view), ['Beta']);
    // Opened for the first time: no filter.
    assert.equal((view.$('filter') as HTMLInputElement).value, '');
    assert.deepEqual(view.names(), ['four', 'three']);
    view.items()[1].dispatchEvent(new view.dom.window.Event('click'));
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'Beta', skill: '.agents/skills/three/SKILL.md' });
    // alpha again: as it was left, not scanned again.
    const scans = view.scans();
    clickTab(view, 'SkillAtlas');
    await openRepository(view, 'alpha');
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'alpha']);
    assert.deepEqual(marked(view), ['alpha']);
    assert.equal((view.$('filter') as HTMLInputElement).value, 'two');
    assert.deepEqual(view.names(), ['two']);
    assert.equal(view.selected(), 'web/.github/skills/two/SKILL.md');
    assert.equal(view.$('summary').textContent, `SkillAtlas/alpha · 1 of 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'alpha', skill: 'web/.github/skills/two/SKILL.md', filter: 'two' });
    clickTab(view, 'SkillAtlas');
    await openRepository(view, 'Beta');
    assert.equal(view.selected(), '.agents/skills/three/SKILL.md');
    assert.equal((view.$('filter') as HTMLInputElement).value, '');
    assert.equal(view.scans(), scans);
  } finally {
    view.close();
  }
});

test('page: × closes the repository\'s tab → the organisation\'s, nothing scanned, nothing forgotten', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'alpha');
    view.items()[1].dispatchEvent(new view.dom.window.Event('click'));
    view.filter('two');
    const scans = view.scans();
    closeTab(view, 'alpha');
    assert.deepEqual(tabNames(view), ['SkillAtlas']);
    assert.equal(activeTab(view), 'SkillAtlas');
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('main').hidden, true);
    assert.deepEqual(marked(view), []);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });
    // Selected again: its tab as it was left, not scanned again.
    await openRepository(view, 'alpha');
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'alpha']);
    assert.equal((view.$('filter') as HTMLInputElement).value, 'two');
    assert.equal(view.selected(), 'web/.github/skills/two/SKILL.md');
    assert.equal(view.scans(), scans);
  } finally {
    view.close();
  }
});

test('page: the repository\'s tab while it scans → Scanning <repo>…; left before it is done → kept, not shown', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const scans = view.scans();
    const click = (name: string) =>
      [...view.$('repositories').children].find((node) => (node as HTMLElement).dataset.name === name)!.dispatchEvent(new view.dom.window.Event('click'));
    click('Beta');
    assert.equal(activeTab(view), 'Beta');
    assert.equal(view.$('loading').hidden, false);
    assert.equal(view.$('loading').textContent, 'Scanning Beta…');
    assert.equal(view.$('main').hidden, true);
    assert.equal(view.$('organisation').hidden, true);
    clickTab(view, 'SkillAtlas');
    assert.equal(view.$('loading').hidden, true);
    await view.settled(scans + 1);
    // Done while the organisation's tab is active: it stays.
    assert.equal(activeTab(view), 'SkillAtlas');
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('main').hidden, true);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });
    clickTab(view, 'Beta');
    assert.deepEqual(view.names(), ['four', 'three']);
    assert.equal(view.scans(), scans + 1);
    // alpha selected, then Beta before alpha is done: Beta's skills stay; alpha kept.
    clickTab(view, 'SkillAtlas');
    click('alpha');
    clickTab(view, 'SkillAtlas');
    click('Beta');
    await view.settled(scans + 2);
    assert.deepEqual(tabNames(view), ['SkillAtlas', 'Beta']);
    assert.deepEqual(view.names(), ['four', 'three']);
    clickTab(view, 'SkillAtlas');
    await openRepository(view, 'alpha');
    assert.deepEqual(view.names(), ['one', 'two']);
    // Closed before it is done: nothing shown when it is.
    clickTab(view, 'SkillAtlas');
    click('example-tools');
    closeTab(view, 'example-tools');
    await view.settled(scans + 3);
    assert.deepEqual(tabNames(view), ['SkillAtlas']);
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('main').hidden, true);
    assert.equal(view.scans(), scans + 3);
  } finally {
    view.close();
  }
});

test('page: the URL keeps the active tab; reload restores it, with its skill and filter', { timeout: 5_000 }, async () => {
  const view = await page('/');
  let url: string;
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'Beta');
    clickTab(view, 'SkillAtlas');
    await openRepository(view, 'alpha');
    view.items()[1].dispatchEvent(new view.dom.window.Event('click'));
    view.filter('two');
    url = view.dom.window.location.pathname + view.dom.window.location.search;
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'alpha', skill: 'web/.github/skills/two/SKILL.md', filter: 'two' });
  } finally {
    view.close();
  }
  const reloaded = await page(url);
  try {
    await reloaded.settled(2);
    assert.deepEqual(tabNames(reloaded), ['SkillAtlas', 'alpha']);
    assert.equal(activeTab(reloaded), 'alpha');
    assert.equal(reloaded.$('organisation').hidden, true);
    assert.equal((reloaded.$('filter') as HTMLInputElement).value, 'two');
    assert.deepEqual(reloaded.names(), ['two']);
    assert.equal(reloaded.selected(), 'web/.github/skills/two/SKILL.md');
    // Back to the organisation: its repositories, from the same scan.
    clickTab(reloaded, 'SkillAtlas');
    assert.equal(reloaded.$('organisation').hidden, false);
    assert.equal(reloaded.$('repositories').children.length, 4);
    assert.deepEqual(reloaded.search(), { repo: 'github.com/skillatlas' });
    assert.equal(reloaded.scans(), 2);
    // Beta was opened before the reload: not kept, scanned now.
    await openRepository(reloaded, 'Beta');
    assert.equal(reloaded.scans(), 3);
  } finally {
    reloaded.close();
  }
  // The organisation's tab active: only it, after a reload.
  const organisation = await page(`/?repo=${encodeURIComponent('github.com/skillatlas')}`);
  try {
    await organisation.settled(1);
    assert.deepEqual(tabNames(organisation), ['SkillAtlas']);
    assert.equal(activeTab(organisation), 'SkillAtlas');
  } finally {
    organisation.close();
  }
});

test('page: another link entered → the tabs closed; a repository link has no tabs', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'Beta');
    await view.enter('github.com/skillatlas');
    assert.deepEqual(tabNames(view), ['SkillAtlas']);
    assert.equal(activeTab(view), 'SkillAtlas');
    assert.deepEqual(marked(view), []);
    // The repositories opened are forgotten: scanned again.
    const scans = view.scans();
    await openRepository(view, 'Beta');
    assert.equal(view.scans(), scans + 1);
    await view.enter(FIXTURE);
    assert.equal(view.$('tabs').hidden, true);
    assert.equal(view.shown('tabs'), false);
    assert.equal(view.$('main').hidden, false);
  } finally {
    view.close();
  }
});

test('page: a neon-sunset style: the tabs on rounded cards, the active one tinted with an accent bar', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await openRepository(view, 'Beta');
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const [organisation, beta] = tabsOf(view);
    for (const tab of [organisation, beta]) assert.match(style(tab).borderRadius, /^[1-9]\d*px$/);
    assert.match(style(beta).backgroundImage, /^linear-gradient\(/);
    assert.match(style(beta).boxShadow, /\binset\b/);
    assert.doesNotMatch(style(organisation).backgroundImage, /gradient/);
    assert.doesNotMatch(style(organisation).boxShadow, /\binset\b/);
    assert.equal(style(view.$('tabs')).display, 'flex');
  } finally {
    view.close();
  }
});

test('page: repositories with 0 skills not listed; one in the URL → the organisation, none selected', { timeout: 5_000 }, async () => {
  for (const name of ['empty', 'Docs']) {
    const view = await page(`/?repo=${encodeURIComponent('github.com/skillatlas')}&repository=${name}`);
    try {
      await view.settled(1);
      assert.equal(view.scans(), 1);
      assert.equal(view.$('organisation').hidden, false);
      assert.deepEqual(tabNames(view), ['SkillAtlas']);
      assert.equal(activeTab(view), 'SkillAtlas');
      assert.ok(![...view.$('repositories').children].some((item) => (item as HTMLElement).dataset.name === name), name);
      assert.equal(view.$('error').textContent, '');
      assert.equal(view.$('main').hidden, true);
      assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });
    } finally {
      view.close();
    }
  }
});

test('page: every repository with 0 skills → none listed, the header counts them all, no error', { timeout: 5_000 }, async () => {
  // Every repository with 0 skills: none listed, no error.
  const quiet = {
    organisation: { name: 'quiet', url: 'https://github.com/quiet' },
    repositories: ['a', 'b'].map((name) => ({ name, url: `https://github.com/quiet/${name}`, commit: ORGANISATION_COMMIT, skillCount: 0 })),
    skills: 0,
    warnings: [],
  };
  const empty = await serve({ open, scanOrganisation: async () => quiet, port: 0 });
  const at = new URL(empty.url).port;
  const other = await page('/', at);
  try {
    await other.enter('github.com/quiet');
    assert.equal(other.$('org-summary').textContent, 'quiet · 2 repositories · 0 skills');
    assert.equal(other.$('repositories').children.length, 0);
    assert.equal(other.$('error').textContent, '');
    assert.equal(other.$('main').hidden, true);
    // The API: every repository, with its count.
    const body = await (await fetch(`http://127.0.0.1:${at}/api/scan?repo=github.com/quiet`)).json();
    assert.deepEqual(body.repositories.map((repository: { skillCount: number }) => repository.skillCount), [0, 0]);
  } finally {
    other.close();
    empty.server.close();
  }
});

test('page: an unknown organisation → its message, nothing else', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    await view.enter('github.com/no-such-organisation');
    assert.equal(view.$('error').textContent, 'Organisation not found: https://github.com/no-such-organisation');
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('main').hidden, true);
    assert.equal(view.shown('problems'), false);
  } finally {
    view.close();
  }
});

/** `GET /api/scan?stream=1&repo=<link>` on the server at `at`: its status, type, and each line parsed. */
async function streamed(repo: string, at = port) {
  const response = await fetch(`http://127.0.0.1:${at}/api/scan?stream=1&repo=${encodeURIComponent(repo)}`);
  const text = await response.text();
  const type = response.headers.get('content-type');
  return { status: response.status, type, lines: type?.startsWith('application/x-ndjson') ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : JSON.parse(text) };
}

/**
 * A server whose organisation scan stops after `scanned` of `total` repositories, until `finish`
 * lets it end with the recorded result, or `fail` with an error.
 */
async function stoppedServer(scanned: number, total: number) {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => ((finish = resolve), (fail = reject)));
  let reached!: () => void;
  const stopped = new Promise<void>((resolve) => (reached = resolve));
  const options: WebOptions = {
    open,
    async scanOrganisation(input, progress) {
      for (let done = 0; done <= scanned; done++) progress?.(done, total);
      reached();
      await gate;
      for (let done = scanned + 1; done <= total; done++) progress?.(done, total);
      return scanOrganisation(input);
    },
  };
  const { server, url } = await serve({ ...options, port: 0 });
  return { port: new URL(url).port, stopped, finish, fail, close: () => server.close() };
}

test('API: stream=1, an organisation → a line per repository done, 0 of N first, then the same JSON as without it', async () => {
  const { status, type, lines } = (await streamed('github.com/skillatlas')) as { status: number; type: string; lines: Record<string, any>[] };
  assert.equal(status, 200);
  assert.equal(type, 'application/x-ndjson; charset=utf-8');
  assert.deepEqual(lines.slice(0, -1).map((line) => line.progress), [0, 1, 2, 3, 4, 5, 6, 7].map((scanned) => ({ scanned, total: 7 })));
  const { body: result } = await scan('github.com/skillatlas');
  assert.deepEqual(lines.at(-1), { result });
  // 0 of N: the organisation and every repository listed, none scanned yet.
  const notScanned = (name: string) => ({ name, url: `https://github.com/SkillAtlas/${name}`, commit: null, skillCount: null });
  assert.deepEqual(lines[0], {
    progress: { scanned: 0, total: 7 },
    organisation: result.organisation,
    repositories: ['example-tools', 'Docs', 'alpha', 'huge', 'Beta', 'broken', 'empty'].map(notScanned),
  });
  // Then each repository just done, as in the result, and its warnings, whatever order they end in.
  const done = lines.slice(1, -1);
  assert.deepEqual(done.map((line) => Object.keys(line).sort()), done.map(() => ['progress', 'repository', 'warnings']));
  const byName = (entries: { name: string }[]) => [...entries].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(byName(done.map((line) => line.repository)), byName(result.repositories));
  assert.deepEqual(done.flatMap((line) => line.warnings).sort(), [...result.warnings].sort());
  // One repository: only its answer.
  const repository = await streamed('https://github.com/JetBrains/example');
  assert.deepEqual(repository.lines, [{ result: (await scan('https://github.com/JetBrains/example')).body }]);
});

test('API: stream=1, a scan that fails before any progress → 400 and its message, as without it', async () => {
  assert.deepEqual(await streamed('github.com/no-such-organisation'), {
    status: 400,
    type: 'application/json; charset=utf-8',
    lines: { error: 'Organisation not found: https://github.com/no-such-organisation' },
  });
});

test('API: stream=1, a scan that fails after some progress → its message, the last line', async () => {
  const stopped = await stoppedServer(1, 3);
  try {
    const answer = streamed('github.com/skillatlas', stopped.port);
    await stopped.stopped;
    stopped.fail(new AtlasError('Cannot reach GitHub: connection reset'));
    assert.deepEqual((await answer).lines, [
      { progress: { scanned: 0, total: 3 } },
      { progress: { scanned: 1, total: 3 } },
      { error: 'Cannot reach GitHub: connection reset' },
    ]);
  } finally {
    stopped.close();
  }
});

test('page: an organisation scanning → a progress bar, N of M repositories scanned; hidden once it is done', { timeout: 5_000 }, async () => {
  const stopped = await stoppedServer(2, 7);
  const view = await page('/', stopped.port);
  try {
    assert.equal(view.$('progress').hidden, true);
    (view.$('repo') as HTMLInputElement).value = 'github.com/skillatlas';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await stopped.stopped;
    // The lines arrive as they are written: wait for the page to show the last one.
    while (view.$('progress-text').textContent !== '2 of 7 repositories scanned') await new Promise((r) => setTimeout(r, 10));
    assert.equal(view.$('progress').hidden, false);
    const bar = view.$('progress-bar') as HTMLProgressElement;
    assert.deepEqual([bar.value, bar.max], [2, 7]);
    assert.equal(view.$('scan').textContent, 'Stop');
    stopped.finish();
    await view.settled(1);
    assert.equal(view.$('progress').hidden, true);
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 6 skills');
    // A repository of it selected: no progress bar.
    const repositories = [...view.$('repositories').children] as HTMLElement[];
    repositories[0].dispatchEvent(new view.dom.window.Event('click'));
    assert.equal(view.$('progress').hidden, true);
    await view.settled(2);
    assert.equal(view.$('progress').hidden, true);
  } finally {
    view.close();
    stopped.close();
  }
});

test('page: an organisation scan that fails → the progress bar hidden, its message', { timeout: 5_000 }, async () => {
  const stopped = await stoppedServer(1, 3);
  const view = await page('/', stopped.port);
  try {
    (view.$('repo') as HTMLInputElement).value = 'github.com/skillatlas';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await stopped.stopped;
    while (view.$('progress-text').textContent !== '1 of 3 repositories scanned') await new Promise((r) => setTimeout(r, 10));
    assert.equal(view.$('progress').hidden, false);
    stopped.fail(new AtlasError('Cannot reach GitHub: connection reset'));
    await view.settled(1);
    assert.equal(view.$('progress').hidden, true);
    assert.equal(view.$('error').textContent, 'Cannot reach GitHub: connection reset');
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('main').hidden, true);
  } finally {
    view.close();
    stopped.close();
  }
  // Unknown: fails before any progress; no progress bar.
  const unknown = await page('/');
  try {
    await unknown.enter('github.com/no-such-organisation');
    assert.equal(unknown.$('progress').hidden, true);
    assert.equal(unknown.$('error').textContent, 'Organisation not found: https://github.com/no-such-organisation');
  } finally {
    unknown.close();
  }
});

test('page: another link entered while an organisation is scanned → its progress no longer shown', { timeout: 5_000 }, async () => {
  const stopped = await stoppedServer(1, 3);
  const view = await page('/', stopped.port);
  try {
    (view.$('repo') as HTMLInputElement).value = 'github.com/skillatlas';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await stopped.stopped;
    while (view.$('progress').hidden) await new Promise((r) => setTimeout(r, 10));
    (view.$('repo') as HTMLInputElement).value = 'https://github.com/JetBrains/example';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    assert.equal(view.$('progress').hidden, true);
    while (view.$('main').hidden) await new Promise((r) => setTimeout(r, 10));
    stopped.finish();
    await view.settled(2);
    assert.equal(view.$('progress').hidden, true);
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('summary').textContent, `JetBrains/example · 1 skill · ${EXAMPLE_COMMIT.slice(0, 12)}`);
  } finally {
    view.close();
    stopped.close();
  }
});

/**
 * A server whose scans hold, as on a slow network, until `release`: an organisation's, one
 * repository at a time, once `scanned` of them are done; a link's, before it is opened. A held
 * request is aborted with its scan's signal. `signals` has each scan's signal, `urls` each request
 * of an organisation's scan to GitHub.
 */
async function heldServer(scanned: number) {
  let held = true;
  let holding = 0;
  const signals: AbortSignal[] = [];
  const urls: string[] = [];
  const hold = (signal?: AbortSignal) =>
    held
      ? new Promise<never>((_, reject) => {
          holding++;
          signal?.addEventListener('abort', () => reject(signal.reason));
        })
      : Promise.resolve();
  const options: WebOptions = {
    async open(input, signal) {
      signals.push(signal!);
      await hold(signal);
      // Through the tree, as the organisation's repositories are recorded: no code search.
      return parseGitHubUrl(input) ? openGitHub(input, { fetch: github }) : open(input);
    },
    scanOrganisation(input, progress, refresh, signal) {
      signals.push(signal!);
      let done = 0;
      const fetch: Fetch = async (url, init) => {
        urls.push(url);
        if (done >= scanned) await hold(init?.signal);
        return github(url, init);
      };
      return scanOwner(input, {
        fetch,
        token: 'test',
        concurrency: 1,
        signal,
        progress: (count, total, update) => {
          done = count;
          progress?.(count, total, update);
        },
      });
    },
  };
  const { server, url } = await serve({ ...options, port: 0 });
  return {
    port: new URL(url).port,
    signals,
    urls,
    holding: () => holding,
    hold: () => (held = true),
    release: () => (held = false),
    // Its open requests too: a scan not aborted would keep the test running.
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

/** Waits for \`done\`; fails after 3 seconds instead of waiting for ever. */
const until = async (done: () => boolean) => {
  const deadline = Date.now() + 3_000;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('page: a neon-sunset style: Stop, while a scan runs, clearly not Scan: cyan on a dark ground, a cyan glow; Scan again after', { timeout: 5_000 }, async () => {
  const held = await heldServer(0);
  const view = await page('/', held.port);
  const scan = view.$('scan') as HTMLButtonElement;
  const style = () => view.dom.window.getComputedStyle(scan);
  const cyan = ([r, g, b]: number[]) => r < 120 && g > 200 && b > 200;
  try {
    const looks = { image: style().backgroundImage, colour: style().color, border: style().borderTopColor, shadow: style().boxShadow };
    (view.$('repo') as HTMLInputElement).value = FIXTURE;
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await until(() => scan.textContent === 'Stop');
    // No gradient, a dark ground, cyan text and border, a glow in cyan, not in pink.
    assert.equal(style().backgroundImage, 'none');
    const ground = rgba(style().backgroundColor);
    assert.equal(ground[3], 1, style().backgroundColor);
    assert.ok(Math.max(...ground.slice(0, 3)) < 60, style().backgroundColor);
    assert.ok(cyan(rgba(style().color)), style().color);
    assert.ok(cyan(rgba(style().borderTopColor)), style().borderTopColor);
    assert.equal(style().borderTopStyle, 'solid');
    assert.match(style().boxShadow, /rgba\(34, 227, 224, [\d.]+\) 0px 0px [1-9]\d*px/);
    assert.doesNotMatch(style().boxShadow, /rgba?\(255, 46, 151/);
    assert.equal(style().cursor, 'pointer');
    assert.notDeepEqual({ image: style().backgroundImage, colour: style().color, border: style().borderTopColor, shadow: style().boxShadow }, looks);
    // Its text at WCAG AA on its ground; brighter under the pointer, as Scan.
    const ratio = contrast(rgba(style().color), ground);
    assert.ok(ratio >= 4.5, `Stop: ${ratio.toFixed(2)}:1`);
    const hover = sheetRules(view).filter((rule) => /:hover$/.test(rule.selectorText) && scan.matches(rule.selectorText.replace(':hover', '')));
    assert.ok(hover.some((rule) => /rgb\(34, 227, 224\)|#22e3e0/.test(rule.style.boxShadow)), 'a cyan glow under the pointer');
    // Stopped: Scan's look again.
    scan.click();
    assert.equal(scan.textContent, 'Scan');
    assert.deepEqual({ image: style().backgroundImage, colour: style().color, border: style().borderTopColor, shadow: style().boxShadow }, looks);
  } finally {
    view.close();
    held.close();
  }
});

test('page: while an organisation scans, Stop → what has been found so far kept, the rest not scanned; Scan again', { timeout: 5_000 }, async () => {
  const held = await heldServer(3);
  const view = await page('/', held.port);
  const button = view.$('scan') as HTMLButtonElement;
  const repositories = () =>
    ([...view.$('repositories').children] as HTMLElement[]).map((item) => `${view.text(item, '.name')} ${view.text(item, '.count')}`);
  try {
    assert.deepEqual([button.textContent, button.type], ['Scan', 'submit']);
    (view.$('repo') as HTMLInputElement).value = 'github.com/skillatlas';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    // Done one at a time, in the order listed: example-tools, Docs and alpha, then held.
    await until(() => view.$('progress-text').textContent === '3 of 7 repositories scanned');
    // Stop, enabled; not the form's submit button, so Enter in the field still scans a link.
    assert.deepEqual([button.textContent, button.type, button.disabled], ['Stop', 'button', false]);
    button.click();
    assert.deepEqual([button.textContent, button.type, button.disabled], ['Scan', 'submit', false]);
    assert.equal(view.$('progress').hidden, true);
    assert.equal(view.$('error').textContent, '');
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('main').hidden, true);
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 4 skills');
    // Docs, scanned with 0 skills, is not listed; counted in the header all the same.
    assert.deepEqual(repositories(), [
      'alpha 2 skills',
      'example-tools 2 skills',
      'Beta not scanned',
      'broken not scanned',
      'empty not scanned',
      'huge not scanned',
    ]);
    assert.deepEqual([...view.$('warnings').children].map((item) => item.textContent), [
      'example-tools: .agents/skills/release/SKILL.md: malformed front matter: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 15; using the directory name',
    ]);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });
    assert.deepEqual([tabNames(view), activeTab(view)], [['SkillAtlas'], 'SkillAtlas']);
    // The server stops the scan: its request aborted, no repository started after it.
    await until(() => held.signals[0].aborted);
    const requested = held.urls.length;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(held.urls.length, requested);
    assert.equal(held.urls.some((url) => /SkillAtlas\/(Beta|broken|empty)\b/.test(url)), false);
    // A repository not scanned, selected: scanned now, its skills shown.
    held.release();
    ([...view.$('repositories').children] as HTMLElement[])[2].dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(2);
    assert.equal(view.$('error').textContent, '');
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    // Scan again: the whole organisation.
    await view.enter('github.com/skillatlas');
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 6 skills');
    assert.equal(repositories().filter((line) => line.endsWith('not scanned')).length, 1);
    assert.deepEqual([button.textContent, button.type], ['Scan', 'submit']);
    assert.equal(view.$('progress').hidden, true);
  } finally {
    view.close();
    held.close();
  }
});

test('page: Stop before an organisation\'s repositories are listed, or on a repository link → nothing shown, no error', { timeout: 5_000 }, async () => {
  const held = await heldServer(0);
  const view = await page('/', held.port);
  const button = view.$('scan') as HTMLButtonElement;
  try {
    // A scan before, with warnings: Stop leaves none of them.
    held.release();
    await view.enter(FIXTURE);
    assert.equal(view.$('problems').hidden, false);
    assert.ok(view.$('warnings').children.length > 0);
    held.hold();
    for (const [index, link] of ['github.com/skillatlas', FIXTURE].entries()) {
      (view.$('repo') as HTMLInputElement).value = link;
      view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
      await until(() => held.holding() === index + 1);
      assert.equal(button.textContent, 'Stop');
      button.click();
      assert.equal(button.textContent, 'Scan');
      assert.equal(view.$('organisation').hidden, true);
      assert.equal(view.$('main').hidden, true);
      assert.equal(view.$('progress').hidden, true);
      assert.equal(view.$('error').textContent, '');
      assert.equal(view.$('problems').hidden, true);
      assert.equal(view.$('warnings').children.length, 0);
      assert.deepEqual(view.search(), { repo: link });
      await until(() => held.signals[index + 1].aborted);
    }
    // Scan again: its skills.
    held.release();
    await view.enter(FIXTURE);
    assert.match(view.$('summary').textContent!, / · 4 skills$/);
    assert.equal(button.textContent, 'Scan');
  } finally {
    view.close();
    held.close();
  }
});

test('page: another link entered while an organisation scans → the earlier scan aborted, it shows nothing more', { timeout: 5_000 }, async () => {
  const held = await heldServer(3);
  const view = await page('/', held.port);
  const button = view.$('scan') as HTMLButtonElement;
  try {
    (view.$('repo') as HTMLInputElement).value = 'github.com/skillatlas';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await until(() => view.$('progress-text').textContent === '3 of 7 repositories scanned');
    assert.equal(held.signals[0].aborted, false);
    // Enter in the field, Stop showing: the link entered is scanned, the earlier one aborted.
    held.release();
    await view.enter(FIXTURE);
    assert.match(view.$('summary').textContent!, / · 4 skills$/);
    assert.deepEqual([button.textContent, button.type], ['Scan', 'submit']);
    assert.equal(view.$('progress').hidden, true);
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('error').textContent, '');
    assert.equal(view.search().repo, FIXTURE);
    // The server stops the earlier scan: its signal aborted, no request to GitHub after it.
    await until(() => held.signals[0].aborted);
    const requested = held.urls.length;
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(held.urls.length, requested);
    assert.equal(held.urls.some((url) => /SkillAtlas\/(Beta|broken|empty)\b/.test(url)), false);
    assert.equal(view.$('organisation').hidden, true);
    assert.match(view.$('summary').textContent!, / · 4 skills$/);
  } finally {
    view.close();
    held.close();
  }
});

test('page: Stop while a repository of the organisation is scanned → the organisation stays, no repository selected', { timeout: 5_000 }, async () => {
  const held = await heldServer(7);
  held.release();
  const view = await page('/', held.port);
  const button = view.$('scan') as HTMLButtonElement;
  try {
    await view.enter('github.com/skillatlas');
    const items = () => [...view.$('repositories').children] as HTMLElement[];
    items()[0].dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(2);
    assert.equal(view.$('main').hidden, false);
    held.hold();
    items()[1].dispatchEvent(new view.dom.window.Event('click'));
    await until(() => held.holding() === 1);
    assert.equal(button.textContent, 'Stop');
    button.click();
    assert.equal(button.textContent, 'Scan');
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 6 skills');
    assert.deepEqual(items().map((item) => item.getAttribute('aria-selected')), items().map(() => 'false'));
    // Its tab closed, the organisation's active.
    assert.deepEqual([tabNames(view), activeTab(view)], [['SkillAtlas'], 'SkillAtlas']);
    assert.equal(view.$('loading').hidden, true);
    assert.equal(view.$('main').hidden, true);
    assert.equal(view.$('error').textContent, '');
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });
    await until(() => held.signals.at(-1)!.aborted);
    // Selected again: scanned again, its skills.
    held.release();
    const scans = view.scans();
    items()[1].dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    assert.equal(activeTab(view), 'Beta');
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.equal(view.$('error').textContent, '');
  } finally {
    view.close();
    held.close();
  }
});

/**
 * A server whose scan of a repository whose link contains `stalled` waits until `release`; the
 * others as on the server above. `reached` once such a scan started.
 */
async function stalledServer(stalled: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const started = new Promise<void>((resolve) => (reached = resolve));
  const options: WebOptions = {
    async open(input) {
      if (input.includes(stalled)) {
        reached();
        await gate;
      }
      return open(input);
    },
    scanOrganisation,
  };
  const { server, url } = await serve({ ...options, port: 0 });
  return { port: new URL(url).port, started, release, close: () => (release(), server.closeAllConnections(), server.close()) };
}

/** The Scan button: its label, and whether it is enabled. */
const button = (view: Awaited<ReturnType<typeof page>>) => {
  const scan = view.$('scan') as HTMLButtonElement;
  return [scan.textContent, !scan.disabled];
};

test('page: the Scan button → Stop, enabled, while a scan runs; Scan, enabled, once it succeeds', { timeout: 5_000 }, async () => {
  const stalled = await stalledServer('JetBrains/example');
  const view = await page('/', stalled.port);
  try {
    assert.deepEqual(button(view), ['Scan', true]);
    (view.$('repo') as HTMLInputElement).value = 'https://github.com/JetBrains/example';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await stalled.started;
    assert.deepEqual(button(view), ['Stop', true]);
    stalled.release();
    await view.settled(1);
    assert.equal(view.$('summary').textContent, `JetBrains/example · 1 skill · ${EXAMPLE_COMMIT.slice(0, 12)}`);
    assert.deepEqual(button(view), ['Scan', true]);
  } finally {
    view.close();
    stalled.close();
  }
});

test('page: the Scan button → Scan, enabled, once a scan fails, before or after some progress', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/no-such-organisation');
    assert.equal(view.$('error').textContent, 'Organisation not found: https://github.com/no-such-organisation');
    assert.deepEqual(button(view), ['Scan', true]);
  } finally {
    view.close();
  }
  const stopped = await stoppedServer(1, 3);
  const failing = await page('/', stopped.port);
  try {
    (failing.$('repo') as HTMLInputElement).value = 'github.com/skillatlas';
    failing.$('form').dispatchEvent(new failing.dom.window.Event('submit', { cancelable: true }));
    await stopped.stopped;
    assert.deepEqual(button(failing), ['Stop', true]);
    stopped.fail(new AtlasError('Cannot reach GitHub: connection reset'));
    await failing.settled(1);
    assert.equal(failing.$('error').textContent, 'Cannot reach GitHub: connection reset');
    assert.deepEqual(button(failing), ['Scan', true]);
  } finally {
    failing.close();
    stopped.close();
  }
});

test('page: the Scan button → Scan, enabled, once an organisation is scanned; an earlier scan still running does not hold it', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    assert.equal(view.$('org-summary').textContent, 'SkillAtlas · 7 repositories · 6 skills');
    assert.deepEqual(button(view), ['Scan', true]);
  } finally {
    view.close();
  }
  // An organisation scan that never ends, replaced by another link: the button follows the latest.
  const stopped = await stoppedServer(1, 3);
  const replaced = await page('/', stopped.port);
  try {
    (replaced.$('repo') as HTMLInputElement).value = 'github.com/skillatlas';
    replaced.$('form').dispatchEvent(new replaced.dom.window.Event('submit', { cancelable: true }));
    await stopped.stopped;
    (replaced.$('repo') as HTMLInputElement).value = 'https://github.com/JetBrains/example';
    replaced.$('form').dispatchEvent(new replaced.dom.window.Event('submit', { cancelable: true }));
    while (replaced.$('main').hidden) await new Promise((r) => setTimeout(r, 10));
    assert.equal(replaced.$('summary').textContent, `JetBrains/example · 1 skill · ${EXAMPLE_COMMIT.slice(0, 12)}`);
    assert.deepEqual(button(replaced), ['Scan', true]);
    // The earlier one ending later changes nothing.
    stopped.finish();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(replaced.$('organisation').hidden, true);
    assert.deepEqual(button(replaced), ['Scan', true]);
  } finally {
    replaced.close();
    stopped.close();
  }
});

test('page: the Scan button → Scan, enabled, once the repository last opened from an organisation is shown', { timeout: 5_000 }, async () => {
  const stalled = await stalledServer('/alpha/');
  const view = await page('/', stalled.port);
  try {
    await view.enter('github.com/skillatlas');
    const repositories = [...view.$('repositories').children] as HTMLElement[];
    const scans = view.scans();
    // alpha never answers; Beta, opened after it, does.
    repositories[0].dispatchEvent(new view.dom.window.Event('click'));
    await stalled.started;
    assert.deepEqual(button(view), ['Stop', true]);
    repositories[1].dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 2);
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.deepEqual(button(view), ['Scan', true]);
    // alpha answering later changes nothing.
    stalled.release();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.deepEqual(button(view), ['Scan', true]);
  } finally {
    view.close();
    stalled.close();
  }
  // Reloaded with a repository: the organisation, then it; the button once it is shown.
  const reloaded = await page(`/?repo=${encodeURIComponent('github.com/skillatlas')}&repository=Beta`);
  try {
    await reloaded.settled(2);
    assert.equal(reloaded.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.deepEqual(button(reloaded), ['Scan', true]);
  } finally {
    reloaded.close();
  }
});

test('page: a repository of the organisation clicked while another link is scanned → nothing; the button waits for that link', { timeout: 5_000 }, async () => {
  const stalled = await stalledServer('JetBrains/example');
  const view = await page('/', stalled.port);
  try {
    await view.enter('github.com/skillatlas');
    const beta = [...view.$('repositories').children][1] as HTMLElement;
    (view.$('repo') as HTMLInputElement).value = 'https://github.com/JetBrains/example';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await stalled.started;
    const scans = view.scans();
    beta.dispatchEvent(new view.dom.window.Event('click'));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(view.scans(), scans);
    assert.equal(view.$('error').textContent, '');
    assert.deepEqual(button(view), ['Stop', true]);
    stalled.release();
    await view.settled(scans);
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('summary').textContent, `JetBrains/example · 1 skill · ${EXAMPLE_COMMIT.slice(0, 12)}`);
    assert.deepEqual(button(view), ['Scan', true]);
  } finally {
    view.close();
    stalled.close();
  }
});

/** The page's Tab order: what is shown and focusable, in document order, skipping tabindex="-1". */
function tabOrder(view: Awaited<ReturnType<typeof page>>) {
  const document = view.dom.window.document;
  const shown = (node: Element) => {
    for (let at: Element | null = node; at; at = at.parentElement) {
      if ((at as HTMLElement).hidden || view.dom.window.getComputedStyle(at).display === 'none') return false;
    }
    return true;
  };
  return ([...document.querySelectorAll('input, button, a[href], [tabindex]')] as HTMLElement[])
    .filter((node) => node.tabIndex >= 0 && shown(node))
    .map((node) => node.id || (node.dataset.path ?? node.dataset.name ?? node.tagName.toLowerCase()));
}
/** A key pressed on the element focused, as a browser dispatches it; whether the page took it. */
function press(view: Awaited<ReturnType<typeof page>>, key: string) {
  const focused = view.dom.window.document.activeElement!;
  const event = new view.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  focused.dispatchEvent(event);
  return event.defaultPrevented;
}
const focused = (view: Awaited<ReturnType<typeof page>>) => {
  const node = view.dom.window.document.activeElement as HTMLElement;
  return node.dataset.path ?? node.dataset.name ?? node.id;
};

test('page: the skills from the keyboard: Tab reaches the selected one, the arrows move, Enter or Space selects', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const paths = view.items().map((item) => item.dataset.path!);
    // The field, Scan, the warnings' list, the filter, the skills once, on the selected one, the SKILL.md link.
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'warnings', 'filter', paths[0], 'a']);
    assert.equal(view.$('skills').getAttribute('role'), 'listbox');
    assert.ok(view.items().every((item) => item.getAttribute('role') === 'option'));

    // ArrowDown in the filter: on to the selected skill.
    view.$('filter').focus();
    assert.equal(press(view, 'ArrowDown'), true);
    assert.equal(focused(view), paths[0]);
    // The arrows, Home and End move the focus; the selection stays.
    press(view, 'ArrowDown');
    assert.equal(focused(view), paths[1]);
    press(view, 'End');
    assert.equal(focused(view), paths[3]);
    press(view, 'ArrowDown');
    assert.equal(focused(view), paths[3]);
    press(view, 'ArrowUp');
    assert.equal(focused(view), paths[2]);
    press(view, 'Home');
    assert.equal(focused(view), paths[0]);
    press(view, 'ArrowDown');
    assert.equal(view.selected(), paths[0]);
    assert.equal(view.$('skill').querySelector('h2')!.textContent, 'code-style');
    // The focus leaving the list (Shift+Tab, a click elsewhere): Tab comes back on the selected one.
    view.$('filter').focus();
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'warnings', 'filter', paths[0], 'a']);
    press(view, 'ArrowDown');
    press(view, 'ArrowDown');
    assert.equal(focused(view), paths[1]);

    // Enter selects the skill focused: its SKILL.md, its link, the URL.
    assert.equal(press(view, 'Enter'), true);
    assert.equal(view.selected(), paths[1]);
    assert.equal(view.$('skill').querySelector('h2')!.textContent, 'commits');
    assert.equal(view.$('content').textContent, readFileSync(join(FIXTURE, paths[1]), 'utf8'));
    assert.equal(view.search().skill, paths[1]);
    assert.equal(focused(view), paths[1]);
    // Space too, without scrolling the page.
    press(view, 'ArrowDown');
    assert.equal(press(view, ' '), true);
    assert.equal(view.selected(), paths[2]);
    assert.equal(view.$('skill').querySelector('h2')!.textContent, 'invoices');
    // Tab comes back to the list on the selected skill, also after the filter narrows it.
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'warnings', 'filter', paths[2], 'a']);
    view.filter('commit');
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'warnings', 'filter', view.selected(), 'a']);
    // Other keys are left to the browser.
    view.items()[0].focus();
    assert.equal(press(view, 'Tab'), false);
    assert.equal(press(view, 'a'), false);
  } finally {
    view.close();
  }
});

test('page: an organisation\'s repositories from the keyboard: Tab reaches them, the arrows move, Enter or Space opens one', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const repositories = () => [...view.$('repositories').children] as HTMLElement[];
    assert.equal(view.$('repositories').getAttribute('role'), 'listbox');
    // None selected yet: Tab reaches the first.
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'alpha', 'warnings']);
    repositories()[0].focus();
    press(view, 'ArrowDown');
    assert.equal(focused(view), 'Beta');
    // Moving the focus opens nothing.
    assert.equal(view.$('main').hidden, true);
    // The focus leaving the list: Tab comes back on the first, none being selected.
    view.$('scan').focus();
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'alpha', 'warnings']);
    repositories()[0].focus();
    press(view, 'ArrowDown');
    let scans = view.scans();
    assert.equal(press(view, 'Enter'), true);
    await view.settled(scans + 1);
    assert.equal(repositories()[1].getAttribute('aria-selected'), 'true');
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'Beta', skill: '.agents/skills/four/SKILL.md' });
    // In the repository's tab: its close button, the warnings' list, then its skills; the list is in the organisation's tab.
    assert.equal(activeTab(view), 'Beta');
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'button', 'warnings', 'filter', '.agents/skills/four/SKILL.md', 'a']);
    // Back in the organisation's tab, Tab reaches the list on the repository opened.
    clickTab(view, 'SkillAtlas');
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'button', 'Beta', 'warnings']);
    // Space opens one too.
    repositories()[1].focus();
    press(view, 'ArrowUp');
    assert.equal(focused(view), 'alpha');
    scans = view.scans();
    assert.equal(press(view, ' '), true);
    await view.settled(scans + 1);
    assert.equal(repositories()[0].getAttribute('aria-selected'), 'true');
    assert.match(view.$('summary').textContent!, /^SkillAtlas\/alpha · 2 skills/);
    clickTab(view, 'SkillAtlas');
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'button', 'alpha', 'warnings']);
    // Its tab closed with the keyboard's button: none marked, Tab reaches the first.
    closeTab(view, 'alpha');
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'alpha', 'warnings']);
    // One opened with the mouse, the focus elsewhere: Tab reaches the list on it too.
    view.$('repo').focus();
    await openRepository(view, 'Beta');
    clickTab(view, 'SkillAtlas');
    assert.deepEqual(tabOrder(view), ['repo', 'scan', 'button', 'Beta', 'warnings']);
  } finally {
    view.close();
  }
});

test('page: the skill or repository the keyboard is on → a visible focus', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const scans = view.scans();
    ([...view.$('repositories').children][1] as HTMLElement).dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    // jsdom matches no :focus-visible: read the rule from the sheet, and check it is for both lists.
    const rules = [...view.dom.window.document.styleSheets[0].cssRules] as CSSStyleRule[];
    const focus = rules.filter((rule) => rule.selectorText?.includes(':focus-visible') && /^\d+px solid/.test(rule.style.outline));
    assert.ok(focus.length, 'a :focus-visible rule with an outline');
    for (const item of [view.items()[0], view.items()[1], [...view.$('repositories').children][0]]) {
      assert.ok(focus.some((rule) => rule.selectorText.split(',').some((selector) => item.matches(selector.replace(':focus-visible', '')))));
    }
  } finally {
    view.close();
  }
});
