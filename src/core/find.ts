/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a project's own skills, in the order that picks the skill among its copies. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** Never part of a repository's own skills. */
export const SKIPPED = new Set(['.git', 'node_modules']);

/**
 * The project skills among the paths: `<project>/<agent folder>/<skill>/SKILL.md`, where the
 * project is the root or any directory, and the file is named exactly SKILL.md. The same skill
 * directory in several agent folders of one project is one skill; the others are its copies.
 */
export function findSkills(paths: string[]): SkillFile[] {
  const skills = new Map<string, { name: string; files: { path: string; root: number }[] }>();
  for (const path of paths) {
    const location = locate(path);
    if (!location) continue;
    const key = `${location.project}\0${location.name}`;
    const skill = skills.get(key) ?? { name: location.name, files: [] };
    skill.files.push({ path, root: location.root });
    skills.set(key, skill);
  }
  return [...skills.values()]
    .map(({ name, files }) => {
      const [first, ...copies] = files.sort((a, b) => a.root - b.root || compare(a.path, b.path));
      return { path: first.path, name, copies: copies.map((copy) => copy.path) };
    })
    .sort((a, b) => compare(a.path, b.path));
}

/** The project, the agent folder (its index in SKILL_ROOTS) and the skill of a SKILL.md path. */
function locate(path: string): { project: string; root: number; name: string } | undefined {
  const segments = path.split('/');
  if (segments.length < 4 || segments.at(-1) !== 'SKILL.md') return undefined;
  if (segments.some((segment) => SKIPPED.has(segment))) return undefined;
  const folder = segments.slice(-4, -2).join('/');
  const root = SKILL_ROOTS.indexOf(folder);
  if (root < 0) return undefined;
  return { project: segments.slice(0, -4).join('/'), root, name: segments.at(-2)! };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
