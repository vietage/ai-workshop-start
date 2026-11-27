#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr, or the local web view. Only an organisation's scan stores anything: its cache.
import { openCache } from './cache.ts';
import { ansi, run } from './commands.ts';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { scanOrganisation as scanOwner, type Progress } from './core/organisation.ts';
import { openDirectory } from './local.ts';
import { serve } from './web.ts';

const token = process.env.GITHUB_TOKEN || undefined;
// How long a GitHub request may go unanswered, in seconds; 30 by default, and for a value that is
// not a number above 0. Infinity, or more than a timer holds (about 24.8 days): no limit.
const limit = Number(process.env.SKILL_ATLAS_GITHUB_TIMEOUT);
const timeout = limit > 0 ? limit * 1000 : undefined;
const open = (input: string) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token, timeout }) : openDirectory(input));
// The repositories already scanned are kept in a SQLite file, for the CLI and the web view alike.
const scanOrganisation = (input: string, progress?: Progress, refresh?: boolean) =>
  scanOwner(input, { fetch, token, timeout, progress, refresh, cache: () => openCache() });
// A progress bar only on a terminal: redrawn on one line, erased when done; piped stderr gets nothing.
let drawn = false;
const progress = process.stderr.isTTY
  ? {
      show: (line: string) => {
        process.stderr.write(`\r\x1b[K${line}`);
        drawn = true;
      },
      hide: () => {
        if (drawn) process.stderr.write('\r\x1b[K');
        drawn = false;
      },
    }
  : undefined;

// Bold names and dim links only on a terminal, and not with NO_COLOR: piped stdout is plain text.
const style = process.stdout.isTTY && !process.env.NO_COLOR ? ansi : undefined;

let serving = false;
const code = await run(process.argv.slice(2), {
  open,
  scanOrganisation,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  progress,
  style,
  serve: async (port) => {
    serving = true;
    const { url } = await serve({ open, scanOrganisation, port });
    console.log(`Skill Atlas: ${url} (Ctrl+C to stop)`);
  },
});
process.exitCode = code;
// A GitHub request given up on can leave its connection open (through a proxy, Node does not close
// it on abort), which would keep the process alive: once the output is written, exit. Not `serve`.
if (!serving) {
  const written = (stream: NodeJS.WriteStream) => new Promise<void>((resolve) => stream.write('', () => resolve()));
  await Promise.all([written(process.stdout), written(process.stderr)]);
  process.exit(code);
}
