import { stackServerApp } from "@/lib/stack";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export async function AuthNav() {
  const user = await stackServerApp.getUser();

  if (user) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href="/handler/sign-out">Sign Out</Link>
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/handler/sign-in">Sign In</Link>
    </Button>
  );
}
