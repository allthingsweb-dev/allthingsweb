/**
 * The guard against two migrations taking one number (core/scripts/
 * migration-guard.ts runs it on every pull request and on main): a
 * branch's core migrations must extend what production has applied, in
 * order, and a pull request must not add a migration under a number
 * production or another open pull request already has. Each problem says
 * exactly what to renumber, and to what.
 */

/** A core migration as the migrator knows it: core/migrations/NNNN_name.ts. */
export interface MigrationRef {
  readonly id: number;
  readonly name: string;
}

/** A migration another open pull request adds. */
export interface Claim extends MigrationRef {
  readonly pr: number;
}

export interface GuardInput {
  /** This checkout's core migrations, in id order. */
  readonly local: ReadonlyArray<MigrationRef>;
  /** Production's record of applied migrations, in id order. */
  readonly applied: ReadonlyArray<MigrationRef>;
  /** The migrations this pull request adds; none on main. */
  readonly added: ReadonlyArray<MigrationRef>;
  /** The migrations every other open pull request adds. */
  readonly claims: ReadonlyArray<Claim>;
}

/** A migration's file name: 0011_planning. */
export const fileOf = ({ id, name }: MigrationRef): string =>
  `${String(id).padStart(4, "0")}_${name}`;

const same = (a: MigrationRef, b: MigrationRef) =>
  a.id === b.id && a.name === b.name;

/**
 * What is wrong, one sentence each that says what to renumber and to what;
 * empty when the migrations may merge and apply as they are.
 */
export function checkMigrations(input: GuardInput): ReadonlyArray<string> {
  const { local, applied, added, claims } = input;
  const isAdded = (m: MigrationRef) => added.some((a) => same(a, m));
  // Numbers anyone has: production, this branch's base, other open pulls.
  const taken = [
    ...applied.map((m) => m.id),
    ...local.filter((m) => !isAdded(m)).map((m) => m.id),
    ...claims.map((c) => c.id),
  ];
  let next = Math.max(0, ...taken) + 1;
  const renumbered = new Map<string, number>();
  /** The free number `migration` should take, the same each time it's asked. */
  const freeFor = (migration: MigrationRef) => {
    const key = fileOf(migration);
    const known = renumbered.get(key);
    if (known !== undefined) return known;
    const number = next++;
    renumbered.set(key, number);
    return number;
  };
  const renumber = (migration: MigrationRef) =>
    `renumber ${fileOf(migration)} to ${fileOf({ ...migration, id: freeFor(migration) })} (core/migrations/${fileOf(migration)}.ts, its key in core/migrations/index.ts, and its drizzle twin in app/migrations)`;

  const problems: Array<string> = [];

  // (a) The branch extends production's record: same ids and names, in order.
  for (const [index, done] of applied.entries()) {
    const here = local[index];
    if (here !== undefined && same(here, done)) continue;
    if (here === undefined) {
      problems.push(
        `Production has applied ${applied
          .slice(index)
          .map(fileOf)
          .join(
            ", ",
          )}, which this branch doesn't have: merge main, which has them.`,
      );
      break;
    }
    if (isAdded(here)) {
      // This pull request's migrations from here on sit where production's are.
      const ours = local.slice(index).filter(isAdded);
      problems.push(
        `Production has applied ${fileOf(done)}, where this pull request has ${fileOf(here)}: merge main, then ${ours.map(renumber).join("; ")}.`,
      );
    } else {
      problems.push(
        `Production has applied ${fileOf(done)}, where this branch has ${fileOf(here)}, which it didn't add: applied migrations are never renamed, reordered or removed; merge main, or put ${fileOf(here)} back as ${fileOf(done)}.`,
      );
    }
    break;
  }

  // (b) No other open pull request adds a migration under the same number.
  // A migration (a) already moves isn't asked again; the rest move past
  // every number taken, this pull request's own that stay included.
  next = Math.max(
    next,
    ...added.filter((a) => !renumbered.has(fileOf(a))).map((a) => a.id + 1),
  );
  for (const migration of added) {
    if (renumbered.has(fileOf(migration))) continue;
    const rivals = claims.filter(
      (claim) => claim.id === migration.id && !same(claim, migration),
    );
    if (rivals.length === 0) continue;
    problems.push(
      `${fileOf(migration)} takes ${String(migration.id).padStart(4, "0")}, as ${rivals
        .map((rival) => `#${rival.pr}'s ${fileOf(rival)}`)
        .join(
          " and ",
        )} does: ${renumber(migration)}, or agree that the other pull request moves instead.`,
    );
  }
  return problems;
}

/** A core migration file's path, as a pull request lists it, as a migration; null for any other path. */
export function migrationOfPath(path: string): MigrationRef | null {
  const match = /^core\/migrations\/(\d{4})_([a-z0-9_]+)\.ts$/.exec(path);
  if (match === null) return null;
  const [, number, name] = match;
  return { id: Number(number), name: name ?? "" };
}
