import { NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import type { ClientUser } from "@/lib/client-user";
import { toClientUser } from "@/lib/client-user";

export async function GET() {
  const user = await stackServerApp.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Get all users from Stack Auth and convert to client-safe format
    const serverUsers = await stackServerApp.listUsers();
    const clientUsers: ClientUser[] = serverUsers.map(toClientUser);

    return NextResponse.json({ users: clientUsers });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
