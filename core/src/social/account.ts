/**
 * Our Bluesky account. The DID is the account itself and never changes; the
 * handle is a domain that names it. Bluesky checks a domain handle by
 * reading the DID from that domain's /.well-known/atproto-did, which the
 * Web Worker serves from here (web/src/seo/routes.ts).
 */
export const ourAccount = {
  handle: "allthingsweb.dev",
  did: "did:plc:2udktehieuvck4emsuoasldh",
} as const;
