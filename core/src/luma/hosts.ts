import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../approval.ts";
import { DataSourceError } from "../errors.ts";
import { actorFor, logAfterLuma } from "../planning/draft-log.ts";
import { type EventRef, StudioRefused } from "./publish.ts";
import {
  LumaWrite,
  type LumaHost,
  type LumaWriteError,
  type ManagedEvent,
} from "./write.ts";

/**
 * An evening's hosts on Luma: the people and company accounts its page
 * names, and who can manage it. Read at any time; changed in two steps, as
 * publishing and covers are.
 *
 * What Luma's API can do (public-api.luma.com/openapi.json):
 *
 * - `events/get` lists the hosts: id, email and name.
 * - `hosts/add` adds one **by email**, at an access level:
 *   - `none`: shown on the event's page, with no rights to manage it: a
 *     hosting company, a speaker, anyone credited. The studio's default:
 *     least privilege, whatever Luma's own default (manager) is;
 *   - `check-in`: may check guests in, and is never shown on the page;
 *   - `manager`: may change the event and its guests, shown on the page.
 *     Only ever asked for by name, for an organizer.
 *   A Luma user id can't be added: the API takes no id, and the studio
 *   can't see a user's email.
 * - `hosts/remove` removes one by email. The event's creator can't be
 *   removed.
 *
 * Whatever can't be done as asked is a gap, refused by name, never skipped.
 *
 * Luma keeps an unpublished evening's hosts itself, privately with the
 * event: nothing about them goes into a file here. Once the evening is
 * public, the Luma people import (people-sync.ts) reads them like any
 * evening's.
 *
 * - `read` lists the hosts now.
 * - `prepare` says each host it would add or remove, any gaps, and the
 *   approval token for exactly that: the first 16 hex digits of the
 *   SHA-256 of the event, its hosts now and the changes, as canonical
 *   JSON. A public event's change shows on its page at once, which the
 *   plan says.
 * - `approve` takes that token, works the plan out again and goes on only
 *   if it hashes the same; it adds, then removes, and reads the hosts back
 *   to check each change took.
 */

/** A host's rights on the event, as `hosts/add` names them. */
export const hostAccessLevels = ["none", "check-in", "manager"] as const;
export type HostAccess = (typeof hostAccessLevels)[number];

/** What each access level means, as the plan prints it. */
export const hostAccessText: Readonly<Record<HostAccess, string>> = {
  none: "shown on the page, no rights to manage it",
  "check-in": "may check guests in, not shown on the page",
  manager: "a manager, shown on the page",
};

/** Who to add (an email, at an access level) and who to remove (an email or a Luma user id). */
export interface HostsRequest {
  readonly add: ReadonlyArray<{
    readonly email: string;
    readonly access: HostAccess;
  }>;
  readonly remove: ReadonlyArray<string>;
}

/** One of the event's hosts, as Luma has them. */
export interface Host {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  /** Whether they made the event: Luma won't remove them. */
  readonly creator: boolean;
}

/** An evening's hosts, as Luma has them now. */
export interface Hosts {
  readonly lumaEventId: string;
  readonly name: string;
  readonly url: string;
  readonly visibility: ManagedEvent["visibility"];
  readonly hosts: ReadonlyArray<Host>;
}

/** One change the plan makes. */
export type HostChange =
  | {
      readonly action: "add";
      readonly email: string;
      readonly access: HostAccess;
    }
  | {
      readonly action: "remove";
      readonly email: string;
      readonly name: string | null;
    };

/** Something Luma's API can't do as asked: refused, never skipped. */
export interface HostGap {
  readonly action: "add" | "remove";
  /** As it was asked. */
  readonly who: string;
  readonly reason: string;
}

export interface HostsPlan {
  readonly changes: ReadonlyArray<HostChange>;
  readonly gaps: ReadonlyArray<HostGap>;
}

export interface PreparedHosts extends HostsPlan {
  readonly hosts: Hosts;
  /** True when the event is public: a change shows on its page at once. */
  readonly public: boolean;
  readonly token: string;
}

export type HostsFailure = StudioRefused | LumaWriteError | DataSourceError;

export interface HostsShape {
  readonly read: (ref: EventRef) => Effect.Effect<Hosts, HostsFailure>;
  readonly prepare: (
    ref: EventRef,
    request: HostsRequest,
  ) => Effect.Effect<PreparedHosts, HostsFailure>;
  readonly approve: (
    ref: EventRef,
    request: HostsRequest,
    token: string,
  ) => Effect.Effect<PreparedHosts, HostsFailure>;
}

const refuse = (reason: string) => Effect.fail(new StudioRefused({ reason }));

/** An email as Luma takes one. */
const isEmail = (text: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);

const sameEmail = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** The changes `request` makes to `current`, and what Luma can't do: no reads, no writes. */
export function hostsPlan(current: Hosts, request: HostsRequest): HostsPlan {
  const changes: Array<HostChange> = [];
  const gaps: Array<HostGap> = [];
  const seen = new Set<string>();
  for (const asked of request.add) {
    const who = asked.email.trim();
    if (!isEmail(who)) {
      gaps.push({
        action: "add",
        who,
        reason: who.startsWith("usr-")
          ? "Luma's API adds a host by email only (hosts/add), and a Luma user's email isn't ours to see: give their email."
          : "Luma's API adds a host by email only (hosts/add), and this isn't one.",
      });
      continue;
    }
    const key = who.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (current.hosts.some((host) => sameEmail(host.email, who))) continue;
    changes.push({ action: "add", email: who, access: asked.access });
  }
  for (const asked of request.remove) {
    const who = asked.trim();
    const host = current.hosts.find((own) =>
      who.startsWith("usr-") ? own.id === who : sameEmail(own.email, who),
    );
    if (host === undefined) {
      gaps.push({
        action: "remove",
        who,
        reason: "No host of this event is them.",
      });
      continue;
    }
    if (host.creator) {
      gaps.push({
        action: "remove",
        who,
        reason:
          "They made the event, and Luma's API can't remove its creator (hosts/remove).",
      });
      continue;
    }
    // Removing someone also asked to be added, however each was named,
    // can't be both: refused, so neither wins quietly.
    if (request.add.some((added) => sameEmail(added.email, host.email))) {
      gaps.push({
        action: "remove",
        who,
        reason: `${host.email} is also asked to be added: give one.`,
      });
      continue;
    }
    if (changes.some((change) => sameEmail(change.email, host.email))) continue;
    changes.push({ action: "remove", email: host.email, name: host.name });
  }
  return { changes, gaps };
}

/** Why `request` can't be asked at all; null when it can. */
export function hostsRequestProblem(request: HostsRequest): string | null {
  if (request.add.length === 0 && request.remove.length === 0) {
    return "Nothing to change: give --add or --remove.";
  }
  const added = new Set<string>();
  for (const { email } of request.add) {
    const key = email.trim().toLowerCase();
    if (added.has(key))
      return `${email.trim()} is added twice: give them once.`;
    added.add(key);
  }
  const both = request.remove.find((who) =>
    added.has(who.trim().toLowerCase()),
  );
  return both === undefined
    ? null
    : `${both.trim()} is both added and removed: give one.`;
}

/** The hosts `event` lists, or why its answer isn't what Luma documents. */
export function hostsOf(event: ManagedEvent): Hosts | string {
  if (
    event.hosts === undefined ||
    event.hosts.some((host) => host.email === undefined)
  ) {
    return "Luma's answer to events/get has no hosts with their emails: it is not what its API documents for an event's manager.";
  }
  return {
    lumaEventId: event.id,
    name: event.name,
    url: event.url,
    visibility: event.visibility,
    hosts: event.hosts.map((host: LumaHost) => ({
      id: host.id,
      email: host.email ?? "",
      name: host.name,
      creator: event.user_id !== undefined && host.id === event.user_id,
    })),
  };
}

/** Whether `after`, read back, shows `change` made. */
export function took(change: HostChange, after: Hosts): boolean {
  const there = after.hosts.some((host) => sameEmail(host.email, change.email));
  return change.action === "add" ? there : !there;
}

const Row = Schema.Struct({
  slug: Schema.String,
  lumaEventId: Schema.NullOr(Schema.String),
  curation: Schema.String,
});

const make = Effect.gen(function* () {
  const luma = yield* LumaWrite;
  const sql = yield* SqlClient;

  /** The Luma event `ref` names. */
  const lumaIdOf = (ref: EventRef) =>
    Effect.gen(function* () {
      if (ref._tag === "Luma") return ref.lumaEventId;
      const [row] = yield* sql`
        SELECT slug, luma_event_id AS "lumaEventId", curation
        FROM events WHERE slug = ${ref.slug} OR short_slug = ${ref.slug}`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
        Effect.mapError((cause) => new DataSourceError({ cause })),
      );
      if (row === undefined) {
        return yield* refuse(`No evening, published or draft, is ${ref.slug}.`);
      }
      if (row.curation === "shared") {
        return yield* refuse(
          `${row.slug} is shared: its hosts are its organizer's.`,
        );
      }
      if (row.lumaEventId === null) {
        return yield* refuse(`${row.slug} has no Luma event yet.`);
      }
      return row.lumaEventId;
    });

  const readFrom = (lumaEventId: string) =>
    Effect.gen(function* () {
      const event = yield* luma.get(lumaEventId);
      if (event.access !== "manage") {
        return yield* refuse(
          `${lumaEventId} isn't our calendar's to manage: its hosts can't be read or changed.`,
        );
      }
      const hosts = hostsOf(event);
      if (typeof hosts === "string") return yield* refuse(hosts);
      return hosts;
    });

  const prepareFrom = (lumaEventId: string, request: HostsRequest) =>
    Effect.gen(function* () {
      const problem = hostsRequestProblem(request);
      if (problem !== null) return yield* refuse(problem);
      const hosts = yield* readFrom(lumaEventId);
      const plan = hostsPlan(hosts, request);
      const prepared: PreparedHosts = {
        ...plan,
        hosts,
        public: hosts.visibility === "public",
        token: yield* approvalToken({
          lumaEventId,
          visibility: hosts.visibility,
          hosts: hosts.hosts,
          changes: plan.changes,
        }),
      };
      return prepared;
    });

  const approve = (ref: EventRef, request: HostsRequest, token: string) =>
    Effect.gen(function* () {
      yield* actorFor(refuse);
      const lumaEventId = yield* lumaIdOf(ref);
      const prepared = yield* prepareFrom(lumaEventId, request);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would change has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      if (prepared.gaps.length > 0) {
        return yield* refuse(
          `Luma's API can't do this as asked, so nothing was sent: ${prepared.gaps
            .map((gap) => `${gap.action} ${gap.who}: ${gap.reason}`)
            .join(" ")}`,
        );
      }
      if (prepared.changes.length === 0) {
        return yield* refuse("Nothing to change: the hosts are already so.");
      }
      for (const change of prepared.changes) {
        yield* change.action === "add"
          ? luma.addHost(lumaEventId, change.email, change.access)
          : luma.removeHost(lumaEventId, change.email);
      }
      const after = yield* readFrom(lumaEventId);
      const missed = prepared.changes.filter((change) => !took(change, after));
      if (missed.length > 0) {
        return yield* refuse(
          `Luma took the changes, but these don't read as sent: ${missed
            .map((change) => `${change.action} ${change.email}`)
            .join(
              ", ",
            )}. Read them with bun run luma hosts and set them again.`,
        );
      }
      // Hosts are named by email on Luma: the log keeps only what changed.
      const added = prepared.changes.filter(
        (change) => change.action === "add",
      );
      const removed = prepared.changes.length - added.length;
      yield* logAfterLuma(
        {
          event: { lumaEventId },
          command: "luma hosts",
          summary: `Changed its hosts on Luma: ${added.length} added${
            added.length === 0
              ? ""
              : ` (${added.map((change) => change.access).join(", ")})`
          }, ${removed} removed.`,
          payload: {
            added: added.map((change) => ({ access: change.access })),
            removed,
            token,
          },
        },
        refuse,
      ).pipe(Effect.provideService(SqlClient, sql));
      return { ...prepared, hosts: after };
    });

  return LumaHosts.of({
    read: (ref) => Effect.flatMap(lumaIdOf(ref), readFrom),
    prepare: (ref, request) =>
      Effect.flatMap(lumaIdOf(ref), (lumaEventId) =>
        prepareFrom(lumaEventId, request),
      ),
    approve,
  });
});

export class LumaHosts extends Context.Service<LumaHosts, HostsShape>()(
  "allthings/LumaHosts",
) {
  /** Needs `LumaWrite` and a `SqlClient`, to find an evening by its slug. */
  static readonly layer = Layer.effect(LumaHosts, make);
}

/**
 * The hosts `args` (a command line) adds, each at its access level:
 * `--access <level>` sets the level of the `--add <email>` right before it,
 * with no other flag between them,
 * and one left without is `none`, least privilege. Each also as
 * `--flag=<value>`; nothing after `--` is a flag. Why it can't be read, as
 * a string.
 */
export function hostAddsInOrder(
  args: ReadonlyArray<string>,
): HostsRequest["add"] | string {
  const adds: Array<{ email: string; access: HostAccess }> = [];
  // Whether the last flag was an --add, so an --access may follow it.
  let open = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") break;
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (name !== "--add" && name !== "--access") {
      // Any other flag between an --add and its --access ends it.
      if (arg.startsWith("--")) open = false;
      continue;
    }
    const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
    if (value === undefined) return `${name} needs a value.`;
    if (name === "--add") {
      adds.push({ email: value, access: "none" });
      open = true;
      continue;
    }
    const last = adds.at(-1);
    if (last === undefined || !open) {
      return `--access ${value} goes right after the --add it is for.`;
    }
    if (!(hostAccessLevels as ReadonlyArray<string>).includes(value)) {
      return `--access is one of ${hostAccessLevels.join(", ")}: ${value}`;
    }
    adds[adds.length - 1] = { ...last, access: value as HostAccess };
    open = false;
  }
  return adds;
}
