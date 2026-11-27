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
// `signal` (the web view's stopped scan) aborts the requests to GitHub.
const open = (input: string, signal?: AbortSignal) =>
  parseGitHubUrl(input) ? openGitHub(input, { fetch: (url, init) => fetch(url, { ...init, signal }), token }) : openDirectory(input);
// The repositories already scanned are kept in a SQLite file, for the CLI and the web view alike.
const scanOrganisation = (input: string, progress?: Progress, refresh?: boolean, signal?: AbortSignal) =>
  scanOwner(input, { fetch, token, progress, refresh, signal, cache: () => openCache() });
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

process.exitCode = await run(process.argv.slice(2), {
  open,
  scanOrganisation,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  progress,
  style,
  serve: async (port) => {
    const { url } = await serve({ open, scanOrganisation, port });
    console.log(`Skill Atlas: ${url} (Ctrl+C to stop)`);
  },
});
