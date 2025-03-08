import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

type Config = {
  databaseUrl: string;
};

type Deps = {
  mainConfig: Config;
};

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export function createDatabaseClient({ mainConfig }: Deps) {
  const sql = neon(mainConfig.databaseUrl);
  return drizzle(sql);
}
