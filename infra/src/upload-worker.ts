import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import { Media } from "./media.ts";

/**
 * Stores and deletes media objects for the app while it runs outside
 * Cloudflare. The bucket is a binding, so no R2 credential exists anywhere;
 * callers present a bearer token Alchemy generates once and keeps in state.
 * Once the app runs on Workers it binds the bucket itself and this goes away.
 */
export const MediaUpload = Cloudflare.Worker("MediaUpload", {
  main: "./src/media-upload.ts",
  compatibility: { date: "2026-10-01" },
  env: {
    MEDIA: Media,
    UPLOAD_TOKEN: Alchemy.makeRandom("MediaUploadToken"),
  },
});

export type MediaUploadEnv = Cloudflare.InferEnv<typeof MediaUpload>;

/**
 * Deploy-time proof that uploads work: stores and deletes one object through
 * the Worker with the real token. Runs again whenever the Worker changes.
 */
export const MediaUploadCheck = Alchemy.Action(
  "MediaUploadCheck",
  (input: { url: string; token: Redacted.Redacted; workerHash: string }) => {
    const object = `${input.url}/deploy-checks/${input.workerHash}.txt`;
    const authorization = `Bearer ${Redacted.value(input.token)}`;
    const expect = (method: "PUT" | "DELETE", status: number) =>
      Effect.tryPromise(() =>
        fetch(object, {
          method,
          headers: { authorization, "content-type": "text/plain" },
          ...(method === "PUT" ? { body: "ok" } : {}),
        }),
      ).pipe(
        Effect.filterOrFail(
          (response) => response.status === status,
          (response) =>
            new Error(`${method} returned ${response.status}, not ${status}`),
        ),
        // A new workers.dev route takes a few seconds to answer.
        Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 15 }),
      );
    return Effect.gen(function* () {
      yield* expect("PUT", 201);
      yield* expect("DELETE", 204);
      return { checked: input.workerHash };
    }).pipe(Effect.orDie);
  },
);
