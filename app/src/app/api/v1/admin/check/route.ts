import { NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";

export async function GET() {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ isAdmin: false });
    }

    const adminStatus = await isAdmin(user.id);
    return NextResponse.json({ isAdmin: adminStatus });
  } catch (error) {
    console.error("Error checking admin status:", error);
    return NextResponse.json({ isAdmin: false });
  }
}
