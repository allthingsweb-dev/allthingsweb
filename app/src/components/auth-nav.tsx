import { stackServerApp } from "@/lib/stack";
import { UserButton } from "@stackframe/stack";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export async function AuthNav() {
  const user = await stackServerApp.getUser();

  if (user) {
    return <UserButton />;
  }

  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/handler/sign-in">Sign In</Link>
    </Button>
  );
}
