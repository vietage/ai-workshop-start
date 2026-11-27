// The decisions in spec/memory.md: the update-memory skill, the memory/ folder, and what AGENTS.md
// and the review skills say about them, checked on the files as agents read them.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseSkill } from '../src/core/parse.ts';
import { atlas } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const skill = (name: string) => read(`.agents/skills/${name}/SKILL.md`);

test('update-memory is a project skill: front matter with its name and a description', () => {
  const parsed = parseSkill(skill('update-memory'));
  assert.equal(parsed.warning, undefined);
  assert.equal(parsed.name, 'update-memory');
  assert.match(parsed.description, /^Adds a short note to memory\//);
  assert.match(parsed.description, /never reviewed/);
});

test('./skill-atlas scan . lists update-memory with the other skills of this repository', async () => {
  const { code, stdout, stderr } = await atlas(['scan', ROOT]);
  assert.equal(code, 0, stderr);
  for (const name of ['issue-to-pr', 'review-pr', 'address-review', 'update-memory']) {
    assert.match(stdout, new RegExp(`^${name} — `, 'm'), name);
  }
  assert.match(stdout, /^  file:\/\/.*\/\.agents\/skills\/update-memory\/SKILL\.md$/m);
});

test('the skill adds one note per file in memory/, with what was learned, why it matters and where it applies', () => {
  const text = skill('update-memory');
  assert.match(text, /`memory\/<descriptive-name>\.md`/);
  assert.match(text, /One new Markdown file per note/);
  for (const part of ['\\*\\*Why it matters:\\*\\*', '\\*\\*Where it applies:\\*\\*', 'Learned in <the issue or PR']) {
    assert.match(text, new RegExp(part), part);
  }
  assert.match(text, /before the task's last commit/);
  assert.match(text, /git add memory\//);
  assert.match(text, /learned nothing new, write no note/);
  assert.match(text, /Never write secrets/);
});

test('the skill only adds: never edits, overwrites or deletes a note; a wrong note gets a new one', () => {
  const text = skill('update-memory');
  assert.match(text, /It only adds notes, never changes or removes one/);
  assert.match(text, /never overwrite a file/);
  assert.match(text, /don't edit it:\s+add a new note that says what changed and names the old note's file/);
});

test('a task that may not commit writes no note', () => {
  assert.match(skill('update-memory'), /If your task may not commit \(review-pr doesn't edit, commit or\s+push\), write no note/);
});

test('the notes are never reviewed: the skill, the review chain and both review skills say so', () => {
  assert.match(skill('update-memory'), /\*\*No review\.\*\* These notes are never reviewed: no review step, no approval/);
  assert.match(skill('update-memory'), /review-pr\]\([^)]*\) and\s+\[address-review\]\([^)]*\) skip `memory\/`/);
  assert.match(skill('review-pr'), /\*\*Skip `memory\/`\.\*\*[^]*are never reviewed: no findings, no comments,\s+no approval asked, and they don't change the verdict/);
  assert.match(skill('address-review'), /Skip anything about `memory\/`[^]*are never reviewed[^]*never change a note to\s+satisfy a review/);
  assert.match(read('.agents/review-chain.md'), /are not part of the chain: they are never\s+reviewed, and both skills skip `memory\/`/);
});

test('AGENTS.md: the notes are in memory/, search them when needed, use update-memory at the end of a task', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /## Memory\n/);
  assert.match(agents, /Notes from earlier tasks are in \[\.\/memory\]\(memory\/\): search them when needed/);
  assert.match(agents, /At the end of a task, use the \[update-memory\]\(\.agents\/skills\/update-memory\/SKILL\.md\) skill/);
  assert.match(agents, /never reviewed/);
  assert.match(skill('issue-to-pr'), /Before you commit, use the \[update-memory\]\(\.\.\/update-memory\/SKILL\.md\) skill/);
});

test('memory/ is in the repository, with a README that says how to read and write it, and README.md links both', () => {
  assert.ok(existsSync(new URL('../memory/README.md', import.meta.url)));
  const readme = read('memory/README.md');
  assert.match(readme, /grep -ril "<words>" memory\//);
  assert.match(readme, /update-memory skill\]\(\.\.\/\.agents\/skills\/update-memory\/SKILL\.md\)/);
  assert.match(readme, /\*\*Never reviewed\*\*/);
  const main = read('README.md');
  assert.match(main, /\[memory\/\]\(memory\/README\.md\)/);
  assert.match(main, /\[update-memory\]\(\.agents\/skills\/update-memory\/SKILL\.md\)/);
});

test('every link in the memory files and the skill resolves to a file in the repository', () => {
  for (const [file, dir] of [
    ['.agents/skills/update-memory/SKILL.md', '.agents/skills/update-memory/'],
    ['memory/README.md', 'memory/'],
    ['AGENTS.md', ''],
  ]) {
    for (const [, target] of read(file).matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(target)) continue;
      assert.ok(existsSync(new URL(`../${dir}${target}`, import.meta.url)), `${file}: ${target}`);
    }
  }
});
