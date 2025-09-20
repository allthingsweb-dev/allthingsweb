import { stackServerApp } from "@/lib/stack";
import { ProfileButton } from "@/components/profile-button";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { administratorsTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { toClientUser } from "@/lib/client-user";

export async function AuthNav() {
  const user = await stackServerApp.getUser();

  if (user) {
    // Check if user is admin by querying the administrators table
    const adminCheck = await db
      .select()
      .from(administratorsTable)
      .where(eq(administratorsTable.userId, user.id))
      .limit(1);

    const isAdmin = adminCheck.length > 0;

    return <ProfileButton user={toClientUser(user)} isAdmin={isAdmin} />;
  }

  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/handler/sign-in">Sign In</Link>
    </Button>
  );
}
