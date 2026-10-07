/**
 * The allthings mod's contract: the values it keeps in `$.state`, and the
 * shapes they hold. The hooks module imports these types from here, so this
 * file is the one place they are written.
 */

/** One talk of an evening, as `get_event` lists it. */
export type EveningTalk = {
  title: string;
  speakers: readonly string[];
};

/**
 * An evening as the mod draws it: the site's EventSummary (`list_events`),
 * with the fields `get_event` adds when the mod asked for them, and the topic
 * and neighborhood the mod derives.
 */
export type Evening = {
  slug: string;
  name: string;
  /** The <topic> of allthings/<topic>: lowercase, from the evening's name. */
  topic: string;
  url: string;
  status: "upcoming" | "live" | "past";
  /** ISO 8601 UTC instants. */
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  address: string | null;
  /** The local name of the venue's neighborhood, when the mod knows it. */
  neighborhood: string | null;
  rsvpUrl: string | null;
  recordingUrl: string | null;
  isHackathon: boolean;
  /** Hosting companies; empty until `get_event` has been asked. */
  hosts: readonly string[];
  /** Empty until `get_event` has been asked. */
  talks: readonly EveningTalk[];
};

/** A card `/at` printed, keyed in `cards` by the arguments it ran with. */
export type Card = {
  evening: Evening;
  /** When the card was made, in milliseconds since the epoch. */
  at: number;
};

declare module "claude-code" {
  interface PluginState {
    allthings: {
      /** The next evening, from list_events (upcoming, limit 1); null for none. */
      next: Evening | null;
      /** When `next` was last fetched, in milliseconds; 0 for never. */
      fetchedAt: number;
      /** The clock the band reads, moved every 30 seconds. */
      now: number;
      /** Moves every half second while something blinks: the cursor and the spinner. */
      tick: number;
      /** Slugs of the evenings the person pressed "I'm in" for. */
      clicked: readonly string[];
      /** The slash's color for the session's theme: Bridge on light, Glow on dark. */
      slash: string;
      /** The person's reduce-motion setting: the cursor stays solid. */
      reduceMotion: boolean;
      /** The cards `/at` printed, keyed by their arguments ("" for the next one). */
      cards: Readonly<Record<string, Card>>;
    };
  }
}
