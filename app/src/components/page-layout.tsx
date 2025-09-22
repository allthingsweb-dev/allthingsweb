import { headers } from "next/headers";
import { HomeIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TopNav } from "@/components/top-nav";
import { AuthNav } from "@/components/auth-nav";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { administratorsTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { toClientUser } from "@/lib/client-user";

export async function PageLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "/";

  // Get user and admin status for TopNav
  const user = await stackServerApp.getUser();
  let isAdmin = false;
  let clientUser = null;

  if (user) {
    const adminCheck = await db
      .select()
      .from(administratorsTable)
      .where(eq(administratorsTable.userId, user.id))
      .limit(1);

    isAdmin = adminCheck.length > 0;
    clientUser = toClientUser(user);
  }

  return (
    <div className="min-h-[100dvh] max-w-[100vw] w-full flex flex-col">
      <header className="w-full px-4 lg:px-6 h-14 flex items-center">
        {pathname !== "/" && (
          <Button size="icon" variant="ghost" asChild aria-label="To homepage">
            <Link href="/">
              <HomeIcon className="w-6 h-6" />
            </Link>
          </Button>
        )}
        <TopNav authNav={<AuthNav />} user={clientUser} isAdmin={isAdmin} />
      </header>
      <main className="w-full flex flex-col items-center justify-center">
        {children}
      </main>
      <footer className="mt-auto w-full flex flex-col gap-2 sm:flex-row py-6 shrink-0 items-center px-4 md:px-6 border-t">
        <p className="text-xs text-muted-foreground">
          &copy; 2024 All Things Web. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
