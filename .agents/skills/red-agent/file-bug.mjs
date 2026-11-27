#!/usr/bin/env node
// Files one GitHub issue for a bug the red agent found in the web view, with the video of it, and
// the label that hands it to an AI agent. A bug that already has an open issue (the same key) gets a
// comment with the new video instead. See SKILL.md.
//
//   node .agents/skills/red-agent/file-bug.mjs --key <key> --title "<title>" --body <file.md> --video <file.mp4> [--dry-run]
//
// The body must have the sections `## Steps to reproduce`, `## Expected` (citing spec/) and
// `## Actual`. Exit codes: 0 filed, commented or dry run; 1 gh or git failed; 2 invalid input.
// The videos are uploaded as assets of one pre-release, `red-agent-recordings`: GitHub has no API
// to attach a file to an issue, and a release asset gets a stable download link.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const LABELS = [
  ['Delegated to AI', '8b03eb', 'An AI agent picks this up'],
  ['bug', 'd73a4a', "Something isn't working"],
  ['red-agent', 'b60205', 'Found by the red agent (.agents/skills/red-agent)'],
];
export const RELEASE = 'red-agent-recordings';
export const SECTIONS = ['Steps to reproduce', 'Expected', 'Actual'];
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const issueTitle = (title) => `[Red agent] ${title.trim()}`;
export const marker = (key) => `<!-- red-agent: ${key} -->`;

/** What is wrong with the input, one message per problem; none → it can be filed. */
export function problems({ key, title, body, video }) {
  const found = [];
  if (!key || !KEY.test(key)) found.push('--key: lowercase words joined by "-", e.g. filter-drops-unicode');
  if (!title?.trim()) found.push('--title: what goes wrong, in one line');
  if (body === undefined) found.push('--body: a Markdown file');
  else {
    for (const section of SECTIONS) {
      if (!new RegExp(`^## ${section}\\s*$`, 'm').test(body)) found.push(`--body: no "## ${section}" section`);
    }
    if (!/spec\//.test(section(body, 'Expected'))) found.push('--body: "## Expected" cites no spec/ file: say what the spec says');
  }
  if (!video) found.push('--video: the recording of the bug');
  else if (!existsSync(video) || !statSync(video).isFile() || statSync(video).size === 0) found.push(`--video: ${video} is not a file, or is empty`);
  return found;
}

/** The text of one `## <name>` section, up to the next `## `. */
function section(body, name) {
  const match = new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(body);
  return match ? match[1] : '';
}

/** The issue's body: where it was found, the video, the agent's report, and the key. */
export function issueBody({ key, body, commit, repo, video }) {
  return [
    'The [red agent](https://github.com/' + repo + '/blob/' + commit + '/.agents/skills/red-agent/SKILL.md) broke the web view (`./skill-atlas serve`).',
    '',
    `- Commit: \`${commit}\``,
    `- Video: ${video}`,
    '',
    body.trim(),
    '',
    `Fix the product so that it does what [spec/](https://github.com/${repo}/tree/main/spec) says, and add a test for this case.`,
    '',
    marker(key),
  ].join('\n');
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const gh = (args) => run('gh', args);

function ensureLabels() {
  const existing = JSON.parse(gh(['label', 'list', '--limit', '500', '--json', 'name'])).map((label) => label.name.toLowerCase());
  for (const [name, color, description] of LABELS) {
    if (!existing.includes(name.toLowerCase())) gh(['label', 'create', name, '--color', color, '--description', description]);
  }
}

function uploadVideo(repo, video, name) {
  try {
    gh(['release', 'view', RELEASE, '--json', 'tagName']);
  } catch {
    gh(['release', 'create', RELEASE, '--prerelease', '--title', 'Red agent recordings',
      '--notes', 'Videos of the bugs the red agent found, linked from their issues. Not a release.']);
  }
  // The asset's name is the file's name: a copy under the key's and the commit's name.
  const dir = mkdtempSync(join(tmpdir(), 'red-agent-'));
  try {
    const named = join(dir, name);
    copyFileSync(video, named);
    gh(['release', 'upload', RELEASE, named, '--clobber']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return `https://github.com/${repo}/releases/download/${RELEASE}/${encodeURIComponent(name)}`;
}

function main() {
  const { values } = parseArgs({
    options: {
      key: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, video: { type: 'string' },
      commit: { type: 'string' }, 'dry-run': { type: 'boolean' },
    },
  });
  let body;
  if (values.body !== undefined) {
    try { body = readFileSync(values.body, 'utf8'); } catch { body = undefined; }
  }
  const found = problems({ key: values.key, title: values.title, body, video: values.video });
  if (found.length) {
    console.error(found.join('\n'));
    process.exit(2);
  }
  const { key } = values;
  const title = issueTitle(values.title);
  const ext = values.video.match(/\.\w+$/)?.[0] ?? '.mp4';
  try {
    const commit = values.commit ?? run('git', ['rev-parse', 'HEAD']);
    const name = `${key}-${commit.slice(0, 7)}${ext}`;
    if (values['dry-run']) {
      const repo = process.env.RED_AGENT_REPO ?? '<owner>/<repo>';
      console.log(`would file: ${title}\n  labels: ${LABELS.map(([label]) => label).join(', ')}\n  video: ${values.video} → ${name}\n`);
      console.log(issueBody({ key, body, commit, repo, video: `<${name}>` }));
      return;
    }
    const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
    // Re-found: an open issue with this key; the search is fuzzy, the marker is not.
    const open = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `"red-agent: ${key}" in:body`,
      '--limit', '50', '--json', 'number,url,body']));
    const existing = open.find((issue) => issue.body?.includes(marker(key)));
    ensureLabels();
    const video = uploadVideo(repo, values.video, name);
    const text = issueBody({ key, body, commit, repo, video });
    if (existing) {
      gh(['issue', 'comment', String(existing.number), '--body', `Still happens.\n\n${text}`]);
      console.log(`commented: ${existing.url}`);
    } else {
      const url = gh(['issue', 'create', '--title', title, '--body', text, ...LABELS.flatMap(([label]) => ['--label', label])]);
      console.log(`filed: ${url}`);
    }
  } catch (error) {
    console.error(error.stderr?.toString().trim() || error.message);
    process.exit(1);
  }
}

if (import.meta.main) main();
