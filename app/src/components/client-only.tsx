"use client";

import { useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/ui/icons";

interface ClientOnlyProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * A component that renders its children only after the first mount on the client.
 * This prevents hydration mismatches in Next.js applications.
 *
 * @param children - The content to render after client-side mount
 * @param fallback - Optional custom loading component (defaults to LoadingSpinner)
 */
export function ClientOnly({ children, fallback }: ClientOnlyProps) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return (
      <div className="flex items-center justify-center p-4">
        {fallback || <LoadingSpinner />}
      </div>
    );
  }

  return <>{children}</>;
}
