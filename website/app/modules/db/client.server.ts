import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import type { MainConfig } from "~/config.server";

type Deps = {
  mainConfig: MainConfig;
};

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export function createDatabaseClient({ mainConfig }: Deps) {
  const sql = neon(mainConfig.databaseUrl);
  return drizzle({ client: sql });
}
