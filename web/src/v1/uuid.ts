const hex4 = "[0-9a-fA-F]{4}";
const digits = `${hex4}(?:-?${hex4}){7}`;
const uuid = new RegExp(`^(?:${digits}|\\{${digits}\\})$`);

/**
 * Whether Postgres would read `value` as a uuid: 32 hex digits in either
 * case, optionally in braces, with an optional hyphen after any group of
 * four but the last (`string_to_uuid` in Postgres's uuid.c). The app passes
 * the id straight to Postgres, so this accepts exactly the ids it finds; the
 * rest made Postgres fail the query, which the app answered with a 500.
 */
export function isPostgresUuid(value: string): boolean {
  return uuid.test(value);
}
