import { expect, test } from "bun:test";
import { ConfigProvider, Effect, Layer } from "effect";
import * as Database from "../src/database.ts";

/** The real connection is not opened here; only its configuration is. */
test("requires DATABASE_URL before connecting", async () => {
  const error = await Effect.runPromise(
    Effect.flip(Layer.build(Database.layer)).pipe(
      Effect.scoped,
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: {} }),
      ),
    ),
  );
  expect(error._tag).toBe("ConfigError");
});
