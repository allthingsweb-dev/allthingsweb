import type { SpeakerRole, TalkFormat } from "./rows.ts";

/**
 * Who was on stage, and in what capacity, follows from two facts the
 * database keeps apart: how a talk is held (`talks.format`) and each
 * speaker's part in it (`talk_speakers.role`). A speaker of a panel is a
 * panelist, of a fireside chat its guest; a moderator moderates either, or
 * hosts a talk's Q&A. Keeping them apart means a "panelist" can never sit in
 * a talk that isn't a panel.
 *
 * The event as a whole has its own people, in `event_people`: organizers,
 * co-hosts and the MC (rows.EventPerson).
 */

/** A speaker's capacity on stage, as an event page names it. */
export type StageRole = "speaker" | "panelist" | "guest" | "moderator";

/** What a speaker who doesn't moderate is called, by the talk's format. */
const speakerIn: Readonly<Record<TalkFormat, StageRole>> = {
  talk: "speaker",
  panel: "panelist",
  fireside: "guest",
};

/** The capacity of a speaker with `role` in a talk held as `format`. */
export const stageRole = (format: TalkFormat, role: SpeakerRole): StageRole =>
  role === "moderator" ? "moderator" : speakerIn[format];
