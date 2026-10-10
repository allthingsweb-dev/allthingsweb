/**
 * CodeRabbit's configuration. CodeRabbit bundles and evaluates this file
 * itself, in a sandbox with no network and an empty environment, so it may
 * import only `@coderabbitai/config` and relative files. That package gives
 * it types alone: `bun run typecheck` at the root checks this file, since
 * CodeRabbit drops keys it doesn't know without a word. A committed
 * `.coderabbit.yaml` would win over this file, so there must never be one.
 *
 * `@coderabbitai configuration` on a pull request shows what CodeRabbit
 * resolved, and where each value came from.
 */
import { defineConfig, type CodeRabbitConfig } from "@coderabbitai/config";

type Reviews = NonNullable<CodeRabbitConfig["reviews"]>;
type PreMergeChecks = NonNullable<Reviews["pre_merge_checks"]>;
type CustomCheck = NonNullable<PreMergeChecks["custom_checks"]>[number];

/**
 * What a review of each part of the repository holds it to, as each part's
 * README and CI state it. One list, so a directory and its rules can't drift
 * apart.
 */
const areas = [
  {
    dir: "core",
    rules: [
      "core is the data layer the Worker (web/) and the CLI share: Effect services over Postgres, the public contract (src/contract.ts) and the migrations. core/README.md is its documentation; flag a change that contradicts it or leaves it stale.",
      "Every public read builds its statement from src/catalog.ts. Flag a file that states one of its rules itself (which evenings are public, their order, ahead or ended, ours, a lineup's order) outside src/catalog.ts; tests/catalog-guard.test.ts enforces it, and its list of exceptions only shrinks.",
      "Every command that writes takes --dry-run, which writes nothing (a rolled-back transaction, or reads only). Where a command issues an approval token, the write takes --approve <token> and refuses anything that moved since the dry run.",
      "planning is private: site_reader and site_sync are never granted the schema (tests/planning-privacy.test.ts), and no seed, fixture or backfill holds planning rows.",
      'Migrations follow core/README.md, "Migrations": one file per change with the next id, listed in migrations/index.ts, forward only and never edited after merge.',
    ],
  },
  {
    dir: "web",
    rules: [
      "web is the Cloudflare Worker that serves allthings.dev: the pages, the v1 API, the MCP server, the draft preview (src/preview/) and the hourly Luma sync (src/sync/). It replaces the old app in app/.",
      "Reads build on core/src/catalog.ts, and the surfaces must agree: web/tests/parity.test.ts holds list_events, /api/v1, the feeds, the pages and the sitemap to the same evenings, people and order.",
      "The pages run no JavaScript; forms post to the same page. Canonical URLs, the sitemap, feeds and link previews always name https://allthings.dev (ORIGIN), on every stage.",
      "The Web Worker never reads a draft: only the preview Worker does, as draft_collab, behind Cloudflare Access.",
      "Rendered HTML must pass the XSS scan (bun run xss-scan): flag any value written into markup without escaping.",
    ],
  },
  {
    dir: "infra",
    rules: [
      "infra declares allthings' Cloudflare resources with Alchemy v2 in alchemy.run.ts. infra/README.md is its documentation; flag a change that contradicts it or leaves it stale.",
      "When alchemy.run.ts declares more, ci-token.json widens in the same pull request.",
      "Each database role holds exactly the grants its script lists (scripts/site-reader.ts, site-sync.ts, draft-collab.ts) and is made with SQL by the database owner, never in Neon's console or API.",
      "Secrets are never printed: they are read with `op read` into variables, and scripts pass tokens through memory only.",
      "Production has one writer at a time, the app's cron or the Sync Worker (tests/sync.test.ts). A change to SYNC in src/sync.ts is a one-line pull request of its own.",
      "Media objects are never overwritten: a replacement goes under a new key.",
    ],
  },
  {
    dir: "cli",
    rules: [
      "cli is `allthings`, the command-line client for people and agents. It reads the public MCP server at https://allthings.dev/mcp (src/config.ts).",
      "Its --json output and its exit codes (0 ok, 1 service error, 2 usage error, 3 no such evening) are a public contract. cli/src/schemas.ts is held to core/src/contract.ts by core/tests/contract.test.ts.",
      "The old name keeps working: the `atw` bin and ATW_MCP_URL and ATW_VERSION print a note on stderr only, so scripts reading stdout don't break. allthings 2 stays a prerelease until the launch.",
    ],
  },
  {
    dir: "plugins",
    rules: [
      "plugins/allthings is the allthings plugin for coding agents: the MCP server, two skills, and a Claude Code mod with themes and an output style. Its README is its documentation.",
      "plugin.json and mcp.json (the Agent Plugins manifest) and .claude-plugin/plugin.json (Claude Code's) describe the same plugin.",
      "The mod reads the MCP server mcp.json configures and stays quiet when the site can't be reached.",
      'The output style changes only the voice: evenings rather than events, "I\'m in" and never RSVP.',
    ],
  },
  {
    dir: "brand",
    rules: [
      "brand/foundations.md is the rules every page, cover and line of copy is checked against; when tokens or components disagree with it, it wins.",
      "The name is allthings, one word, always lowercase. Hosting companies are never called sponsors.",
      "Every color pairing meets its APCA target and WCAG 2.2 AA (the token tests check both), and color never carries meaning alone.",
      "Marks are generated: brand/marks/generate.py writes them, and `uv run --locked generate.py --check` in brand/marks must pass.",
    ],
  },
  {
    dir: "app",
    rules: [
      "app is the old Next.js app on Vercel, which web/ and core replace. Keep changes to what it needs until the cutover; new features belong in web/ and core.",
      "A change to app/src/lib/schema.ts ships twice until the cutover: as the app's drizzle migration (bun run db:generate --name <name>) and as a core migration. core/tests/migrations.test.ts replays app/migrations and fails when the two drift; production takes migrations from core alone.",
      "app/vercel.json may not bring the Luma cron back while the Sync Worker writes (infra/tests/sync.test.ts).",
    ],
  },
] as const;

const pathInstructions: Reviews["path_instructions"] = areas.map(
  ({ dir, rules }) => ({
    path: `${dir}/**`,
    instructions: rules.map((rule) => `- ${rule}`).join("\n"),
  }),
);

/** Lines of a check's instructions, numbered so a failure can name one. */
const numbered = (lines: readonly string[]): string =>
  lines.map((line, index) => `${index + 1}. ${line}`).join("\n");

/** One rule, documented in core/README.md, "Migrations". */
const migrationsCheck: CustomCheck = {
  name: "Migrations reach production safely",
  mode: "error",
  instructions: `This pull request changes core/migrations/ or app/migrations/. Production applies migrations by id and name (core/README.md, "Migrations"). Pass only if every item holds; otherwise fail and name each that doesn't.

${numbered([
  "Forward only, and never edited after merge: no migration that exists on the base branch is modified, renamed or deleted. To change something, the pull request adds a migration.",
  "Each new core migration is migrations/NNNN_short_name.ts with the next id after the last, default-exporting statements([...]), listed in core/migrations/index.ts with no id skipped. Its number must be free: CI's migration guard (Migration numbers) compares it with what production has applied and with other open pull requests, and when it fails, the migration takes the number it names.",
  "No CREATE INDEX CONCURRENTLY: each migration runs in one transaction with the others pending.",
  "Until the cutover, a change to a table in app/src/lib/schema.ts ships twice: as the app's drizzle migration in app/migrations (from bun run db:generate) and as a core migration. The one exception is a migration that only brings production back to what app/migrations already creates: it ships in core alone, and its entry leaves the list in core/tests/migrations.test.ts. The lines a migration creates are added to core/tests/fixtures/production-schema.txt.",
  "The code already on main keeps running on the migrated schema: a column or table is added before code uses it, and a drop or rename is a later migration, after the code stops using the old shape.",
  "A migration reaches production before the code that needs it, since the app on Vercel and its previews read production's database. The pull request description must say whether this pull request's migrations must be applied to production before it merges, and if so, that they will be run as core/README.md, \"Running them\", says: once approved and green, from the final head commit, `bun run migrate --dry-run` against production lists exactly this pull request's migrations as pending, then `bun run migrate`, then merge, with nothing pushed in between. Fail if the description doesn't say either way.",
])}`,
};

/** Documented in infra/README.md and the headers of infra/scripts/. */
const productionScriptsCheck: CustomCheck = {
  name: "Production writes take their planned path",
  mode: "error",
  instructions: `This pull request changes infra/. Pass only if every item holds; otherwise fail and name each that doesn't.

${numbered([
  "A script or command that writes to production shows what it will do before it does it, and checks the result afterwards, as the existing ones do: `bun run plan --stage prod` before `bun run deploy --stage prod`, and every deploy proves uploads work by storing and deleting one object; copy-media.ts's plan, copy and verify, which never overwrites or deletes; dry runs that roll back or only read. A new production write without a dry run or plan before it, or a change that skips one, fails.",
  "Tests and rehearsals never write to production. Tests run on PGlite or a disposable Postgres (CORE_TEST_POSTGRES_URL) made with the scripts' own statements, and nothing in them reaches Luma or Discord. A rehearsal that reads production (bun run sync:rehearse, web/scripts/sync-dry-run.ts) writes nothing: its transaction always rolls back, and it runs as site_sync.",
  "Production has one writer at a time: the app's cron or the Sync Worker, never both (infra/tests/sync.test.ts). A change to SYNC in src/sync.ts is a one-line pull request of its own, in the handover's order.",
  "When alchemy.run.ts declares more, ci-token.json widens in the same pull request.",
])}`,
};

/** Documented in infra/README.md and the headers of infra/scripts/. */
const secretsCheck: CustomCheck = {
  name: "Secrets are never printed",
  mode: "error",
  instructions: `Pass only if every item holds for the code, scripts, workflows and documentation this pull request changes; otherwise fail and name each that doesn't.

${numbered([
  "Credentials are read from the allthings 1Password vault with `op read` into a variable or straight into the command's environment, as in NEON_READER_URL=$(op read \"op://allthings/allthings site_reader/credential\") bun run deploy. No secret value is written into the repository, a command line's output, a log or a pull request.",
  "Every connection string or token passed to a command is captured, never echoed: nothing prints, logs or interpolates it into output (no echo, console.log, set -x or error message that includes it). A script that makes a credential sends it straight into a repository secret or 1Password, and a failing command shows its stderr alone.",
  "A Worker that is missing a secret names the binding, never a value.",
])}`,
};

/** Documented in infra/README.md, core/README.md and infra/scripts/. */
const rolesCheck: CustomCheck = {
  name: "Database roles hold only listed grants",
  mode: "error",
  instructions: `Pass only if every item holds; otherwise fail and name each that doesn't.

${numbered([
  "site_reader and site_sync only ever get the grants their scripts list explicitly: site_reader may only SELECT the tables the public site reads (and the migrator's record) and starts every transaction read-only; site_sync holds exactly SITE_SYNC_GRANTS, the column privileges the sync's statements use, with no DELETE and no table the sync doesn't touch. No migration or script grants them anything else: no GRANT on ALL TABLES, on a whole schema, to PUBLIC, or as a default privilege that would reach them.",
  "draft_collab holds exactly DRAFT_COLLAB_GRANTS and DRAFT_COLLAB_FUNCTIONS, with no UPDATE, DELETE or TRUNCATE anywhere, and row security applies to it.",
  "Roles are made with SQL by the database owner (infra/scripts/login-role.ts), never in Neon's console or API, whose roles join neon_superuser.",
  "site_reader and site_sync are never granted the planning schema, and the privacy tests cover it: a change to planning's tables or to a role's grants keeps core/tests/planning-privacy.test.ts proving both roles are refused, and keeps core/tests/site-sync.test.ts and core/tests/draft-collab.test.ts checking that each role can do what it needs and nothing else.",
])}`,
};

export default defineConfig((ctx) => {
  const changed = ctx.pr?.changedFiles;
  const paths = changed?.status === "resolved" ? changed.paths : [];
  const touches = (...prefixes: string[]) =>
    paths.some((path) => prefixes.some((prefix) => path.startsWith(prefix)));

  const migrations = touches("core/migrations/", "app/migrations/");
  const infra = touches("infra/");

  const customChecks: CustomCheck[] = [
    ...(migrations ? [migrationsCheck] : []),
    ...(infra ? [productionScriptsCheck] : []),
    ...(migrations || infra ? [secretsCheck, rolesCheck] : []),
  ];

  return {
    early_access: true,
    reviews: {
      profile: "assertive",
      request_changes_workflow: true,
      review_details: true,
      fail_commit_status: true,
      auto_apply_labels: true,
      auto_assign_reviewers: true,
      auto_review: { drafts: true },
      finishing_touches: {
        unit_tests: { enabled: false },
        simplify: { enabled: true },
      },
      path_instructions: pathInstructions,
      ...(customChecks.length > 0
        ? { pre_merge_checks: { custom_checks: customChecks } }
        : {}),
    },
    issue_enrichment: {
      auto_enrich: { enabled: true },
      labeling: { auto_apply_labels: true },
    },
  };
});
