// End to end: the real ./skill-atlas on real GitHub repositories, each at a fixed commit, against
// the output stored in tests/expected. `UPDATE_EXPECTED=1 npm test` stores what it prints now.
// Needs the network; GITHUB_TOKEN, if set, raises the GitHub rate limit.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ATLAS = fileURLToPath(new URL('../skill-atlas', import.meta.url));
const EXPECTED = new URL('./expected/', import.meta.url);

const REPOSITORIES = [
  { name: 'MPS', commit: '1cbf7f783dbc5c74c8e5231d31f61b02829143de' },
  { name: 'android', commit: '294d4c098cb833f7a457cd891a125de82d4e1715' },
  { name: 'koog', commit: '709079e4a34d6c9234583352550e6a2b88a0bb85' },
];

function atlas(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ATLAS, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

for (const { name, commit } of REPOSITORIES) {
  test(`./skill-atlas scan github.com/JetBrains/${name}/tree/<commit> prints the stored output`, { timeout: 60_000 }, async () => {
    const scanned = await atlas(['scan', `github.com/JetBrains/${name}/tree/${commit}`]);
    assert.equal(scanned.code, 0, scanned.stderr);
    const stdout = new URL(`${name}.stdout.txt`, EXPECTED);
    const stderr = new URL(`${name}.stderr.txt`, EXPECTED);
    if (process.env.UPDATE_EXPECTED) {
      writeFileSync(stdout, scanned.stdout);
      writeFileSync(stderr, scanned.stderr);
    }
    assert.equal(scanned.stdout, readFileSync(stdout, 'utf8'));
    assert.equal(scanned.stderr, readFileSync(stderr, 'utf8'));
  });
}

// A real organisation, on each repository's default branch, so not a stored output: what is always
// true of it. vietage owns this repository's fork, which is skipped.
test('./skill-atlas scan github.com/<org> lists its repositories with their skill counts', { timeout: 60_000 }, async () => {
  const scanned = await atlas(['scan', 'github.com/vietage']);
  assert.equal(scanned.code, 0, scanned.stderr);
  const [header, ...lines] = scanned.stdout.trimEnd().split('\n');
  const total = /^vietage · (\d+) repositor(?:y|ies) · (\d+) skills?$/.exec(header);
  assert.ok(total, header);
  assert.equal(lines.length, Number(total[1]));
  const repositories = lines.map((line) => {
    const match = /^([\w.-]+) — (?:(\d+) skills?|not scanned)$/.exec(line);
    assert.ok(match, line);
    return { name: match[1], count: match[2] === undefined ? -1 : Number(match[2]) };
  });
  assert.equal(repositories.reduce((sum, { count }) => sum + Math.max(count, 0), 0), Number(total[2]));
  const sorted = [...repositories].sort((a, b) => b.count - a.count || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  assert.deepEqual(repositories, sorted);
  assert.ok(!repositories.some(({ name }) => name === 'ai-workshop-start'), 'a fork is skipped');
});

test('./skill-atlas scan github.com/<unknown org> → a clear message, exit code 1', { timeout: 60_000 }, async () => {
  const scanned = await atlas(['scan', 'github.com/skill-atlas-no-such-organisation-0']);
  assert.deepEqual(scanned, {
    code: 1,
    stdout: '',
    stderr: 'Organisation not found: https://github.com/skill-atlas-no-such-organisation-0\n',
  });
});
