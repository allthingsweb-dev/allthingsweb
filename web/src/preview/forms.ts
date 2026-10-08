import { Schema } from "effect";

/**
 * What every form a collaborator sends the draft preview must be
 * (core/README.md, "Collaborating on a draft"), checked before anything is
 * read or written:
 *
 * - **From the preview's own page.** A browser names the page's origin in
 *   `Origin` on a form's POST; it must be the preview's. Without one,
 *   `Sec-Fetch-Site` must say `same-origin`. A request with neither is
 *   refused.
 * - **With its form token.** Each form carries an HMAC (SHA-256) of who
 *   signed in, the evening, the form and when Access signed them in, keyed
 *   by the Worker's own secret (`COLLAB_FORM_KEY`, which Alchemy made and
 *   nothing else knows). Another page can't make one, and a token stops
 *   working when its Access session does.
 * - **Small, and of one encoding.** `application/x-www-form-urlencoded`
 *   only, with a Content-Length, under the form's limit; each field once.
 *
 * Then each form's fields are decoded with its schema below.
 */

/** Who a token is for: the signer, the evening, the form, the Access session. */
export interface TokenFor {
  readonly email: string;
  readonly eventId: string;
  readonly form: string;
  readonly issuedAt: number;
}

const encoder = new TextEncoder();

const keyOf = (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const message = (parts: TokenFor) =>
  encoder.encode(
    [
      "allthings-collab-form",
      parts.email,
      parts.eventId,
      parts.form,
      String(parts.issuedAt),
    ].join("\n"),
  );

const base64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64url = (text: string) =>
  Uint8Array.from(
    atob(text.replaceAll("-", "+").replaceAll("_", "/") + "="),
    (char) => char.charCodeAt(0),
  );

/** The form token for `parts`, under `secret`. */
export async function formToken(
  secret: string,
  parts: TokenFor,
): Promise<string> {
  return base64url(
    await crypto.subtle.sign("HMAC", await keyOf(secret), message(parts)),
  );
}

/** Whether `token` is the form token for `parts`: compared in constant time by WebCrypto. */
export async function isFormToken(
  secret: string,
  parts: TokenFor,
  token: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return crypto.subtle.verify(
    "HMAC",
    await keyOf(secret),
    fromBase64url(token),
    message(parts),
  );
}

/** Whether a form's POST came from the preview's own page. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** Why a form's body was refused, or its fields. */
export type FormBody =
  | { readonly ok: true; readonly fields: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/** A form's fields, read only if the body is URL-encoded and at most `limit` bytes. */
export async function readForm(
  request: Request,
  limit: number,
): Promise<FormBody> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/x-www-form-urlencoded(?:\s*;.*)?$/i.test(type)) {
    return { ok: false, status: 415, reason: "A form is sent URL-encoded." };
  }
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d{1,9}$/.test(declared)) {
    return { ok: false, status: 411, reason: "A form says how long it is." };
  }
  if (Number(declared) > limit) {
    return { ok: false, status: 413, reason: "That's too long to send." };
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) {
    return { ok: false, status: 413, reason: "That's too long to send." };
  }
  const params = new URLSearchParams(new TextDecoder().decode(bytes));
  const fields: Record<string, string> = {};
  for (const [name, value] of params) {
    if (Object.hasOwn(fields, name)) {
      return { ok: false, status: 400, reason: "A field came twice." };
    }
    fields[name] = value;
  }
  return { ok: true, fields };
}

/**
 * No control characters but tabs and line breaks, and no Unicode line or
 * paragraph separators: text that reads as it looks.
 */
const printable = (value: string) => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || code === 0x7f;
    if (control && char !== "\t" && char !== "\n") return false;
    if (code === 0x2028 || code === 0x2029) return false;
  }
  return true;
};

/** Text someone wrote, as it is kept: line breaks as \n, NFC, trimmed. */
export const written = (value: string): string =>
  value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC").trim();

/**
 * Text someone wrote, once made `written`: printable, and between 1 and
 * `max` characters.
 */
export const Written = (max: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (value: string) =>
        (value.length > 0 && value.length <= max && printable(value)) ||
        `is empty, over ${max} characters, or holds a character that isn't text`,
    ),
  );

const id = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A comment, as its form sends it. */
export const CommentForm = Schema.Struct({
  token: Schema.String,
  /** What it is on: the evening, a brief section, or a round. */
  on: Schema.String.check(
    Schema.isPattern(new RegExp(`^(?:evening|section:${id}|round:${id})$`)),
  ),
  body: Written(2000),
});
export type CommentForm = typeof CommentForm.Type;

/** A comment form's whole body, at most: 2000 characters of text, each up to 9 bytes encoded. */
export const commentLimit = 20_000;

/** A round's fields, each question's at most: what a host writes in the brief's format. */
export const roundLimits = {
  question: 1000,
  answer: 500,
  alsoAccept: 500,
  source: 500,
  whyFair: 300,
} as const;

/** A round form's whole body, at most: 25 questions of fields at their limits, encoded. */
export const roundLimit = 300_000;

const questionTypes = new Set([
  "guess the output",
  "spot the bug",
  "name that error",
  "visual",
  "open",
]);
const difficulties = new Set(["gettable", "deep", "brutal"]);

/** One question, as the round form and the seal hold it. */
export interface RoundQuestion {
  readonly type: string | null;
  readonly question: string;
  readonly answer: string;
  readonly alsoAccept: string;
  readonly source: string;
  readonly whyFair: string;
  readonly difficulty: string | null;
}

export type RoundFormResult =
  | {
      readonly ok: true;
      readonly stage: "draft" | "final";
      readonly roundId: string;
      readonly questions: ReadonlyArray<RoundQuestion>;
      readonly backups: ReadonlyArray<RoundQuestion>;
    }
  | { readonly ok: false; readonly reason: string };

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * A round form's fields: \`round\`, \`stage\` ("draft" to save, "final" to hand
 * in), and for each of the round's questions then its backups, \`q<n>_type\`,
 * \`q<n>_question\`, \`q<n>_answer\`, \`q<n>_also\`, \`q<n>_source\`, \`q<n>_fair\`
 * and \`q<n>_difficulty\`. Every text is \`written\` and held to its limit; a
 * source is an https link. A draft may leave anything empty but not all of
 * it; a round handed in has every question, answer, source, type and
 * difficulty. Nothing else is taken.
 */
export function parseRoundForm(
  fields: Readonly<Record<string, string>>,
  count: { readonly questions: number; readonly backups: number },
): RoundFormResult {
  const refuse = (reason: string): RoundFormResult => ({ ok: false, reason });
  const stage = fields["stage"];
  if (stage !== "draft" && stage !== "final") {
    return refuse("save it as a draft, or hand it in.");
  }
  const roundId = fields["round"] ?? "";
  if (!new RegExp(`^${id}$`).test(roundId))
    return refuse("that isn't a round.");
  const total = count.questions + count.backups;
  const allowed = new Set(["token", "round", "stage"]);
  const read: Array<RoundQuestion> = [];
  for (let n = 1; n <= total; n++) {
    const field = (name: string) => {
      allowed.add(`q${n}_${name}`);
      return written(fields[`q${n}_${name}`] ?? "");
    };
    const type = field("type");
    const difficulty = field("difficulty");
    const question = {
      type: type === "" ? null : type,
      question: field("question"),
      answer: field("answer"),
      alsoAccept: field("also"),
      source: field("source"),
      whyFair: field("fair"),
      difficulty: difficulty === "" ? null : difficulty,
    };
    const label =
      n <= count.questions ? `question ${n}` : `backup ${n - count.questions}`;
    if (question.type !== null && !questionTypes.has(question.type)) {
      return refuse(`${label}'s type isn't one of the brief's.`);
    }
    if (
      question.difficulty !== null &&
      !difficulties.has(question.difficulty)
    ) {
      return refuse(`${label}'s difficulty is gettable, deep or brutal.`);
    }
    for (const [name, max] of [
      ["question", roundLimits.question],
      ["answer", roundLimits.answer],
      ["alsoAccept", roundLimits.alsoAccept],
      ["source", roundLimits.source],
      ["whyFair", roundLimits.whyFair],
    ] as const) {
      const value = question[name];
      if (value.length > max || (value !== "" && !printable(value))) {
        return refuse(
          `${label}: a field is over ${max} characters, or holds a character that isn't text.`,
        );
      }
    }
    if (question.source !== "" && !isHttps(question.source)) {
      return refuse(`${label}'s source is an https link.`);
    }
    if (
      stage === "final" &&
      (question.type === null ||
        question.difficulty === null ||
        question.question === "" ||
        question.answer === "" ||
        question.source === "")
    ) {
      return refuse(
        `to hand it in, ${label} needs its type, question, answer, source and difficulty.`,
      );
    }
    read.push(question);
  }
  if (Object.keys(fields).some((name) => !allowed.has(name))) {
    return refuse("the form has a field it shouldn't.");
  }
  if (read.every((q) => q.question === "" && q.answer === "")) {
    return refuse("write at least one question first.");
  }
  return {
    ok: true,
    stage,
    roundId,
    questions: read.slice(0, count.questions),
    backups: read.slice(count.questions),
  };
}
