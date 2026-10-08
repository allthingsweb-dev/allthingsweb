import { Schema } from "effect";

/**
 * A round's questions and answer key, sealed at rest (README,
 * "Collaborating on a draft"): the draft preview seals each save before it
 * is stored in `planning.round_submissions`, and only the preview (to show
 * the round's hosts and the organizers) and `bun run collab export` (for
 * the night) open one. Pure WebCrypto, so the Worker and Bun run the same
 * code.
 *
 * - **AES-256-GCM**, with a fresh 12-byte nonce for each save.
 * - **The row is bound in.** Its id, evening, round, collaborator and stage
 *   are the additional data, so a ciphertext moved to another row, or
 *   another host's round, doesn't open.
 * - **Each row names its key.** `key_id` is `k-` and the first 8 hex digits
 *   of the key's SHA-256, so a key can be told apart without being stored,
 *   and rotated: a row opens only with the key it names.
 *
 * The key is `COLLAB_ANSWERS_KEY`: 32 random bytes, base64url, made by
 * infra/scripts/collab-answers-key.ts into 1Password ("allthings collab
 * answers key") and given to the preview Worker as a secret. This doesn't
 * protect against a compromised Worker, which holds the key. It keeps
 * answers out of database dumps, branches of production, and any tool that
 * prints planning's rows.
 */

/** What kind of question it is, as the brief's answer-key format names them. */
export const QuestionType = Schema.Literals([
  "guess the output",
  "spot the bug",
  "name that error",
  "visual",
  "open",
]);
export type QuestionType = typeof QuestionType.Type;

export const Difficulty = Schema.Literals(["gettable", "deep", "brutal"]);
export type Difficulty = typeof Difficulty.Type;

/** One question of a round, as its host writes it. A draft may leave fields empty. */
export const Question = Schema.Struct({
  type: Schema.NullOr(QuestionType),
  question: Schema.String,
  answer: Schema.String,
  alsoAccept: Schema.String,
  source: Schema.String,
  whyFair: Schema.String,
  difficulty: Schema.NullOr(Difficulty),
});
export type Question = typeof Question.Type;

/** A round as sealed: its questions, then its backups. */
export const RoundAnswers = Schema.Struct({
  questions: Schema.Array(Question),
  backups: Schema.Array(Question),
});
export type RoundAnswers = typeof RoundAnswers.Type;

/** The row a seal belongs to: bound into it as additional data. */
export interface SealedFor {
  readonly submissionId: string;
  readonly eventId: string;
  readonly roundId: string;
  readonly collaboratorId: string;
  readonly stage: "draft" | "final";
}

export interface Sealed {
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

const encoder = new TextEncoder();

const fromBase64url = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(
    text.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (text.length % 4)) % 4),
  );
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Why `secret` can't be the answers key, or undefined. */
export function keyProblem(
  secret: string,
  name = "COLLAB_ANSWERS_KEY",
): string | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    return `${name} is not 32 bytes of base64url`;
  }
  return undefined;
}

/** `secret`'s id, as rows name it: k- and 8 hex digits of its SHA-256. */
export async function keyIdOf(secret: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", fromBase64url(secret)),
  );
  return `k-${Array.from(digest.slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const keyOf = (secret: string) =>
  crypto.subtle.importKey("raw", fromBase64url(secret), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);

const additional = (row: SealedFor) =>
  encoder.encode(
    [
      "allthings-round",
      row.submissionId,
      row.eventId,
      row.roundId,
      row.collaboratorId,
      row.stage,
    ].join("\n"),
  );

/** `answers`, sealed for `row` with `secret`. */
export async function seal(
  secret: string,
  row: SealedFor,
  answers: RoundAnswers,
): Promise<Sealed> {
  const problem = keyProblem(secret);
  if (problem !== undefined) throw new Error(problem);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: additional(row) },
      await keyOf(secret),
      encoder.encode(JSON.stringify(answers)),
    ),
  );
  return { keyId: await keyIdOf(secret), nonce, ciphertext };
}

/**
 * What `sealed` holds, opened with the first of `secrets` that its key id
 * names and that opens it; undefined if none does, or it wasn't sealed for
 * `row`.
 */
export async function open(
  secrets: ReadonlyArray<string>,
  row: SealedFor,
  sealed: Sealed,
): Promise<RoundAnswers | undefined> {
  for (const secret of secrets) {
    if (keyProblem(secret) !== undefined) continue;
    if ((await keyIdOf(secret)) !== sealed.keyId) continue;
    try {
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(sealed.nonce),
          additionalData: additional(row),
        },
        await keyOf(secret),
        new Uint8Array(sealed.ciphertext),
      );
      return Schema.decodeUnknownSync(RoundAnswers)(
        JSON.parse(new TextDecoder().decode(plain)),
      );
    } catch {
      // Key ids are 32 bits: another key may share this one's. Try the next.
      continue;
    }
  }
  return undefined;
}

/** A round's answer key as the night reads it: the brief's format, one block per question. */
export function answerKey(
  round: {
    readonly position: number;
    readonly title: string;
    readonly hosts: ReadonlyArray<string>;
  },
  answers: RoundAnswers,
): string {
  const block = (label: string, q: Question) =>
    [
      `${label}. [type: ${q.type ?? "?"}]`,
      `Question: ${q.question}`,
      `Answer: ${q.answer}`,
      ...(q.alsoAccept.trim() === "" ? [] : [`Also accept: ${q.alsoAccept}`]),
      `Source: ${q.source}`,
      `Why it's fair: ${q.whyFair}`,
      `Difficulty: ${q.difficulty ?? "?"}`,
    ].join("\n");
  return [
    `Round ${round.position}: ${round.title} (host: ${round.hosts.join(", ") || "?"})`,
    ...answers.questions.map((q, i) => block(`Q${i + 1}`, q)),
    ...answers.backups.map((q, i) => block(`Backup ${i + 1}`, q)),
  ].join("\n\n");
}
