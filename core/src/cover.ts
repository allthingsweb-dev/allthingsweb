import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import type { EventPage } from "./event-page.ts";

/**
 * An evening's Luma cover: what it says, and drawing it. Every evening's
 * cover is allthings-branded and its own (brand/foundations.md, "Imagery":
 * typographic, generated from event data, never hand-assembled), never one
 * of Luma's defaults.
 *
 * `coverFacts` says what the cover says, from the evening as its page
 * reads it: the lockup (allthings/<topic>, or the name where it yields no
 * topic), the day, hour and year in San Francisco, the neighborhood, the
 * hosting companies (or the venue's name, with none on record) and the
 * short link, in the evening's mode. The facts
 * are all that varies, so they are what makes two covers differ.
 *
 * `CoverRenderer` draws them with the brand's template,
 * brand/marks/cover.py, as a square PNG. Same facts, same pixels.
 */

/** What a cover says: brand/marks/cover.py's input, exactly. */
export interface CoverFacts {
  readonly mode: "night" | "paper";
  /** allthings/<topic>; null for a name that yields none, set as written. */
  readonly topic: string | null;
  readonly name: string;
  /** Whether the cursor follows the lockup: the evening hasn't happened. */
  readonly ahead: boolean;
  /** "Tue Oct 27", in San Francisco. */
  readonly date: string;
  /** "6:00 PM", in San Francisco. */
  readonly time: string;
  readonly year: string;
  readonly neighborhood: string | null;
  /** "CodeRabbit", "Convex & Discord"; null without a host on record. */
  readonly hosts: string | null;
  /** The venue's name, said in place of hosts when none is on record. */
  readonly venue: string | null;
  /** "allthings.dev/trivia": the lockup is the link. */
  readonly link: string;
}

const sanFrancisco = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles");
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Hosts as every surface names them: "A", "A & B", "A, B & C". */
export function hostNames(hosts: ReadonlyArray<string>): string | null {
  if (hosts.length === 0) return null;
  if (hosts.length <= 2) return hosts.join(" & ");
  return `${hosts.slice(0, -1).join(", ")} & ${hosts.at(-1) ?? ""}`;
}

/**
 * What `page`'s cover says, its short link being `linkSlug` on the site at
 * `siteHost` (allthings.dev).
 */
export function coverFacts(
  page: Pick<
    EventPage,
    "mode" | "topic" | "name" | "status" | "startsAt" | "venue" | "hosts"
  >,
  linkSlug: string,
  siteHost: string,
): CoverFacts {
  const { weekDay, month, day, hour, minute, year } = DateTime.toParts(
    DateTime.setZone(page.startsAt, sanFrancisco),
  );
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return {
    mode: page.mode,
    topic: page.topic ?? null,
    name: page.name,
    ahead: page.status !== "past",
    date: `${weekdays[weekDay] ?? ""} ${months[month - 1] ?? ""} ${day}`,
    time: `${twelveHour}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`,
    year: String(year),
    neighborhood: page.venue?.neighborhood ?? null,
    hosts: hostNames(page.hosts),
    venue: page.venue?.name ?? null,
    link: `${siteHost}/${linkSlug}`,
  };
}

/**
 * Whether `url` is one of Luma's own covers: the gallery a new event
 * starts with, on images.lumacdn.com/gallery-images/. Never an evening's.
 */
export function isLumaDefaultCover(url: string | null): boolean {
  if (url === null) return false;
  try {
    const { hostname, pathname } = new URL(url);
    return (
      hostname === "images.lumacdn.com" &&
      pathname.startsWith("/gallery-images/")
    );
  } catch {
    return false;
  }
}

/** The SHA-256 of `bytes`, as 64 hex digits. */
export const sha256 = (bytes: Uint8Array) =>
  Effect.promise(async () =>
    [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
      ),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );

/** The brand's template couldn't draw the cover; what it said. */
export class CoverUnrendered extends Schema.TaggedError<CoverUnrendered>()(
  "CoverUnrendered",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export interface CoverRendererShape {
  /** The cover `facts` say, as a square PNG. */
  readonly render: (
    facts: CoverFacts,
  ) => Effect.Effect<Uint8Array, CoverUnrendered>;
}

/** Where the brand's generators are: `uv run cover.py` runs there. */
const marks = new URL("../../brand/marks/", import.meta.url);

/** Runs brand/marks/cover.py with uv, the facts on its stdin. */
const renderWithUv = (facts: CoverFacts) =>
  Effect.tryPromise({
    try: async () => {
      const out = join(tmpdir(), `allthings-cover-${crypto.randomUUID()}.png`);
      const child = Bun.spawn(
        ["uv", "run", "--locked", "--quiet", "cover.py", "--out", out],
        {
          cwd: Bun.fileURLToPath(marks),
          stdin: new TextEncoder().encode(JSON.stringify(facts)),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      const file = Bun.file(out);
      try {
        if (code !== 0) throw new Error(stderr.trim() || `exit ${code}`);
        return new Uint8Array(await file.arrayBuffer());
      } finally {
        if (await file.exists()) await file.delete();
      }
    },
    catch: (cause) =>
      new CoverUnrendered({
        reason: `brand/marks/cover.py could not draw the cover: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

export class CoverRenderer extends Context.Service<
  CoverRenderer,
  CoverRendererShape
>()("allthings/CoverRenderer") {
  /** The brand's template, run with uv (brand/marks/README.md). */
  static readonly layer = Layer.succeed(
    CoverRenderer,
    CoverRenderer.of({ render: renderWithUv }),
  );
}
