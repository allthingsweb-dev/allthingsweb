import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { ConfigProvider, Effect } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../src/approval.ts";
import { rolledBack } from "../src/planning/dry-run.ts";
import {
  decide,
  getProposal,
  listProposals,
  planDecision,
  proposalLimits,
  readProposal,
  recordProposal,
} from "../src/proposals.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * Talk proposals (src/proposals.ts): read in with a reason per field,
 * recorded by an organizer, listed oldest first, and accepted, declined or
 * removed exactly as a dry run showed it. In the studio's run
 * (`bun run test:studio`) every statement here runs as the studio.
 */

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer(db))));

const failure = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(sqlLayer(db)), Effect.flip),
  ) as Promise<{ readonly message: string }>;

const sent = {
  title: "  Effect in production ",
  abstract:
    "What a year of Effect in a payments service taught us:\r\nerrors as values, retries, and the tests we stopped writing.",
  name: "Ada Lovelace",
  email: "ada@example.com",
  links: ["https://github.com/ada", ""],
  about: "",
};

const proposals = async () =>
  (
    await db.query<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count FROM planning.proposals GROUP BY status ORDER BY status`,
    )
  ).rows;

describe("reading a proposal in", () => {
  test("trims it, reads its line endings as \\n, drops blanks, and fills the format", () => {
    expect(readProposal(sent)).toEqual({
      ok: true,
      proposal: {
        title: "Effect in production",
        abstract:
          "What a year of Effect in a payments service taught us:\nerrors as values, retries, and the tests we stopped writing.",
        format: "talk",
        name: "Ada Lovelace",
        email: "ada@example.com",
        about: null,
        links: ["https://github.com/ada"],
        notes: null,
      },
    });
  });

  test("says every problem, one per field, in words a person can act on", () => {
    const read = readProposal({
      title: "x".repeat(proposalLimits.title + 1),
      abstract: "Too short.",
      format: "keynote",
      name: "Ada\nLovelace",
      email: "ada at example",
      links: ["http://insecure.example", "https://fine.example"],
      website: "https://spam.example",
    });
    expect(read).toEqual({
      ok: false,
      problems: [
        { field: "proposal", message: 'Unknown field: "website".' },
        {
          field: "title",
          message: "The title is 121 characters; keep it to 120.",
        },
        {
          field: "abstract",
          message:
            "The abstract is 10 characters; say a little more, at least 40.",
        },
        {
          field: "format",
          message: "The format is one of talk, lightning, demo.",
        },
        { field: "name", message: "Your name fits on one line." },
        {
          field: "email",
          message: '"ada at example" doesn\'t read as an email address.',
        },
        {
          field: "links",
          message: '"http://insecure.example" isn\'t an https:// link.',
        },
      ],
    });
  });

  test("asks for what is missing, and refuses what isn't an object", () => {
    expect(readProposal({})).toEqual({
      ok: false,
      problems: [
        { field: "title", message: "The title is missing." },
        { field: "abstract", message: "The abstract is missing." },
        { field: "name", message: "Your name is missing." },
        {
          field: "email",
          message: "An email is missing: it is how we answer you.",
        },
      ],
    });
    expect(readProposal(["a"])).toEqual({
      ok: false,
      problems: [
        { field: "proposal", message: "A proposal is an object of fields." },
      ],
    });
    const wrong = readProposal({ ...sent, title: 5, links: "https://a.b" });
    expect(wrong.ok ? [] : wrong.problems).toEqual([
      { field: "title", message: "title: Expected string." },
      { field: "links", message: "links: Expected array." },
    ]);
  });

  test("holds links to four, each https, none twice", () => {
    const links = (given: ReadonlyArray<string>) => {
      const read = readProposal({ ...sent, links: given });
      return read.ok ? "ok" : read.problems[0]!.message;
    };
    expect(links(["https://a.example", "https://a.example"])).toBe(
      "A link is given twice.",
    );
    expect(links([1, 2, 3, 4, 5].map((n) => `https://${n}.example`))).toBe(
      "5 links; give at most 4.",
    );
    expect(links([`https://${"a".repeat(250)}.example`])).toBe(
      "A link is 266 characters; keep each to 255.",
    );
    expect(links(["https://a.example/with space"])).toBe(
      '"https://a.example/with space" isn\'t an https:// link.',
    );
  });
});

describe("recording a proposal", () => {
  test("stores it as the organizer's, new, and lists it oldest first", async () => {
    const first = await run(recordProposal(sent));
    expect(first).toMatchObject({
      title: "Effect in production",
      format: "talk",
      email: "ada@example.com",
      links: ["https://github.com/ada"],
      about: null,
      source: "organizer",
      recordedBy: "test/core",
      status: "new",
      decidedAt: null,
      decidedBy: null,
    });
    const second = await run(
      recordProposal({
        ...sent,
        title: "Lightning: PGlite in the browser",
        format: "lightning",
      }),
    );
    expect((await run(listProposals())).map((one) => one.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(await run(listProposals("accepted"))).toEqual([]);
    expect(await run(getProposal(first.id.toUpperCase()))).toEqual(first);
  });

  test("refuses what reads wrong, saying why, and keeps nothing", async () => {
    expect(
      (await failure(recordProposal({ ...sent, email: "nope" }))).message,
    ).toBe('"nope" doesn\'t read as an email address.');
    expect(await proposals()).toEqual([]);
  });

  test("a dry run keeps nothing", async () => {
    const proposal = await run(rolledBack(recordProposal(sent)));
    expect(proposal.title).toBe("Effect in production");
    expect(await proposals()).toEqual([]);
  });

  test("needs ALLTHINGS_ACTOR", async () => {
    const refused = await Effect.runPromise(
      recordProposal(sent).pipe(
        Effect.provide(sqlLayer(db)),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
        Effect.flip,
      ),
    );
    expect(refused.message).toContain("set ALLTHINGS_ACTOR");
    expect(await proposals()).toEqual([]);
  });
});

describe("the table", () => {
  test("holds whatever writes to the same limits", async () => {
    // Each its own title, so the intake trigger never takes one for another sent twice.
    let tries = 0;
    const insert = (columns: string, values: string) =>
      db
        .exec(
          `INSERT INTO planning.proposals (${columns}) VALUES (${values.replace("{n}", String(++tries))})`,
        )
        .then(
          () => undefined,
          (error: Error) => error.message,
        );
    const base = `'T{n}', 'An abstract.', 'Ada', 'ada@example.com'`;
    const columns = `title, abstract, name, email`;
    expect(await insert(`${columns}, source`, `${base}, 'site'`)).toBe(
      undefined,
    );
    for (const [extra, value, check] of [
      [`source`, `'mail'`, "proposals_source_check"],
      [`source`, `'organizer'`, "proposals_organizer_check"],
      [`source, recorded_by`, `'site', 'erik'`, "proposals_organizer_check"],
      [
        `source, recorded_by`,
        `'organizer', 'Erik T'`,
        "proposals_recorded_by_check",
      ],
      [`source, links`, `'site', '{http://a.b}'`, "proposals_links_check"],
      [`source, links`, `'site', '{"https://a b"}'`, "proposals_links_check"],
      [
        `source, links`,
        `'site', '{https://a,https://b,https://c,https://d,https://e}'`,
        "proposals_links_check",
      ],
      [`source, status`, `'site', 'accepted'`, "proposals_decided_check"],
      [`source, format`, `'site', 'keynote'`, "proposals_format_check"],
    ] as const) {
      expect(
        await insert(`${columns}, ${extra}`, `${base}, ${value}`),
      ).toContain(check);
    }
    expect(
      await insert(
        `${columns}, source, links`,
        `${base}, 'site', '{https://a.example,https://b.example/x?y=1}'`,
      ),
    ).toBe(undefined);
    expect(
      await insert(
        `title, abstract, name, email, source`,
        `E'Two\\nlines', 'An abstract.', 'Ada', 'ada@example.com', 'site'`,
      ),
    ).toContain("proposals_title_check");
  });
});

describe("deciding a proposal", () => {
  test("a dry run shows the proposal, the decision and its token, and changes nothing", async () => {
    const proposal = await run(recordProposal(sent));
    const planned = await run(
      planDecision(proposal.id, { kind: "accept", note: "  Great fit. " }),
    );
    expect(planned).toEqual({
      proposal,
      decision: { kind: "accept", note: "Great fit." },
      token: await Effect.runPromise(
        approvalToken({
          proposal,
          decision: { kind: "accept", note: "Great fit." },
        }),
      ),
    });
    expect(await proposals()).toEqual([{ status: "new", count: 1 }]);
  });

  test("accepts and declines exactly as approved, saying who and why", async () => {
    const proposal = await run(recordProposal(sent));
    const { token } = await run(
      planDecision(proposal.id, { kind: "accept", note: "Great fit." }),
    );
    const accepted = await run(
      decide(proposal.id, { kind: "accept", note: "Great fit." }, token),
    );
    expect(accepted).toMatchObject({
      status: "accepted",
      decidedBy: "test/core",
      decisionNote: "Great fit.",
    });
    expect(accepted.decidedAt).not.toBeNull();
    expect(await run(listProposals())).toEqual([]);
    expect(await run(listProposals("accepted"))).toEqual([accepted]);

    // Already accepted: nothing to change.
    expect(
      (await failure(planDecision(proposal.id, { kind: "accept" }))).message,
    ).toContain("is already accepted");

    const declining = await run(planDecision(proposal.id, { kind: "decline" }));
    const declined = await run(
      decide(proposal.id, { kind: "decline" }, declining.token),
    );
    expect(declined).toMatchObject({ status: "declined", decisionNote: null });
  });

  test("refuses a token for anything else: another decision, another note, a proposal changed since", async () => {
    const proposal = await run(recordProposal(sent));
    const { token } = await run(planDecision(proposal.id, { kind: "accept" }));
    for (const other of [
      { kind: "decline" as const },
      { kind: "accept" as const, note: "Changed my mind about why." },
    ]) {
      expect(
        (await failure(decide(proposal.id, other, token))).message,
      ).toContain(`has changed since ${token} was approved`);
    }
    await db.exec(
      `UPDATE planning.proposals SET updated_at = now() + interval '1 second'`,
    );
    expect(
      (await failure(decide(proposal.id, { kind: "accept" }, token))).message,
    ).toContain(`has changed since ${token} was approved`);
    expect(
      (await failure(decide(proposal.id, { kind: "accept" }, "not-a-token")))
        .message,
    ).toContain("is not an approval token");
    expect(await proposals()).toEqual([{ status: "new", count: 1 }]);
  });

  test("removes one exactly as approved, and takes no note", async () => {
    const proposal = await run(recordProposal(sent));
    expect(
      (
        await failure(
          planDecision(proposal.id, { kind: "remove", note: "Spam." }),
        )
      ).message,
    ).toContain("takes no note");
    const { token } = await run(planDecision(proposal.id, { kind: "remove" }));
    expect(await run(decide(proposal.id, { kind: "remove" }, token))).toEqual(
      proposal,
    );
    expect(await proposals()).toEqual([]);
    expect((await failure(getProposal(proposal.id))).message).toBe(
      `No proposal has the id ${proposal.id}.`,
    );
  });

  test("names what it can't find", async () => {
    expect((await failure(getProposal("nope"))).message).toBe(
      "nope is not a proposal's id: proposals list shows them.",
    );
  });
});
