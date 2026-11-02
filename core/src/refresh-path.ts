/**
 * Where the site's page store hears that its data changed
 * (web/src/refresh.ts): the Sync Worker and the studio (site-refresh.ts)
 * POST it. It imports nothing, so the Worker's cold start reads it
 * without core's dependencies.
 */
export const refreshPath = "/_site/refresh";

/**
 * Where the writers have the site build its pages into its store
 * (web/src/prewarm.ts): the Sync Worker after each run, and a prod deploy.
 */
export const prewarmPath = "/_site/prewarm";
