import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { hackUsersTable } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { generateTxId } from "@/lib/tx-utils";

// POST - Add user to hack (team)
export async function POST(request: NextRequest) {
  try {
    console.log("🚀 POST /api/v1/hack-users - Starting hack user creation");

    const user = await stackServerApp.getUser();
    console.log("👤 POST /api/v1/hack-users - User authentication", {
      userId: user?.id,
      userEmail: user?.primaryEmail,
      authenticated: !!user,
    });

    if (!user) {
      console.warn("❌ POST /api/v1/hack-users - Unauthorized access attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("📥 POST /api/v1/hack-users - Request body", { body });

    // Transform field names from snake_case to camelCase for Drizzle schema
    const hackId = body.hack_id;
    const userId = body.user_id;
    console.log("🔗 POST /api/v1/hack-users - Relationship data", {
      hackId,
      userId,
      compositeKey: `${hackId}-${userId}`,
    });

    const insertData = {
      hackId,
      userId,
    };
    console.log("💾 POST /api/v1/hack-users - Inserting into database", {
      insertData,
    });

    // Insert the new hack user relationship
    const [newHackUser] = await db
      .insert(hackUsersTable)
      .values(insertData)
      .returning();

    console.log("✅ POST /api/v1/hack-users - Database insert successful", {
      newHackUser,
    });

    // Generate transaction ID for Electric SQL sync
    const txid = await generateTxId();
    console.log("🔄 POST /api/v1/hack-users - Generated txid", { txid });

    const response = {
      message: "User added to hack successfully",
      hackUser: newHackUser,
      txid: txid,
    };
    console.log("📤 POST /api/v1/hack-users - Sending response", { response });

    return NextResponse.json(response);
  } catch (error) {
    console.error(
      "❌ POST /api/v1/hack-users - Error adding user to hack:",
      error,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE - Remove user from hack
export async function DELETE(request: NextRequest) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    // Transform field names from snake_case to camelCase for Drizzle schema
    const hackId = body.hack_id;
    const userId = body.user_id;

    // Delete the hack user relationship
    await db
      .delete(hackUsersTable)
      .where(
        and(
          eq(hackUsersTable.hackId, hackId),
          eq(hackUsersTable.userId, userId),
        ),
      );

    // Generate transaction ID for Electric SQL sync
    const txid = await generateTxId();

    return NextResponse.json({
      message: "User removed from hack successfully",
      txid: txid,
    });
  } catch (error) {
    console.error("Error removing user from hack:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT - Update hack user (not typically used)
export async function PUT(request: NextRequest) {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

// GET - List hack users
export async function GET(request: NextRequest) {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
