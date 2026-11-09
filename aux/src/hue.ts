import { assertNoFlash, guardLight, type LightCommand } from "./policy.ts";

/**
 * A Philips Hue Bridge, through its CLIP v2 API over HTTPS on the local
 * network, authenticated with the `hue-application-key` header.
 *
 * The hub only ever sets a grouped light (a room, a zone or the whole home)
 * to a color and brightness with a fade, and only through
 * {@link lightBody}, which passes the flash guard (policy.ts). It never
 * sends `alert`, `signaling`, an effect or Entertainment streaming.
 */

export type HueFetch = (
  url: string,
  init: BunFetchRequestInit,
) => Promise<Response>;

export class HueError extends Error {
  override readonly name = "HueError";
}

/**
 * Whether `ip` is an IPv4 address on a private or link-local network: the
 * only kind of address the hub accepts for a Bridge, because the Bridge's
 * certificate is self-signed and so is accepted unverified.
 */
export function isPrivateIPv4(ip: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a = 0, b = 0] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/** The CLIP v2 body that sets a grouped light, checked by the flash guard. */
export function lightBody(command: LightCommand): Record<string, unknown> {
  const safe = guardLight(command);
  const body: Record<string, unknown> = {
    on: { on: true },
    dimming: { brightness: safe.brightness },
    ...("xy" in safe.color
      ? { color: { xy: { x: safe.color.xy[0], y: safe.color.xy[1] } } }
      : { color_temperature: { mirek: safe.color.mirek } }),
    dynamics: { duration: safe.transitionMs },
  };
  assertNoFlash(body);
  return body;
}

/** A room, zone or the whole home, and the grouped light that controls it. */
export interface HueGroup {
  readonly kind: "room" | "zone" | "bridge_home";
  readonly name: string;
  readonly groupedLightId: string;
}

interface ClipResource {
  id?: unknown;
  metadata?: { name?: unknown };
  services?: { rid?: unknown; rtype?: unknown }[];
}

export interface Hue {
  /** Sets one grouped light: on, color, brightness, with a fade. */
  setGroupedLight(id: string, command: LightCommand): Promise<void>;
  /** The Bridge's grouped light ids. */
  groupedLightIds(): Promise<string[]>;
  /** The Bridge's rooms, zones and home, for setting up the config. */
  groups(): Promise<HueGroup[]>;
}

export function createHue({
  bridgeIp,
  appKey,
  fetch = globalThis.fetch,
  timeoutMs = 4_000,
}: {
  bridgeIp: string;
  appKey: string;
  fetch?: HueFetch;
  timeoutMs?: number;
}): Hue {
  if (!isPrivateIPv4(bridgeIp)) {
    throw new HueError(
      `The Bridge address must be a private IPv4 address, not "${bridgeIp}"`,
    );
  }
  const base = `https://${bridgeIp}/clip/v2/resource`;

  async function request(
    method: "GET" | "PUT",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ClipResource[]> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          "hue-application-key": appKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
        // The Bridge's certificate is self-signed. This client only ever
        // calls the configured Bridge, at a private address (above).
        tls: { rejectUnauthorized: false },
      });
    } catch (error) {
      throw new HueError(
        error instanceof Error && error.name === "TimeoutError"
          ? `The Bridge didn't answer within ${timeoutMs} ms`
          : `Could not reach the Bridge: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let parsed: { errors?: { description?: unknown }[]; data?: unknown };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      throw new HueError(`The Bridge answered ${response.status} without JSON`);
    }
    const errors = (parsed.errors ?? []).map((error) =>
      typeof error.description === "string"
        ? error.description
        : "unknown error",
    );
    if (!response.ok || errors.length > 0) {
      throw new HueError(
        `The Bridge answered ${response.status}: ${errors.join("; ") || "no detail"}`,
      );
    }
    return Array.isArray(parsed.data) ? (parsed.data as ClipResource[]) : [];
  }

  async function groupsOf(kind: HueGroup["kind"]): Promise<HueGroup[]> {
    const resources = await request("GET", `/${kind}`);
    return resources.flatMap((resource) => {
      const service = resource.services?.find(
        (candidate) => candidate.rtype === "grouped_light",
      );
      if (typeof service?.rid !== "string") return [];
      const name =
        kind === "bridge_home"
          ? "home (every light)"
          : typeof resource.metadata?.name === "string"
            ? resource.metadata.name
            : "unnamed";
      return [{ kind, name, groupedLightId: service.rid }];
    });
  }

  return {
    async setGroupedLight(id, command) {
      await request(
        "PUT",
        `/grouped_light/${encodeURIComponent(id)}`,
        lightBody(command),
      );
    },
    async groupedLightIds() {
      const resources = await request("GET", "/grouped_light");
      return resources.flatMap((resource) =>
        typeof resource.id === "string" ? [resource.id] : [],
      );
    },
    async groups() {
      return [
        ...(await groupsOf("bridge_home")),
        ...(await groupsOf("room")),
        ...(await groupsOf("zone")),
      ];
    },
  };
}
