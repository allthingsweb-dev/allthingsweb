/**
 * How long Hyperdrive keeps the answer to a read of the site's data, in
 * seconds, and how much longer it may answer with it while it fetches a new
 * one. infra/src/web.ts deploys every stage's Hyperdrive with it.
 */
export const readerCaching = { maxAge: 60, staleWhileRevalidate: 15 } as const;

/**
 * Milliseconds after which Hyperdrive gives no answer older than a write:
 * the page store (page-store.ts) keeps pages of a new version of the data
 * only from then on, so none is built from an answer that predates it.
 */
export const readerTurnover =
  (readerCaching.maxAge + readerCaching.staleWhileRevalidate) * 1000;
