/**
 * How allthings sounds, as rules a test can hold any text to: the words the
 * brand doesn't say, and the stock phrases that make writing read as
 * written by no one. Whatever we write in our own voice (promotion drafts,
 * announcements, the letter) is checked against these, so a phrase that
 * slips in fails a test instead of reaching anyone.
 *
 * The rules judge our words only. Other people's words quoted in a text,
 * such as a talk's title as its speaker wrote it, are theirs: a caller
 * checks the text it wrote, around them.
 */

/** One rule: what it finds, and why we don't say it. */
export interface VoiceRule {
  readonly pattern: RegExp;
  readonly why: string;
}

/** A rule a text broke, with the words that broke it. */
export interface VoiceFinding {
  readonly why: string;
  readonly said: string;
}

const rule = (pattern: RegExp, why: string): VoiceRule => ({ pattern, why });

/**
 * The brand's words: an evening is something you come to, not a product
 * you sign up for, and hosts host it.
 */
export const brandDiction: ReadonlyArray<VoiceRule> = [
  rule(/\brsvp/i, "people say they're in; RSVP is the platform's word"),
  rule(/\bregister/i, "people say they're in, they don't register"),
  rule(/\bsign(ed)?[ -]?up\b/i, "people say they're in, they don't sign up"),
  rule(/\bsponsor/i, "companies host evenings, they don't sponsor them"),
  rule(/!/, "the words carry it, not the punctuation"),
  rule(/\p{Extended_Pictographic}/u, "no emoji: the words carry it"),
];

/**
 * Stock phrases: hype, filler and the constructions of writing that has
 * nothing particular to say. Each has a plain alternative that says what
 * is actually there.
 */
export const stockPhrases: ReadonlyArray<VoiceRule> = [
  rule(/\bseamless(ly)?\b/i, "hype: say what works and how"),
  rule(/\bunlock(s|ing)?\b/i, "hype: say what someone can now do"),
  rule(/\belevat(e|es|ing)\b/i, "hype: say what gets better"),
  rule(/\bleverag(e|es|ing)\b/i, "filler: say use"),
  rule(/\bdelv(e|es|ing)\b/i, "stock phrase: say look at"),
  rule(
    /\bdeep[ -]dives?\b|\bdive (right )?in(to)?\b/i,
    "stock phrase: say what's covered",
  ),
  rule(/\bgame[ -]?chang/i, "hype: say what changed"),
  rule(
    /\bcutting[ -]edge\b|\bbleeding[ -]edge\b/i,
    "hype: say what's new about it",
  ),
  rule(/\bstate[ -]of[ -]the[ -]art\b/i, "hype: say what's new about it"),
  rule(
    /\bworld[ -]class\b|\bnext[ -]level\b|\bbest[ -]in[ -]class\b/i,
    "hype: show it, with who and what",
  ),
  rule(/\brevolutioni[sz]/i, "hype: say what changed"),
  rule(/\bsupercharg/i, "hype: say what got faster or easier"),
  rule(/\bempower/i, "filler: say what someone can now do"),
  rule(/\bsynerg/i, "filler: say who works with whom on what"),
  rule(/\brobust\b/i, "filler: say what it withstands"),
  rule(/\bvibrant\b/i, "filler: show the people instead"),
  rule(
    /\btapestry\b|\btestament to\b|\brealm of\b/i,
    "stock phrase: say the thing itself",
  ),
  rule(
    /\bever[ -]evolving\b|\bfast[ -]paced\b|\bin today's\b/i,
    "stock phrase: start with the particular",
  ),
  rule(
    /\b(ai|tech|technology|digital|software) landscape\b/i,
    "stock phrase: name the actual things",
  ),
  rule(/\bnavigat(e|ing) the\b/i, "stock phrase: say what someone does"),
  rule(/\bharness(ing)? the\b/i, "stock phrase: say use"),
  rule(/\bembark/i, "stock phrase: say start"),
  rule(
    /\b(thrilled|excited|delighted|pleased) to (announce|share|welcome|introduce)\b/i,
    "throat-clearing: say the news",
  ),
  rule(
    /\bdon'?t miss\b|\bstay tuned\b|\bbuckle up\b|\blook no further\b/i,
    "a pitch: say what's there and let people decide",
  ),
  rule(/\bwhether you'?re an?\b/i, "a pitch to everyone: speak to someone"),
  rule(
    /\bnot (just|only|merely) [^.;:]{1,60}, but\b|\bmore than just\b/i,
    "a setup for a contrast nobody raised: say what it is",
  ),
  rule(
    /\bit'?s not [^.;:]{1,40}[,;] it'?s\b/i,
    "a setup for a contrast nobody raised: say what it is",
  ),
  rule(
    /\b(incredibly|truly|super|amazing|awesome|insanely)\b/i,
    "an intensifier: let the particulars do it",
  ),
  rule(/—/, "a dash for drama: use a colon, a comma or a full stop"),
];

/** Every rule our own words are held to. */
export const voice: ReadonlyArray<VoiceRule> = [
  ...brandDiction,
  ...stockPhrases,
];

/** The longest sentence we write, in words: past it, a reader loses the thread. */
export const longestSentence = 40;

/** Each rule `text` breaks, with what it said; empty when it reads as ours. */
export function voiceFindings(
  text: string,
  rules: ReadonlyArray<VoiceRule> = voice,
): ReadonlyArray<VoiceFinding> {
  const findings: VoiceFinding[] = [];
  for (const { pattern, why } of rules) {
    const found = pattern.exec(text);
    if (found !== null) findings.push({ why, said: found[0] });
  }
  for (const sentence of sentences(text)) {
    const words = sentence
      .split(/\s+/)
      .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    if (words > longestSentence) {
      findings.push({
        why: `a sentence of ${words} words: split it (${longestSentence} at most)`,
        said: `${sentence.slice(0, 60)}…`,
      });
    }
  }
  return findings;
}

/**
 * `text`'s sentences. A paragraph's lines are one text, however it is
 * wrapped, split after a full stop, question mark or exclamation mark; a
 * semicolon or a colon doesn't end one. A list item or a heading starts a
 * paragraph of its own, and a blank line ends one.
 */
function sentences(text: string): ReadonlyArray<string> {
  const paragraphs: string[] = [];
  let lines: string[] = [];
  const end = () => {
    if (lines.length > 0) paragraphs.push(lines.join(" "));
    lines = [];
  };
  for (const line of text.split("\n").map((each) => each.trim())) {
    if (line === "") {
      end();
    } else if (/^#{1,6}\s/.test(line)) {
      end();
      paragraphs.push(line);
    } else {
      if (/^(?:[-*+•]|\d+[.)])\s/.test(line)) end();
      lines.push(line);
    }
  }
  end();
  return paragraphs
    .flatMap((paragraph) => paragraph.split(/(?<=[.?!])\s+(?=[A-Z"“(])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}
