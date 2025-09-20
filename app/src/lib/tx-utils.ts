import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import type { Txid } from "@tanstack/electric-db-collection";

/**
 * Generate a transaction ID that matches Electric SQL's logical replication streams.
 *
 * Uses pg_current_xact_id()::xid::text which strips off the epoch, giving the raw 32-bit value
 * that matches what PostgreSQL sends in logical replication streams and is exposed through Electric.
 */
export async function generateTxId(): Promise<Txid> {
  // The ::xid cast strips off the epoch, giving you the raw 32-bit value
  // that matches what PostgreSQL sends in logical replication streams
  // (and then exposed through Electric which we'll match against
  // in the client).
  const result = await db.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`,
  );
  const txid = result.rows[0]?.txid;

  if (txid == null || typeof txid !== "string") {
    throw new Error(`Failed to get transaction ID`);
  }

  return parseInt(txid, 10);
}
