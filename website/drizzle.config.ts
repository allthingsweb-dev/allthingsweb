import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./app/modules/db/schema.server.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
