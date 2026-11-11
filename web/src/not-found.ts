/**
 * What a path the site answered 404 was, for its request data point
 * (metrics.ts): one of a few kinds, and a shape safe to store and show. A
 * 404's path is whatever the asker sent, and scanners send paths that look
 * like secrets (`/.env`, `ssl/server.key`), so the raw path is never kept.
 * The shape is built only from fixed words below and markers: a scanner's
 * family name, a well-known file's name, an old site's route, or a word a
 * visitor guessed that is on {@link guessedWords}.
 *
 * The kinds, tried in this order:
 *
 * - `well-known`: what browsers and crawlers ask every site for on their
 *   own (`/.well-known/…`, `/apple-touch-icon-precomposed.png`, `/llms.txt`).
 * - `legacy`: an old allthings site's URL: the Remix site's images
 *   (`/img?src=…`, `/img/pocketbase/…`), its Open Graph images, the Next
 *   app's `/_next/…`, an evening's dated slug at the root.
 * - `probe`: a scanner looking for secrets, admin pages or other sites'
 *   software (`.env`, WordPress, PHP, version control, cloud credentials,
 *   keys, Terraform state, config files).
 * - `guessed`: a page a person or crawler guessed the site has (`/press`,
 *   `/blog`, `/people/someone-else`).
 * - `other`: anything else, such as a crawler that took an image's
 *   `srcset` for one URL.
 *
 * It imports nothing: metrics.ts loads it after each answer is sent.
 */

/** The kinds of 404, in the order they are tried and shown. */
export const notFoundKinds = [
  "well-known",
  "legacy",
  "probe",
  "guessed",
  "other",
] as const;

export type NotFoundKind = (typeof notFoundKinds)[number];

export interface NotFoundShape {
  readonly kind: NotFoundKind;
  /** Safe to store and show: fixed words and markers only. */
  readonly shape: string;
}

/**
 * Names under `/.well-known/` that are registered or widely asked for, kept
 * as they are; any other is `/.well-known/(other)`.
 */
export const wellKnownNames: ReadonlySet<string> = new Set([
  "security.txt",
  "traffic-advice",
  "apple-app-site-association",
  "assetlinks.json",
  "change-password",
  "openid-configuration",
  "oauth-authorization-server",
  "oauth-protected-resource",
  "mcp",
  "mcp.json",
  "nodeinfo",
  "webfinger",
  "host-meta",
  "host-meta.json",
  "mta-sts.txt",
  "gpc.json",
  "ai-plugin.json",
  "agent.json",
  "atproto-did",
  "dnt-policy.txt",
  "humans.txt",
  "trust.txt",
  "appspecific",
]);

/** Files at the root that browsers, apps and crawlers ask any site for. */
export const wellKnownFiles: ReadonlySet<string> = new Set([
  "apple-touch-icon-precomposed.png",
  "apple-touch-icon-120x120.png",
  "apple-touch-icon-120x120-precomposed.png",
  "apple-touch-icon-152x152.png",
  "apple-touch-icon-152x152-precomposed.png",
  "apple-touch-icon-180x180.png",
  "browserconfig.xml",
  "site.webmanifest",
  "manifest.json",
  "llms.txt",
  "llms-full.txt",
  "ads.txt",
  "app-ads.txt",
  "humans.txt",
  "security.txt",
  "sitemap_index.xml",
  "sitemap-index.xml",
  "feed.xml",
  "atom.xml",
  "index.xml",
  "feed",
]);

/** The Remix site's CMS collections, under `/img/pocketbase/`. */
const pocketbaseCollections: ReadonlySet<string> = new Set([
  "speakers",
  "members",
  "events",
  "sponsors",
  "talks",
]);

/**
 * Single words a visitor may guess a site like this has, kept as they are
 * when a guessed path is made of them; any other word is `(word)`.
 */
export const guessedWords: ReadonlySet<string> = new Set([
  "about-us",
  "account",
  "archive",
  "blog",
  "calendar",
  "careers",
  "cfp",
  "community",
  "contact",
  "discord",
  "docs",
  "donate",
  "event",
  "faq",
  "gallery",
  "github",
  "hackathon",
  "hackathons",
  "home",
  "imprint",
  "index",
  "info",
  "jobs",
  "join",
  "login",
  "meetup",
  "meetups",
  "members",
  "new",
  "news",
  "newsletter",
  "organizers",
  "partners",
  "photos",
  "press",
  "pricing",
  "privacy",
  "recordings",
  "register",
  "schedule",
  "search",
  "signin",
  "signup",
  "site",
  "slides",
  "speak",
  "speaker",
  "sponsor",
  "sponsors",
  "subscribe",
  "talks",
  "team",
  "terms",
  "videos",
  "volunteer",
  "youtube",
]);

/**
 * The first segments of the site's own routes whose deeper paths are
 * slugs: an evening's, a person's, a short link's, a lab variant's, an
 * API resource's. Only below these is a path kept segment by segment;
 * below any other first segment, a point keeps that segment alone and
 * `/…` for the rest, so whatever a crafted URL carries after it is never
 * stored (metrics.ts). Photo variants (`/img/…`) are kept as their class:
 * their paths are the site's own, and a 404 there says enough by its
 * count. A 404 below one is shown as the root and `(slug)`, never the slug.
 * Here, not in metrics.ts, so this module imports nothing.
 */
export const slugRoots: ReadonlySet<string> = new Set([
  "events",
  "people",
  "speakers",
  "about",
  "brand",
  "lab",
  "r",
  "api",
  "code-of-conduct",
  "privacy",
]);

/**
 * Scanners' families, tried in order on the decoded, lowercase path. The
 * family's name is the shape: `(probe: env)`.
 */
const probeFamilies: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "env",
    /\.env(\b|$)|(^|\/)env(\.[a-z]+)?$|_environment|@vite\/env|env-config|\.dev\.vars/,
  ],
  ["version control", /(^|\/)\.(git|svn|hg|bzr)(\/|$|-)|\.gitlab-ci/],
  ["wordpress", /(^|\/)(wp|wordpress)(\/|$)|(^|\/)wp-|xmlrpc/],
  ["php", /\.php|phpinfo|phpmyadmin|(^|\/)_profiler(\/|$)|(^|\/)pma(\/|$)/],
  [
    "cloud credentials",
    /\.aws(\/|$)|\.boto|boto\.cfg|\.s3cfg|s3\.(secret|properties)|credentials|\.docker\/|\.npmrc|\.netrc|\.pypirc|\.ssh(\/|$)|id_(rsa|ed25519|ecdsa)|secrets?(\.|\/|$)|api-?keys|\.firebaserc|\.amplifyrc|aws-exports|sentry\.properties|wrangler\.toml|samconfig/,
  ],
  [
    "keys and certificates",
    /\.(key|pem|p12|pfx|crt|cer|jks|keystore)$|(^|\/)(ssl|certs?|private)\/[^/]*\.[a-z0-9]+$/,
  ],
  ["terraform", /terraform|\.tfvars|\.tfstate/],
  [
    "server internals",
    /server-(status|info)|actuator|telescope|cgi-bin|\.(asp|aspx|axd|jsp|jspx|action|cgi|do)$|___proxy|(^|\/)proc\/self|(^|\/)etc\/|(^|\/)(ecp|owa|autodiscover|_layouts|hnap1|boaform|_ignition|__debug|debug|console|manager|jenkins|solr|webdav|druid|nacos|geoserver)(\/|$)|(^|\/)v2\/_catalog|(^|\/)(admin|administrator|cpanel|whm|webmail)(\/|$)|\.\.\//,
  ],
  [
    "graphql and api",
    /(^|\/)(graphql|gql|swagger|openapi|api-docs)(\/|\.|$)|(^|\/)api\/(fs|system|console|config|users|common)(\/|\.|$)|(^|\/)rest\/workflows|(^|\/)webhooks?(-test)?(\/|$)/,
  ],
  [
    "other software",
    /(^|\/)(rest|livewire|_debugbar|_vercel|_react|_api|__nextjs_action|userfiles|cms|portal|auth|oauth|password|two-factor-challenge|forgot-password|healthz|elasticsearch[a-z_]*|private-key|aws|curl|internal|var\/log)(\/|$|\.)|\.(html?|plist)$/,
  ],
  [
    "backups",
    /\.(sql|bak|backup|old|orig|save|swp|zip|tar|gz|tgz|rar|7z|dump)$|(^|\/)(backup|backups|bk|bak|bc|old|temp|tmp|dump)(\/|$)/,
  ],
  [
    "config and source files",
    /(^|\/)\.[a-z0-9_-]+|dockerfile|docker-compose|(^|\/)(config|settings|constants?|app|index|main|server|runtime-config)\.[a-z]+$|\.(json|ya?ml|toml|ini|conf|config|cfg|properties|xml|js|mjs|cjs|ts|tsx|py|rb|go|java|log|md|txt|lock|hcl|prisma|sh|bash_history|db|sqlite|map)$/,
  ],
];

/** The family of scanner `path` (decoded, lowercase) looks like, if any. */
const probeFamily = (path: string): string | undefined =>
  probeFamilies.find(([, pattern]) => pattern.test(path))?.[0];

/** The path, decoded (at most 8 passes) and lowercase; undefined when malformed. */
function decoded(pathname: string): string | undefined {
  let text = pathname;
  for (let pass = 0; pass < 8 && text.includes("%"); pass++) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return undefined;
    }
  }
  return text.toLowerCase();
}

/** A segment as a guessed path shows it: a guessed word, or what it was. */
function guessedSegment(segment: string): string {
  if (guessedWords.has(segment)) return segment;
  const words = segment.split(/[-_.]/).filter((word) => word !== "");
  if (words.length === 0) return "(code)";
  const shaped = words.every(
    (word) => /^[a-z]+$/.test(word) || /^[0-9]{1,4}$/.test(word),
  );
  if (!shaped || !words.some((word) => /^[a-z]+$/.test(word))) {
    return "(code)";
  }
  return words.length === 1 ? "(word)" : "(slug)";
}

/** `{kind, shape}` for a path the site answered 404 (see the module's comment). */
export function notFoundShape(pathname: string): NotFoundShape {
  // `//host/…`: a crawler that read a protocol-relative URL as a path.
  if (pathname.startsWith("//")) {
    return { kind: "other", shape: "(protocol-relative URL)" };
  }
  const path = decoded(pathname);
  if (path === undefined) return { kind: "probe", shape: "(probe: malformed)" };
  const segments = path.replace(/^\/+/, "").replace(/\/+$/, "").split("/");
  const [first = "", second = ""] = segments;
  if (first === "") return { kind: "other", shape: "/" };

  if (first === ".well-known") {
    if (wellKnownNames.has(second)) {
      return { kind: "well-known", shape: `/.well-known/${second}` };
    }
    // A scanner hiding a script there (`/.well-known/x.php`) is a probe.
    const family = probeFamily(path.slice(path.indexOf(".well-known/") + 12));
    return family === undefined
      ? { kind: "well-known", shape: "/.well-known/(other)" }
      : { kind: "probe", shape: `(probe: ${family})` };
  }
  if (segments.length === 1 && wellKnownFiles.has(first)) {
    return { kind: "well-known", shape: `/${first}` };
  }

  if (first === "img") {
    if (segments.length === 1) {
      // The Remix site's image endpoint, `/img?src=…&w=…`.
      return { kind: "legacy", shape: "/img (the Remix site's images)" };
    }
    if (second === "pocketbase" || second === "public" || second === "gen") {
      const collection = segments[2] ?? "";
      return {
        kind: "legacy",
        shape:
          second === "pocketbase"
            ? `/img/pocketbase/${pocketbaseCollections.has(collection) ? collection : "(other)"}/…`
            : `/img/${second}/…`,
      };
    }
    // A crawler that took a `srcset` ("a.jpg 240w, b.jpg 360w") for one URL.
    if (/\s\d+[wx],/.test(path)) {
      return { kind: "other", shape: "/img/… (a srcset read as one URL)" };
    }
    return { kind: "other", shape: "/img/…" };
  }
  if (first === "_next") return { kind: "legacy", shape: "/_next/…" };
  if (
    segments.length === 1 &&
    ["preview.png", "qr.png", "speakers.png", "healthcheck"].includes(first)
  ) {
    return { kind: "legacy", shape: `/${first}` };
  }
  if (/^\d{4}-\d{2}-\d{2}(-[a-z0-9]+)*$/.test(first)) {
    const rest = segments.slice(1).join("/");
    return {
      kind: "legacy",
      shape: ["preview.png", "qr.png", "thumbnail.png"].includes(rest)
        ? `/(dated slug)/${rest}`
        : rest === ""
          ? "/(dated slug)"
          : "/(dated slug)/…",
    };
  }
  if (first === "tests" && second === "errors") {
    return { kind: "legacy", shape: "/tests/errors/…" };
  }
  // The Next app's Vercel cron, retired with it (legacy-urls.ts).
  if (path === "/api/cron/luma-sync") {
    return { kind: "legacy", shape: "/api/cron/luma-sync" };
  }

  const family = probeFamily(path);
  if (family !== undefined)
    return { kind: "probe", shape: `(probe: ${family})` };

  if (slugRoots.has(first)) {
    return {
      kind: "guessed",
      shape: segments.length === 1 ? `/${first}` : `/${first}/(slug)`,
    };
  }
  if (segments.length <= 2) {
    return {
      kind: "guessed",
      shape: `/${segments.map(guessedSegment).join("/")}`,
    };
  }
  return { kind: "other", shape: `/${guessedSegment(first)}/…` };
}

/** Shapes {@link notFoundShape} gives whole. */
const wholeShapes: ReadonlySet<string> = new Set([
  "/",
  "(protocol-relative URL)",
  "/img (the Remix site's images)",
  "/img/… (a srcset read as one URL)",
  "(probe: malformed)",
  ...probeFamilies.map(([family]) => `(probe: ${family})`),
]);

/** Every segment {@link notFoundShape} may put in a shape. */
const shapeSegments: ReadonlySet<string> = new Set([
  ...wellKnownNames,
  ...wellKnownFiles,
  ...guessedWords,
  ...slugRoots,
  ...pocketbaseCollections,
  ".well-known",
  "img",
  "pocketbase",
  "public",
  "gen",
  "_next",
  "preview.png",
  "qr.png",
  "thumbnail.png",
  "speakers.png",
  "healthcheck",
  "tests",
  "errors",
  "cron",
  "luma-sync",
  "(other)",
  "(word)",
  "(slug)",
  "(code)",
  "(dated slug)",
  "…",
]);

/**
 * Whether `shape` is one {@link notFoundShape} could have given: what a
 * report shows of a stored 404 is checked again, so a point written by
 * other code never shows what a URL carried.
 */
export function isNotFoundShape(shape: string): boolean {
  if (wholeShapes.has(shape)) return true;
  if (!shape.startsWith("/")) return false;
  return shape
    .slice(1)
    .split("/")
    .every((segment) => shapeSegments.has(segment));
}
