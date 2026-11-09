import { describe, expect, test } from "bun:test";
import {
  createHue,
  type HueFetch,
  HueError,
  isPrivateIPv4,
  lightBody,
} from "../src/hue.ts";
import { forbiddenLightKeys, type LightCommand } from "../src/policy.ts";

// A made-up address on a private range: the Bridge's real one stays local.
const bridgeIp = "10.20.30.40";
const appKey = "test-app-key-0123456789";

type Sent = { url: string; init: BunFetchRequestInit; body: unknown };

function fakeBridge(
  answer: (url: string) => Response = () =>
    Response.json({ errors: [], data: [{ rid: "x", rtype: "grouped_light" }] }),
): { fetch: HueFetch; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    fetch: async (url, init) => {
      sent.push({
        url,
        init,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return answer(url);
    },
  };
}

/** Every key anywhere in `value`, nested ones included. */
function keysOf(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [
    key,
    ...keysOf(inner),
  ]);
}

describe("Hue client", () => {
  test("sets a grouped light over HTTPS with the application key and a fade", async () => {
    const { fetch, sent } = fakeBridge();
    const hue = createHue({ bridgeIp, appKey, fetch });
    await hue.setGroupedLight("zone-1", {
      color: { xy: [0.58, 0.39] },
      brightness: 60,
      transitionMs: 2_000,
    });
    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe(
      `https://${bridgeIp}/clip/v2/resource/grouped_light/zone-1`,
    );
    expect(request?.init.method).toBe("PUT");
    expect(request?.init.headers).toMatchObject({
      "hue-application-key": appKey,
      "content-type": "application/json",
    });
    // The Bridge's certificate is self-signed.
    expect(request?.init.tls).toEqual({ rejectUnauthorized: false });
    expect(request?.init.signal).toBeInstanceOf(AbortSignal);
    expect(request?.body).toEqual({
      on: { on: true },
      dimming: { brightness: 60 },
      color: { xy: { x: 0.58, y: 0.39 } },
      dynamics: { duration: 2_000 },
    });
  });

  test("never sends signaling, alert or effects, and always fades 1.5 s or more", async () => {
    const { fetch, sent } = fakeBridge();
    const hue = createHue({ bridgeIp, appKey, fetch });
    const commands: LightCommand[] = [];
    for (let i = 0; i < 200; i++) {
      commands.push({
        color:
          i % 2 === 0 ? { mirek: 100 + i * 3 } : { xy: [i / 150, 1 - i / 150] },
        brightness: i - 50,
        transitionMs: i * 20 - 500,
      });
    }
    for (const command of commands) await hue.setGroupedLight("g", command);
    expect(sent).toHaveLength(commands.length);
    for (const { body } of sent) {
      const keys = keysOf(body);
      for (const forbidden of forbiddenLightKeys) {
        expect(keys).not.toContain(forbidden);
      }
      const { dynamics, dimming } = body as {
        dynamics: { duration: number };
        dimming: { brightness: number };
      };
      expect(dynamics.duration).toBeGreaterThanOrEqual(1_500);
      expect(dimming.brightness).toBeGreaterThanOrEqual(25);
      expect(dimming.brightness).toBeLessThanOrEqual(80);
    }
  });

  test("a white is a color temperature", () => {
    expect(
      lightBody({ color: { mirek: 370 }, brightness: 80, transitionMs: 1_500 }),
    ).toEqual({
      on: { on: true },
      dimming: { brightness: 80 },
      color_temperature: { mirek: 370 },
      dynamics: { duration: 1_500 },
    });
  });

  test("accepts only a private IPv4 Bridge address", () => {
    for (const ip of [
      "10.0.0.2",
      "172.16.0.9",
      "172.31.255.1",
      "192.168.0.2",
      "169.254.1.1",
    ]) {
      expect(isPrivateIPv4(ip)).toBe(true);
    }
    for (const ip of [
      "8.8.8.8",
      "172.32.0.1",
      "192.169.0.1",
      "192.168.0.256",
      "allthings.dev",
      "localhost",
      "::1",
      "10.0.0.2/evil",
    ]) {
      expect(isPrivateIPv4(ip)).toBe(false);
    }
    expect(() => createHue({ bridgeIp: "8.8.8.8", appKey })).toThrow(HueError);
  });

  test("the Bridge's errors, a bad status and a timeout are Hue errors", async () => {
    const command: LightCommand = {
      color: { mirek: 300 },
      brightness: 50,
      transitionMs: 2_000,
    };
    const refusing = createHue({
      bridgeIp,
      appKey,
      fetch: fakeBridge(() =>
        Response.json({
          errors: [{ description: "device unreachable" }],
          data: [],
        }),
      ).fetch,
    });
    await expect(refusing.setGroupedLight("g", command)).rejects.toThrow(
      "device unreachable",
    );
    const unauthorized = createHue({
      bridgeIp,
      appKey,
      fetch: fakeBridge(() =>
        Response.json(
          { errors: [{ description: "unauthorized user" }] },
          { status: 403 },
        ),
      ).fetch,
    });
    await expect(unauthorized.setGroupedLight("g", command)).rejects.toThrow(
      "answered 403",
    );
    const silent = createHue({
      bridgeIp,
      appKey,
      timeoutMs: 1_000,
      fetch: async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      },
    });
    await expect(silent.setGroupedLight("g", command)).rejects.toThrow(
      "didn't answer within 1000 ms",
    );
  });

  test("lists the home, rooms and zones with their grouped lights", async () => {
    const { fetch } = fakeBridge((url) =>
      Response.json({
        errors: [],
        data: url.endsWith("/bridge_home")
          ? [
              {
                id: "h",
                services: [{ rid: "gl-home", rtype: "grouped_light" }],
              },
            ]
          : url.endsWith("/room")
            ? [
                {
                  id: "r",
                  metadata: { name: "Lounge" },
                  services: [
                    { rid: "dev", rtype: "device" },
                    { rid: "gl-lounge", rtype: "grouped_light" },
                  ],
                },
              ]
            : url.endsWith("/zone")
              ? [
                  {
                    id: "z",
                    metadata: { name: "Terrace" },
                    services: [{ rid: "gl-terrace", rtype: "grouped_light" }],
                  },
                ]
              : [{ id: "gl-home" }, { id: "gl-lounge" }, { id: "gl-terrace" }],
      }),
    );
    const hue = createHue({ bridgeIp, appKey, fetch });
    expect(await hue.groups()).toEqual([
      {
        kind: "bridge_home",
        name: "home (every light)",
        groupedLightId: "gl-home",
      },
      { kind: "room", name: "Lounge", groupedLightId: "gl-lounge" },
      { kind: "zone", name: "Terrace", groupedLightId: "gl-terrace" },
    ]);
    expect(await hue.groupedLightIds()).toEqual([
      "gl-home",
      "gl-lounge",
      "gl-terrace",
    ]);
  });
});
