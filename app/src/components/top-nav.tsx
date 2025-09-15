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

interface TopNavProps {
  authNav: React.ReactNode;
}

export function TopNav({ authNav }: TopNavProps) {
  return (
    <nav className="ml-auto flex items-center gap-4">
      <Popover>
        <PopoverTrigger
          className="md:hidden p-2 hover:bg-muted rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          aria-label="Toggle navigation"
        >
          <MenuIcon className="w-6 h-6" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-4">
          <LinkList />
          <div className="mt-4 pt-4 border-t flex items-center justify-between">
            <ModeToggle />
            {authNav}
          </div>
        </PopoverContent>
      </Popover>
      <LinkList className="hidden md:flex" />
      <div className="hidden md:flex items-center gap-4">
        {authNav}
        <ModeToggle />
      </div>
    </nav>
  );
}

function LinkList({ className }: { className?: string }) {
  return (
    <ul className={cn("flex flex-col md:flex-row gap-3 md:gap-6", className)}>
      <li>
        <Link
          href="/about"
          className="block text-sm font-medium hover:underline underline-offset-4 transition-colors duration-200 py-2 md:py-0 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
        >
          About us
        </Link>
      </li>
      <li>
        <Link
          href="/speakers"
          className="block text-sm font-medium hover:underline underline-offset-4 transition-colors duration-200 py-2 md:py-0 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
        >
          Past speakers
        </Link>
      </li>
    </ul>
  );
}
