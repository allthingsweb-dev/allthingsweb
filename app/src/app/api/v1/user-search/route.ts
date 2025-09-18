import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ilike, and, isNull } from "drizzle-orm";
import { usersSync as usersSyncTable } from "drizzle-orm/neon";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 25);

    if (!q) {
      return NextResponse.json({ users: [] });
    }

    const results = await db
      .select({ id: usersSyncTable.id, name: usersSyncTable.name, email: usersSyncTable.email })
      .from(usersSyncTable)
      .where(and(ilike(usersSyncTable.name, `%${q}%`), isNull(usersSyncTable.deletedAt)))
      .limit(limit);

    return NextResponse.json({ users: results });
  } catch (error) {
    console.error("Error searching users:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

