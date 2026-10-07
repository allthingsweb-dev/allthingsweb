/**
 * Who may see a draft: the Worker's own check of what Cloudflare Access
 * signed, behind Access at the edge (infra/src/preview.ts). Access lets a
 * request through only for the organizers' emails, and says so in a JWT
 * (the `Cf-Access-Jwt-Assertion` header) signed with its team's keys. The
 * Worker trusts nothing else: it verifies that token's signature against
 * the team's published keys, its issuer, its audience (this Worker's Access
 * application) and its times, and that its email is one of the viewers
 * the stack names. Anything missing or wrong is refused, settings
 * included: a preview without them shows nobody anything.
 *
 * It reads the token rather than `ctx.access`, because a Worker with static
 * assets runs behind Cloudflare's asset router, which doesn't pass
 * `ctx.access` on.
 */

/** What the check needs: the stack sets each (infra/src/preview.ts). */
export interface AccessSettings {
  /** The Access team's domain, such as "allthings.cloudflareaccess.com". */
  readonly teamDomain: string;
  /** The audience tag of the Access application in front of this Worker. */
  readonly audience: string;
  /** Who may see drafts, by the email they sign in with, lowercase. */
  readonly viewers: ReadonlySet<string>;
}

/** The settings from the Worker's bindings, or why there are none. */
export function accessSettings(
  env: Readonly<Record<string, unknown>>,
): AccessSettings | string {
  const team = env["ACCESS_TEAM_DOMAIN"];
  const audience = env["ACCESS_AUD"];
  const viewers = env["PREVIEW_VIEWERS"];
  if (
    typeof team !== "string" ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)
  ) {
    return "ACCESS_TEAM_DOMAIN is not an Access team domain";
  }
  if (typeof audience !== "string" || audience.trim() === "") {
    return "ACCESS_AUD is not set";
  }
  if (typeof viewers !== "string") return "PREVIEW_VIEWERS is not set";
  const emails = viewers
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== "");
  if (
    emails.length === 0 ||
    emails.some((email) => !/^[^@\s]+@[^@\s]+$/.test(email))
  ) {
    return "PREVIEW_VIEWERS is not a list of emails";
  }
  return { teamDomain: team, audience, viewers: new Set(emails) };
}

/** A public key in the team's key set, as Access publishes it. */
export interface PublicJwk {
  readonly kid: string;
  readonly kty: string;
  readonly n: string;
  readonly e: string;
  readonly alg?: string;
}

/** The team's current keys; `refresh` asks again, when a token names one it lacks. */
export type KeySource = (
  teamDomain: string,
  refresh: boolean,
) => Promise<ReadonlyArray<PublicJwk>>;

/** The team's keys from `https://<team>/cdn-cgi/access/certs`, kept for an hour. */
export function publishedKeys(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): KeySource {
  const kept = new Map<
    string,
    { keys: ReadonlyArray<PublicJwk>; at: number }
  >();
  return async (teamDomain, refresh) => {
    const known = kept.get(teamDomain);
    if (!refresh && known !== undefined && now() - known.at < 3_600_000) {
      return known.keys;
    }
    const response = await fetcher(
      `https://${teamDomain}/cdn-cgi/access/certs`,
    );
    if (!response.ok) throw new Error(`Access keys: HTTP ${response.status}`);
    const body = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys)
      ? body.keys.filter(
          (key): key is PublicJwk =>
            typeof key === "object" &&
            key !== null &&
            typeof (key as PublicJwk).kid === "string" &&
            (key as PublicJwk).kty === "RSA" &&
            typeof (key as PublicJwk).n === "string" &&
            typeof (key as PublicJwk).e === "string",
        )
      : [];
    kept.set(teamDomain, { keys, at: now() });
    return keys;
  };
}

export type Verdict =
  | { readonly allowed: true; readonly email: string }
  | { readonly allowed: false; readonly reason: string };

const refuse = (reason: string): Verdict => ({ allowed: false, reason });

const base64url = (text: string): Uint8Array<ArrayBuffer> => {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const json = (part: string): unknown => {
  try {
    return JSON.parse(new TextDecoder().decode(base64url(part))) as unknown;
  } catch {
    return undefined;
  }
};

/** Leeway for clocks that disagree, in seconds. */
const leeway = 60;

/**
 * Whether `token` (the `Cf-Access-Jwt-Assertion` header, if any) lets its
 * bearer see drafts at `now` (milliseconds since the epoch).
 */
export async function verifyAccess(
  token: string | null | undefined,
  settings: AccessSettings,
  keys: KeySource,
  now: number,
): Promise<Verdict> {
  if (token === null || token === undefined || token === "") {
    return refuse("no Access token");
  }
  const parts = token.split(".");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    parts.length !== 3 ||
    encodedHeader === undefined ||
    encodedPayload === undefined ||
    encodedSignature === undefined
  ) {
    return refuse("not a JWT");
  }
  const header = json(encodedHeader) as
    | { alg?: unknown; kid?: unknown }
    | undefined;
  const claims = json(encodedPayload) as
    | {
        iss?: unknown;
        aud?: unknown;
        exp?: unknown;
        nbf?: unknown;
        iat?: unknown;
        email?: unknown;
      }
    | undefined;
  if (header === undefined || claims === undefined) return refuse("not a JWT");
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    return refuse("not signed with RS256");
  }

  let key = (await keys(settings.teamDomain, false)).find(
    (candidate) => candidate.kid === header.kid,
  );
  // Access rotates its keys: one we haven't seen may be new.
  key ??= (await keys(settings.teamDomain, true)).find(
    (candidate) => candidate.kid === header.kid,
  );
  if (key === undefined) return refuse("signed with an unknown key");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: key.kty, n: key.n, e: key.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    base64url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!signed) return refuse("bad signature");

  if (claims.iss !== `https://${settings.teamDomain}`) {
    return refuse("issued by another team");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(settings.audience)) {
    return refuse("for another application");
  }
  const seconds = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp + leeway < seconds) {
    return refuse("expired");
  }
  if (typeof claims.nbf === "number" && claims.nbf - leeway > seconds) {
    return refuse("not valid yet");
  }
  if (typeof claims.email !== "string") return refuse("no email");
  const email = claims.email.toLowerCase();
  if (!settings.viewers.has(email)) return refuse("not a viewer");
  return { allowed: true, email };
}
