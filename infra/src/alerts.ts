import * as Output from "alchemy/Output";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Cloudflare from "alchemy/Cloudflare";
import {
  Credentials,
  formatHeaders,
} from "@distilled.cloud/cloudflare/Credentials";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ALLTHINGS_ACCOUNT } from "./media.ts";

/**
 * Production's alerts, as Cloudflare notification policies: email to the
 * maintainer when the site's Worker fails, when an hourly sync fails, and
 * when no sync has succeeded for two hours. Each is a custom alert
 * (`custom_analytics`): Cloudflare runs an SQL query over the account's
 * Workers Logs (`logs.workersLogs`, the lines each Worker logs and one per
 * invocation) on a schedule, and notifies when its `value` crosses the
 * threshold. Nothing runs in our Workers for it, so an alert still fires
 * when a Worker can't run at all.
 *
 * Alchemy's own `NotificationPolicy` can't declare these: the filters a
 * custom alert needs (the query, its schedule and its trigger) are missing
 * from its pinned schema, which drops them. So {@link SqlAlert} is a
 * resource of our own, with a provider that calls the same notification
 * policies API with the deploy's Cloudflare credentials.
 */

/** Who the alerts email: the allthings account's one member. */
export const ALERT_EMAIL = "ethorelli@gmail.com";

/** A comparison a threshold alert fires on. */
export type AlertOperator = ">" | ">=" | "<" | "<=";

export interface SqlAlertProps {
  /** The policy's name in Cloudflare's notifications, and the email's subject. */
  readonly name: string;
  /** What it means, and what to do: shown with the policy. */
  readonly description: string;
  /**
   * The SQL API query Cloudflare runs: one numeric column named `value`,
   * one dataset, the account's filter and its own time range.
   */
  readonly query: string;
  /** It fires when `value` is `operator` `threshold`. */
  readonly operator: AlertOperator;
  readonly threshold: number;
  /** The span the query reads, as the trigger's window (`"1h"`). */
  readonly window: string;
  /** How often Cloudflare runs the query (`"10m"`; Logs datasets allow no less). */
  readonly every: string;
  /** How often an alert that keeps firing emails again (`"1h"`). */
  readonly repeat: string;
  /** Who it emails. */
  readonly email: ReadonlyArray<string>;
}

export type SqlAlert = Resource<
  "Allthings.Cloudflare.SqlAlert",
  SqlAlertProps,
  {
    /** Cloudflare's id for the notification policy. */
    readonly policyId: string;
    /** The account that holds it. */
    readonly accountId: string;
  }
>;

export const SqlAlert = Resource<SqlAlert>("Allthings.Cloudflare.SqlAlert");

/**
 * The notification policy Cloudflare's API takes for an alert: a custom
 * alert over the SQL API, with a threshold trigger. Every filter value is
 * a list of strings, as the API keeps them.
 */
export const policyBody = (props: SqlAlertProps) => ({
  name: props.name,
  alert_type: "custom_analytics",
  enabled: true,
  description: props.description,
  alert_interval: props.repeat,
  mechanisms: { email: props.email.map((id) => ({ id })) },
  filters: {
    source: ["sql_api"],
    selectors: [props.query],
    execution_interval: [props.every],
    alert_trigger_preferences: ["threshold"],
    alert_trigger_preferences_operator: [props.operator],
    alert_trigger_preferences_value: [String(props.threshold)],
    alert_trigger_preferences_short_window: [props.window],
    alert_trigger_preferences_long_window: [props.window],
  },
});

/** Cloudflare's v4 answer: `result` when it succeeded. */
interface Answer<T> {
  readonly success?: boolean;
  readonly result?: T;
  readonly errors?: ReadonlyArray<{
    readonly code?: number;
    readonly message?: string;
  }>;
}

/** One call to the account's notification policies, with the deploy's credentials. */
const policies = <T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  accountId: string,
  path: string,
  body?: unknown,
) =>
  Effect.gen(function* () {
    const credentials = yield* yield* Credentials;
    const response = yield* Effect.tryPromise(() =>
      fetch(
        `${credentials.apiBaseUrl}/accounts/${accountId}/alerting/v3/policies${path}`,
        {
          method,
          headers: {
            ...formatHeaders(credentials),
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      ),
    );
    const answer = (yield* Effect.tryPromise(() =>
      response.json(),
    )) as Answer<T>;
    return { status: response.status, answer };
  });

/** What Cloudflare holds under `policyId`, or undefined when it holds none. */
const findById = (accountId: string, policyId: string) =>
  policies<{ readonly id: string }>("GET", accountId, `/${policyId}`).pipe(
    Effect.map(({ answer }) =>
      answer.success === true && answer.result?.id === policyId
        ? policyId
        : undefined,
    ),
  );

/** The id of the account's policy named `name`, if there is one. */
const findByName = (accountId: string, name: string) =>
  policies<ReadonlyArray<{ readonly id: string; readonly name: string }>>(
    "GET",
    accountId,
    "",
  ).pipe(
    Effect.map(
      ({ answer }) => answer.result?.find((policy) => policy.name === name)?.id,
    ),
  );

const failed = (what: string, answer: Answer<unknown>) =>
  new Error(
    `Cloudflare refused to ${what}: ${(answer.errors ?? [])
      .map((error) => `${error.code ?? "?"} ${error.message ?? ""}`)
      .join("; ")}`,
  );

export const SqlAlertProvider = () =>
  Provider.succeed(SqlAlert, {
    reconcile: Effect.fn(function* ({ news, output }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const body = policyBody(news);
      // The policy it made before, else one of the same name (state lost).
      const existing =
        (output?.policyId === undefined
          ? undefined
          : yield* findById(accountId, output.policyId)) ??
        (yield* findByName(accountId, news.name));
      if (existing !== undefined) {
        const { answer } = yield* policies(
          "PUT",
          accountId,
          `/${existing}`,
          body,
        );
        if (answer.success !== true) {
          return yield* Effect.fail(failed(`update "${news.name}"`, answer));
        }
        return { policyId: existing, accountId };
      }
      const { answer } = yield* policies<{ readonly id?: string }>(
        "POST",
        accountId,
        "",
        body,
      );
      if (answer.success !== true || answer.result?.id === undefined) {
        return yield* Effect.fail(failed(`create "${news.name}"`, answer));
      }
      return { policyId: answer.result.id, accountId };
    }),
    delete: Effect.fn(function* ({ output }) {
      const { status, answer } = yield* policies(
        "DELETE",
        output.accountId,
        `/${output.policyId}`,
      );
      // Gone already is gone.
      if (answer.success !== true && status !== 404) {
        yield* Effect.fail(failed("delete an alert", answer));
      }
    }),
    read: Effect.fn(function* ({ output }) {
      if (output === undefined) return undefined;
      const found = yield* findById(output.accountId, output.policyId);
      return found === undefined ? undefined : output;
    }),
    list: () => Effect.succeed([]),
  });

/**
 * The providers the stack runs with: Alchemy's Cloudflare providers, and
 * {@link SqlAlertProvider} beside them, on the same credentials and account.
 */
export const withAlertProviders = <A, E, R>(cloudflare: Layer.Layer<A, E, R>) =>
  SqlAlertProvider().pipe(Layer.provideMerge(cloudflare));

/** How each alert reads the logs: the account's own, over its last `span`. */
const logsOf = (workerName: string, span: string) =>
  `FROM logs.workersLogs WHERE accountTag = '${ALLTHINGS_ACCOUNT}' AND scriptName = '${workerName}' AND timestamp >= NOW() - INTERVAL ${span}`;

/**
 * The share of the site's requests, in percent, that the Worker failed over
 * the last hour: a 5xx status, or an invocation that threw. Each request
 * logs one invocation line (`cf-worker-event`). Fewer than 100 (Workers
 * Logs samples, so this counts what they stand for) read as 0, so a quiet
 * hour's one failure doesn't page anyone.
 */
export const webErrorRateQuery = (workerName: string) =>
  `SELECT CASE WHEN COUNT(*) < 100 THEN 0.0 ELSE 100.0 * countIf(httpStatus >= 500 OR error != '') / COUNT(*) END AS value ${logsOf(workerName, "'1' HOUR")} AND logType = 'cf-worker-event'`;

/**
 * Failures of the sync in the last hour: a step that failed, a run whose
 * summary isn't ok, a preflight that refused (web/src/sync/run.ts and
 * worker.ts log each as JSON, which Workers Logs keeps as attributes), or
 * an invocation that threw.
 */
export const syncFailureQuery = (workerName: string) =>
  `SELECT COUNT(*) AS value ${logsOf(workerName, "'1' HOUR")} AND (attributes['status'] = 'failed' OR (attributes['step'] = 'summary' AND attributes['ok'] = false) OR (logType = 'cf-worker-event' AND error != ''))`;

/** Runs of the sync that succeeded in the last two hours: their `ok` summaries. */
export const syncSuccessQuery = (workerName: string) =>
  `SELECT COUNT(*) AS value ${logsOf(workerName, "'2' HOUR")} AND attributes['step'] = 'summary' AND attributes['ok'] = true`;

/**
 * Production's three alerts, for the site's Worker and the sync's, by
 * their script names (the Workers' `workerName`). Every 10 minutes, the
 * least a Logs dataset allows; one email an hour while one keeps firing.
 */
export const makeAlerts = (
  web: Output.Output<string> | undefined,
  sync: Output.Output<string> | undefined,
) =>
  Effect.gen(function* () {
    const schedule = {
      every: "10m",
      repeat: "1h",
      email: [ALERT_EMAIL],
    } as const;
    if (web !== undefined) {
      yield* SqlAlert("WebErrors", {
        name: "allthings: site errors over 5%",
        description:
          "Over 5% of allthings.dev's requests in the last hour failed in its Worker (a 5xx or an exception). Its Workers Logs say which (infra/README.md, Alerts).",
        query: web.pipe(Output.map(webErrorRateQuery)),
        operator: ">",
        threshold: 5,
        window: "1h",
        ...schedule,
      });
    }
    if (sync !== undefined) {
      yield* SqlAlert("SyncFailed", {
        name: "allthings: hourly sync failed",
        description:
          "A run of the hourly Luma sync failed in the last hour: a step, its preflight or the invocation. Its luma-sync lines in Workers Logs say which (infra/README.md, Alerts).",
        query: sync.pipe(Output.map(syncFailureQuery)),
        operator: ">",
        threshold: 0,
        window: "1h",
        ...schedule,
      });
      yield* SqlAlert("SyncStale", {
        name: "allthings: no good sync for 2 hours",
        description:
          "No run of the hourly Luma sync has succeeded in the last two hours, so the site's data may be stale. Check the Sync Worker's Cron Trigger and its luma-sync lines in Workers Logs (infra/README.md, Alerts).",
        query: sync.pipe(Output.map(syncSuccessQuery)),
        operator: "<",
        threshold: 1,
        window: "2h",
        ...schedule,
      });
    }
  });
