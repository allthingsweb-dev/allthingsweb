import { useLocation } from "react-router";
import { DefaultRightTopNav } from "./right-top-nav";
import { HomeIcon } from "lucide-react";
import { ButtonNavLink } from "./ui/button";

export function PageLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <div className="min-h-[100dvh] max-w-[100vw] w-full flex flex-col">
      <header className="w-full px-4 lg:px-6 h-14 flex items-center">
        {location.pathname !== "/" && (
          <ButtonNavLink
            size="icon"
            variant="icon"
            to="/"
            aria-label="To homepage"
          >
            <HomeIcon className="w-6 h-6" />
          </ButtonNavLink>
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
