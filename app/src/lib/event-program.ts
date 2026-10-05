import type { eventPrograms } from "./schema";

type EventProgram = (typeof eventPrograms)[number];

/**
 * The program an event takes when an admin writer sets its hackathon flag,
 * or undefined to leave it be. The database holds the two together
 * (events_program_hackathon_check): setting the flag makes the program
 * hackathon, and clearing it on a hackathon makes it an evening of talks,
 * the default; any other program stays as it is.
 */
export function programForHackathonFlag(
  isHackathon: boolean | undefined,
  current: EventProgram | undefined,
): EventProgram | undefined {
  if (isHackathon === true) return "hackathon";
  if (isHackathon === false && current === "hackathon") return "talks";
  return undefined;
}
