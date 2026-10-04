/**
 * The Worker's runtime settings. infra/src/web.ts deploys with them and the
 * tests run the Worker locally with them, so what is tested is what deploys.
 *
 * - `date` is the newest the workerd pinned by Alchemy supports locally, so
 *   local and deployed behavior match. Raise it with Alchemy upgrades.
 * - `nodejs_compat`, which `@effect/sql-pg` needs for `node:net`, `node:tls`
 *   and `node:crypto`, is on by default from 2026-08-04. workerd warns when a
 *   default flag is also listed, so it isn't.
 */
export const compatibility = { date: "2026-09-25" } as const;
