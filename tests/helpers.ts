// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { openGitHub, parseGitHubUrl } from '../src/core/github.ts';
import { scanOrganisation as scanOwner, type Progress } from '../src/core/organisation.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
};

/** The commit of every repository of the SkillAtlas organisation. */
export const ORGANISATION_COMMIT = '1cbf7f783dbc5c74c8e5231d31f61b02829143de';

const skillText = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n`;

/**
 * What GitHub answers for the organisation SkillAtlas, asked for as `github.com/skillatlas`:
 * alpha, Beta and example-tools with 2 skills each, Docs with none, huge with a tree too large
 * to list at once, empty without a commit, broken rate limited; archived and forks on the first page, which is full, so
 * a second page is asked for. Only through the trees: no code search is recorded.
 */
const ORGANISATION: Recording = (() => {
  const sha = ORGANISATION_COMMIT;
  const recording: Recording = {
    'https://api.github.com/users/skillatlas': { status: 200, body: { login: 'SkillAtlas', type: 'Organization' } },
    'https://api.github.com/users/no-such-organisation': { status: 404, body: { message: 'Not Found' } },
    'https://api.github.com/users/someone': { status: 200, body: { login: 'someone', type: 'User' } },
    'https://api.github.com/users/someone/repos?per_page=100&page=1': {
      status: 200,
      body: [{ name: 'dotfiles', full_name: 'someone/dotfiles', default_branch: 'main', archived: false, fork: false }],
    },
  };
  const listed = (name: string, flags: { archived?: boolean; fork?: boolean } = {}) => ({
    name,
    full_name: `SkillAtlas/${name}`,
    default_branch: 'main',
    archived: flags.archived ?? false,
    fork: flags.fork ?? false,
  });
  const skipped = Array.from({ length: 96 }, (_, index) => listed(`old-${index}`, index % 2 ? { archived: true } : { fork: true }));
  recording['https://api.github.com/orgs/SkillAtlas/repos?per_page=100&page=1'] = {
    status: 200,
    body: [listed('example-tools'), ...skipped.slice(0, 48), listed('Docs'), listed('alpha'), ...skipped.slice(48), listed('huge')],
  };
  recording['https://api.github.com/orgs/SkillAtlas/repos?per_page=100&page=2'] = { status: 200, body: [listed('Beta'), listed('broken'), listed('empty')] };

  const repository = (owner: string, name: string, files: Record<string, string>, truncated = false) => {
    const id = `${owner}/${name}`;
    recording[`https://api.github.com/repos/${id}`] = { status: 200, body: { full_name: id, default_branch: 'main' } };
    // The default branch, and the commit the web page pins when a repository is selected.
    for (const ref of ['main', sha]) recording[`https://api.github.com/repos/${id}/commits/${ref}`] = { status: 200, body: { sha } };
    const tree = Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: path }));
    recording[`https://api.github.com/repos/${id}/git/trees/${sha}?recursive=1`] = { status: 200, body: { truncated, tree } };
    for (const [path, text] of Object.entries(files)) recording[`https://raw.githubusercontent.com/${id}/${sha}/${path}`] = { status: 200, body: text };
  };
  repository('SkillAtlas', 'example-tools', {
    '.claude/skills/review/SKILL.md': skillText('review'),
    '.agents/skills/release/SKILL.md': '---\nname: [release\n---\n',
    'README.md': '# example-tools\n',
  });
  repository('SkillAtlas', 'Docs', { 'README.md': '# Docs\n', 'skills/guide/SKILL.md': skillText('guide') });
  repository('SkillAtlas', 'alpha', { '.claude/skills/one/SKILL.md': skillText('one'), 'web/.github/skills/two/SKILL.md': skillText('two') });
  repository('SkillAtlas', 'Beta', { '.agents/skills/three/SKILL.md': skillText('three'), '.agents/skills/four/SKILL.md': skillText('four') });
  repository('SkillAtlas', 'huge', {}, true);
  recording['https://api.github.com/repos/SkillAtlas/empty'] = { status: 200, body: { full_name: 'SkillAtlas/empty', default_branch: 'main' } };
  recording['https://api.github.com/repos/SkillAtlas/empty/commits/main'] = { status: 409, body: { message: 'Git Repository is empty.' } };
  recording[`https://api.github.com/repos/SkillAtlas/huge/git/trees/${sha}`] = { status: 200, body: { truncated: false, tree: [] } };
  const limited = { status: 403, body: { message: 'API rate limit exceeded for installation ID 1.' } };
  recording['https://api.github.com/repos/SkillAtlas/broken/commits/main'] = limited;
  recording['https://api.github.com/repos/SkillAtlas/broken'] = limited;
  repository('someone', 'dotfiles', { '.claude/skills/shell/SKILL.md': skillText('shell') });
  return recording;
})();

/** GitHub, answering from EXAMPLE and ORGANISATION. */
export const github = replay({ ...EXAMPLE, ...ORGANISATION });

/** Preloaded into the real CLI (`node --import`): GitHub answers from the recordings; with `TERMINAL=1`, stderr is a terminal. */
export const TERMINAL = new URL('./terminal.ts', import.meta.url).href;

/** Opens a GitHub URL or a directory as the CLI does, with GitHub answering from EXAMPLE. */
export const open = (input: string) =>
  // With a token, through code search, as EXAMPLE answers it.
  parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input);

/** Scans an organisation as the CLI does, with GitHub answering from ORGANISATION; with a token, which is never used to search. */
export const scanOrganisation = (input: string, progress?: Progress) => scanOwner(input, { fetch: github, token: 'test', progress });

/**
 * `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE; with `terminal`,
 * as on a terminal: `progress` has what the progress bar showed, and `hidden` once it was hidden.
 */
export async function atlas(args: string[], { terminal = false, scan = scanOrganisation } = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const progress: string[] = [];
  const code = await run(args, {
    open,
    scanOrganisation: scan,
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    progress: terminal ? { show: (line) => progress.push(line), hide: () => progress.push('hidden') } : undefined,
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), ...(terminal ? { progress } : {}) };
}
