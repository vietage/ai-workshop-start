// The decisions in spec/web.md, checked on a real local server: GitHub answered from recordings,
// ./fixture from the disk.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE, open, ORGANISATION_COMMIT, scanOrganisation } from './helpers.ts';
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
  const dom = new JSDOM((await get('/')).text, {
    url: `http://localhost:${at}${path}`,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = ((input: string) => {
        scans++;
        return fetch(new URL(input, `http://127.0.0.1:${at}`));
      }) as typeof fetch;
      // As in a browser: jsdom has no TextDecoder of its own.
      (window as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
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
  return { dom, $, settled, enter, items, text, search, filter, names, selected, shown, scans: () => scans, close: () => dom.window.close() };
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
    // Hidden as the page's style shows it, too: no rule for main may show it again.
    assert.equal(view.shown('main'), false);
    assert.equal(view.shown('error'), true);
    assert.equal(view.shown('organisation'), false);
    assert.equal(view.shown('progress'), false);
  } finally {
    view.close();
  }
});

test('page: whatever is hidden is not shown, whatever its own style', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    for (const element of view.dom.window.document.querySelectorAll('body *')) {
      (element as HTMLElement).hidden = true;
      assert.equal(view.dom.window.getComputedStyle(element).display, 'none', element.outerHTML.slice(0, 60));
      (element as HTMLElement).hidden = false;
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
    assert.equal(view.$('org-warnings').children.length, 3);
    // No repository selected yet: no skills.
    assert.equal(view.$('main').hidden, true);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas' });

    const scans = view.scans();
    repositories()[1].dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    assert.equal(repositories()[1].getAttribute('aria-selected'), 'true');
    assert.equal(view.$('main').hidden, false);
    assert.equal(view.$('summary').textContent, `SkillAtlas/Beta · 2 skills · ${ORGANISATION_COMMIT.slice(0, 12)}`);
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

test('page: a gradient style: the header, the page, cards, the selected skill and its name', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter(FIXTURE);
    const style = (node: Element) => view.dom.window.getComputedStyle(node);
    const document = view.dom.window.document;
    assert.match(style(document.querySelector('header')!).backgroundImage, /^linear-gradient\(/);
    assert.match(style(document.body).backgroundImage, /^linear-gradient\(/);
    // Rounded cards: jsdom gives `0px` for an element with no radius.
    for (const id of ['organisation', 'list', 'skill']) assert.match(style(view.$(id)).borderRadius, /^[1-9]\d*px$/, id);
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

test('page: a gradient style: the selected repository tinted, with an accent bar; each count in a pill', { timeout: 5_000 }, async () => {
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

test('page: a gradient style, light and dark as the system\'s colours', { timeout: 5_000 }, async () => {
  // jsdom evaluates no media queries, so this reads the page's style sheet itself.
  const view = await page('/');
  try {
    const sheet = view.dom.window.document.styleSheets[0];
    const rules = [...sheet.cssRules];
    const root = rules.find((rule) => (rule as CSSStyleRule).selectorText === ':root') as CSSStyleRule;
    assert.equal(root.style.getPropertyValue('color-scheme'), 'light dark');
    const dark = rules.find((rule) => (rule as CSSMediaRule).media?.mediaText === '(prefers-color-scheme: dark)') as CSSMediaRule;
    assert.ok(dark, 'a (prefers-color-scheme: dark) rule');
    const darkRoot = [...dark.cssRules].find((rule) => (rule as CSSStyleRule).selectorText === ':root') as CSSStyleRule;
    assert.ok(darkRoot, 'a :root rule for dark colours');
    for (const name of ['--page', '--card', '--text', '--accent', '--selected']) {
      const light = root.style.getPropertyValue(name);
      const value = darkRoot.style.getPropertyValue(name);
      assert.notEqual(value, '', name);
      assert.notEqual(value, light, name);
    }
    assert.match(darkRoot.style.getPropertyValue('--page'), /^linear-gradient\(/);
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

test('page: a repository of the organisation that fails → its message; the organisation stays', { timeout: 5_000 }, async () => {
  const view = await page('/');
  try {
    await view.enter('github.com/skillatlas');
    const broken = [...view.$('repositories').children].at(-1) as HTMLElement;
    const scans = view.scans();
    broken.dispatchEvent(new view.dom.window.Event('click'));
    await view.settled(scans + 1);
    assert.equal(view.$('error').textContent, 'GitHub rate limit reached; try again in a minute');
    assert.equal(view.$('organisation').hidden, false);
    assert.equal(view.$('main').hidden, true);
    assert.deepEqual(view.search(), { repo: 'github.com/skillatlas', repository: 'broken' });
    // A repository link after it: no organisation.
    await view.enter('https://github.com/JetBrains/example');
    assert.equal(view.$('organisation').hidden, true);
    assert.equal(view.$('error').textContent, '');
    assert.deepEqual(view.search(), { repo: 'https://github.com/JetBrains/example', skill: '.claude/skills/commits/SKILL.md' });
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
  const { status, type, lines } = await streamed('github.com/skillatlas');
  assert.equal(status, 200);
  assert.equal(type, 'application/x-ndjson; charset=utf-8');
  assert.deepEqual(lines.slice(0, -1), [0, 1, 2, 3, 4, 5, 6, 7].map((scanned) => ({ progress: { scanned, total: 7 } })));
  assert.deepEqual(lines.at(-1), { result: (await scan('github.com/skillatlas')).body });
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
    assert.equal((view.$('scan') as HTMLButtonElement).disabled, true);
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

test('page: the Scan button → Scanning…, disabled, while a scan runs; Scan, enabled, once it succeeds', { timeout: 5_000 }, async () => {
  const stalled = await stalledServer('JetBrains/example');
  const view = await page('/', stalled.port);
  try {
    assert.deepEqual(button(view), ['Scan', true]);
    (view.$('repo') as HTMLInputElement).value = 'https://github.com/JetBrains/example';
    view.$('form').dispatchEvent(new view.dom.window.Event('submit', { cancelable: true }));
    await stalled.started;
    assert.deepEqual(button(view), ['Scanning…', false]);
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
    assert.deepEqual(button(failing), ['Scanning…', false]);
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
    assert.deepEqual(button(view), ['Scanning…', false]);
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
    assert.deepEqual(button(view), ['Scanning…', false]);
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
