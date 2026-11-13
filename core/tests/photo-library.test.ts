import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DateTime, Effect, Exit } from "effect";
import sharp from "sharp";
import {
  blockedBy,
  cleared,
  ExportMissing,
  exportOriginals,
  hashDistance,
  isOwn,
  isStill,
  kindOf,
  type LibraryPhoto,
  libraryWindow,
  type Measured,
  measure,
  sfIso,
  shortlist,
} from "../scripts/photo-library.ts";

/**
 * An evening's photos from the Photos library (scripts/photo-library.ts):
 * the window, what a photo shows, whose faces may be shortlisted, and the
 * shortlist itself, on photos described here and images Sharp draws. No
 * test reads a Photos library.
 */

const at = (iso: string) => DateTime.makeUnsafe(iso);

const photo = (overrides: Partial<LibraryPhoto> = {}): LibraryPhoto => ({
  uuid: "A",
  original_filename: "IMG_1.HEIC",
  date: "2026-09-15T18:00:00-07:00",
  ismissing: true,
  path_derivatives: [],
  labels: [],
  persons: [],
  face_info: [],
  score: { overall: 0.5 },
  shared: false,
  syndicated: false,
  shared_library: false,
  shared_moment: false,
  ...overrides,
});

const faces = (n: number) => Array.from({ length: n }, () => ({}));

describe("the window", () => {
  test("an hour either side, in San Francisco's time, summer or winter", () => {
    // agent-setups: 17:30–20:30 PDT.
    expect(
      libraryWindow(at("2026-09-16T00:30:00Z"), at("2026-09-16T03:30:00Z")),
    ).toEqual({
      from: "2026-09-15T16:30:00-07:00",
      to: "2026-09-15T21:30:00-07:00",
    });
    // aie: 19:00–22:00 PST, after the clocks went back.
    expect(
      libraryWindow(at("2026-11-12T03:00:00Z"), at("2026-11-12T06:00:00Z")),
    ).toEqual({
      from: "2026-11-11T18:00:00-08:00",
      to: "2026-11-11T23:00:00-08:00",
    });
  });

  test("the staging folder's date is the evening's in San Francisco", () => {
    expect(sfIso(at("2026-11-12T03:00:00Z")).slice(0, 10)).toBe("2026-11-11");
  });
});

describe("whose photo it is", () => {
  test("only Erik's own: nothing shared, Shared with You, in a Shared Library or a shared moment", () => {
    expect(isOwn(photo())).toBe(true);
    for (const shared of [
      { shared: true },
      { syndicated: true },
      { shared_library: true },
      { shared_moment: true },
    ]) {
      expect(isOwn(photo(shared))).toBe(false);
    }
  });

  test("a photo the library says nothing of, on any of the four, is not known to be his", () => {
    for (const field of [
      "shared",
      "syndicated",
      "shared_library",
      "shared_moment",
    ] as const) {
      expect(isOwn(photo({ [field]: null }))).toBe(false);
      const { [field]: _, ...missing } = photo();
      expect(isOwn(missing)).toBe(false);
    }
  });

  test("a preview is a still JPEG, never a Live Photo's movie", () => {
    expect(isStill("/lib/derivatives/A_1_105_c.jpeg")).toBe(true);
    expect(isStill("/lib/derivatives/A_4_5005_c.JPG")).toBe(true);
    expect(isStill("/lib/derivatives/A_3_105_c.mov")).toBe(false);
  });
});

describe("what a photo shows", () => {
  test("the stage by its labels, a crowd by faces or label, a room with none, else a close-up", () => {
    expect(
      kindOf(photo({ labels: ["People", "Podium"], face_info: faces(1) })),
    ).toBe("stage");
    expect(kindOf(photo({ face_info: faces(9) }))).toBe("crowd");
    expect(kindOf(photo({ labels: ["Crowd"], face_info: faces(2) }))).toBe(
      "crowd",
    );
    expect(kindOf(photo({ labels: ["Chair"] }))).toBe("room");
    expect(kindOf(photo({ face_info: faces(1) }))).toBe("close-up");
  });
});

describe("whose close-up may be shortlisted", () => {
  const people = ["Erik Thorelli", "Andre Landgraf"];
  test("every face named in the library as someone on stage or running it", () => {
    expect(
      cleared(
        photo({ persons: ["erik  thorelli"], face_info: faces(1) }),
        people,
      ),
    ).toBe(true);
  });
  test("an unnamed face is a guest's", () => {
    expect(
      cleared(
        photo({ persons: ["Erik Thorelli", "_UNKNOWN_"], face_info: faces(2) }),
        people,
      ),
    ).toBe(false);
    expect(cleared(photo({ persons: [], face_info: faces(1) }), people)).toBe(
      false,
    );
  });
  test("a named face that isn't on the evening's stage is a guest's", () => {
    expect(
      cleared(
        photo({ persons: ["Someone Else"], face_info: faces(1) }),
        people,
      ),
    ).toBe(false);
  });
});

describe("measuring", () => {
  const draw = async (svg: string) => {
    const path = `${process.env["TMPDIR"] ?? "/tmp"}/photo-library-${Bun.hash(svg)}.png`;
    await sharp(Buffer.from(svg)).png().toFile(path);
    return path;
  };
  const flat = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#888"/></svg>`;
  const stripes = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#fff"/>${Array.from(
    { length: 40 },
    (_, i) => `<rect x="${i * 10}" width="5" height="300" fill="#000"/>`,
  ).join("")}</svg>`;

  test("a flat image has no edges; stripes are sharp", async () => {
    const plain = await measure(await draw(flat));
    const sharpImage = await measure(await draw(stripes));
    expect(plain.sharpness).toBe(0);
    expect(sharpImage.sharpness).toBeGreaterThan(1000);
  });

  test("the same image hashes the same, and hashes are 64 bits", async () => {
    const a = await measure(await draw(stripes));
    const b = await measure(await draw(stripes));
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashDistance(a.hash, b.hash)).toBe(0);
    expect(hashDistance("0000000000000000", "000000000000000f")).toBe(4);
  });
});

describe("the shortlist", () => {
  const m = (
    uuid: string,
    overrides: Partial<Omit<Measured, "photo">> & {
      readonly photo?: Partial<LibraryPhoto>;
    } = {},
  ): Measured => {
    const p = photo({ uuid, ...overrides.photo });
    return {
      preview: `${uuid}.jpeg`,
      kind: overrides.kind ?? kindOf(p),
      sharpness: overrides.sharpness ?? 100,
      hash: overrides.hash ?? uuid.repeat(16),
      photo: p,
    };
  };

  test("blurred out, one of each shot, close-ups of guests for Erik, kinds in turn", () => {
    const set = [
      m("1", { photo: { labels: ["Podium"], score: { overall: 0.9 } } }),
      m("2", { photo: { labels: ["Podium"], score: { overall: 0.8 } } }),
      // The same shot as 1, and worse.
      m("3", {
        photo: { labels: ["Podium"], score: { overall: 0.7 } },
        hash: "1111111111111110",
      }),
      m("a", { photo: { face_info: faces(6), score: { overall: 0.6 } } }),
      m("b", { photo: { labels: ["Chair"], score: { overall: 0.5 } } }),
      // Blurred: well under a quarter of the median.
      m("c", { photo: { labels: ["Chair"] }, sharpness: 5 }),
      // A guest's close-up.
      m("d", { photo: { face_info: faces(1), persons: ["_UNKNOWN_"] } }),
    ];
    const list = shortlist(set, [], 3);
    expect(list.picks.map((p) => p.photo.uuid)).toEqual(["1", "a", "b"]);
    expect(list.forErik.map((p) => p.photo.uuid)).toEqual(["d"]);
    expect(list.left).toEqual([
      { why: "blurred", uuid: "c" },
      { why: "same shot", uuid: "3", as: "1" },
      { why: "for Erik", uuid: "d" },
      { why: "past the limit", uuid: "2" },
    ]);
    // The same photos give the same shortlist, in any order.
    expect(shortlist(set.toReversed(), [], 3)).toEqual(list);
  });

  test("at the limit, the rest of each kind is left out, never dropped", () => {
    const list = shortlist(
      [
        m("1", { photo: { labels: ["Podium"] } }),
        m("a", { photo: { face_info: faces(6) } }),
        m("b", { photo: { labels: ["Chair"] } }),
      ],
      [],
      1,
    );
    expect(list.picks.map((p) => p.photo.uuid)).toEqual(["1"]);
    expect(list.left).toEqual([
      { why: "past the limit", uuid: "a" },
      { why: "past the limit", uuid: "b" },
    ]);
  });

  test("of an even number, the median is the mean of the middle two", () => {
    // Sharpness 5 and 100: the median is 52.5, so 5 is blurred.
    const list = shortlist(
      [m("1", { sharpness: 100 }), m("2", { sharpness: 5 })],
      [],
      8,
    );
    expect(list.picks.map((p) => p.photo.uuid)).toEqual(["1"]);
    expect(list.left).toEqual([{ why: "blurred", uuid: "2" }]);
  });

  test("a close-up of someone on stage is shortlisted", () => {
    const list = shortlist(
      [
        m("e", {
          photo: { face_info: faces(1), persons: ["Ada Lovelace"] },
        }),
      ],
      ["Ada Lovelace"],
      8,
    );
    expect(list.picks.map((p) => p.photo.uuid)).toEqual(["e"]);
    expect(list.forErik).toEqual([]);
  });
});

describe("exporting the picks", () => {
  const evening = () =>
    mkdtemp(join(process.env["TMPDIR"] ?? "/tmp", "photo-library-export-"));

  /**
   * A stand-in for osxphotos: writes `{uuid}.jpeg` for each of `writes`
   * into the folder it's given, dated 2020 as a copied original keeps its
   * own time.
   */
  const fakeExport =
    (writes: ReadonlyArray<string>) => (args: ReadonlyArray<string>) =>
      Effect.promise(async () => {
        const into = args[1] ?? "";
        for (const uuid of writes) {
          const file = join(into, `${uuid}.jpeg`);
          await writeFile(file, "jpeg bytes");
          const old = new Date("2020-01-01T00:00:00Z");
          await utimes(file, old, old);
        }
        return "";
      });

  test("a file the export wrote counts, however old its time; it moves into candidates", async () => {
    const folder = await evening();
    const files = await Effect.runPromise(
      exportOriginals(["A", "B"], folder, fakeExport(["A", "B"])),
    );
    expect(files).toEqual([
      join(folder, "candidates", "A.jpeg"),
      join(folder, "candidates", "B.jpeg"),
    ]);
    // Only the photos: the run's own folder is gone.
    expect((await readdir(join(folder, "candidates"))).toSorted()).toEqual([
      "A.jpeg",
      "B.jpeg",
    ]);
  });

  test("a photo the export didn't write fails it, even with an earlier export there", async () => {
    const folder = await evening();
    await Effect.runPromise(exportOriginals(["B"], folder, fakeExport(["B"])));
    const exit = await Effect.runPromiseExit(
      exportOriginals(["A", "B"], folder, fakeExport(["A"])),
    );
    expect(exit).toEqual(Exit.fail(new ExportMissing({ uuids: ["B"] })));
    // Nothing moved: candidates holds only the earlier export.
    expect(await readdir(join(folder, "candidates"))).toEqual(["B.jpeg"]);
  });
});

describe("what macOS refuses", () => {
  test("Photos access for a download, Full Disk Access for the library", () => {
    expect(
      blockedBy("Error: could not get authorization to access Photos library"),
    ).toContain("Privacy & Security > Photos");
    expect(
      blockedBy("sqlite3.OperationalError: unable to open database file"),
    ).toContain("Full Disk Access");
    expect(blockedBy("Exported 3 photos")).toBeNull();
  });
});
