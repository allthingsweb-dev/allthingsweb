/**
 * Error messages that clients rely on. The CLI maps this one to its "not
 * found" exit code, and its contract test checks that it still recognizes it.
 */
export function eventNotFoundMessage(slug: string): string {
  return `No published event has the slug "${slug}". Use list_events to find one.`;
}
