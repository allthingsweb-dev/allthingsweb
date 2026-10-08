import { describe, expect, test } from "bun:test";
import { newAnswersKey } from "../../infra/scripts/collab-answers-key.ts";
import {
  answerKey,
  keyIdOf,
  keyProblem,
  open,
  type RoundAnswers,
  seal,
  type SealedFor,
} from "../src/collab/seal.ts";

/**
 * A round's answer key sealed at rest (src/collab/seal.ts): it opens with
 * its key for its own row alone, and nothing of it shows in what is stored.
 */

const key = newAnswersKey();
const other = newAnswersKey();

const row: SealedFor = {
  submissionId: "a5000000-0000-4000-8000-000000000001",
  eventId: "e0000000-0000-4000-8000-000000000001",
  roundId: "a1000000-0000-4000-8000-000000000001",
  collaboratorId: "a4000000-0000-4000-8000-000000000001",
  stage: "final",
};

const answers: RoundAnswers = {
  questions: [
    {
      type: "open",
      question: "Name the three primitives an MCP server exposes.",
      answer: "Tools, resources and prompts.",
      alsoAccept: "",
      source: "https://modelcontextprotocol.io/specification",
      whyFair: "It's the spec's first page.",
      difficulty: "gettable",
    },
  ],
  backups: [
    {
      type: null,
      question: "What does xmin hold?",
      answer: "The inserting transaction's id.",
      alsoAccept: "the xid that made the row version",
      source: "https://www.postgresql.org/docs/17/ddl-system-columns.html",
      whyFair: "Documented.",
      difficulty: "deep",
    },
  ],
};

describe("a sealed round", () => {
  test("opens with its key, for its row", async () => {
    const sealed = await seal(key, row, answers);
    expect(sealed.nonce.byteLength).toBe(12);
    expect(sealed.keyId).toBe(await keyIdOf(key));
    expect(sealed.keyId).toMatch(/^k-[0-9a-f]{8}$/);
    expect(await open([key], row, sealed)).toEqual(answers);
  });

  test("shows nothing of what it holds", async () => {
    const sealed = await seal(key, row, answers);
    const stored = new TextDecoder("latin1").decode(sealed.ciphertext);
    for (const word of [
      "primitives",
      "Tools",
      "xmin",
      "modelcontextprotocol",
    ]) {
      expect(stored).not.toContain(word);
    }
    // A fresh nonce each time: the same answers never seal the same.
    const again = await seal(key, row, answers);
    expect(again.ciphertext).not.toEqual(sealed.ciphertext);
  });

  test("doesn't open moved to another row, round, host or stage", async () => {
    const sealed = await seal(key, row, answers);
    for (const moved of [
      { ...row, submissionId: "a5000000-0000-4000-8000-000000000002" },
      { ...row, eventId: "e0000000-0000-4000-8000-000000000002" },
      { ...row, roundId: "a1000000-0000-4000-8000-000000000002" },
      { ...row, collaboratorId: "a4000000-0000-4000-8000-000000000002" },
      { ...row, stage: "draft" as const },
    ]) {
      expect(await open([key], moved, sealed)).toBeUndefined();
    }
  });

  test("doesn't open with another key, or tampered with", async () => {
    const sealed = await seal(key, row, answers);
    expect(await open([other], row, sealed)).toBeUndefined();
    const flipped = new Uint8Array(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(
      await open([key], row, { ...sealed, ciphertext: flipped }),
    ).toBeUndefined();
  });

  test("opens with the key it names among several: a rotation's previous one", async () => {
    const old = await seal(other, row, answers);
    expect(await open([key, other], row, old)).toEqual(answers);
  });
});

test("a key is 32 bytes of base64url, and a new one is", () => {
  expect(keyProblem(key)).toBeUndefined();
  expect(newAnswersKey()).not.toBe(key);
  for (const bad of ["", "short", `${key}=`, key.slice(1), "+".repeat(43)]) {
    expect(keyProblem(bad)).toBe(
      "COLLAB_ANSWERS_KEY is not 32 bytes of base64url",
    );
  }
});

test("the answer key reads in the brief's format", () => {
  expect(
    answerKey({ position: 6, title: "Agents", hosts: ["Abhi"] }, answers),
  ).toBe(
    [
      "Round 6: Agents (host: Abhi)",
      [
        "Q1. [type: open]",
        "Question: Name the three primitives an MCP server exposes.",
        "Answer: Tools, resources and prompts.",
        "Source: https://modelcontextprotocol.io/specification",
        "Why it's fair: It's the spec's first page.",
        "Difficulty: gettable",
      ].join("\n"),
      [
        "Backup 1. [type: ?]",
        "Question: What does xmin hold?",
        "Answer: The inserting transaction's id.",
        "Also accept: the xid that made the row version",
        "Source: https://www.postgresql.org/docs/17/ddl-system-columns.html",
        "Why it's fair: Documented.",
        "Difficulty: deep",
      ].join("\n"),
    ].join("\n\n"),
  );
});
