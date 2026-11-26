/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/** A GitHub repository without a commit: it has no files, so no skills. */
export class EmptyRepository extends AtlasError {}
