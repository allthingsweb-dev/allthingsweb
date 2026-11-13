import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DateTime, Duration, Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import sharp from "sharp";
import { published } from "../src/catalog.ts";

/**
 * An evening's photos from Erik's Apple Photos library, on his Mac, for the
 * agent running it: what was taken from an hour before it to an hour after,
 * read with osxphotos (`uvx`, pinned) and never written to. Each photo's
 * own preview comes out into a private staging folder outside any
 * repository, a shortlist is drawn from them the same way every time, and
 * only the photos picked from it are exported at full size, as JPEG, for
 * `bun run photos add`.
 *
 * Guests' faces are theirs: a close-up (one to three faces) goes on the
 * shortlist only when every face in it is named in the library as someone
 * on the evening's stage or running it. Any other close-up is listed for
 * Erik to pick, never shortlisted. Crowds, rooms and the stage are fine.
 */

/** osxphotos, pinned, run by uv. */
export const osxphotos = ["uvx", "--python", "3.12", "osxphotos@0.78.1"];

/** San Francisco, where the evenings are, for the staging folder's date. */
const zone = "America/Los_Angeles";

/** How long before an evening, and after it, a photo may be of it. */
export const photoMargin = Duration.hours(1);

/** The instant as an ISO date-time with San Francisco's offset then. */
export function sfIso(instant: DateTime.Utc): string {
  const date = DateTime.toDateUtc(instant);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const offset = (parts["timeZoneName"] ?? "GMT").replace(/^GMT/, "");
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}${offset === "" ? "+00:00" : offset}`;
}

/** The library's window for an evening: an hour either side of it. */
export function libraryWindow(
  startsAt: DateTime.Utc,
  endsAt: DateTime.Utc,
): { readonly from: string; readonly to: string } {
  return {
    from: sfIso(DateTime.subtractDuration(startsAt, photoMargin)),
    to: sfIso(DateTime.addDuration(endsAt, photoMargin)),
  };
}

/** The private staging folder for the evening starting at `startsAt`. */
export const stagingFolder = (startsAt: DateTime.Utc): string =>
  join(homedir(), "Desktop", "allthings-photos", sfIso(startsAt).slice(0, 10));

/** What osxphotos says about a photo, as far as the shortlist reads it. */
export const LibraryPhoto = Schema.Struct({
  uuid: Schema.String,
  original_filename: Schema.String,
  date: Schema.String,
  ismissing: Schema.Boolean,
  path_derivatives: Schema.Array(Schema.String),
  labels: Schema.Array(Schema.String),
  persons: Schema.Array(Schema.String),
  face_info: Schema.Array(Schema.Unknown),
  score: Schema.Struct({ overall: Schema.NullOr(Schema.Number) }),
});
export type LibraryPhoto = typeof LibraryPhoto.Type;

/** What a photo shows, for variety. */
export type PhotoKind = "stage" | "crowd" | "room" | "close-up";

const stageLabels = new Set([
  "Podium",
  "Stage",
  "Presentation",
  "Projector",
  "Projection Screen",
  "Screen",
  "Lectern",
  "Microphone",
  "Concert",
  "Performance",
]);

/** A photo's kind, from its faces and the library's labels. */
export function kindOf(photo: LibraryPhoto): PhotoKind {
  const faces = photo.face_info.length;
  if (photo.labels.some((label) => stageLabels.has(label))) return "stage";
  if (faces >= 4 || photo.labels.includes("Crowd")) return "crowd";
  if (faces === 0) return "room";
  return "close-up";
}

/** A name as compared: case, spacing and accents aside. */
const nameKey = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Whether a close-up may be shortlisted: every face in it is named in the
 * library, and each name is one of `cleared` (the evening's speakers and
 * organizers). A face the library hasn't named is a guest's.
 */
export function cleared(
  photo: LibraryPhoto,
  people: ReadonlyArray<string>,
): boolean {
  const known = new Set(people.map(nameKey));
  return (
    photo.persons.length >= photo.face_info.length &&
    photo.persons.length > 0 &&
    photo.persons.every(
      (person) => person !== "_UNKNOWN_" && known.has(nameKey(person)),
    )
  );
}

/** What the shortlist measures of a preview. */
export interface Measured {
  readonly photo: LibraryPhoto;
  readonly preview: string;
  readonly kind: PhotoKind;
  /** How sharp: the variance of its Laplacian at 512 pixels, greyscale. */
  readonly sharpness: number;
  /** A 64-bit difference hash, as 16 hex digits. */
  readonly hash: string;
}

/** How many bits two hashes differ in. */
export function hashDistance(a: string, b: string): number {
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (bits > 0n) {
    count += Number(bits & 1n);
    bits >>= 1n;
  }
  return count;
}

/** Hashes this close or closer are the same shot. */
export const sameShot = 10;

/** A photo less sharp than this share of the set's median is blurred. */
export const blurShare = 0.25;

/** The image at `path`: its sharpness and difference hash. */
export const measure = async (path: string) => {
  const grey = sharp(path).rotate().greyscale();
  const { data, info } = await grey
    .clone()
    .resize({ width: 512, height: 512, fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  // The Laplacian's variance: low when nothing has an edge.
  const { width, height } = info;
  const values: Array<number> = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = (dx: number, dy: number) =>
        data[(y + dy) * width + (x + dx)] ?? 0;
      values.push(at(-1, 0) + at(1, 0) + at(0, -1) + at(0, 1) - 4 * at(0, 0));
    }
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const sharpness =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const tiny = await grey
    .clone()
    .resize({ width: 9, height: 8, fit: "fill" })
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = tiny[row * 9 + col] ?? 0;
      const right = tiny[row * 9 + col + 1] ?? 0;
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return { sharpness, hash: hash.toString(16).padStart(16, "0") };
};

/** Why a photo is not on the shortlist. */
export type Left =
  | { readonly why: "blurred"; readonly uuid: string }
  | { readonly why: "same shot"; readonly uuid: string; readonly as: string }
  | { readonly why: "for Erik"; readonly uuid: string }
  | { readonly why: "past the limit"; readonly uuid: string };

export interface Shortlist {
  /** In the order to show them, kinds taken in turn. */
  readonly picks: ReadonlyArray<Measured>;
  /** Close-ups of people not known to be on stage or running it. */
  readonly forErik: ReadonlyArray<Measured>;
  readonly left: ReadonlyArray<Left>;
}

/** The order kinds are taken in, one of each in turn. */
const kindOrder: ReadonlyArray<PhotoKind> = [
  "stage",
  "crowd",
  "room",
  "close-up",
];

const overall = (m: Measured) => m.photo.score.overall ?? -1;

/** Best first: the library's overall score, then the sharper, then by uuid. */
const better = (a: Measured, b: Measured) =>
  overall(b) - overall(a) ||
  b.sharpness - a.sharpness ||
  a.photo.uuid.localeCompare(b.photo.uuid);

/**
 * The shortlist, the same for the same photos every time: blurred photos
 * out (less sharp than {@link blurShare} of the set's median), one of each
 * run of the same shot (hashes within {@link sameShot} bits; the better
 * stays), close-ups not {@link cleared} set aside for Erik, then up to
 * `max`, taking the best of each kind in turn for variety.
 */
export function shortlist(
  measured: ReadonlyArray<Measured>,
  people: ReadonlyArray<string>,
  max: number,
): Shortlist {
  const left: Array<Left> = [];
  const sorted = measured.map((m) => m.sharpness).toSorted((a, b) => a - b);
  const median =
    sorted.length === 0
      ? 0
      : (sorted[Math.floor((sorted.length - 1) / 2)] ?? 0);
  const focused = measured.filter((m) => {
    if (m.sharpness >= median * blurShare) return true;
    left.push({ why: "blurred", uuid: m.photo.uuid });
    return false;
  });
  const kept: Array<Measured> = [];
  for (const m of focused.toSorted(better)) {
    const twin = kept.find((k) => hashDistance(k.hash, m.hash) <= sameShot);
    if (twin === undefined) kept.push(m);
    else
      left.push({ why: "same shot", uuid: m.photo.uuid, as: twin.photo.uuid });
  }
  const forErik = kept.filter(
    (m) => m.kind === "close-up" && !cleared(m.photo, people),
  );
  for (const m of forErik) left.push({ why: "for Erik", uuid: m.photo.uuid });
  const queues = kindOrder.map((kind) =>
    kept.filter((m) => m.kind === kind && !forErik.includes(m)),
  );
  const picks: Array<Measured> = [];
  while (picks.length < max && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined && picks.length < max) picks.push(next);
    }
  }
  for (const queue of queues) {
    for (const m of queue)
      left.push({ why: "past the limit", uuid: m.photo.uuid });
  }
  return { picks, forErik, left };
}

/** macOS refused osxphotos something; what Erik must allow is in `allow`. */
export class LibraryBlocked extends Schema.TaggedError<LibraryBlocked>()(
  "LibraryBlocked",
  { allow: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `${this.allow}\n(${this.detail})`;
  }
}

/** osxphotos failed for another reason. */
export class LibraryError extends Schema.TaggedError<LibraryError>()(
  "LibraryError",
  { detail: Schema.String },
) {
  override get message(): string {
    return `osxphotos failed: ${this.detail}`;
  }
}

/** What macOS says when it refuses, and what to allow for each. */
export function blockedBy(output: string): string | null {
  if (/could not get authorization to access Photos library/i.test(output)) {
    return "macOS refused Photos access. In System Settings > Privacy & Security > Photos, give the app this runs in (Terminal, or Claude) Full Access, then run it again.";
  }
  if (
    /Operation not permitted|unable to open database|Full Disk Access/i.test(
      output,
    )
  ) {
    return "macOS refused to read the Photos library. In System Settings > Privacy & Security > Full Disk Access, turn on the app this runs in (Terminal, or Claude), then run it again.";
  }
  return null;
}

/** Runs osxphotos with `args`; its standard output, or why it failed. */
export const runOsxphotos = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const done = yield* Effect.promise(async () => {
      const child = Bun.spawn([...osxphotos, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code };
    });
    const output = `${done.stdout}\n${done.stderr}`;
    const blocked = blockedBy(output);
    if (blocked !== null) {
      return yield* new LibraryBlocked({
        allow: blocked,
        detail: output.trim().split("\n").slice(-2).join(" "),
      });
    }
    if (done.code !== 0) {
      return yield* new LibraryError({
        detail: done.stderr.trim().split("\n").slice(-3).join(" "),
      });
    }
    return done.stdout;
  });

/** The photos taken in the window, read from the library, not written. */
export const queryLibrary = (window: { from: string; to: string }) =>
  runOsxphotos([
    "query",
    "--from-date",
    window.from,
    "--to-date",
    window.to,
    "--only-photos",
    "--not-screenshot",
    "--json",
  ]).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Array(LibraryPhoto)),
      ),
    ),
  );

/** A photo's largest local preview, which the library keeps even for one in iCloud. */
export const largestPreview = (photo: LibraryPhoto) =>
  Effect.promise(async () => {
    let best: { path: string; size: number } | null = null;
    for (const path of photo.path_derivatives) {
      const size = await stat(path).then(
        (s) => s.size,
        () => -1,
      );
      if (size > 0 && (best === null || size > best.size))
        best = { path, size };
    }
    return best?.path ?? null;
  });

/** Copies each photo's preview into `folder`/previews, named by its uuid. */
export const stagePreviews = (
  photos: ReadonlyArray<LibraryPhoto>,
  folder: string,
) =>
  Effect.gen(function* () {
    const previews = join(folder, "previews");
    yield* Effect.promise(() => mkdir(previews, { recursive: true }));
    const staged: Array<{ photo: LibraryPhoto; preview: string }> = [];
    const noPreview: Array<string> = [];
    for (const photo of photos) {
      const source = yield* largestPreview(photo);
      if (source === null) {
        noPreview.push(photo.uuid);
        continue;
      }
      const preview = join(previews, `${photo.uuid}.jpeg`);
      yield* Effect.promise(() => copyFile(source, preview));
      staged.push({ photo, preview });
    }
    return { staged, noPreview };
  });

/**
 * Exports the photos with `uuids` at full size, as JPEG named by uuid, into
 * `folder`/candidates. One only in iCloud is downloaded through Photos
 * (PhotoKit), which macOS must allow.
 */
export const exportOriginals = (uuids: ReadonlyArray<string>, folder: string) =>
  Effect.gen(function* () {
    const candidates = join(folder, "candidates");
    yield* Effect.promise(() => mkdir(candidates, { recursive: true }));
    yield* runOsxphotos([
      "export",
      candidates,
      ...uuids.flatMap((uuid) => ["--uuid", uuid]),
      "--convert-to-jpeg",
      "--jpeg-ext",
      "jpeg",
      "--filename",
      "{uuid}",
      "--skip-live",
      "--download-missing",
      "--use-photokit",
      "--update",
    ]);
    return uuids.map((uuid) => join(candidates, `${uuid}.jpeg`));
  });

const EveningRow = Schema.Struct({
  slug: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  people: Schema.Array(Schema.String),
});

/** No published evening has this slug or short link. */
export class PhotoEveningNotFound extends Schema.TaggedError<PhotoEveningNotFound>()(
  "PhotoEveningNotFound",
  { slug: Schema.String },
) {
  override get message(): string {
    return `No published evening has the slug or short link "${this.slug}"`;
  }
}

/**
 * The published evening at `slug` (its long slug or a short link): when it
 * was, and the names of everyone on its stage or running it.
 */
export const eveningForPhotos = (slug: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql`
      SELECT e.slug, e.start_date AS "startDate", e.end_date AS "endDate",
        COALESCE((
          SELECT json_agg(p.name ORDER BY p.name) FROM profiles p
          WHERE p.id IN (
            SELECT profile_id FROM event_people WHERE event_id = e.id
            UNION
            SELECT ts.speaker_id FROM talk_speakers ts
            JOIN event_talks et ON et.talk_id = ts.talk_id
            WHERE et.event_id = e.id)
        ), '[]'::json) AS people
      FROM events e
      WHERE ${published(sql, "e")} AND (e.slug = ${slug} OR e.id IN (
        SELECT event_id FROM event_slugs WHERE slug = ${slug}))`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(EveningRow))),
    );
    const [row] = rows;
    if (row === undefined) return yield* new PhotoEveningNotFound({ slug });
    return row;
  });

/** The library's answer kept beside the previews, as osxphotos gave it. */
export const readStaged = (folder: string) =>
  Effect.promise(() => readFile(join(folder, "library.json"), "utf8")).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Array(LibraryPhoto)),
      ),
    ),
  );
