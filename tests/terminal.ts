// Preloaded into the real CLI by the tests (`node --import`): GitHub answers from the recordings in
// helpers.ts; with `TERMINAL=1`, stderr is a terminal, as when the CLI is run by hand.
import { github } from './helpers.ts';

globalThis.fetch = ((input: string | URL) => github(String(input))) as typeof fetch;
if (process.env.TERMINAL === '1') process.stderr.isTTY = true;
