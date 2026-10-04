import { maxTopicLength } from "../../src/lockup.ts";

/**
 * Strings on either side of the topic rule, for holding src/lockup.ts's
 * isTopic and the CHECK on `events.topic` to the same answers, in PGlite
 * and on Postgres 17.
 */

export const topics: ReadonlyArray<string> = [
  "effect",
  "dev setups",
  "typescript ai afterparty",
  "react native after-party",
  "ship ai",
  "ai",
  "nextdev.fm live",
  "web show & tell",
  "c++ & c#",
  "rock 'n' roll",
  "server-side rendering",
  "web3",
  "0",
  "café night",
  "école",
  "日本",
  // A letter number (Unicode's Nl) is a letter to both.
  "ⅻ",
  "a".repeat(maxTopicLength),
  // Characters, not UTF-16 code units: each of these is two.
  "𝐚".repeat(maxTopicLength),
];

export const notTopics: ReadonlyArray<string> = [
  "",
  " ai",
  "ai ",
  "dev  setups",
  "Effect",
  "ÉCOLE",
  "Ⅻ",
  "a".repeat(maxTopicLength + 1),
  // 25 characters.
  "typescript ai after-party",
  "𝐚".repeat(maxTopicLength + 1),
  "all things",
  "web all things",
  "-ai",
  "ai-",
  "a--b",
  "a -b",
  "ship/ai",
  "ai!",
  "ai: the party",
  "(ai)",
  "ai_x",
  "a\tb",
  "🎉",
  // Digits are 0 to 9 only.
  "x²",
  "٣",
  // "école" decomposed: not NFC.
  "école",
];
