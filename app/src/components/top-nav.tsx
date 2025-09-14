"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MenuIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ModeToggle } from "@/components/theme-toggle";

export function TopNav() {
  return (
    <nav className="ml-auto flex items-center gap-4">
      <Popover>
        <PopoverTrigger className="md:hidden" aria-label="Toggle navigation">
          <MenuIcon className="w-6 h-6" />
        </PopoverTrigger>
        <PopoverContent align="end">
          <LinkList />
          <div className="mt-4 pt-4 border-t">
            <ModeToggle />
          </div>
        </PopoverContent>
      </Popover>
      <LinkList className="hidden md:flex" />
      <ModeToggle />
    </nav>
  );
}

function LinkList({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-col md:flex-row gap-4 md:gap-6", className)}>
      <li>
        <Link
          href="/about"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          About us
        </Link>
      </li>
      <li>
        <Link
          href="/speakers"
          className="text-sm font-medium hover:underline underline-offset-4"
        >
          Past speakers
        </Link>
      </li>
    </ul>
  );
}
