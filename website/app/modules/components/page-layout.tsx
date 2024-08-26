import { NavLink, useLocation } from "@remix-run/react";
import { DefaultRightTopNav } from "./right-top-nav";
import { HomeIcon } from "lucide-react";

export function PageLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div className="min-h-[100dvh] max-w-[100vw] w-full flex flex-col">
      <header className="w-full px-4 lg:px-6 h-14 flex items-center">
        {location.pathname !== "/" && (
          <NavLink to="/" aria-label="To homepage">
            <HomeIcon className="w-4 h-4" />
          </NavLink>
        )}
        <DefaultRightTopNav />
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
