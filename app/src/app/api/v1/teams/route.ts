import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { hacksTable, hackUsersTable } from "@/lib/schema";
import { generateTxId } from "@/lib/tx-utils";

// POST - Create team (hack + hack users)
export async function POST(request: NextRequest) {
  try {
    console.log("🚀 POST /api/v1/teams - Starting team creation");

    const user = await stackServerApp.getUser();
    console.log("👤 POST /api/v1/teams - User authentication", {
      userId: user?.id,
      userEmail: user?.primaryEmail,
      authenticated: !!user,
    });

    if (!user) {
      console.warn("❌ POST /api/v1/teams - Unauthorized access attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("📥 POST /api/v1/teams - Request body", { body });

    const { hackData, userIds } = body;

    console.log("🔗 POST /api/v1/teams - Team creation data", {
      hackData,
      userIds,
      userCount: userIds?.length,
    });

    // Start a database transaction
    const result = await db.transaction(async (tx) => {
      console.log("💾 POST /api/v1/teams - Creating hack in transaction");

      // Insert the hack first
      const [newHack] = await tx
        .insert(hacksTable)
        .values(hackData)
        .returning();

      console.log("✅ POST /api/v1/teams - Hack created", { newHack });

      // Insert all hack users
      const hackUsers = [];
      for (const userId of userIds) {
        console.log("💾 POST /api/v1/teams - Adding user to hack", {
          hackId: newHack.id,
          userId,
          compositeKey: `${newHack.id}-${userId}`,
        });

        const [newHackUser] = await tx
          .insert(hackUsersTable)
          .values({
            hackId: newHack.id,
            userId,
          })
          .returning();

        hackUsers.push(newHackUser);
        console.log("✅ POST /api/v1/teams - User added to hack", {
          newHackUser,
        });
      }

      return { hack: newHack, hackUsers };
    });

    // Generate transaction ID for Electric SQL sync
    const txid = await generateTxId();
    console.log("🔄 POST /api/v1/teams - Generated txid", { txid });

    const response = {
      message: "Team created successfully",
      hack: result.hack,
      hackUsers: result.hackUsers,
      txid: txid,
    };
    console.log("📤 POST /api/v1/teams - Sending response", { response });

    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ POST /api/v1/teams - Error creating team:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
