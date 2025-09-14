"use client";

import { usePathname } from "next/navigation";
import { HomeIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function PageLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

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
        <div className="ml-auto">
          {/* Add theme toggle or other nav items here later */}
        </div>
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
