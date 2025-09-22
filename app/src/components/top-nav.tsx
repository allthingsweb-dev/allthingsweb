"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MenuIcon, User, Shield, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ModeToggle } from "@/components/theme-toggle";
import type { ClientUser } from "@/lib/client-user";
import { Button } from "@/components/ui/button";

interface TopNavProps {
  authNav: React.ReactNode;
  user?: ClientUser | null;
  isAdmin?: boolean;
}

export function TopNav({ authNav, user, isAdmin }: TopNavProps) {
  return (
    <nav className="ml-auto flex items-center gap-4">
      {/* Mobile: Dark mode toggle and hamburger menu side by side */}
      <div className="md:hidden flex items-center gap-2">
        <ModeToggle />
        <Popover>
          <PopoverTrigger
            className="p-2 hover:bg-muted rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            aria-label="Toggle navigation"
          >
            <MenuIcon className="w-6 h-6" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-4">
            <LinkList user={user} isAdmin={isAdmin} isMobile={true} />
          </PopoverContent>
        </Popover>
      </div>

      {/* Desktop: Original layout */}
      <LinkList className="hidden md:flex" />
      <div className="hidden md:flex items-center gap-4">
        {authNav}
        <ModeToggle />
      </div>
    </nav>
  );
}

function LinkList({
  className,
  user,
  isAdmin,
  isMobile = false,
}: {
  className?: string;
  user?: ClientUser | null;
  isAdmin?: boolean;
  isMobile?: boolean;
}) {
  const handleSignOut = () => {
    window.location.href = "/handler/sign-out";
  };

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

      {/* Mobile: Add auth links directly to nav menu */}
      {isMobile && user && (
        <>
          <li className="pt-3 border-t border-border">
            <Link
              href="/profile"
              className="flex items-center gap-2 text-sm font-medium hover:underline underline-offset-4 transition-colors duration-200 py-2 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
            >
              <User className="h-4 w-4" />
              My Profile
            </Link>
          </li>
          {isAdmin && (
            <li>
              <Link
                href="/admin"
                className="flex items-center gap-2 text-sm font-medium hover:underline underline-offset-4 transition-colors duration-200 py-2 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
              >
                <Shield className="h-4 w-4" />
                Admin
              </Link>
            </li>
          )}
          <li>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 text-sm font-medium hover:underline underline-offset-4 transition-colors duration-200 py-2 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm text-red-600 hover:text-red-700 w-full text-left"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </button>
          </li>
        </>
      )}

      {/* Mobile: Show sign in if no user */}
      {isMobile && !user && (
        <li className="pt-3 border-t border-border">
          <Link
            href="/handler/sign-in"
            className="block text-sm font-medium hover:underline underline-offset-4 transition-colors duration-200 py-2 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-sm"
          >
            Sign In
          </Link>
        </li>
      )}
    </ul>
  );
}
