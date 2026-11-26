// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { filterWords, firstSentence, skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** Starts the local web view; resolves once it listens. Missing where there is none (the browser). */
  serve?(port: number): Promise<void>;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it
    --filter <words>              only the skills whose name or description contains every word
  serve [--port <port>]           open a local web view, at http://localhost:4173 by default
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'serve') await serveCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

const scanUsage = 'Usage: skill-atlas scan <GitHub URL | directory> [--filter <words>]';

async function scanCommand(args: string[], context: Context) {
  const inputs: string[] = [];
  let filter: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--filter') inputs.push(args[index]);
    // One argument, right after the flag: not missing, not blank, not the flag again; its words,
    // split on whitespace, as in the web view.
    else if (filter === undefined && args[index + 1]?.trim() && args[index + 1] !== '--filter') filter = filterWords(args[++index]).join(' ');
    else throw new AtlasError(scanUsage);
  }
  if (inputs.length !== 1) throw new AtlasError(scanUsage);
  const result = await scan(await context.open(inputs[0]), { filter });
  printRepository(result.repository, result.skills, filter === undefined ? undefined : { filter, total: result.total }, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

async function serveCommand(args: string[], context: Context) {
  if (!context.serve) throw new AtlasError('serve runs only from the command line');
  const usage = 'Usage: skill-atlas serve [--port <port>]';
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port')) throw new AtlasError(usage);
  const port = args.length ? Number(args[1]) : 4173;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AtlasError(`Not a port: ${args[1]}\n${usage}`);
  await context.serve(port);
}

/**
 * `<owner>/<repo> · N skills`, or `· N of M skills` when filtered, then each skill's name, first
 * sentence and link; `no skills match "<words>"` when the filter leaves none.
 */
function printRepository(
  repository: Repository,
  skills: Skill[],
  filtered: { filter: string; total: number } | undefined,
  { print }: Context,
) {
  const total = filtered?.total ?? skills.length;
  const shown = filtered ? `${skills.length} of ` : '';
  print(`${repository.id} · ${shown}${total} ${total === 1 ? 'skill' : 'skills'}`);
  if (filtered && skills.length === 0) print(`no skills match "${filtered.filter}"`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}
