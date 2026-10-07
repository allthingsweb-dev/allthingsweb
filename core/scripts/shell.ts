/**
 * `text` as one shell word, to print a command an organizer can paste: as
 * it is when it is only safe characters, else in single quotes.
 */
export const shellWord = (text: string): string =>
  /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
