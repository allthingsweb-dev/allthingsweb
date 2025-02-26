import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";

export default function Header() {
  return (
    <header className="flex items-center justify-center py-8 px-4">
      <SignedOut>
        <SignInButton />
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </header>
  );
}