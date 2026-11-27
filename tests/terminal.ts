// Preloaded into the real CLI by the tests (`node --import`): GitHub answers from the recordings in
// helpers.ts; with `TERMINAL=1`, stderr is a terminal, as when the CLI is run by hand; with
// `STDOUT_TERMINAL=1`, stdout is one.
import { github } from './helpers.ts';

globalThis.fetch = ((input: string | URL) => github(String(input))) as typeof fetch;
if (process.env.TERMINAL === '1') process.stderr.isTTY = true;
if (process.env.STDOUT_TERMINAL === '1') process.stdout.isTTY = true;
