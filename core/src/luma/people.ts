import type { LumaEventPeople, LumaHost } from "./api.ts";

/**
 * Who hosted each event on Luma, matched to the site's profiles: a pure plan
 * the import (src/luma/people-sync.ts) then writes in one statement.
 *
 * A host is matched by their Luma user id, which a profile holds once it has
 * been matched. A host no profile holds yet is matched
 * - as an organizer decided ({@link Decisions}): to the profile they named,
 *   or to a new profile with the name the host goes by on Luma and their
 *   Luma photo, if they uploaded one;
 * - otherwise by name, exactly as {@link normalizeName} writes it, never by
 *   similarity, when one profile has that name and no Luma user id, and no
 *   other unmatched host goes by it. It is reported, for review.
 *
 * A host whose Luma user id is a hosting company's (`sponsors.luma_user_id`)
 * is that company, not a person: the company is attached to the event as one
 * of its hosting companies, and no profile is matched or made for it.
 *
 * Anyone else is reported and left out until an organizer decides. Nothing
 * is created without that decision: Luma's hosts include companies' accounts
 * not yet on record, and people go by other names there ("Liz" for
 * Elizabeth, no accent), so a profile made from every unknown host would be
 * wrong or a duplicate as often as not.
 *
 * A host whose profile is an allthings organizer's is the event's
 * organizer; everyone else is a co-host. Positions follow Luma's order.
 */

/** A profile, as the import matches hosts against it. */
export interface StoredProfile {
  readonly id: string;
  readonly name: string;
  readonly lumaUserId: string | null;
  readonly profileType: "organizer" | "member";
}

/** A hosting company with its Luma account on record. */
export interface StoredCompany {
  readonly id: string;
  readonly name: string;
  readonly lumaUserId: string;
}

/** A hosting company the import attaches to an event, as Luma lists it. */
export interface PlannedHost {
  readonly eventId: string;
  readonly companyId: string;
}

/** An event of ours, and what Luma showed of its people. */
export interface FetchedEvent {
  readonly eventId: string;
  readonly people: LumaEventPeople;
}

/** What an organizer decided about hosts no profile holds yet. */
export interface Decisions {
  /** Hosts to make a profile for, by Luma user id. */
  readonly create: ReadonlyArray<string>;
  /** Hosts who are an existing profile: Luma user id to profile id. */
  readonly link: Readonly<Record<string, string>>;
}

export const noDecisions: Decisions = { create: [], link: {} };

export type ImportedRole = "organizer" | "co-host";

/** A row of event_people the import writes, its person by Luma user id. */
export interface PlannedPerson {
  readonly eventId: string;
  readonly lumaUserId: string;
  readonly role: ImportedRole;
  readonly position: number;
}

/** A profile the import creates. */
export interface NewProfile {
  readonly lumaUserId: string;
  readonly name: string;
  readonly photoSourceUrl: string | null;
}

/** An existing profile the import gives a Luma user id. */
export interface Link {
  readonly profileId: string;
  readonly lumaUserId: string;
}

/** Counts Luma keeps for an event our calendar manages. */
export interface GuestCounts {
  readonly eventId: string;
  readonly guestCount: number;
  readonly checkedInCount: number;
}

/** What an organizer should look at, one line per host and event. */
export type Review =
  | {
      readonly _tag: "Matched";
      /** By exact name, or as an organizer decided. */
      readonly how: "name" | "decision";
      readonly lumaEventId: string;
      readonly lumaUserId: string;
      readonly name: string;
      readonly profileId: string;
    }
  | {
      readonly _tag: "Created";
      readonly lumaEventId: string;
      readonly lumaUserId: string;
      readonly name: string;
    }
  | {
      readonly _tag: "Company";
      readonly lumaEventId: string;
      readonly lumaUserId: string;
      readonly name: string;
      readonly companyId: string;
    }
  | {
      readonly _tag: "Unmatched";
      readonly lumaEventId: string;
      readonly lumaUserId: string;
      readonly name: string | null;
      readonly reason: string;
    };

export interface PeoplePlan {
  readonly links: ReadonlyArray<Link>;
  readonly newProfiles: ReadonlyArray<NewProfile>;
  /** The import's rows for each of {@link replacedEventIds}, in full. */
  readonly people: ReadonlyArray<PlannedPerson>;
  /**
   * Hosting companies Luma lists as hosts, to attach to their events. The
   * import only adds them: a company an organizer attached stays, and so
   * does one Luma stops listing.
   */
  readonly hosts: ReadonlyArray<PlannedHost>;
  /**
   * Events whose rows from Luma are replaced by {@link people}: those Luma
   * listed hosts for. An event Luma showed no hosts for keeps its rows.
   */
  readonly replacedEventIds: ReadonlyArray<string>;
  readonly guestCounts: ReadonlyArray<GuestCounts>;
  readonly review: ReadonlyArray<Review>;
  /**
   * Decisions that cannot be carried out, each saying why. The import
   * writes nothing while there is one.
   */
  readonly problems: ReadonlyArray<string>;
}

/**
 * A name as matching compares it: canonical Unicode (NFC), single spaces,
 * no surrounding space, lowercase. Accents and every other character stay,
 * so "Sébastien" and "Sebastien" are different names.
 */
export const normalizeName = (name: string): string =>
  name.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase();

/** Luma's CDN for photos people upload; its stock avatars live elsewhere. */
export const lumaPhotoHost = "images.lumacdn.com";

/**
 * A Luma avatar worth fetching as a profile photo: one the person uploaded,
 * on Luma's CDN over https. Luma's stock avatars are not a photo of anyone.
 */
export function lumaPhotoUrl(avatarUrl: string | null): string | null {
  if (avatarUrl === null) return null;
  const url = URL.parse(avatarUrl);
  return url !== null &&
    url.protocol === "https:" &&
    url.hostname === lumaPhotoHost &&
    url.username === "" &&
    url.password === ""
    ? url.href
    : null;
}

type Match =
  | { readonly _tag: "Held"; readonly profile: StoredProfile }
  | {
      readonly _tag: "Link";
      readonly how: "name" | "decision";
      readonly profile: StoredProfile;
    }
  | { readonly _tag: "New"; readonly name: string }
  | { readonly _tag: "Unmatched"; readonly reason: string };

/** The name a host goes by on Luma, tidied, or null for none. */
const hostName = (host: LumaHost): string | null => {
  const name = host.name?.normalize("NFC").replace(/\s+/gu, " ").trim();
  return name === undefined || name === "" ? null : name;
};

/** How each distinct host is matched, decided once for every event. */
function matchHosts(
  hosts: ReadonlyMap<string, LumaHost>,
  profiles: ReadonlyArray<StoredProfile>,
  decisions: Decisions,
): { matches: ReadonlyMap<string, Match>; problems: ReadonlyArray<string> } {
  const problems: Array<string> = [];
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const byUserId = new Map<string, StoredProfile>();
  const byName = new Map<string, Array<StoredProfile>>();
  for (const profile of profiles) {
    if (profile.lumaUserId !== null) byUserId.set(profile.lumaUserId, profile);
    const key = normalizeName(profile.name);
    byName.set(key, [...(byName.get(key) ?? []), profile]);
  }
  const create = new Set(decisions.create);
  const link = new Map(Object.entries(decisions.link));

  for (const lumaUserId of new Set([...create, ...link.keys()])) {
    if (!hosts.has(lumaUserId)) {
      problems.push(
        `${lumaUserId} is not a host of any event Luma showed us; nothing to decide`,
      );
    }
    if (create.has(lumaUserId) && link.has(lumaUserId)) {
      problems.push(`${lumaUserId} is both to be created and linked`);
    }
  }

  // Hosts not yet held by a profile, by name, to find two Luma users who
  // would both claim one name.
  const unheldByName = new Map<string, Array<string>>();
  for (const host of hosts.values()) {
    const name = hostName(host);
    if (byUserId.has(host.lumaUserId) || name === null) continue;
    const key = normalizeName(name);
    unheldByName.set(key, [...(unheldByName.get(key) ?? []), host.lumaUserId]);
  }

  const matches = new Map<string, Match>();
  for (const host of hosts.values()) {
    const { lumaUserId } = host;
    const held = byUserId.get(lumaUserId);
    const linkTo = link.get(lumaUserId);
    const name = hostName(host);
    if (held !== undefined) {
      // A decision already carried out (by an earlier run) changes nothing;
      // one that contradicts what a profile holds is a mistake.
      matches.set(lumaUserId, { _tag: "Held", profile: held });
      if (linkTo !== undefined && linkTo !== held.id) {
        problems.push(
          `${lumaUserId} is already profile ${held.id} (${held.name}); unlink it there first`,
        );
      }
    } else if (linkTo !== undefined) {
      const profile = byId.get(linkTo);
      if (profile === undefined) {
        problems.push(`${lumaUserId}: no profile has the id ${linkTo}`);
      } else if (profile.lumaUserId !== null) {
        problems.push(
          `${lumaUserId}: profile ${linkTo} (${profile.name}) is already Luma user ${profile.lumaUserId}`,
        );
      } else {
        matches.set(lumaUserId, { _tag: "Link", how: "decision", profile });
      }
    } else if (create.has(lumaUserId)) {
      if (name === null) {
        problems.push(
          `${lumaUserId} shows no name on Luma to make a profile with`,
        );
      } else {
        matches.set(lumaUserId, { _tag: "New", name });
      }
    } else if (name === null) {
      matches.set(lumaUserId, {
        _tag: "Unmatched",
        reason: "Luma shows no name for this host",
      });
    } else {
      const key = normalizeName(name);
      const named = byName.get(key) ?? [];
      const [only] = named;
      const reason =
        (unheldByName.get(key) ?? []).length > 1
          ? "another Luma user goes by the same name"
          : only === undefined
            ? "no profile has this name"
            : named.length > 1
              ? `${named.length} profiles have this name`
              : only.lumaUserId !== null
                ? "the profile with this name belongs to another Luma user"
                : null;
      matches.set(
        lumaUserId,
        reason === null && only !== undefined
          ? { _tag: "Link", how: "name", profile: only }
          : { _tag: "Unmatched", reason: reason ?? "no profile has this name" },
      );
    }
  }

  // Two hosts may not become one profile.
  const claimed = new Map<string, string>();
  for (const [lumaUserId, match] of matches) {
    if (match._tag !== "Link") continue;
    const other = claimed.get(match.profile.id);
    if (other !== undefined) {
      problems.push(
        `${other} and ${lumaUserId} would both be profile ${match.profile.id} (${match.profile.name})`,
      );
    }
    claimed.set(match.profile.id, lumaUserId);
  }

  return { matches, problems };
}

/** The import's plan for `events`, given every profile and the decisions. */
export function planPeople(
  events: ReadonlyArray<FetchedEvent>,
  profiles: ReadonlyArray<StoredProfile>,
  decisions: Decisions = noDecisions,
  companies: ReadonlyArray<StoredCompany> = [],
): PeoplePlan {
  const companyOf = new Map(
    companies.map((company) => [company.lumaUserId, company] as const),
  );
  // Companies' accounts are matched to the company, never to a person.
  const hosts = new Map<string, LumaHost>();
  for (const event of events) {
    for (const host of event.people.hosts) {
      if (!companyOf.has(host.lumaUserId) && !hosts.has(host.lumaUserId)) {
        hosts.set(host.lumaUserId, host);
      }
    }
  }
  const matched = matchHosts(hosts, profiles, decisions);
  const { matches } = matched;
  const problems = [
    ...matched.problems.filter(
      (problem) =>
        ![...companyOf.keys()].some((id) =>
          problem.startsWith(`${id} is not a host`),
        ),
    ),
    ...[...new Set([...decisions.create, ...Object.keys(decisions.link)])]
      .filter((lumaUserId) => companyOf.has(lumaUserId))
      .map(
        (lumaUserId) =>
          `${lumaUserId} is the hosting company ${companyOf.get(lumaUserId)?.name ?? ""}, not a person; nothing to decide`,
      ),
  ];

  const links: Array<Link> = [];
  const newProfiles: Array<NewProfile> = [];
  for (const host of hosts.values()) {
    const match = matches.get(host.lumaUserId);
    if (match?._tag === "Link") {
      links.push({ profileId: match.profile.id, lumaUserId: host.lumaUserId });
    } else if (match?._tag === "New") {
      newProfiles.push({
        lumaUserId: host.lumaUserId,
        name: match.name,
        photoSourceUrl: lumaPhotoUrl(host.avatarUrl),
      });
    }
  }

  const people: Array<PlannedPerson> = [];
  const plannedHosts: Array<PlannedHost> = [];
  const replacedEventIds: Array<string> = [];
  const guestCounts: Array<GuestCounts> = [];
  const review: Array<Review> = [];
  for (const { eventId, people: luma } of events) {
    if (luma.guestCount !== null && luma.checkedInCount !== null) {
      guestCounts.push({
        eventId,
        guestCount: luma.guestCount,
        checkedInCount: luma.checkedInCount,
      });
    }
    for (const host of luma.hosts) {
      const company = companyOf.get(host.lumaUserId);
      if (
        company === undefined ||
        plannedHosts.some(
          (planned) =>
            planned.eventId === eventId && planned.companyId === company.id,
        )
      ) {
        continue;
      }
      plannedHosts.push({ eventId, companyId: company.id });
      review.push({
        _tag: "Company",
        lumaEventId: luma.lumaEventId,
        lumaUserId: host.lumaUserId,
        name: company.name,
        companyId: company.id,
      });
    }
    if (luma.hosts.length === 0) continue;
    replacedEventIds.push(eventId);
    const positions: Record<ImportedRole, number> = {
      organizer: 0,
      "co-host": 0,
    };
    const seen = new Set<string>();
    for (const host of luma.hosts) {
      const { lumaUserId } = host;
      const match = matches.get(lumaUserId);
      // A company's account has no match: it was planned as a host above.
      if (seen.has(lumaUserId) || match === undefined) continue;
      seen.add(lumaUserId);
      const { lumaEventId } = luma;
      if (match._tag === "Unmatched") {
        review.push({
          _tag: "Unmatched",
          lumaEventId,
          lumaUserId,
          name: hostName(host),
          reason: match.reason,
        });
        continue;
      }
      if (match._tag === "Link") {
        review.push({
          _tag: "Matched",
          how: match.how,
          lumaEventId,
          lumaUserId,
          name: match.profile.name,
          profileId: match.profile.id,
        });
      } else if (match._tag === "New") {
        review.push({
          _tag: "Created",
          lumaEventId,
          lumaUserId,
          name: match.name,
        });
      }
      const role: ImportedRole =
        match._tag !== "New" && match.profile.profileType === "organizer"
          ? "organizer"
          : "co-host";
      people.push({ eventId, lumaUserId, role, position: positions[role]++ });
    }
  }

  return {
    links,
    newProfiles,
    people,
    hosts: plannedHosts,
    replacedEventIds,
    guestCounts,
    review,
    problems,
  };
}
