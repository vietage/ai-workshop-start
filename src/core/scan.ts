import { findSkills, type SkillFile } from './find.ts';
import { filterSkills, sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
};

export type ScanOptions = {
  /** Only the skills whose name or description contains it, in any case. */
  filter?: string;
};

export type ScanResult = {
  repository: Repository;
  skills: Skill[];
  /** How many skills the repository has, before the filter. */
  total: number;
  warnings: string[];
};

/** fetch → find → parse, then the filter. Nothing is stored: the result is all there is. */
export async function scan(source: Source, options: ScanOptions = {}): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  const skills = sortSkills(results.flatMap((result) => (result.skill ? [result.skill] : [])));
  return {
    repository: source.repository,
    skills: filterSkills(skills, options.filter),
    total: skills.length,
    warnings: [...source.warnings, ...results.flatMap((result) => result.warnings)],
  };
}

async function readSkill(source: Source, file: SkillFile): Promise<{ skill?: Skill; warnings: string[] }> {
  const [bytes, ...copies] = await Promise.all([file.path, ...file.copies].map((path) => source.read(path)));
  if (!bytes) return { warnings: [`${file.path}: listed, but not found at the scanned commit; skipped`] };
  const differing = file.copies.filter((_, index) => copies[index] && !same(bytes, copies[index]));
  const parsed = parseSkill(new TextDecoder().decode(bytes));
  const skill: Skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: file.copies,
  };
  const warnings = [
    ...(parsed.warning ? [`${file.path}: ${parsed.warning}`] : []),
    ...(differing.length > 0 ? [`${file.path}: its copies differ: ${differing.join(', ')}`] : []),
  ];
  return { skill, warnings };
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
