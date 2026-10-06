import { Schema } from "effect";
import { isTopic } from "../lockup.ts";
import { EventProgram } from "../rows.ts";

/**
 * What planning holds (migrations/0011_planning.ts), as the planning
 * service reads and writes it: the statuses and kinds the database checks,
 * the inputs each change takes, and the rows each list returns.
 */

/** An idea, from a first thought to a scheduled evening, or dropped. */
export const IdeaStatus = Schema.Literals([
  "idea",
  "drafting",
  "scheduled",
  "dropped",
]);
export type IdeaStatus = typeof IdeaStatus.Type;

/** Where we are with a speaker we'd like on stage. */
export const SpeakerStatus = Schema.Literals([
  "wanted",
  "asked",
  "confirmed",
  "declined",
]);
export type SpeakerStatus = typeof SpeakerStatus.Type;

/** Where we are with a company we'd like to host. */
export const HostStatus = Schema.Literals([
  "prospect",
  "asked",
  "confirmed",
  "declined",
]);
export type HostStatus = typeof HostStatus.Type;

/** Whether a window says when someone is free, or when they aren't. */
export const AvailabilityKind = Schema.Literals(["available", "unavailable"]);
export type AvailabilityKind = typeof AvailabilityKind.Type;

/** Text with something in it besides whitespace. */
export const Text = Schema.String.check(
  Schema.makeFilter((value: string) => value.trim() !== "" || "is blank"),
);

/** A topic as events.topic holds it: src/lockup.ts's isTopic. */
export const Topic = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      isTopic(value) ||
      `"${value}" is not a topic: lowercase, at most 24 characters, of letters, digits, single spaces and . & + # ' (a hyphen only inside a word), like "react native"`,
  ),
);

/** A calendar day, YYYY-MM-DD, that exists. */
export const Day = Schema.String.check(
  Schema.makeFilter((value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "is not a YYYY-MM-DD day";
    const day = new Date(`${value}T00:00:00Z`);
    return (
      (!Number.isNaN(day.getTime()) &&
        day.toISOString().slice(0, 10) === value) ||
      `${value} is not a day on the calendar`
    );
  }),
);

/** A row's id. */
export const Id = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ),
);

/** An email address, as contacts_email_check reads one. */
export const Email = Schema.String.check(
  Schema.isPattern(/^[^@\s]+@[^@\s]+[.][^@\s]+$/),
);

/** An https link, as contacts_url_check reads one. */
export const Link = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/));

/** When someone is free or not: either end may be open, and a note keeps their words. */
export const WindowInput = Schema.Struct({
  kind: Schema.optionalKey(AvailabilityKind),
  startsOn: Schema.optionalKey(Day),
  endsOn: Schema.optionalKey(Day),
  note: Schema.optionalKey(Text),
});
export type WindowInput = typeof WindowInput.Type;

/** Someone new, without a profile. */
export const NewContact = Schema.Struct({
  name: Text,
  email: Schema.optionalKey(Email),
  url: Schema.optionalKey(Link),
  /** Where they work: a hosting company's id or exact name. */
  company: Schema.optionalKey(Text),
});
export type NewContact = typeof NewContact.Type;

/**
 * Who a change is about: a profile (its id or exact name), a contact
 * already stored (its id), or someone new.
 */
export type PersonRef =
  | { readonly _tag: "Profile"; readonly ref: string }
  | { readonly _tag: "Contact"; readonly id: string }
  | { readonly _tag: "NewContact"; readonly contact: NewContact };

export const NewIdea = Schema.Struct({
  title: Text,
  pitch: Text,
  program: EventProgram,
  topic: Schema.optionalKey(Topic),
  status: Schema.optionalKey(IdeaStatus),
  /** The draft evening it became, by slug. */
  eventSlug: Schema.optionalKey(Text),
  /** A past evening it builds on, by slug. */
  inspiredBySlug: Schema.optionalKey(Text),
});
export type NewIdea = typeof NewIdea.Type;

/** What to change on an idea; `null` clears a field. */
export const IdeaChanges = Schema.Struct({
  title: Schema.optionalKey(Text),
  pitch: Schema.optionalKey(Text),
  program: Schema.optionalKey(EventProgram),
  topic: Schema.optionalKey(Schema.NullOr(Topic)),
  status: Schema.optionalKey(IdeaStatus),
  eventSlug: Schema.optionalKey(Schema.NullOr(Text)),
  inspiredBySlug: Schema.optionalKey(Schema.NullOr(Text)),
});
export type IdeaChanges = typeof IdeaChanges.Type;

export const NewWantedSpeaker = Schema.Struct({
  topics: Schema.Array(Topic).check(Schema.isMinLength(1)),
  status: Schema.optionalKey(SpeakerStatus),
  note: Schema.optionalKey(Text),
  availability: Schema.optionalKey(Schema.Array(WindowInput)),
});
export type NewWantedSpeaker = typeof NewWantedSpeaker.Type;

/** What to change on a wanted speaker; `note: null` clears the note. */
export const SpeakerChanges = Schema.Struct({
  status: Schema.optionalKey(SpeakerStatus),
  note: Schema.optionalKey(Schema.NullOr(Text)),
  addTopics: Schema.optionalKey(Schema.Array(Topic)),
  removeTopics: Schema.optionalKey(Schema.Array(Topic)),
  addAvailability: Schema.optionalKey(Schema.Array(WindowInput)),
  /** Availability windows to remove, by id. */
  removeAvailability: Schema.optionalKey(Schema.Array(Id)),
});
export type SpeakerChanges = typeof SpeakerChanges.Type;

/** A company: one we know (its id or exact name), or a new name. */
export type CompanyRef =
  | { readonly _tag: "Host"; readonly ref: string }
  | { readonly _tag: "NewCompany"; readonly name: string };

export const NewHostProspect = Schema.Struct({
  status: Schema.optionalKey(HostStatus),
  note: Schema.optionalKey(Text),
});
export type NewHostProspect = typeof NewHostProspect.Type;

/** What to change on a host prospect; `note: null` clears the note. */
export const HostChanges = Schema.Struct({
  status: Schema.optionalKey(HostStatus),
  note: Schema.optionalKey(Schema.NullOr(Text)),
});
export type HostChanges = typeof HostChanges.Type;

/** What a note is about: a profile or a company (id or exact name), or a contact (id). */
export type NoteSubject =
  | { readonly _tag: "Profile"; readonly ref: string }
  | { readonly _tag: "Host"; readonly ref: string }
  | { readonly _tag: "Contact"; readonly id: string };

const EventRef = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  startDate: Schema.String,
  isDraft: Schema.Boolean,
});

export const Idea = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  pitch: Schema.String,
  program: EventProgram,
  topic: Schema.NullOr(Schema.String),
  status: IdeaStatus,
  event: Schema.NullOr(EventRef),
  inspiredBy: Schema.NullOr(EventRef),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Idea = typeof Idea.Type;

export const Window = Schema.Struct({
  id: Schema.String,
  kind: AvailabilityKind,
  startsOn: Schema.NullOr(Schema.String),
  endsOn: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
});
export type Window = typeof Window.Type;

export const Note = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  author: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type Note = typeof Note.Type;

export const Contact = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
});
export type Contact = typeof Contact.Type;

export const Person = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("profile"),
    profileId: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("contact"), contact: Contact }),
]);
export type Person = typeof Person.Type;

export const WantedSpeaker = Schema.Struct({
  id: Schema.String,
  person: Person,
  status: SpeakerStatus,
  topics: Schema.Array(Schema.String),
  availability: Schema.Array(Window),
  note: Schema.NullOr(Schema.String),
  /** Notes on the person (their profile or contact). */
  notes: Schema.Array(Note),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type WantedSpeaker = typeof WantedSpeaker.Type;

export const Company = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("host"),
    sponsorId: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("new"), name: Schema.String }),
]);
export type Company = typeof Company.Type;

export const HostProspect = Schema.Struct({
  id: Schema.String,
  company: Company,
  contact: Schema.NullOr(Contact),
  status: HostStatus,
  note: Schema.NullOr(Schema.String),
  /** The last evening it hosted that has started, from its events. */
  lastHosted: Schema.NullOr(EventRef),
  /** Published evenings it has hosted, past and upcoming. */
  timesHosted: Schema.Number,
  /** Notes on the company. */
  notes: Schema.Array(Note),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type HostProspect = typeof HostProspect.Type;

export const SearchHit = Schema.Struct({
  kind: Schema.Literals([
    "idea",
    "wanted speaker",
    "host prospect",
    "contact",
    "note",
  ]),
  id: Schema.String,
  label: Schema.String,
  /** The text that matched. */
  text: Schema.String,
});
export type SearchHit = typeof SearchHit.Type;

/**
 * Whether the windows leave someone free on `day` (YYYY-MM-DD): no
 * `unavailable` window covers it, and an `available` one does, unless none
 * has dates at all. Windows with only a note say nothing about days.
 */
export function isAvailableOn(
  windows: ReadonlyArray<Pick<Window, "kind" | "startsOn" | "endsOn">>,
  day: string,
): boolean {
  const dated = windows.filter(
    (window) => window.startsOn !== null || window.endsOn !== null,
  );
  const covers = (window: Pick<Window, "startsOn" | "endsOn">) =>
    (window.startsOn === null || window.startsOn <= day) &&
    (window.endsOn === null || window.endsOn >= day);
  if (dated.some((window) => window.kind === "unavailable" && covers(window))) {
    return false;
  }
  const available = dated.filter((window) => window.kind === "available");
  return available.length === 0 || available.some(covers);
}
