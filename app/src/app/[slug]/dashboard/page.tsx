import { stackServerApp } from "@/lib/stack";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { toClientUser } from "@/lib/client-user";
import { isAdmin } from "@/lib/admin";
import { notFound } from "next/navigation";
import { ClientOnly } from "@/components/client-only";
import { HackathonDashboard } from "./hackathon-dashboard";
import { Toaster } from "sonner";

interface DashboardPageProps {
  params: Promise<{ slug: string }>;
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  // Require user to be logged in - redirect to login if not
  const user = await stackServerApp.getUser({ or: "redirect" });

  // Await the params in Next.js 15
  const { slug } = await params;

  // Get the event data
  const event = await getExpandedEventBySlug(slug);

  if (!event) {
    notFound();
  }

  // Only show dashboard for hackathon events
  if (!event.isHackathon) {
    notFound();
  }

  // Extract only serializable user data for the client component
  const clientUser = toClientUser(user);

  // Check if user is admin
  const userIsAdmin = await isAdmin(user.id);

  return (
    <div className="min-h-[100dvh] max-w-[100vw] w-full">
      <Toaster richColors />
      <ClientOnly
        fallback={
          <div className="min-h-screen bg-gray-50 w-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-gray-600">Loading dashboard...</p>
            </div>
          </div>
        }
      >
        <HackathonDashboard
          event={event}
          user={clientUser}
          isAdmin={userIsAdmin}
        />
      </ClientOnly>
    </div>
  );
}
