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
