import { Zero } from "@rocicorp/zero";
import { schema } from "@lib/zero-sync/schema";

export type AtwZero = ReturnType<typeof createZero>;

export const createZero = () => {
  const z = new Zero({
    userID: "anon",
    server: "https://allthingsweb-sync.fly.dev",
    schema,
    kvStore: "mem",
  });
  return z;
};
