import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { mainConfig } from "@/lib/config";

const sql = neon(mainConfig.database.databaseUrl);
export const db = drizzle({ client: sql });
