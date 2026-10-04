# allthings-core

The data layer the Worker (`web/`) runs on: repositories over Postgres with
Effect SQL, and the migrations that define the schema.

## Luma sync

`src/luma/` is the app's hourly Luma calendar sync (`app/src/lib/luma/`) as
Effect services, for a Worker cron to run: `Luma` reads the calendar's public
iCalendar feed over `HttpClient` (retrying 429, 5xx, timeouts and dropped
connections), and `LumaSync` writes it to `events` in one statement. Which
columns Luma owns, and which the site does, is written down in
`src/luma/sync.ts`. `tests/luma-parity.test.ts` runs the app's sync and
core's on copies of one database with the same feed and requires the same
rows; nothing in the tests reaches Luma.

## Migrations

`migrations/` holds the schema as Effect SQL migrations, applied by Effect's
migrator (`src/migrator.ts`). The Next app in `app/` still runs on drizzle and
its hand-applied `app/migrations` until the cutover; both share production
until then (see below).

### Writing one

- One file per change: `migrations/NNNN_short_name.ts`, the next id after the
  last, default-exporting `statements([...])` with one SQL statement per
  entry. Add it to `migrations/index.ts`; a test fails if a file is missing
  there or an id is skipped.
- Forward only, and never edited after merge: production records each
  migration by id and name and will not run it again. To change something,
  add a migration. `migrate` refuses a database whose record is not a prefix
  of the migrations here.
- Each runs in one transaction with the others pending, so no
  `CREATE INDEX CONCURRENTLY`; split such a change out when it is needed.
- Until the cutover, a schema change ships twice: as the app's drizzle
  migration and as a migration here. `tests/migrations.test.ts` replays
  `app/migrations` and fails when the two schemas drift apart. Change
  `app/src/lib/schema.ts`, run `bun run db:generate --name <name>` in `app/`
  for the migration and its snapshot, and append any data statements to the
  generated SQL by hand. Only the test replays those files: production, now
  stamped, takes migrations from here alone.
- Add the lines the migration creates to
  `tests/fixtures/production-schema.txt`, which is production's catalog once
  every migration here has run (`bun run migrate`, after the merge).

`0001_baseline` is production's schema on 2026-10-04, read from its catalog,
not a copy of `app/migrations`: production received changes by hand that
those files do not record. The test lists each difference with its reason.
`tests/fixtures/production-schema.txt` is that catalog plus what each later
migration adds, and the tests hold the migrations to it both in PGlite and on
Postgres 17 (`tests/postgres.test.ts`, in CI).

### Running them

```sh
DATABASE_URL=postgres://… bun run migrate --dry-run   # what would run
DATABASE_URL=postgres://… bun run migrate             # run it
```

After a pull request with a migration merges, run both against production:
the dry run must list exactly that pull request's migrations as pending.

`DATABASE_URL` comes from the environment only: the script does not read
`.env` files. The record of applied migrations is `effect_sql.migrations`, in
its own schema like drizzle's `drizzle.__drizzle_migrations`, so neither tool
sees the other's and drizzle-kit, which manages `public`, leaves it alone.

### Stamping production at the cutover

Production already has the baseline's schema, so the baseline must be recorded
there, not run (running it would fail on the first existing table, and
`migrate` refuses to try). `stamp` records the pending migrations as applied
without running them, and only if the live schema is exactly what they create:

```sh
DATABASE_URL=… bun run migrate stamp --dry-run   # reads only: shows any difference
DATABASE_URL=… bun run migrate stamp             # records 0001_baseline (and any later ones)
```

It builds the expected schema by applying the migrations to an in-process
PGlite, then, through the migrator itself, inserts the records and compares
production's catalog to the expected schema in the same transaction: on any
difference it fails and records nothing. It changes no table of the app's.
To undo it, delete the stamped rows from `effect_sql.migrations` (or drop the
`effect_sql` schema). After the stamp, `bun run migrate` applies later
migrations, and drizzle's migrations stop. Production was stamped at
`0001_baseline` on 2026-10-04.

### In CI, once a Neon credential exists

Each pull request gets a Neon branch of production: create it, run
`bun run migrate` against it (the branch inherits production's record, so only
the pull request's new migrations run), run the tests against it, then delete
the branch. On deploy, `bun run migrate` runs against production before the new
Worker goes live. Neither job exists yet.
