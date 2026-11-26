// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it
    --filter <word>               only the skills whose name or description contains the word
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

const scanUsage = 'Usage: skill-atlas scan <GitHub URL | directory> [--filter <word>]';

async function scanCommand(args: string[], context: Context) {
  const inputs: string[] = [];
  let filter: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--filter') inputs.push(args[index]);
    else if (filter === undefined && args[index + 1]) filter = args[++index];
    else throw new AtlasError(scanUsage);
  }
  if (inputs.length !== 1) throw new AtlasError(scanUsage);
  const result = await scan(await context.open(inputs[0]), { filter });
  printRepository(result.repository, result.skills, filter === undefined ? undefined : result.total, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

/**
 * `<owner>/<repo> · N skills`, or `· N of M skills` when filtered, then each skill's name, first
 * sentence and link.
 */
function printRepository(repository: Repository, skills: Skill[], total: number | undefined, { print }: Context) {
  const count = total ?? skills.length;
  const shown = total === undefined ? '' : `${skills.length} of `;
  print(`${repository.id} · ${shown}${count} ${count === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}
