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
