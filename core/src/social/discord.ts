import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

/**
 * A Discord channel webhook, as discord.com/developers/docs documents it:
 * what the event studio needs to send an evening's message to our server.
 *
 * - `GET` the webhook: its name, and the server and channel it posts to.
 * - `POST` the webhook with `?wait=true`: one message, which Discord
 *   answers with its id. `allowed_mentions` is empty, so no text in a
 *   draft can ping anyone.
 * - `GET` one of the webhook's messages by id: what it says, so that a
 *   message found in the channel after a send went unanswered can be
 *   recorded as the one sent.
 *
 * The webhook's URL is its secret (DISCORD_WEBHOOK_URL): nothing here puts
 * it in a message or an error. A webhook can't list what it sent, so the
 * caller keeps the record (src/social/sent-posts.ts). A message is sent
 * once: an answer that says Discord didn't take it is `DiscordRefused`;
 * no answer (none in 30 seconds counts as none), or a server error, is
 * `DiscordUnanswered`, for it may have.
 */

/** Discord didn't take the message: nothing was sent. */
export class DiscordRefused extends Schema.TaggedError<DiscordRefused>()(
  "DiscordRefused",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** No answer to say whether Discord took it: it may have. */
export class DiscordUnanswered extends Schema.TaggedError<DiscordUnanswered>()(
  "DiscordUnanswered",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** A channel webhook's URL, on any of Discord's hosts. */
const webhookUrl =
  /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{1,20})\/[\w-]{1,100}$/;

/** Where the webhook posts, without its secret. */
export interface Webhook {
  readonly id: string;
  readonly name: string;
  readonly guildId: string;
  readonly channelId: string;
}

/** A message as the webhook sends it. */
export interface MessageContent {
  readonly content: string;
  readonly allowed_mentions: { readonly parse: ReadonlyArray<never> };
}

/** A message's page in the Discord app. */
export const messageUrl = (webhook: Webhook, messageId: string): string =>
  `https://discord.com/channels/${webhook.guildId}/${webhook.channelId}/${messageId}`;

const WebhookBody = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  guild_id: Schema.String,
  channel_id: Schema.String,
});

const MessageBody = Schema.Struct({
  id: Schema.String,
  channel_id: Schema.String,
});

const SentMessage = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
});

/** How long any request waits for Discord's answer. */
export const answerTimeout = "30 seconds";

export interface DiscordShape {
  /** The webhook DISCORD_WEBHOOK_URL names: where it posts. Reads only. */
  readonly webhook: Effect.Effect<Webhook, DiscordRefused | DiscordUnanswered>;
  /** Sends `message` through the webhook, once: the message's id. */
  readonly send: (
    message: MessageContent,
  ) => Effect.Effect<
    { readonly id: string },
    DiscordRefused | DiscordUnanswered
  >;
  /** One message this webhook sent, by id: None when it sent no such message. */
  readonly sentMessage: (
    id: string,
  ) => Effect.Effect<
    Option.Option<{ readonly id: string; readonly content: string }>,
    DiscordRefused | DiscordUnanswered
  >;
}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const url = yield* Config.option(Config.Redacted("DISCORD_WEBHOOK_URL"));

  const target = Effect.gen(function* () {
    if (Option.isNone(url)) {
      return yield* new DiscordRefused({
        reason:
          "DISCORD_WEBHOOK_URL is not set: there is no channel to read or post to.",
      });
    }
    const value = Redacted.value(url.value);
    if (!webhookUrl.test(value)) {
      return yield* new DiscordRefused({
        reason: "DISCORD_WEBHOOK_URL is not a Discord channel webhook's URL.",
      });
    }
    return value;
  });

  /** One request, sent once: the body of a 2xx answer, or why there's none. */
  const exchange = (
    request: HttpClientRequest.HttpClientRequest,
    what: string,
  ): Effect.Effect<string, DiscordRefused | DiscordUnanswered> =>
    Effect.gen(function* () {
      const response = yield* client.execute(request);
      if (response.status >= 200 && response.status < 300) {
        return yield* response.text;
      }
      if (response.status >= 500) {
        return yield* new DiscordUnanswered({
          reason: `Discord failed ${what}: ${response.status}`,
        });
      }
      return yield* new DiscordRefused({
        reason: `Discord refused ${what}: ${response.status}`,
      });
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.fail(
          new DiscordUnanswered({ reason: `Discord didn't answer ${what}` }),
        ),
      ),
      Effect.timeoutOrElse({
        duration: answerTimeout,
        orElse: () =>
          Effect.fail(
            new DiscordUnanswered({
              reason: `Discord didn't answer ${what} in ${answerTimeout}`,
            }),
          ),
      }),
    );

  const decode =
    <S extends Schema.Top>(schema: S, what: string) =>
    (body: string): Effect.Effect<S["Type"], DiscordUnanswered> =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
        Effect.mapError(
          () =>
            new DiscordUnanswered({
              reason: `Discord's answer to ${what} is not as documented`,
            }),
        ),
      ) as Effect.Effect<S["Type"], DiscordUnanswered>;

  const webhook = Effect.gen(function* () {
    const at = yield* target;
    const body = yield* exchange(HttpClientRequest.get(at), "the webhook");
    const read = yield* decode(WebhookBody, "the webhook")(body);
    return {
      id: read.id,
      name: read.name ?? "",
      guildId: read.guild_id,
      channelId: read.channel_id,
    } satisfies Webhook;
  });

  const send = (message: MessageContent) =>
    Effect.gen(function* () {
      const at = yield* target;
      const body = yield* exchange(
        HttpClientRequest.post(at).pipe(
          HttpClientRequest.setUrlParams({ wait: "true" }),
          HttpClientRequest.bodyJsonUnsafe(message),
        ),
        "the message",
      );
      // Discord took it, but an answer we can't read has no id: that is
      // DiscordUnanswered, so the claim waits for an organizer's --sent.
      const read = yield* decode(MessageBody, "the message")(body);
      return { id: read.id };
    });

  const sentMessage = (id: string) =>
    Effect.gen(function* () {
      if (!/^\d{1,20}$/.test(id)) return Option.none();
      const at = yield* target;
      const body = yield* exchange(
        HttpClientRequest.get(`${at}/messages/${id}`),
        "the message",
      ).pipe(
        Effect.map(Option.some),
        Effect.catchTag("DiscordRefused", (error) =>
          error.reason.endsWith(": 404")
            ? Effect.succeedNone
            : Effect.fail(error),
        ),
      );
      if (Option.isNone(body)) return Option.none();
      const read = yield* decode(SentMessage, "the message")(body.value);
      return Option.some({ id: read.id, content: read.content });
    });

  return Discord.of({ webhook, send, sentMessage });
});

export class Discord extends Context.Service<Discord, DiscordShape>()(
  "allthings/Discord",
) {
  /** Needs an `HttpClient`: `FetchHttpClient.layer` from the CLI. */
  static readonly layer = Layer.effect(Discord, make);
}
