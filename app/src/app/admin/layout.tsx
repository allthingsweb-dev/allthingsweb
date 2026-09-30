import { PageLayout } from "@/components/page-layout";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check if user is logged in, redirect to login if not
  const user = await stackServerApp.getUser({ or: "redirect" });

  // Check if user is admin
  const userIsAdmin = await isAdmin(user.id);

  if (!userIsAdmin) {
    return (
      <PageLayout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-red-600 mb-4">
                Access Denied
              </h1>
              <p className="text-gray-600 mb-4">
                You do not have administrator privileges to access this page.
              </p>
              <Link
                href="/"
                className="inline-block bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition-colors"
              >
                Go to Home
              </Link>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return <PageLayout>{children}</PageLayout>;
}
