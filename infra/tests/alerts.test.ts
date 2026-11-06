import { describe, expect, test } from "bun:test";
import {
  ALERT_EMAIL,
  policyBody,
  syncFailureQuery,
  syncSuccessQuery,
  webErrorRateQuery,
} from "../src/alerts.ts";
import { ALLTHINGS_ACCOUNT } from "../src/media.ts";

describe("the alerts' policies", () => {
  test("are custom alerts over the SQL API, with a threshold trigger, emailing as asked", () => {
    expect(
      policyBody({
        name: "allthings: example",
        description: "What it means.",
        query: "SELECT 1 AS value",
        operator: "<",
        threshold: 1,
        window: "2h",
        every: "10m",
        repeat: "1h",
        email: [ALERT_EMAIL],
      }),
    ).toEqual({
      name: "allthings: example",
      alert_type: "custom_analytics",
      enabled: true,
      description: "What it means.",
      alert_interval: "1h",
      mechanisms: { email: [{ id: "ethorelli@gmail.com" }] },
      filters: {
        source: ["sql_api"],
        selectors: ["SELECT 1 AS value"],
        execution_interval: ["10m"],
        alert_trigger_preferences: ["threshold"],
        alert_trigger_preferences_operator: ["<"],
        alert_trigger_preferences_value: ["1"],
        alert_trigger_preferences_short_window: ["2h"],
        alert_trigger_preferences_long_window: ["2h"],
      },
    });
  });
});

describe("the alerts' queries", () => {
  const scoped = (query: string, worker: string) => {
    // Cloudflare requires one value named `value`, one dataset, the
    // account's filter and a time range of the query's own.
    expect(query).toStartWith("SELECT ");
    expect(query).toContain(" AS value FROM logs.workersLogs WHERE ");
    expect(query).toContain(`accountTag = '${ALLTHINGS_ACCOUNT}'`);
    expect(query).toContain(`scriptName = '${worker}'`);
    expect(query).toContain("timestamp >= NOW() - INTERVAL ");
    expect(query).not.toContain(";");
  };

  test("read the site's failed requests over the last hour, as a share of at least 100", () => {
    const query = webErrorRateQuery("allthings-web-prod-x");
    scoped(query, "allthings-web-prod-x");
    expect(query).toContain("INTERVAL '1' HOUR");
    expect(query).toContain(
      "CASE WHEN COUNT(*) < 100 THEN 0.0 ELSE 100.0 * countIf(httpStatus >= 500 OR error != '') / COUNT(*) END",
    );
    expect(query).toContain("logType = 'cf-worker-event'");
  });

  test("count the sync's failed steps, unhappy summaries and thrown invocations over the last hour", () => {
    const query = syncFailureQuery("allthings-sync-prod-x");
    scoped(query, "allthings-sync-prod-x");
    expect(query).toContain("INTERVAL '1' HOUR");
    for (const failure of [
      "attributes['status'] = 'failed'",
      "attributes['step'] = 'summary' AND attributes['ok'] = false",
      "logType = 'cf-worker-event' AND error != ''",
    ]) {
      expect(query).toContain(failure);
    }
  });

  test("count the sync's good runs over the last two hours", () => {
    const query = syncSuccessQuery("allthings-sync-prod-x");
    scoped(query, "allthings-sync-prod-x");
    expect(query).toContain("INTERVAL '2' HOUR");
    expect(query).toContain(
      "attributes['step'] = 'summary' AND attributes['ok'] = true",
    );
  });
});
